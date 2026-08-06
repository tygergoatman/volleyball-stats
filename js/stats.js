/**
 * Stat aggregation. Pure functions over event lists — the same code produces
 * set, match and season totals, so the numbers can never disagree.
 */

import { STAT_BY_CODE, computeSetState } from './model.js';

/** An empty stat line for one player (or for the team as a whole). */
export function emptyLine() {
    return {
        pass: { att: 0, total: 0, zero: 0, half: 0, one: 0, two: 0, three: 0 },
        attack: { att: 0, kills: 0, errors: 0, inPlay: 0 },
        set: { att: 0, total: 0, errors: 0 },
        serve: { att: 0, aces: 0, errors: 0, inPlay: 0 },
        block: { solo: 0, assist: 0, errors: 0 },
        dig: { digs: 0, errors: 0 },
    };
}

const APPLY = {
    pass3: (line) => {
        line.pass.att += 1;
        line.pass.total += 3;
        line.pass.three += 1;
    },
    pass2: (line) => {
        line.pass.att += 1;
        line.pass.total += 2;
        line.pass.two += 1;
    },
    pass1: (line) => {
        line.pass.att += 1;
        line.pass.total += 1;
        line.pass.one += 1;
    },
    pass05: (line) => {
        line.pass.att += 1;
        line.pass.total += 0.5;
        line.pass.half += 1;
    },
    pass0: (line) => {
        line.pass.att += 1;
        line.pass.zero += 1;
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
    digErr: (line) => {
        line.dig.errors += 1;
    },
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
        errorsCommitted:
            line.attack.errors +
            line.serve.errors +
            line.set.errors +
            line.block.errors +
            line.dig.errors +
            line.pass.zero,
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
    ['Pass Avg', (_p, line, d) => fmtNumber(d.passAvg, 2)],
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
    ['Dig Err', (_p, line) => line.dig.errors],
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
