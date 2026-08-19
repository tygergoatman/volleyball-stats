/**
 * The game plan: substitutions decided before the match, prompted during it.
 *
 * Written to match how the coach writes it on paper — `L > 19, 8 > 4, 4 > 8`,
 * read as **in > out**. That notation is the whole specification: one standing
 * libero pairing, then a short list of swaps. Returns are ordinary rows
 * (`4 > 8`), deliberately not inferred: guessing when a player should come back
 * means prompting at the wrong moment, which is worse than not prompting.
 *
 * **Nothing here records whether a planned sub has happened.** Whether to
 * prompt is derived from the live lineup — the player going out is on court and
 * the player coming in is not — which is what makes rotating past the same
 * rotation twice, starting a new set, and undoing a sub all behave correctly
 * without a single stored flag. Adding an `applied` field would break all three.
 */

import { BACK_ROW, FRONT_ROW } from './model.js';

/** A plan with nothing in it: no libero pairing, no scheduled swaps. */
export function emptyPlan() {
    return { libero: null, subs: [] };
}

/**
 * Bring a stored plan up to shape, dropping anything malformed.
 *
 * Plans are hand-edited state that outlives roster changes, so this is
 * deliberately forgiving: a row missing a player is dropped rather than
 * throwing, and a plan referring to a player who has since left the roster is
 * kept — `planPrompts` simply never fires it, and the editor shows it greyed.
 */
export function normalisePlan(raw) {
    const plan = emptyPlan();
    if (!raw || typeof raw !== 'object') return plan;

    if (raw.libero?.liberoId && raw.libero?.replacesId) {
        plan.libero = {
            liberoId: String(raw.libero.liberoId),
            replacesId: String(raw.libero.replacesId),
        };
    }

    plan.subs = (Array.isArray(raw.subs) ? raw.subs : [])
        .filter((row) => row?.inId && row?.outId && row.inId !== row.outId)
        .map((row) => ({
            id: String(row.id ?? `${row.rotation}-${row.inId}-${row.outId}`),
            rotation: clampRotation(row.rotation),
            inId: String(row.inId),
            outId: String(row.outId),
        }))
        .sort((a, b) => a.rotation - b.rotation);

    return plan;
}

function clampRotation(value) {
    const rotation = Number(value);
    if (!Number.isFinite(rotation)) return 1;
    return Math.min(6, Math.max(1, Math.round(rotation)));
}

/**
 * What the plan has to say about the position right now, as a list of prompts.
 *
 * Empty means nothing to do, which is the normal case for most of a set.
 *
 * @param {object} config
 * @param {object} config.plan normalised plan for the team
 * @param {Array<string|null>} config.lineup current lineup, indexed by (position - 1)
 * @param {number} config.rotation 1-6
 * @param {string[]} [config.available] ids that may come on — bench, plus the
 *   player the libero replaced, who is reserved rather than benched
 * @param {string|null} [config.liberoReplaced] who the libero actually went in
 *   for, from the live sheet. Trusted over the plan, because the coach may have
 *   put her in for somebody else.
 * @returns {Array<{kind: 'libero'|'sub', inId: string, outId: string, rotation?: number, id: string}>}
 */
export function planPrompts({ plan, lineup = [], rotation = 1, available = [], liberoReplaced = null }) {
    const prompts = [];
    if (!plan) return prompts;

    const onCourt = new Set(lineup.filter(Boolean));
    const canComeOn = new Set(available.filter(Boolean));
    const positionOf = (id) => lineup.indexOf(id) + 1;

    // --- the standing libero pairing -------------------------------------
    //
    // Not keyed to a rotation number: what triggers it is the player crossing
    // between rows, which covers all six rotations and both directions from one
    // line of input.
    if (plan.libero) {
        const { liberoId, replacesId } = plan.libero;
        const liberoOn = onCourt.has(liberoId);

        if (!liberoOn && onCourt.has(replacesId) && BACK_ROW.includes(positionOf(replacesId))) {
            // Her window is open and stays open while the slot is in the back,
            // so this keeps offering until it is taken or the slot rotates on.
            if (canComeOn.has(liberoId)) {
                prompts.push({ kind: 'libero', id: 'libero-on', inId: liberoId, outId: replacesId });
            }
        } else if (liberoOn && FRONT_ROW.includes(positionOf(liberoId))) {
            // She cannot stay: the slot has rotated to the front. Whoever she
            // actually replaced comes back, which is not always the planned one.
            const returning = liberoReplaced ?? replacesId;
            if (returning && canComeOn.has(returning)) {
                prompts.push({ kind: 'libero', id: 'libero-off', inId: returning, outId: liberoId });
            }
        }
    }

    // --- the rotation-keyed schedule --------------------------------------
    for (const row of plan.subs) {
        if (row.rotation !== rotation) continue;
        // The derivation that replaces an "applied" flag.
        if (!onCourt.has(row.outId)) continue;
        if (onCourt.has(row.inId) || !canComeOn.has(row.inId)) continue;
        prompts.push({ kind: 'sub', id: row.id, inId: row.inId, outId: row.outId, rotation: row.rotation });
    }

    return prompts;
}

/**
 * How many of the set's 15 substitutions a plan would spend if every row fired.
 *
 * Libero replacements are unlimited and deliberately not counted — the same
 * rule the tracking sheet enforces.
 *
 * @param {object} plan
 */
export function plannedSubCost(plan) {
    return plan?.subs?.length ?? 0;
}
