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
export const SCHEMA_VERSION = 4;

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

/** Positions 1, 5 and 6 — where the libero and defensive specialists play. */
export const BACK_ROW = [1, 5, 6];

export const ROSTER_POSITIONS = ['OH', 'MB', 'S', 'OPP', 'L', 'DS'];

/**
 * The order that decides a player's *primary* position, most distinctive first.
 *
 * A player who goes all the way around carries more than one position, but the
 * court can only paint one colour and the roster only has room for one lead
 * tag. The distinctive role wins: colour exists to answer "who is setting, who
 * is the libero" at a glance, so somebody tagged both S and OH reads as a
 * setter, which is the fact worth knowing mid-rally.
 *
 * `positions` is always stored sorted by this, which also means the record does
 * not depend on the order the coach happened to tap — `['S','OH']` and
 * `['OH','S']` are the same player.
 */
export const POSITION_PRECEDENCE = ['L', 'S', 'DS', 'OPP', 'MB', 'OH'];

/**
 * Canonicalise a set of positions: known values only, no duplicates, sorted by
 * `POSITION_PRECEDENCE`.
 *
 * @param {string[]} positions
 * @returns {string[]}
 */
export function sortPositions(positions) {
    const known = [...new Set((positions ?? []).map((p) => String(p ?? '').trim()).filter(Boolean))].filter((p) =>
        ROSTER_POSITIONS.includes(p),
    );
    return known.sort((a, b) => POSITION_PRECEDENCE.indexOf(a) - POSITION_PRECEDENCE.indexOf(b));
}

/**
 * Positions split by the row they are actually played from.
 *
 * This is a 6-2 statement, and it is the team's: **setters set from the back
 * row only.** A setter who has rotated to the front is hitting, not setting —
 * that is what the second S in "6-2" is for. Libero and DS are back row by
 * rule.
 */
export const FRONT_ROW_POSITIONS = ['OH', 'MB', 'OPP'];
export const BACK_ROW_POSITIONS = ['S', 'L', 'DS'];

/**
 * The one position that stands for a player where only one fits.
 *
 * Pass `row` and it answers for where she is standing right now, which for a
 * player who goes all the way around is a different answer front and back: an
 * S/OH in the front row is playing outside and should be called an OH, because
 * she cannot be setting from there. Without `row` it falls back to the static
 * `POSITION_PRECEDENCE` order, which is what the roster list wants.
 *
 * A player whose positions are all on the other side of this split — a pure
 * setter caught in the front row, a libero who should not be there at all —
 * keeps her own position rather than being blanked. She is still that player;
 * the lineup is what is odd, and the 6-2 and front-row-libero checks are the
 * things that say so.
 *
 * @param {object|undefined} player
 * @param {'front'|'back'|null} [row]
 * @returns {string} `''` when the player has no position tagged
 */
export function primaryPosition(player, row = null) {
    const positions = player?.positions ?? [];
    if (positions.length === 0) return '';
    if (row) {
        const playedFromHere = row === 'front' ? FRONT_ROW_POSITIONS : BACK_ROW_POSITIONS;
        const match = positions.find((p) => playedFromHere.includes(p));
        if (match) return match;
    }
    return positions[0];
}

/**
 * Whether a player plays any of the given positions.
 *
 * @param {object|undefined} player
 * @param {string|string[]} positions
 */
export function playsPosition(player, positions) {
    const wanted = Array.isArray(positions) ? positions : [positions];
    return (player?.positions ?? []).some((p) => wanted.includes(p));
}

/**
 * Every position a player carries, for display: `S/OH`, or `''` when untagged.
 *
 * The separator is a parameter because the roster has room to breathe and a
 * court bubble does not.
 *
 * @param {object|undefined} player
 * @param {string} [separator]
 */
export function positionsLabel(player, separator = '/') {
    return (player?.positions ?? []).join(separator);
}

/**
 * Court colours by position, so a glance tells you who is who mid-rally.
 *
 * Hitters share one colour by default because the useful signal is "hitter,
 * setter, libero or DS" rather than six hues competing on one court — but every
 * position is overridable, so they can be split later.
 *
 * Every colour here was checked for contrast against the white bold text on a
 * bubble, at full strength and at the darkened back-row shade: all are at least
 * 3.0:1. Amber and light teal were the obvious picks and both failed, so do not
 * swap one in without re-checking.
 */
export const POSITION_COLORS = {
    OH: '#2f81f7',
    MB: '#2f81f7',
    OPP: '#2f81f7',
    S: '#ea580c',
    L: '#a855f7',
    DS: '#0d9488',
};

/** Players with no position keep the colour the court has always used. */
export const DEFAULT_PLAYER_COLOR = '#2f81f7';

/**
 * The colour a player's bubble should be.
 *
 * @param {object|undefined} player
 * @param {Record<string, string>} [overrides] per-position colours set in the app
 */
export function colorForPlayer(player, overrides = {}, row = null) {
    return colorForPosition(primaryPosition(player, row), overrides);
}

/**
 * The colour for one position, honouring any override.
 *
 * @param {string} position
 * @param {Record<string, string>} [overrides]
 */
export function colorForPosition(position, overrides = {}) {
    if (!position) return DEFAULT_PLAYER_COLOR;
    return overrides[position] ?? POSITION_COLORS[position] ?? DEFAULT_PLAYER_COLOR;
}

/**
 * Darken a hex colour. Back-row bubbles use this so the court still shows front
 * and back at a glance once position colour has taken over the fill — hue says
 * what they play, lightness says which row they are in.
 *
 * @param {string} hex `#rrggbb`
 * @param {number} amount 0-1
 */
export function darkenHex(hex, amount = 0.22) {
    const match = /^#?([\da-f]{6})$/i.exec(String(hex ?? '').trim());
    if (!match) return hex;
    const value = parseInt(match[1], 16);
    const scale = (channel) => Math.max(0, Math.min(255, Math.round(channel * (1 - amount))));
    const r = scale((value >> 16) & 255);
    const g = scale((value >> 8) & 255);
    const b = scale(value & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Positions that are worth calling out on the court map: knowing who is setting
 * and who the libero is matters while capturing; the rest do not.
 *
 * These are read from `position` rather than separate flags. Two fields saying
 * the same thing could disagree, and the roster only ever needs to say it once.
 */
export const HIGHLIGHTED_POSITIONS = ['S', 'L'];

export function isSetter(player) {
    return playsPosition(player, 'S');
}

export function isLibero(player) {
    return playsPosition(player, 'L');
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
        const arriving = playerLookup(event.inId);
        const leaving = playerLookup(event.outId);
        if (event.kind === 'libero' || isLibero(arriving) || isLibero(leaving)) {
            return isLibero(arriving)
                ? `Libero ${playerLabel(arriving)} in for ${playerLabel(leaving)}`
                : `${playerLabel(arriving)} back in for libero ${playerLabel(leaving)}`;
        }
        return `Sub: ${playerLabel(arriving)} in for ${playerLabel(leaving)}`;
    }
    if (event.type === 'team') {
        return TEAM_EVENT_BY_CODE.get(event.code)?.name ?? event.code;
    }
    const definition = STAT_BY_CODE.get(event.code);
    const who = playerLabel(playerLookup(event.playerId));
    return `${who} — ${definition ? definition.name : event.code}`;
}

/**
 * How to refer to a player in a sentence: `#7 Emma`, or just `#7` when no name
 * is recorded.
 *
 * The shared roster file deliberately carries no names — see ROSTER.md — so an
 * unnamed player is the normal case, not a data error. The number is the
 * identity everywhere it matters, and it is the one field always present.
 *
 * @param {object|undefined} player
 * @returns {string}
 */
export function playerLabel(player) {
    if (!player) return 'Unknown player';
    const parts = [];
    if (player.number) parts.push(`#${player.number}`);
    if (player.name) parts.push(player.name);
    return parts.join(' ') || 'Unnamed player';
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
 * Rotate a lineup `count` times, forwards or backwards.
 *
 * Used by the set setup screen: a lineup is entered in serving order, and
 * picking "starting rotation N" turns it into the arrangement where the Nth
 * player in that order is the one serving.
 *
 * @param {Array<string|null>} lineup
 * @param {number} count may be negative
 * @returns {Array<string|null>} a new array
 */
export function rotateLineupBy(lineup, count) {
    const times = ((count % 6) + 6) % 6;
    let next = lineup.slice();
    for (let i = 0; i < times; i++) next = rotateLineup(next);
    return next;
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
