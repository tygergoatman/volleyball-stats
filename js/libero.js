/**
 * The libero tracking sheet, derived from the events already recorded.
 *
 * This mirrors the paper sheet a book keeper fills in: six serving-order rows,
 * each showing who started there and every player who has come and gone since,
 * plus the team's substitution count for the set.
 *
 * Almost none of it is stored. Serving order, who currently occupies each row,
 * how many times each row has served, and the court position each row is
 * standing in are all replayed from the event list — the same reason undo and
 * mid-log corrections leave the score right. The only thing the app has to be
 * *told* is whether a replacement was a libero swap or a substitution, because
 * that is the one distinction the rules care about and it cannot be inferred
 * from the rally.
 *
 * Serving order I–VI is simply the starting lineup in array order: the player in
 * position 1 serves first, and a rotation brings position 2 to position 1 next.
 * Rotation shifts all six uniformly and a substitution replaces a player in
 * place, so the order never scrambles for the whole set.
 */

import { FRONT_ROW, pointFor } from './model.js';

/** Substitutions allowed per set. NFHS; USAV and NCAA play 12. */
export const SUB_LIMIT = 15;

export const SERVING_ORDER = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/**
 * Build the sheet for one set.
 *
 * @param {object} set
 * @param {{liberoIds?: Array<string>, subLimit?: number}} [options]
 * @returns {{
 *   rows: Array<object>,
 *   subsUsed: number,
 *   subLimit: number,
 *   subsLeft: number,
 *   liberoOnCourt: string|null,
 *   warnings: Array<string>,
 * }}
 */
export function liberoSheet(set, { liberoIds = [], subLimit = SUB_LIMIT } = {}) {
    const liberos = new Set(liberoIds.filter(Boolean));
    const isLibero = (id) => liberos.has(id);

    const starting = (set?.startingLineup ?? []).slice(0, 6);
    const slots = starting.map((id) => ({
        startingPlayerId: id ?? null,
        // Every player who has occupied this row, oldest first. `left` marks the
        // ones already gone, which is the strike-through on the paper sheet.
        entries: id ? [{ playerId: id, libero: isLibero(id), left: false }] : [],
        current: id ?? null,
        serves: 0,
    }));
    while (slots.length < 6) {
        slots.push({ startingPlayerId: null, entries: [], current: null, serves: 0 });
    }

    const slotHolding = (playerId) => slots.findIndex((slot) => slot.current === playerId);

    let serving = set?.startingServer ?? 'us';
    let rotations = 0;
    let subsUsed = 0;

    // The one rotational row the libero may serve in. It is never declared —
    // it is whichever row a libero first actually serves from, and serving from
    // a second one is the violation this exists to catch. The team gets one row
    // between them, which is why two liberos do not get two.
    let serveRow = null;
    const serveRowBreaches = [];

    // Position 1 always holds serving-order row (rotations mod 6).
    const servingRow = () => rotations % 6;

    /** Called each time a new term of service begins for us. */
    const beginService = () => {
        const index = servingRow();
        slots[index].serves += 1;
        if (!isLibero(slots[index].current)) return;
        if (serveRow === null) serveRow = index;
        else if (serveRow !== index) serveRowBreaches.push(index);
    };

    // Serving from the first whistle is a term of service like any other.
    if (serving === 'us') beginService();

    for (const event of set?.events ?? []) {
        if (event.type === 'sub') {
            const index = slotHolding(event.outId);
            if (index === -1) continue;

            const slot = slots[index];
            const last = slot.entries[slot.entries.length - 1];
            if (last) last.left = true;
            slot.entries.push({
                playerId: event.inId,
                libero: isLibero(event.inId),
                left: false,
            });
            slot.current = event.inId;

            // A libero replacement is unlimited and never counts against the
            // set's substitutions — the entire reason this sheet is separate
            // from the score book. Events recorded before the app knew the
            // difference are read by who is involved.
            if (!isLiberoReplacement(event, isLibero)) subsUsed += 1;
            continue;
        }

        const winner = pointFor(event);
        if (winner === 'us') {
            const alreadyServing = serving === 'us';
            // Winning a rally the opponent served is a side-out: we rotate, and
            // whoever lands in position 1 begins a new term of service.
            if (!alreadyServing) {
                rotations += 1;
                beginService();
            }
            serving = 'us';
        } else if (winner === 'them') {
            serving = 'them';
        }
    }

    const rows = slots.map((slot, index) => {
        // Row k started in position k+1 and has rotated backwards since.
        const courtPosition = ((((index - rotations) % 6) + 6) % 6) + 1;
        return {
            order: SERVING_ORDER[index],
            index,
            startingPlayerId: slot.startingPlayerId,
            entries: slot.entries,
            currentPlayerId: slot.current,
            // Who the current occupant replaced — the player a libero swap puts
            // back on court.
            previousPlayerId: slot.entries[slot.entries.length - 2]?.playerId ?? null,
            serves: slot.serves,
            courtPosition,
            hasLibero: isLibero(slot.current),
            serving: servingRow() === index && serving === 'us',
            // The triangle on the paper sheet.
            liberoServes: serveRow === index,
        };
    });

    const liberosOnCourt = rows.filter((row) => row.hasLibero).map((row) => row.currentPlayerId);

    return {
        rows,
        liberoServeRow: serveRow,
        liberosOnCourt,
        // Players the libero has replaced. They are off the court but are not
        // bench players: they are the only ones who may come back for the
        // libero, so offering them as substitutes would both break that and put
        // the same player on court twice.
        awaitingLiberoReturn: rows
            .filter((row) => row.hasLibero && row.previousPlayerId)
            .map((row) => row.previousPlayerId),
        subsUsed,
        subLimit,
        subsLeft: Math.max(0, subLimit - subsUsed),
        liberoOnCourt: liberosOnCourt[0] ?? null,
        warnings: warningsFor(rows, { serveRow, serveRowBreaches, liberosOnCourt }),
    };
}

/**
 * Whether a replacement should be read as a libero swap rather than a
 * substitution.
 *
 * `kind` is what the app records now. Falling back to "is either player a
 * libero" keeps sets recorded before the distinction existed from counting
 * every libero swap against the 15.
 */
export function isLiberoReplacement(event, isLibero) {
    if (event?.kind === 'libero') return true;
    if (event?.kind === 'sub') return false;
    return isLibero(event?.inId) || isLibero(event?.outId);
}

/**
 * Things the referee will call that the sheet can see coming. These warn and
 * never block — a courtside tool that refuses to record what actually happened
 * is worse than one that records it and says so.
 */
function warningsFor(rows, { serveRow, serveRowBreaches, liberosOnCourt }) {
    const out = [];

    for (const row of rows) {
        if (row.hasLibero && FRONT_ROW.includes(row.courtPosition)) {
            out.push(`Libero is in position ${row.courtPosition} — front row.`);
        }
    }

    // Only one libero may be on court at a time, however many are designated.
    if (liberosOnCourt.length > 1) {
        out.push('Two liberos are on court. Only one may be on at a time.');
    }

    for (const index of serveRowBreaches) {
        out.push(
            `Libero served from order ${SERVING_ORDER[index]} as well as ${SERVING_ORDER[serveRow]} — the libero may only serve in one rotation.`,
        );
    }

    // The same thing before it happens, which is the useful half: the libero is
    // in the row about to serve, and it is not the row they are locked to.
    const upNext = rows.find((row) => row.serving);
    if (upNext && upNext.hasLibero && serveRow !== null && serveRow !== upNext.index) {
        out.push(`Libero is about to serve from order ${upNext.order}, but is locked to ${SERVING_ORDER[serveRow]}.`);
    }

    return out;
}
