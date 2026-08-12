/**
 * Core domain model: stat definitions, court geometry, rotation math.
 *
 * Everything in this file is pure — no DOM, no storage — so it can be unit
 * tested with `node --test` and reused by any UI.
 */

/**
 * 2 introduced multiple teams, each with its own roster.
 * 3 flattened those into one roster of players carrying team tags, so a player
 *   who swings between JV and Varsity is one person rather than two records.
 */
export const SCHEMA_VERSION = 3;

/* ------------------------------------------------------------------ court */

/**
 * Court positions use standard volleyball numbering. `lineup` arrays are
 * always length 6 and indexed by (position - 1):
 *
 *   index 0 = position 1 = right back  (the server)
 *   index 1 = position 2 = right front
 *   index 2 = position 3 = middle front
 *   index 3 = position 4 = left front
 *   index 4 = position 5 = left back
 *   index 5 = position 6 = middle back
 *
 * Rendered with the net along the top edge:
 *
 *        4   3   2      <- front row
 *        5   6   1      <- back row
 */
export const POSITIONS = [1, 2, 3, 4, 5, 6];

/** Draw order for the 3x2 court grid, left-to-right then front-to-back. */
export const COURT_GRID = [4, 3, 2, 5, 6, 1];

export const POSITION_LABELS = {
    1: 'RB',
    2: 'RF',
    3: 'MF',
    4: 'LF',
    5: 'LB',
    6: 'MB',
};

/** Positions 2, 3 and 4 are front row and are eligible to attack above the net. */
export const FRONT_ROW = [2, 3, 4];

export const ROSTER_POSITIONS = ['OH', 'MB', 'S', 'OPP', 'L', 'DS'];

/**
 * Positions that are worth calling out on the court map: knowing who is setting
 * and who the libero is matters while capturing; the rest do not.
 *
 * These are read from `position` rather than separate flags. Two fields saying
 * the same thing could disagree, and the roster only ever needs to say it once.
 */
export const HIGHLIGHTED_POSITIONS = ['S', 'L'];

export function isSetter(player) {
    return player?.position === 'S';
}

export function isLibero(player) {
    return player?.position === 'L';
}

/* ------------------------------------------------------------------ stats */

/**
 * `point` is which team is awarded a point by this outcome, or null when the
 * ball stays in play. The scoreboard is derived entirely from these values.
 */
export const STAT_GROUPS = [
    {
        key: 'pass',
        label: 'Pass',
        accent: 'pass',
        options: [
            { code: 'pass3', label: '3', value: 3, point: null, name: 'Perfect pass' },
            { code: 'pass2', label: '2', value: 2, point: null, name: 'Good pass' },
            { code: 'pass1', label: '1', value: 1, point: null, name: 'Poor pass' },
            { code: 'pass05', label: '.5', value: 0.5, point: null, name: 'Overpass to their side' },
            // Sits with the passes because it is the same first-contact decision,
            // but it counts as a dig and stays out of the passing average. Placed
            // before the shank so every row ends on its one point-conceding button.
            { code: 'dig', label: 'D', point: null, name: 'Dig' },
            { code: 'pass0', label: '0', value: 0, point: 'them', name: 'Shank / ace against' },
        ],
    },
    {
        key: 'set',
        label: 'Set',
        accent: 'set',
        options: [
            { code: 'set3', label: '3', value: 3, point: null, name: 'Perfect set' },
            { code: 'set2', label: '2', value: 2, point: null, name: 'Good set' },
            { code: 'set1', label: '1', value: 1, point: null, name: 'Poor set' },
            { code: 'set0', label: '0', value: 0, point: 'them', name: 'Set error' },
        ],
    },
    {
        key: 'attack',
        label: 'Attack',
        accent: 'attack',
        options: [
            { code: 'kill', label: 'K', point: 'us', name: 'Kill' },
            { code: 'attackInPlay', label: 'A', point: null, name: 'Attack stays in play' },
            { code: 'attackErr', label: '0', point: 'them', name: 'Attack error' },
        ],
    },
    {
        key: 'block',
        label: 'Block',
        accent: 'block',
        options: [
            { code: 'blockSolo', label: 'Solo', point: 'us', name: 'Solo block' },
            { code: 'blockAssist', label: 'Asst', point: null, name: 'Block assist' },
            { code: 'blockErr', label: 'Err', point: 'them', name: 'Blocking error' },
        ],
    },
    {
        key: 'serve',
        label: 'Serve',
        accent: 'serve',
        options: [
            { code: 'ace', label: 'Ace', point: 'us', name: 'Ace' },
            { code: 'serveIn', label: 'In', point: null, name: 'Serve in play' },
            { code: 'serveErr', label: 'Err', point: 'them', name: 'Service error' },
        ],
    },
];

/**
 * Codes that no longer have a button but may still appear in saved matches.
 * They stay in the lookup so replaying an older set scores it the way it was
 * scored at the time.
 */
export const RETIRED_STATS = [
    { code: 'digErr', label: 'Err', point: 'them', name: 'Dig error', group: 'dig', groupLabel: 'Dig' },
];

/** Flat lookup of every stat option by its code, retired ones included. */
export const STAT_BY_CODE = (() => {
    const map = new Map();
    for (const retired of RETIRED_STATS) map.set(retired.code, { ...retired, retired: true });
    for (const group of STAT_GROUPS) {
        for (const option of group.options) {
            map.set(option.code, { ...option, group: group.key, groupLabel: group.label });
        }
    }
    return map;
})();

/** Team-level outcomes for rallies that no player stat covers. */
export const TEAM_EVENTS = [
    { code: 'oppError', label: 'Opp Error', point: 'us', name: 'Opponent error' },
    { code: 'oppPoint', label: 'Opp Point', point: 'them', name: 'Opponent earned point' },
];

export const TEAM_EVENT_BY_CODE = new Map(TEAM_EVENTS.map((event) => [event.code, event]));

/**
 * Which team, if any, is awarded a point by an event.
 *
 * @param {{type: string, code: string}} event
 * @returns {'us'|'them'|null}
 */
export function pointFor(event) {
    if (!event) return null;
    if (event.type === 'sub') return null;
    const definition = event.type === 'team' ? TEAM_EVENT_BY_CODE.get(event.code) : STAT_BY_CODE.get(event.code);
    return definition ? (definition.point ?? null) : null;
}

/**
 * Human-readable description of an event, used by the point log.
 *
 * @param {object} event
 * @param {(id: string) => object|undefined} playerLookup
 * @returns {string}
 */
export function describeEvent(event, playerLookup = () => undefined) {
    if (event.type === 'sub') {
        const inPlayer = playerLookup(event.inId);
        const outPlayer = playerLookup(event.outId);
        return `Sub: #${inPlayer?.number ?? '?'} ${inPlayer?.name ?? ''} in for #${
            outPlayer?.number ?? '?'
        } ${outPlayer?.name ?? ''}`.trim();
    }
    if (event.type === 'team') {
        return TEAM_EVENT_BY_CODE.get(event.code)?.name ?? event.code;
    }
    const definition = STAT_BY_CODE.get(event.code);
    const player = playerLookup(event.playerId);
    const who = player ? `#${player.number} ${player.name}` : 'Unknown player';
    return `${who} — ${definition ? definition.name : event.code}`;
}

/* --------------------------------------------------------------- rotation */

/**
 * Rotate the lineup one position clockwise: the player in position 2 moves to
 * position 1, 3 to 2, and so on, with position 1 wrapping around to 6.
 *
 * @param {Array<string|null>} lineup length-6 array of player ids
 * @returns {Array<string|null>} a new length-6 array
 */
export function rotateLineup(lineup) {
    return [lineup[1], lineup[2], lineup[3], lineup[4], lineup[5], lineup[0]];
}

/**
 * Advance the rotation counter, wrapping 6 back to 1.
 *
 * @param {number} rotation
 * @returns {number}
 */
export function nextRotation(rotation) {
    return (rotation % 6) + 1;
}

/**
 * Swap a player on the court for one off it.
 *
 * @param {Array<string|null>} lineup
 * @param {string} outId player leaving the court
 * @param {string} inId player entering the court
 * @returns {Array<string|null>} a new lineup, unchanged if `outId` is not on the court
 */
export function applySub(lineup, outId, inId) {
    const index = lineup.indexOf(outId);
    if (index === -1) return lineup.slice();
    const next = lineup.slice();
    next[index] = inId;
    return next;
}

/**
 * The court position (1-6) a player currently occupies, or null when they are
 * not on the court.
 *
 * @param {Array<string|null>} lineup
 * @param {string} playerId
 * @returns {number|null}
 */
export function positionOf(lineup, playerId) {
    const index = lineup.indexOf(playerId);
    return index === -1 ? null : index + 1;
}

/* ------------------------------------------------------------ set replay */

/**
 * Replay a set's event list to derive its current state. Deriving rather than
 * storing means undo is just dropping the last event, and the score can never
 * drift out of sync with the stats that produced it.
 *
 * @param {object} set
 * @returns {{
 *   us: number,
 *   them: number,
 *   serving: 'us'|'them',
 *   rotation: number,
 *   lineup: Array<string|null>,
 *   timeline: Array<object>,
 *   rallies: number
 * }}
 */
export function computeSetState(set) {
    let lineup = (set.startingLineup ?? []).slice();
    let rotation = set.startingRotation ?? 1;
    let serving = set.startingServer ?? 'us';
    let us = 0;
    let them = 0;
    let rallies = 0;
    const timeline = [];

    for (const event of set.events ?? []) {
        const rotationAtEvent = rotation;
        const servingAtEvent = serving;

        if (event.type === 'sub') {
            lineup = applySub(lineup, event.outId, event.inId);
            timeline.push({
                event,
                rotationAtEvent,
                servingAtEvent,
                winner: null,
                scoreAfter: { us, them },
            });
            continue;
        }

        const winner = pointFor(event);
        if (winner === 'us') {
            us += 1;
            rallies += 1;
            // A point won while the opponent was serving is a side-out: we rotate.
            if (serving === 'them') {
                lineup = rotateLineup(lineup);
                rotation = nextRotation(rotation);
            }
            serving = 'us';
        } else if (winner === 'them') {
            them += 1;
            rallies += 1;
            serving = 'them';
        }

        timeline.push({
            event,
            rotationAtEvent,
            servingAtEvent,
            winner,
            scoreAfter: { us, them },
        });
    }

    return { us, them, serving, rotation, lineup, timeline, rallies };
}

/**
 * Whether a set has reached a winning score, using standard rules: first to
 * `target` with a two-point margin.
 *
 * @param {number} us
 * @param {number} them
 * @param {number} target
 * @returns {'us'|'them'|null}
 */
export function setWinner(us, them, target = 25) {
    if (us >= target && us - them >= 2) return 'us';
    if (them >= target && them - us >= 2) return 'them';
    return null;
}

/* ----------------------------------------------------------- match format */

export const MATCH_FORMATS = [
    { sets: 3, label: 'Best of 3', winAt: 2 },
    { sets: 5, label: 'Best of 5', winAt: 3 },
];

export const DEFAULT_FORMAT = 3;

export function formatFor(sets) {
    return MATCH_FORMATS.find((f) => f.sets === sets) ?? MATCH_FORMATS[0];
}

/**
 * Score a set is played to. The deciding set — the last one the format allows —
 * is played to 15; every set before it is played to 25.
 *
 * @param {number} setNumber 1-based
 * @param {number} formatSets 3 or 5
 * @returns {number}
 */
export function targetForSet(setNumber, formatSets = DEFAULT_FORMAT) {
    return setNumber >= formatSets ? 15 : 25;
}

/**
 * Sets won by each side and whether that settles the match.
 *
 * Only sets that have been ended count. A set sitting at 25-20 that nobody has
 * closed out yet is still in progress, and treating it as won would declare the
 * match over while the teams are still on the floor.
 *
 * @param {object} match
 * @returns {{us: number, them: number, winner: 'us'|'them'|null, decided: boolean,
 *            format: object, setsPlayed: number}}
 */
export function matchScore(match) {
    const format = formatFor(match?.format ?? DEFAULT_FORMAT);
    let us = 0;
    let them = 0;
    let setsPlayed = 0;

    for (const set of match?.sets ?? []) {
        if (!set.complete) continue;
        setsPlayed += 1;
        const state = computeSetState(set);
        if (state.us > state.them) us += 1;
        else if (state.them > state.us) them += 1;
    }

    const winner = us >= format.winAt ? 'us' : them >= format.winAt ? 'them' : null;
    return { us, them, winner, decided: Boolean(winner), format, setsPlayed };
}
