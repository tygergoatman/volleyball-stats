/**
 * What a press-and-hold on a player offers: the swaps worth putting under a
 * thumb, and nothing else.
 *
 * **Three candidates, each from a rule, and everybody else through the sheet.**
 * An earlier design also ranked the bench by position — a middle for a middle —
 * and the owner threw it out for the right reason: this roster moves players
 * around and nobody is fixed to a position, so the ranking was inventing a
 * signal that is not in the data. What is left is only what the set itself
 * knows.
 *
 * Pure, so the rules can be tested without a court to press on.
 */

import { BACK_ROW, FRONT_ROW } from './model.js';
import { planPrompts } from './plan.js';

/**
 * @param {object} config
 * @param {string} config.playerId who is being held
 * @param {Array<string|null>} config.lineup current lineup, indexed by (position - 1)
 * @param {number} config.rotation 1-6
 * @param {object} config.plan normalised plan for the team
 * @param {Array<object>} config.rows libero-sheet rows for the set
 * @param {string[]} [config.liberoIds] designated liberos
 * @param {string[]} [config.offCourt] everyone not on court, including the
 *   player a libero replaced — she is reserved rather than benched, and she is
 *   exactly who the return offer needs
 * @returns {{planned: object|null, back: object|null, libero: object|null}}
 *   each a `{kind, inId, outId}` ready for `recordSub`, or null
 */
export function subOptions({
    playerId,
    lineup = [],
    rotation = 1,
    plan = null,
    rows = [],
    liberoIds = [],
    offCourt = [],
}) {
    const result = { planned: null, back: null, libero: null };
    if (!playerId || !lineup.includes(playerId)) return result;

    const liberos = new Set(liberoIds.filter(Boolean));
    const isLibero = (id) => liberos.has(id);
    const canComeOn = new Set(offCourt.filter(Boolean));
    const position = lineup.indexOf(playerId) + 1;

    // --- the plan row due right now ---------------------------------------
    //
    // Straight from `planPrompts` rather than by re-reading the plan, so the
    // bubble says exactly what the plan strip says — including a sub that has
    // moved to follow an ad-hoc swap earlier in the set.
    const prompts = planPrompts({ plan, lineup, rotation, available: offCourt, rows });
    const planned = prompts.find((prompt) => prompt.kind === 'sub' && prompt.outId === playerId);
    if (planned) result.planned = { kind: 'sub', inId: planned.inId, outId: playerId };

    // --- back into this line ----------------------------------------------
    //
    // Whoever the player standing here replaced. One bubble, the most recent:
    // a line with a longer history than that has the older names on the sheet,
    // and a ring is not a place to browse.
    //
    // Holding the libero is the same move read from the other end — she leaves,
    // the player she came on for returns — which is why this needs no separate
    // case. It is the swap made every time she rotates to the front.
    const row = rows.find((r) => r.currentPlayerId === playerId);
    const returning = row?.previousPlayerId ?? null;
    if (returning && canComeOn.has(returning)) {
        // A replacement involving a libero at either end is unlimited and must
        // not be counted against the set's substitutions.
        const kind = isLibero(playerId) || isLibero(returning) ? 'libero' : 'sub';
        result.back = { kind, inId: returning, outId: playerId };
    }

    // --- the libero on ------------------------------------------------------
    //
    // **Back row only.** A libero may not play front row, so offering her there
    // is not the app declining to referee — it is offering something that never
    // happens. Only one libero is ever on court, so a second is not offered
    // while the first is on.
    const liberoOnCourt = lineup.some((id) => id && isLibero(id));
    if (!liberoOnCourt && !isLibero(playerId) && BACK_ROW.includes(position)) {
        const free = [...liberos].find((id) => canComeOn.has(id));
        if (free) result.libero = { kind: 'libero', inId: free, outId: playerId };
    }

    return result;
}

/** Whether a court position is one the libero may stand in. */
export function liberoAllowedAt(position) {
    return !FRONT_ROW.includes(position);
}
