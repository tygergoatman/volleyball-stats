/**
 * Where each role actually plays, as opposed to where the rotation puts them.
 *
 * Three views of the same six players:
 *
 *   Rotation       the legal rotational positions — what the referee sees at
 *                  the whistle, and what the rest of the app already models
 *   Base           where they play once the ball is live: hitters switch sides,
 *                  the back-row setter releases to right back
 *   Serve-receive  the passing formation (not yet built)
 *
 * Only Base and serve-receive need data. The rotation view is the lineup as it
 * already stands, which was verified against the source sheets position for
 * position.
 *
 * Roles are keyed rather than named after players, so one table serves any
 * lineup. `assignRoles` maps them onto actual people.
 */

import { rotateLineupBy } from './model.js';

export const DEFAULT_SYSTEM = '6-2';

export const SYSTEMS = [
    { key: '6-2', label: '6-2', blurb: 'Two setters; whichever is back row sets' },
    // 5-1 slots in here: one setter, one opposite, and its own BASE table.
];

/**
 * The roles a lineup carries, in serving order. This is the convention the
 * rotation sheets are written to: the setter serves first, then an outside,
 * then a middle, then the second setter opposite the first.
 */
export const SERVING_ORDER_ROLES = {
    '6-2': ['S1', 'OH1', 'MB1', 'S2', 'OH2', 'MB2'],
};

/** Which roster position each role is expected to be. */
export const ROLE_POSITION = {
    S1: 'S',
    S2: 'S',
    OH1: 'OH',
    OH2: 'OH',
    MB1: 'MB',
    MB2: 'MB',
};

export const ROLE_LABEL = {
    S1: 'S1',
    S2: 'S2',
    OH1: 'OH1',
    OH2: 'OH2',
    MB1: 'MB1',
    MB2: 'MB2',
};

/**
 * Base: court position (1-6) to role, per rotation.
 *
 * Transcribed from the 6-2 rotation sheets. The invariant worth knowing, and
 * tested: the setter who is back row is always at position 1, and the other
 * setter — playing opposite in the front row — is always at position 2. The
 * middles and outsides then fill around them.
 */
export const BASE = {
    '6-2': {
        1: { 1: 'S1', 2: 'S2', 3: 'MB1', 4: 'OH1', 5: 'OH2', 6: 'MB2' },
        2: { 1: 'S1', 2: 'S2', 3: 'MB1', 4: 'OH2', 5: 'OH1', 6: 'MB2' },
        3: { 1: 'S1', 2: 'S2', 3: 'MB2', 4: 'OH2', 5: 'OH1', 6: 'MB1' },
        4: { 1: 'S2', 2: 'S1', 3: 'MB2', 4: 'OH2', 5: 'OH1', 6: 'MB1' },
        5: { 1: 'S2', 2: 'S1', 3: 'MB2', 4: 'OH1', 5: 'OH2', 6: 'MB1' },
        6: { 1: 'S2', 2: 'S1', 3: 'MB1', 4: 'OH1', 5: 'OH2', 6: 'MB2' },
    },
};

/**
 * Serve-receive, as normalised court coordinates rather than the six slots.
 *
 * This one genuinely is a spatial formation — three passers spread across the
 * back, the setter tucked in at the net — so it does not reduce to a permutation
 * of positions 1-6 the way Base does. `x` runs 0 (left sideline) to 1 (right);
 * `y` runs 0 (net) to 1 (end line).
 *
 * Pulled out of the source PDF with `pdftotext -bbox` and normalised against
 * each panel's court box, so these are the sheet's own placements rather than
 * anybody's estimate of them. Bubbles are allowed to overlap here.
 */
export const SERVE_RECEIVE = {
    '6-2': {
        1: {
            OH1: { x: 0.82, y: 0.56 },
            S1: { x: 0.83, y: 0.65 },
            MB1: { x: 0.42, y: 0.65 },
            S2: { x: 0.17, y: 0.8 },
            OH2: { x: 0.48, y: 0.82 },
            MB2: { x: 0.81, y: 0.83 },
        },
        2: {
            S2: { x: 0.62, y: 0.55 },
            S1: { x: 0.48, y: 0.6 },
            MB1: { x: 0.69, y: 0.69 },
            OH2: { x: 0.14, y: 0.81 },
            MB2: { x: 0.43, y: 0.83 },
            OH1: { x: 0.75, y: 0.83 },
        },
        3: {
            MB2: { x: 0.1, y: 0.54 },
            S1: { x: 0.1, y: 0.63 },
            S2: { x: 0.83, y: 0.67 },
            OH2: { x: 0.19, y: 0.77 },
            OH1: { x: 0.46, y: 0.8 },
            MB1: { x: 0.73, y: 0.8 },
        },
        4: {
            OH2: { x: 0.85, y: 0.54 },
            S2: { x: 0.86, y: 0.62 },
            MB2: { x: 0.58, y: 0.65 },
            S1: { x: 0.16, y: 0.79 },
            OH1: { x: 0.78, y: 0.79 },
            MB1: { x: 0.48, y: 0.81 },
        },
        5: {
            S1: { x: 0.54, y: 0.55 },
            S2: { x: 0.46, y: 0.6 },
            MB2: { x: 0.63, y: 0.67 },
            OH1: { x: 0.14, y: 0.79 },
            OH2: { x: 0.77, y: 0.82 },
            MB1: { x: 0.45, y: 0.84 },
        },
        6: {
            MB1: { x: 0.12, y: 0.55 },
            S2: { x: 0.12, y: 0.59 },
            S1: { x: 0.83, y: 0.65 },
            OH1: { x: 0.19, y: 0.76 },
            OH2: { x: 0.46, y: 0.79 },
            MB2: { x: 0.81, y: 0.8 },
        },
    },
};

/**
 * Rotations where the front row does **not** switch after receiving — the
 * "leave the front row attackers where they receive" note on the sheets, so the
 * outside stays right and the opposite stays outside.
 *
 * No extra table is needed for it: not switching *is* the rotational
 * arrangement, which the app already draws as the Rotation view. So for these
 * rotations the movement the sheet's arrows show is serve-receive → Rotation,
 * not serve-receive → Base.
 */
export const NO_SWITCH_ROTATIONS = { '6-2': [1, 4] };

/** Where each court position sits, so every view can be placed the same way. */
export const POSITION_POINT = {
    4: { x: 0.17, y: 0.29 },
    3: { x: 0.5, y: 0.29 },
    2: { x: 0.83, y: 0.29 },
    5: { x: 0.17, y: 0.72 },
    6: { x: 0.5, y: 0.72 },
    1: { x: 0.83, y: 0.72 },
};

export const FORMATIONS = [
    { key: 'rotation', label: 'Rotation', note: 'Legal rotational positions' },
    { key: 'base', label: 'Base', note: 'Where each position plays once the ball is live' },
    { key: 'receive', label: 'Serve Rcv', note: 'Passing formation — reference only' },
];

/**
 * Map roles onto whoever is on court right now.
 *
 * A role belongs to a slot in the rotation, not to a person: substitute for the
 * second middle and the substitute *is* MB2 for as long as they are on. So the
 * roles are read off the current lineup rather than the one the set started
 * with, which is also what makes this correct after any number of subs.
 *
 * Court position `p` holds canonical slot `(p - 1 + rotation - 1) mod 6`, since
 * rotation N is defined as the Nth player of the team's order serving. Nothing
 * extra has to be typed — the system says which role each slot carries.
 *
 * Where players are tagged with a roster position, disagreements are reported
 * rather than silently accepted: a lineup entered in a different order would
 * otherwise draw a confident and wrong picture.
 *
 * @param {Array<string|null>} lineup current lineup, indexed by (position - 1)
 * @param {number} rotation 1-6
 * @param {(id: string) => object|undefined} playerLookup
 * @param {string} system
 * @returns {{byRole: Record<string, string|null>, roleOf: Record<string, string>, mismatches: Array<object>}}
 */
export function assignRoles(lineup = [], rotation = 1, playerLookup = () => undefined, system = DEFAULT_SYSTEM) {
    const roles = SERVING_ORDER_ROLES[system] ?? SERVING_ORDER_ROLES[DEFAULT_SYSTEM];
    const byRole = {};
    const roleOf = {};
    const mismatches = [];

    for (let position = 1; position <= 6; position++) {
        const role = roles[slotAtPosition(position, rotation)];
        const playerId = lineup[position - 1] ?? null;
        byRole[role] = playerId;
        if (!playerId) continue;
        roleOf[playerId] = role;

        const player = playerLookup(playerId);
        const expected = ROLE_POSITION[role];
        // An untagged player says nothing either way; only a stated position
        // that contradicts the slot is worth raising.
        if (player?.position && expected && player.position !== expected) {
            mismatches.push({ playerId, role, expected, actual: player.position });
        }
    }

    return { byRole, roleOf, mismatches };
}

/**
 * The lineup to draw for a formation: an array of six player ids indexed by
 * (position - 1), the same shape the court map already takes.
 *
 * @param {object} config
 * @param {Array<string|null>} config.lineup current rotational lineup
 * @param {number} config.rotation current rotation, 1-6
 * @param {string} config.formation
 * @param {string} config.system
 * @param {(id: string) => object|undefined} [config.playerLookup]
 * @returns {Array<string|null>}
 */
export function formationLineup({
    lineup = [],
    rotation = 1,
    formation = 'rotation',
    system = DEFAULT_SYSTEM,
    playerLookup = () => undefined,
}) {
    if (formation === 'rotation') return lineup.slice();

    const table = BASE[system]?.[rotation];
    if (!table) return lineup.slice();

    const { byRole } = assignRoles(lineup, rotation, playerLookup, system);

    const drawn = [null, null, null, null, null, null];
    for (let position = 1; position <= 6; position++) {
        drawn[position - 1] = byRole[table[position]] ?? null;
    }
    return drawn;
}

/**
 * Where to draw each player, as normalised court points keyed by player id.
 *
 * One shape for all three views, so the court can move bubbles between them
 * instead of redrawing — which is what turns the sheets' transition arrows into
 * something you watch rather than something to read.
 *
 * @returns {Record<string, {x: number, y: number}>}
 */
/**
 * The source sheets draw everyone between the attack line and the end line —
 * the whole front court sits empty above them, because in serve-receive it is.
 * Reproduced literally that leaves the app's court half empty and stacks players
 * on top of each other, so the drawn band is stretched over the playable height.
 * Relative depth is preserved exactly; only the scale changes.
 */
const RECEIVE_BAND = { from: 0.54, to: 0.84 };
const COURT_BAND = { from: 0.2, to: 0.84 };

function spreadDepth(y) {
    const t = (y - RECEIVE_BAND.from) / (RECEIVE_BAND.to - RECEIVE_BAND.from);
    return COURT_BAND.from + t * (COURT_BAND.to - COURT_BAND.from);
}

export function formationPoints({
    lineup = [],
    rotation = 1,
    formation = 'rotation',
    system = DEFAULT_SYSTEM,
    playerLookup = () => undefined,
}) {
    const points = {};

    if (formation === 'receive') {
        const table = SERVE_RECEIVE[system]?.[rotation];
        if (table) {
            const { byRole } = assignRoles(lineup, rotation, playerLookup, system);
            for (const [role, point] of Object.entries(table)) {
                const playerId = byRole[role];
                if (playerId) points[playerId] = { x: point.x, y: spreadDepth(point.y) };
            }
            // Anyone the roles do not cover keeps their rotational spot.
            for (let position = 1; position <= 6; position++) {
                const id = lineup[position - 1];
                if (id && !points[id]) points[id] = POSITION_POINT[position];
            }
            return points;
        }
    }

    const drawn = formationLineup({ lineup, rotation, formation, system, playerLookup });
    for (let position = 1; position <= 6; position++) {
        const id = drawn[position - 1];
        if (id) points[id] = POSITION_POINT[position];
    }
    return points;
}

/** Whether this rotation leaves the front row unswitched after receiving. */
export function keepsFrontRowOnReceive(rotation, system = DEFAULT_SYSTEM) {
    return (NO_SWITCH_ROTATIONS[system] ?? []).includes(rotation);
}

/**
 * Serving order slot (0-5) a court position holds, given how far the lineup has
 * rotated. Used to line the roles up with the rotation the set is actually in.
 */
export function slotAtPosition(position, rotation) {
    return (position - 1 + (rotation - 1)) % 6;
}

/** The lineup a set starts a given rotation in, from its serving order. */
export function lineupForRotation(startingLineup, rotation) {
    return rotateLineupBy(startingLineup, rotation - 1);
}
