/**
 * Stat aggregation. Pure functions over event lists — the same code produces
 * set, match and season totals, so the numbers can never disagree.
 */

import { STAT_BY_CODE, TEAM_EVENT_BY_CODE, computeSetState, pointFor } from './model.js';

/** An empty stat line for one player (or for the team as a whole). */
export function emptyLine() {
    return {
        pass: { att: 0, total: 0, zero: 0, half: 0, one: 0, two: 0, three: 0 },
        attack: { att: 0, kills: 0, errors: 0, inPlay: 0 },
        set: { att: 0, total: 0, errors: 0 },
        serve: { att: 0, aces: 0, errors: 0, inPlay: 0 },
        block: { solo: 0, assist: 0, errors: 0 },
        dig: { digs: 0 },
        // `whose` is the odd one: a ball nobody called, tagged on whoever
        // was nearest. It is counted here so practice can find the seam,
        // and deliberately left out of `errorsCommitted` — see there.
        fault: { net: 0, under: 0, double: 0, whose: 0 },
    };
}

/** One passing attempt at a given rating. */
function rate(line, value, bucket) {
    line.pass.att += 1;
    line.pass.total += value;
    line.pass[bucket] += 1;
}

const APPLY = {
    pass3: (line) => rate(line, 3, 'three'),
    pass2: (line) => rate(line, 2, 'two'),
    pass1: (line) => rate(line, 1, 'one'),
    pass05: (line) => rate(line, 0.5, 'half'),
    pass0: (line) => rate(line, 0, 'zero'),

    // 2026.09.13a briefly split passing into serve-receive and in-rally rows,
    // and 2026.09.15a put it back to one. Any match recorded in between holds
    // these codes, so they fold into the same passing line rather than being
    // dropped — the numbers stay whole and no migration is needed. Do not
    // delete these: deleting them silently zeroes those matches.
    rally3: (line) => rate(line, 3, 'three'),
    rally2: (line) => rate(line, 2, 'two'),
    rally1: (line) => rate(line, 1, 'one'),
    rally0: (line) => rate(line, 0, 'zero'),

    faultNet: (line) => {
        line.fault.net += 1;
    },
    faultUnder: (line) => {
        line.fault.under += 1;
    },
    faultDouble: (line) => {
        line.fault.double += 1;
    },
    whoseBall: (line) => {
        line.fault.whose += 1;
    },
    kill: (line) => {
        line.attack.att += 1;
        line.attack.kills += 1;
    },
    attackInPlay: (line) => {
        line.attack.att += 1;
        line.attack.inPlay += 1;
    },
    attackErr: (line) => {
        line.attack.att += 1;
        line.attack.errors += 1;
    },
    set3: (line) => {
        line.set.att += 1;
        line.set.total += 3;
    },
    set2: (line) => {
        line.set.att += 1;
        line.set.total += 2;
    },
    set1: (line) => {
        line.set.att += 1;
        line.set.total += 1;
    },
    set0: (line) => {
        line.set.att += 1;
        line.set.errors += 1;
    },
    ace: (line) => {
        line.serve.att += 1;
        line.serve.aces += 1;
    },
    serveIn: (line) => {
        line.serve.att += 1;
        line.serve.inPlay += 1;
    },
    serveErr: (line) => {
        line.serve.att += 1;
        line.serve.errors += 1;
    },
    blockSolo: (line) => {
        line.block.solo += 1;
    },
    blockAssist: (line) => {
        line.block.assist += 1;
    },
    blockErr: (line) => {
        line.block.errors += 1;
    },
    dig: (line) => {
        line.dig.digs += 1;
    },
    // There was a `digErr` handler here and a "Dig Err" CSV column, with no
    // button anywhere that could produce the code — the column could only ever
    // read zero. The in-rally error is `rally0` now, and this is gone.
};

/**
 * Fold a list of events into per-player stat lines.
 *
 * @param {Array<object>} events
 * @param {Map<string, object>} [into] existing accumulator to add onto
 * @returns {Map<string, object>} player id -> stat line
 */
export function aggregate(events, into = new Map()) {
    for (const event of events) {
        if (event.type !== 'stat' || !event.playerId) continue;
        const apply = APPLY[event.code];
        if (!apply) continue;
        if (!into.has(event.playerId)) into.set(event.playerId, emptyLine());
        apply(into.get(event.playerId));
    }
    return into;
}

/** Aggregate every set in a match. */
export function aggregateMatch(match, into = new Map()) {
    for (const set of match.sets ?? []) aggregate(set.events ?? [], into);
    return into;
}

/** Aggregate every match in a season. */
export function aggregateSeason(matches, into = new Map()) {
    for (const match of matches) aggregateMatch(match, into);
    return into;
}

/* --------------------------------------------------- where points came from */

/**
 * Split every point in the match four ways: which side got it, and whether it
 * was earned or handed over.
 *
 *   us.earned          a kill, an ace, a stuff block — we finished the rally
 *   us.fromTheirErrors they put it away themselves
 *   them.earned        they finished the rally, and we did not record an error
 *   them.fromOurErrors a serve into the net, an attack out, a shank
 *
 * `them.fromOurErrors` is the number worth coaching from, which is why the
 * breakdown lists *which* errors rather than only the count.
 *
 * The winner of each point comes from `pointFor`, the same function the
 * scoreboard replays — so these totals cannot drift from the score on screen.
 * A test asserts they match.
 */
export function emptyBreakdown() {
    return {
        us: { earned: 0, fromTheirErrors: 0 },
        them: { earned: 0, fromOurErrors: 0 },
        /** Our point-winning actions, commonest first. */
        earnedBy: new Map(),
        /** Our point-conceding errors, commonest first. */
        errorsBy: new Map(),
    };
}

function bump(counts, code, name) {
    const row = counts.get(code) ?? { code, name, count: 0 };
    row.count += 1;
    counts.set(code, row);
}

/**
 * @param {Array<object>} events
 * @param {object} [into] accumulator, so set/match/season use the same code
 */
export function pointBreakdown(events, into = emptyBreakdown()) {
    for (const event of events) {
        const winner = pointFor(event);
        if (!winner) continue;

        // A team event is a rally nobody's stat line explains. Most are theirs —
        // they erred, or they simply won it — but a `fault` one is ours, and
        // counting it as them earning the point is the wrong half of the split.
        if (event.type === 'team') {
            const definition = TEAM_EVENT_BY_CODE.get(event.code);
            if (winner === 'us') into.us.fromTheirErrors += 1;
            else if (definition?.fault) {
                into.them.fromOurErrors += 1;
                bump(into.errorsBy, event.code, definition.name);
            } else into.them.earned += 1;
            continue;
        }

        const name = STAT_BY_CODE.get(event.code)?.name ?? event.code;
        if (winner === 'us') {
            into.us.earned += 1;
            bump(into.earnedBy, event.code, name);
        } else {
            into.them.fromOurErrors += 1;
            bump(into.errorsBy, event.code, name);
        }
    }
    return into;
}

/** Point breakdown across a list of sets. */
export function breakdownForSets(sets, into = emptyBreakdown()) {
    for (const set of sets) pointBreakdown(set.events ?? [], into);
    return into;
}

/**
 * Totals and shares, for display. Shares are null rather than 0 when there are
 * no points yet, so the UI shows "—" instead of a confident 0%.
 */
export function breakdownTotals(breakdown) {
    const us = breakdown.us.earned + breakdown.us.fromTheirErrors;
    const them = breakdown.them.earned + breakdown.them.fromOurErrors;
    const share = (part, whole) => (whole > 0 ? part / whole : null);

    return {
        us,
        them,
        usEarnedShare: share(breakdown.us.earned, us),
        themGivenShare: share(breakdown.them.fromOurErrors, them),
        earnedBy: [...breakdown.earnedBy.values()].sort((a, b) => b.count - a.count),
        errorsBy: [...breakdown.errorsBy.values()].sort((a, b) => b.count - a.count),
    };
}

/** Sum a collection of stat lines into a single team line. */
export function totalLine(lines) {
    const total = emptyLine();
    for (const line of lines) {
        for (const group of Object.keys(total)) {
            for (const key of Object.keys(total[group])) {
                total[group][key] += line[group][key];
            }
        }
    }
    return total;
}

/* ------------------------------------------------------------- derived */

/**
 * Metrics computed from a raw stat line. Rates are null rather than 0 when
 * there are no attempts, so the UI can render "—" instead of a misleading zero.
 */
export function derive(line) {
    const passAvg = line.pass.att ? line.pass.total / line.pass.att : null;
    const attackAtt = line.attack.att;
    const hitPct = attackAtt ? (line.attack.kills - line.attack.errors) / attackAtt : null;
    const killPct = attackAtt ? line.attack.kills / attackAtt : null;
    const setAvg = line.set.att ? line.set.total / line.set.att : null;
    const serveAtt = line.serve.att;
    const acePct = serveAtt ? line.serve.aces / serveAtt : null;
    const serveErrPct = serveAtt ? line.serve.errors / serveAtt : null;
    const blockTotal = line.block.solo + line.block.assist;

    return {
        passAvg,
        passAtt: line.pass.att,
        hitPct,
        killPct,
        attackAtt,
        setAvg,
        setAtt: line.set.att,
        acePct,
        serveErrPct,
        serveAtt,
        blockTotal,
        // Points a player put directly on the board.
        pointsScored: line.attack.kills + line.serve.aces + line.block.solo,
        // Rallies a player ended in the opponent's favour.
        //
        // **`fault.whose` is deliberately absent.** A ball nobody called is a
        // team error tagged on whoever happened to be nearest; adding it here
        // would charge her for standing close to it, which is the opposite of
        // why it is recorded. It still reaches the scoreboard and the team's
        // "points from our errors" through `pointBreakdown`.
        errorsCommitted:
            line.attack.errors +
            line.serve.errors +
            line.set.errors +
            line.block.errors +
            line.pass.zero +
            line.fault.net +
            line.fault.under +
            line.fault.double,
    };
}

/* --------------------------------------------------------- rotation split */

/**
 * Points won and lost in each of the six rotations, across whichever sets are
 * passed in. This answers "which rotation is bleeding points?".
 *
 * @param {Array<object>} sets
 * @returns {Array<{rotation: number, won: number, lost: number, diff: number}>}
 */
export function rotationBreakdown(sets) {
    const rows = [1, 2, 3, 4, 5, 6].map((rotation) => ({
        rotation,
        won: 0,
        lost: 0,
        diff: 0,
    }));

    for (const set of sets) {
        const { timeline } = computeSetState(set);
        for (const entry of timeline) {
            if (!entry.winner) continue;
            const row = rows[entry.rotationAtEvent - 1];
            if (!row) continue;
            if (entry.winner === 'us') row.won += 1;
            else row.lost += 1;
        }
    }

    for (const row of rows) row.diff = row.won - row.lost;
    return rows;
}

/* ---------------------------------------------------------------- export */

const CSV_COLUMNS = [
    ['#', (player) => player.number],
    ['Name', (player) => player.name],
    ['Pass Att', (_p, line) => line.pass.att],
    ['Pass Avg', (_p, _line, d) => fmtNumber(d.passAvg, 2)],
    ['Pass 3', (_p, line) => line.pass.three],
    ['Pass 2', (_p, line) => line.pass.two],
    ['Pass 1', (_p, line) => line.pass.one],
    ['Pass .5', (_p, line) => line.pass.half],
    ['Pass 0', (_p, line) => line.pass.zero],
    ['Kills (K)', (_p, line) => line.attack.kills],
    ['Attack In Play (A)', (_p, line) => line.attack.inPlay],
    ['Attack Err (0)', (_p, line) => line.attack.errors],
    ['Attack Att', (_p, line) => line.attack.att],
    ['Hit %', (_p, line, d) => fmtNumber(d.hitPct, 3)],
    ['Set Att', (_p, line) => line.set.att],
    ['Set Avg', (_p, line, d) => fmtNumber(d.setAvg, 2)],
    ['Set Err', (_p, line) => line.set.errors],
    ['Serve Att', (_p, line) => line.serve.att],
    ['Aces', (_p, line) => line.serve.aces],
    ['Serve Err', (_p, line) => line.serve.errors],
    ['Block Solo', (_p, line) => line.block.solo],
    ['Block Asst', (_p, line) => line.block.assist],
    ['Block Err', (_p, line) => line.block.errors],
    ['Digs', (_p, line) => line.dig.digs],
    ['Net Touch', (_p, line) => line.fault.net],
    ['Under Net', (_p, line) => line.fault.under],
    ['Double Contact', (_p, line) => line.fault.double],
    // Headed "near" because it is not charged to this player — see emptyLine.
    ['Whose Ball (near)', (_p, line) => line.fault.whose],
];

function fmtNumber(value, digits) {
    return value === null || value === undefined ? '' : value.toFixed(digits);
}

function escapeCsv(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Render aggregated stats as CSV for spreadsheet use.
 *
 * @param {Array<object>} roster
 * @param {Map<string, object>} lines
 * @returns {string}
 */
export function toCsv(roster, lines) {
    const rows = [CSV_COLUMNS.map(([header]) => header).join(',')];
    for (const player of roster) {
        const line = lines.get(player.id);
        if (!line) continue;
        const derived = derive(line);
        rows.push(CSV_COLUMNS.map(([, read]) => escapeCsv(read(player, line, derived))).join(','));
    }
    return rows.join('\n');
}

/**
 * The season as one row per player per match — the shape a spreadsheet can
 * actually chart.
 *
 * `toCsv` writes a *summary*: one row per player, totals only, with the date and
 * opponent nowhere inside the file. Every game-to-game question is averaged away
 * before it reaches the spreadsheet, and reconstructing it means exporting each
 * match by hand and stitching files that do not say which match they came from.
 *
 * This is the same columns with three added in front, and a row per appearance
 * instead of per player. Sort it, pivot it, chart it — it is tidy data.
 *
 * @param {Array<object>} matches in played order
 * @param {(id: string) => object|undefined} playerLookup
 * @returns {string}
 */
export function toMatchCsv(matches, playerLookup) {
    const head = ['Date', 'Opponent', 'Sets', ...CSV_COLUMNS.map(([header]) => header)];
    const rows = [head.join(',')];

    for (const match of matches) {
        const lines = aggregateMatch(match);
        const sets = (match.sets ?? []).filter((set) => set.complete).length;
        for (const [playerId, line] of lines) {
            const player = playerLookup(playerId);
            if (!player) continue;
            const derived = derive(line);
            rows.push(
                [
                    escapeCsv(match.date),
                    escapeCsv(match.opponent),
                    sets,
                    ...CSV_COLUMNS.map(([, read]) => escapeCsv(read(player, line, derived))),
                ].join(','),
            );
        }
    }
    return rows.join('\n');
}

/** Format a rate as a volleyball-style three-decimal figure (e.g. `.286`, `-.071`). */
export function formatPct(value) {
    if (value === null || value === undefined) return '—';
    const fixed = value.toFixed(3);
    return fixed.startsWith('0.') ? fixed.slice(1) : fixed.startsWith('-0.') ? `-${fixed.slice(2)}` : fixed;
}

/** Format an average to two decimals, or an em dash when there are no attempts. */
export function formatAvg(value) {
    return value === null || value === undefined ? '—' : value.toFixed(2);
}

export { STAT_BY_CODE };
