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

import { FRONT_ROW, isSetter, primaryPosition, rotateLineupBy } from './model.js';

export const DEFAULT_SYSTEM = '6-2';

export const SYSTEMS = [
    { key: '6-2', label: '6-2', blurb: 'Two setters; whichever is back row sets' },
    { key: '5-1', label: '5-1', blurb: 'One setter all six rotations; she sets from the front row in three of them' },
];

/**
 * The roles a lineup carries, in serving order. This is the convention the
 * rotation sheets are written to: the setter serves first, then an outside,
 * then a middle, then the second setter opposite the first.
 */
export const SERVING_ORDER_ROLES = {
    '6-2': ['S1', 'OH1', 'MB1', 'S2', 'OH2', 'MB2'],
    // **Structurally identical to the 6-2**, which is the single most useful
    // fact about adding this system: the same six slots in the same order, with
    // the second setter replaced by a true opposite. So a lineup entered for one
    // reads correctly in the other, rotation numbers mean the same thing, and
    // the setter is back row in rotations 1-3 and front row in 4-6 — which is
    // where the two systems finally part company.
    '5-1': ['S', 'OH1', 'MB1', 'OPP', 'OH2', 'MB2'],
};

/**
 * Which roster position each role is expected to be.
 *
 * The setter slots are row-dependent and that is the whole point of a 6-2:
 * **six attackers and two setters**, where only the back-row setter sets and the
 * front-row one plays opposite. So a setter slot in the front row is the
 * opposite position, not a setting position — see `roleExpectations`.
 */
export const ROLE_POSITION = {
    S1: 'S',
    S2: 'S',
    S: 'S',
    OPP: 'OPP',
    OH1: 'OH',
    OH2: 'OH',
    MB1: 'MB',
    MB2: 'MB',
};

/**
 * Roles that set from the back and hit opposite from the front.
 *
 * A 6-2 thing only. The 5-1's `S` sets from wherever she is standing, which is
 * the whole difference between the systems.
 */
const SETTER_ROLES = ['S1', 'S2'];

/**
 * What a role means for the row it is currently standing in: the label to show,
 * and every roster position that legitimately fills it.
 *
 * A front-row setter slot reads **OPP**, because that is the job — right-side
 * attacker. Both `OPP` and `S` belong there: a true opposite subbed in for the
 * setter is the textbook 6-2 move, and a setter who rotates front and hits is
 * equally normal. Labelling that slot "S1" and then warning that an opposite
 * standing in it is not a setter was the app misreading its own system, the
 * same way it once mislabelled the libero.
 *
 * @param {string} role
 * @param {boolean} isFrontRow
 * @returns {{label: string, allowed: string[]}}
 */
export function roleExpectations(role, isFrontRow, system = DEFAULT_SYSTEM) {
    // **In a 5-1 the setter is the setter in all six rotations.** She sets from
    // the front row in three of them, and calling her the opposite there — which
    // is correct for a 6-2 — would be the app misreading the system it was told
    // it is in. This is the whole reason this function had to learn about
    // systems rather than just about rows.
    if (system === '5-1') {
        const expected = ROLE_POSITION[role];
        return { label: role, allowed: expected ? [expected] : [] };
    }
    if (SETTER_ROLES.includes(role) && isFrontRow) {
        return { label: 'OPP', allowed: ['OPP', 'S'] };
    }
    const expected = ROLE_POSITION[role];
    return { label: role, allowed: expected ? [expected] : [] };
}

/**
 * Positions that exist to replace somebody else, so they never carry one of the
 * six 6-2 roles.
 *
 * A libero comes on for a back-row middle or outside — that is the whole point
 * of the position — and a defensive specialist does the same for a hitter.
 * Reading the slot's role onto them labelled the libero "OH1" and then warned
 * that she was an L where an OH was expected, which is the app misunderstanding
 * the game rather than the lineup being wrong.
 */
export const SPECIALIST_POSITIONS = ['L', 'DS'];

/**
 * Whether a player should be labelled by their own position rather than by the
 * role of the slot they are standing in.
 *
 * The test is "specialist and *nothing else*", not "specialist somewhere in the
 * list". A pure libero or pure DS never carries a 6-2 role, so their own tag
 * wins. But a player tagged OH and DS is a hitter who also covers back row —
 * she does rotate through the six roles, and calling her "DS" while she is
 * standing in an outside slot would hide the thing the court is there to show.
 *
 * @param {object|undefined} player
 */
export function isSpecialist(player) {
    const positions = player?.positions ?? [];
    return positions.length > 0 && positions.every((p) => SPECIALIST_POSITIONS.includes(p));
}

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

    /**
     * The 5-1, which is completely regular — six rules, no exceptions:
     *
     * - position 1 ← the setter when she is back row, the opposite when she is not
     * - position 2 ← the setter when she is front row, the opposite when she is not
     * - position 3 ← whichever middle is front row
     * - position 4 ← whichever outside is front row
     * - position 5 ← whichever outside is back row
     * - position 6 ← whichever middle is back row
     *
     * Written out rather than derived so it can be read at a glance against a
     * rotation sheet, and `tests/formations.test.js` asserts the six rules hold
     * for all six rotations — so a typo here fails rather than quietly drawing
     * somebody in the wrong place.
     */
    '5-1': {
        1: { 1: 'S', 2: 'OPP', 3: 'MB1', 4: 'OH1', 5: 'OH2', 6: 'MB2' },
        2: { 1: 'S', 2: 'OPP', 3: 'MB1', 4: 'OH2', 5: 'OH1', 6: 'MB2' },
        3: { 1: 'S', 2: 'OPP', 3: 'MB2', 4: 'OH2', 5: 'OH1', 6: 'MB1' },
        4: { 1: 'OPP', 2: 'S', 3: 'MB2', 4: 'OH2', 5: 'OH1', 6: 'MB1' },
        5: { 1: 'OPP', 2: 'S', 3: 'MB2', 4: 'OH1', 5: 'OH2', 6: 'MB1' },
        6: { 1: 'OPP', 2: 'S', 3: 'MB1', 4: 'OH1', 5: 'OH2', 6: 'MB2' },
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

    /**
     * The 5-1, transcribed from the owner's own "5-1 SERVE RECEIVE FORMATIONS"
     * sheet — the same source as the 6-2, and it arrived after an earlier
     * version of this table had to guess at rotations 4-6.
     *
     * The sheet gives **two options per rotation**, so this table does too, and
     * the court offers a toggle. Picking one for them would have been the same
     * mistake as guessing.
     *
     * Reading the sheet: each panel is drawn net-at-top, so the upper row is
     * positions 4-3-2 left to right and the lower row is 5-6-1. Blue letters are
     * the front row, black the back row, red the setter — which is what makes it
     * possible to tell the two OH and the two M apart. The rotational panels
     * confirm `SERVING_ORDER_ROLES['5-1']` exactly.
     *
     * **Coordinates here are court space, not sheet band** — see `RECEIVE_SPACE`.
     *
     * A few are nudged a little wider than the sheet draws them. A court bubble
     * is 30% of the court's width, so three across always overlap — the 6-2
     * tables have the same property and the view says "reference only" because
     * of it. Where the sheet tucks the setter directly behind a team-mate, that
     * hid her number completely, so those pairs are separated just enough to
     * read. The arrangement is the sheet's; the spacing is what a 393px screen
     * can show.
     */
    '5-1': {
        1: {
            opt1: {
                MB1: { x: 0.38, y: 0.24 },
                OH1: { x: 0.7, y: 0.22 },
                S: { x: 0.82, y: 0.34 },
                OPP: { x: 0.16, y: 0.7 },
                OH2: { x: 0.42, y: 0.72 },
                MB2: { x: 0.68, y: 0.72 },
            },
            opt2: {
                OPP: { x: 0.16, y: 0.24 },
                MB1: { x: 0.46, y: 0.24 },
                OH2: { x: 0.3, y: 0.72 },
                MB2: { x: 0.52, y: 0.72 },
                OH1: { x: 0.76, y: 0.7 },
                S: { x: 0.86, y: 0.36 },
            },
        },
        2: {
            opt1: {
                OPP: { x: 0.38, y: 0.24 },
                S: { x: 0.56, y: 0.34 },
                MB1: { x: 0.72, y: 0.24 },
                OH2: { x: 0.2, y: 0.68 },
                MB2: { x: 0.44, y: 0.72 },
                OH1: { x: 0.66, y: 0.72 },
            },
            opt2: {
                OPP: { x: 0.46, y: 0.24 },
                S: { x: 0.64, y: 0.34 },
                MB1: { x: 0.8, y: 0.24 },
                OH2: { x: 0.22, y: 0.68 },
                MB2: { x: 0.46, y: 0.72 },
                OH1: { x: 0.68, y: 0.72 },
            },
        },
        3: {
            opt1: {
                MB2: { x: 0.14, y: 0.22 },
                S: { x: 0.3, y: 0.36 },
                OH2: { x: 0.52, y: 0.24 },
                OH1: { x: 0.32, y: 0.72 },
                MB1: { x: 0.52, y: 0.72 },
                OPP: { x: 0.74, y: 0.7 },
            },
            opt2: {
                MB2: { x: 0.14, y: 0.22 },
                S: { x: 0.3, y: 0.36 },
                OPP: { x: 0.84, y: 0.26 },
                OH1: { x: 0.26, y: 0.72 },
                OH2: { x: 0.48, y: 0.72 },
                MB1: { x: 0.7, y: 0.72 },
            },
        },
        // Rotations 4-6: the setter is front row and releases at the net rather
        // than coming up from the back. This is the half the sheet was needed
        // for — an earlier release shipped a textbook default here and said so
        // on screen.
        4: {
            opt1: {
                S: { x: 0.14, y: 0.2 },
                MB2: { x: 0.32, y: 0.28 },
                OH2: { x: 0.62, y: 0.26 },
                OH1: { x: 0.18, y: 0.72 },
                MB1: { x: 0.44, y: 0.72 },
                OPP: { x: 0.7, y: 0.72 },
            },
            opt2: {
                S: { x: 0.14, y: 0.2 },
                MB2: { x: 0.34, y: 0.28 },
                OH2: { x: 0.62, y: 0.26 },
                OH1: { x: 0.18, y: 0.72 },
                MB1: { x: 0.44, y: 0.72 },
                OPP: { x: 0.7, y: 0.72 },
            },
        },
        5: {
            opt1: {
                OH1: { x: 0.14, y: 0.24 },
                S: { x: 0.4, y: 0.2 },
                MB2: { x: 0.62, y: 0.28 },
                MB1: { x: 0.2, y: 0.72 },
                OPP: { x: 0.42, y: 0.72 },
                OH2: { x: 0.64, y: 0.72 },
            },
            opt2: {
                OH1: { x: 0.16, y: 0.24 },
                S: { x: 0.5, y: 0.2 },
                MB2: { x: 0.72, y: 0.28 },
                MB1: { x: 0.2, y: 0.72 },
                OPP: { x: 0.44, y: 0.72 },
                OH2: { x: 0.64, y: 0.72 },
            },
        },
        6: {
            opt1: {
                MB1: { x: 0.26, y: 0.26 },
                OH1: { x: 0.44, y: 0.26 },
                S: { x: 0.64, y: 0.2 },
                OPP: { x: 0.22, y: 0.72 },
                OH2: { x: 0.42, y: 0.72 },
                MB2: { x: 0.62, y: 0.72 },
            },
            opt2: {
                MB1: { x: 0.26, y: 0.26 },
                OH1: { x: 0.46, y: 0.26 },
                S: { x: 0.72, y: 0.2 },
                OPP: { x: 0.22, y: 0.72 },
                OH2: { x: 0.42, y: 0.72 },
                MB2: { x: 0.62, y: 0.72 },
            },
        },
    },
};

/**
 * The receive options a system's sheet offers, if it offers more than one.
 *
 * The 6-2 sheet draws one formation per rotation; the 5-1 sheet draws two. So
 * this is per system rather than a global setting, and the court only shows a
 * toggle where there is a real choice to make.
 */
export const RECEIVE_OPTIONS = {
    '5-1': [
        { key: 'opt1', label: 'Opt 1' },
        { key: 'opt2', label: 'Opt 2' },
    ],
};

/**
 * Which coordinate space a system's receive table is written in.
 *
 * The 6-2 numbers came out of a PDF where every player is drawn between the
 * attack line and the end line, so they are stretched over the playable height
 * by `spreadDepth`. The 5-1 sheet draws the net row *at the net*, so its numbers
 * are already true court fractions and stretching them would shove the setter
 * into the middle of the floor. Mixing the two silently would be a bug nobody
 * could see without a ruler.
 */
export const RECEIVE_SPACE = { '6-2': 'band', '5-1': 'court' };

/**
 * The receive drawing for one rotation, whichever shape its system stores.
 *
 * @returns {Record<string, {x: number, y: number}>|null}
 */
export function receiveTable(system, rotation, option = null) {
    const entry = SERVE_RECEIVE[system]?.[rotation];
    if (!entry) return null;
    const options = RECEIVE_OPTIONS[system];
    if (!options) return entry;
    return entry[option ?? options[0].key] ?? entry[options[0].key] ?? null;
}

/**
 * Receive patterns the app is guessing at, by system.
 *
 * **Empty, and worth keeping empty.** Both systems now come from the owner's own
 * sheets. It existed for one release when the 5-1's rotations 4-6 were a
 * textbook default, and the court printed a line saying so — because a picture a
 * coach cannot tell apart from their own sheet is worse than no picture: it gets
 * trusted in a timeout. Keep the mechanism for the next time something has to
 * ship ahead of its data.
 */
export const PROVISIONAL_RECEIVE = {};

/** Whether the receive drawing for this rotation is a default rather than theirs. */
export function receiveIsProvisional(rotation, system = DEFAULT_SYSTEM) {
    return (PROVISIONAL_RECEIVE[system] ?? []).includes(rotation);
}

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
export const NO_SWITCH_ROTATIONS = {
    '6-2': [1, 4],
    // Unknown for the 5-1 until the sheets say otherwise, and an empty list is
    // the honest default: it claims nothing.
    '5-1': [],
};

/** Where each court position sits, so every view can be placed the same way. */
export const POSITION_POINT = {
    4: { x: 0.17, y: 0.29 },
    3: { x: 0.5, y: 0.29 },
    2: { x: 0.83, y: 0.29 },
    5: { x: 0.17, y: 0.72 },
    6: { x: 0.5, y: 0.72 },
    1: { x: 0.83, y: 0.72 },
};

/**
 * The two states of the serve-receive view: the passing formation, and where
 * everyone ends up once the ball is up.
 *
 * "After pass" is not a fourth court — it resolves to an arrangement the app
 * already draws. For most rotations that is Base. For the rotations the sheets
 * mark as no-switch it is the rotational arrangement, because leaving the front
 * row where it receives *is* the rotation. Resolving rather than storing keeps
 * the two in step: correct Base and this follows.
 */
export const RECEIVE_STAGES = [
    { key: 'receive', label: 'Receive' },
    { key: 'afterReceive', label: 'After pass' },
];

export function afterReceiveFormation(rotation, system = DEFAULT_SYSTEM) {
    return keepsFrontRowOnReceive(rotation, system) ? 'rotation' : 'base';
}

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
    rotation = anchoredRotation(lineup, rotation, playerLookup, system);
    const byRole = {};
    const roleOf = {};
    const mismatches = [];

    for (let position = 1; position <= 6; position++) {
        const role = roles[slotAtPosition(position, rotation)];
        const playerId = lineup[position - 1] ?? null;

        // The slot keeps its role whoever is standing in it, so the formation
        // tables still know where to draw them.
        byRole[role] = playerId;
        if (!playerId) continue;

        const player = playerLookup(playerId);

        // A libero or defensive specialist is shown as what they are rather
        // than as the hitter they replaced, and is never a mismatch.
        if (isSpecialist(player)) {
            roleOf[playerId] = primaryPosition(player);
            continue;
        }

        // What this slot means depends on the row it is standing in: a setter
        // slot in the front row is the opposite, and is labelled and checked
        // as one.
        const { label, allowed } = roleExpectations(role, FRONT_ROW.includes(position), system);
        roleOf[playerId] = label;

        // An untagged player says nothing either way, and a player who plays
        // the slot's position among others is not a contradiction — only a
        // stated position list with no room for this slot is worth raising.
        const positions = player?.positions ?? [];
        if (positions.length > 0 && allowed.length > 0 && !allowed.some((p) => positions.includes(p))) {
            mismatches.push({
                playerId,
                role: label,
                expected: allowed.join(' or '),
                actual: positions.join('/'),
            });
        }
    }

    return { byRole, roleOf, mismatches };
}

/**
 * The rotation the **drawing** should use, which in a 5-1 is decided by where
 * the setter is standing rather than by the rotation counter.
 *
 * The bug this exists to kill: a coach started a set in "rotation 4" with the
 * setter at position 1. The counter says which serving-order slot is at position
 * 1, so the app dutifully labelled her the opposite — correct arithmetic, wrong
 * answer, and unarguable from the coach's side because *she is the setter, she
 * is standing right there*.
 *
 * **In a 5-1 there is exactly one setter and she is a person, not a slot.** So
 * the role wheel is pinned to her: whatever position she is in, that is where
 * `S` goes, and the other five roles follow round in serving order. The rotation
 * counter is left alone — it is about who serves, and that is a different
 * question from who sets.
 *
 * Note the two numbering systems agree by construction when the lineup is
 * entered as the app intends, so this changes nothing for a set that was set up
 * cleanly. It only rescues one that was not.
 *
 * Idempotent: the answer depends on the setter's position, not on the rotation
 * passed in, so anchoring an already-anchored rotation returns the same value.
 *
 * Falls back to the counter when there is no single setter on court — nobody
 * tagged `S`, two of them, or she has been substituted out.
 */
export function anchoredRotation(lineup = [], rotation = 1, playerLookup = () => undefined, system = DEFAULT_SYSTEM) {
    if (system !== '5-1') return rotation;

    const setters = [];
    for (let position = 1; position <= 6; position++) {
        const id = lineup[position - 1];
        if (id && isSetter(playerLookup(id))) setters.push(position);
    }
    if (setters.length !== 1) return rotation;

    // Rotation r puts serving-order slot 0 — the setter — at position
    // (2 - r) mod 6. Inverted: a setter at position p means rotation (2 - p).
    const anchored = (((2 - setters[0]) % 6) + 6) % 6;
    return anchored === 0 ? 6 : anchored;
}

/** Whether the 5-1 drawing is following the setter rather than the counter. */
export function isAnchoredAway(lineup, rotation, playerLookup, system) {
    return anchoredRotation(lineup, rotation, playerLookup, system) !== rotation;
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

    const table = BASE[system]?.[anchoredRotation(lineup, rotation, playerLookup, system)];
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
    receiveOption = null,
    system = DEFAULT_SYSTEM,
    playerLookup = () => undefined,
}) {
    if (formation === 'afterReceive') {
        return formationPoints({
            lineup,
            rotation,
            formation: afterReceiveFormation(rotation, system),
            system,
            playerLookup,
            receiveOption,
        });
    }

    const points = {};

    if (formation === 'receive') {
        const table = receiveTable(system, anchoredRotation(lineup, rotation, playerLookup, system), receiveOption);
        if (table) {
            // Band coordinates get stretched over the playable height; court
            // coordinates are already there. See `RECEIVE_SPACE`.
            const depth = RECEIVE_SPACE[system] === 'court' ? (y) => y : spreadDepth;
            const { byRole } = assignRoles(lineup, rotation, playerLookup, system);
            for (const [role, point] of Object.entries(table)) {
                const playerId = byRole[role];
                if (playerId) points[playerId] = { x: point.x, y: depth(point.y) };
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
