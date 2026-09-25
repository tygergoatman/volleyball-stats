/**
 * A season as a sequence, rather than as a total.
 *
 * Everything else in this app aggregates: `aggregateSeason` folds fifteen
 * matches into one line and answers "how did she pass this year?". This module
 * refuses to fold, and answers "how did she pass *in each match*?" — which is
 * the only shape a trend can be drawn from.
 *
 * Nothing new is computed here. Each point is the existing per-match
 * aggregation kept separate and put in date order, so a chart and the Stats tab
 * can never disagree about a number.
 *
 * Pure: no DOM, no storage.
 */

import { matchResult } from './model.js';
import {
    aggregateMatch,
    breakdownForSets,
    breakdownTotals,
    derive,
    emptyBreakdown,
    emptyLine,
    rotationBreakdown,
    totalLine,
} from './stats.js';

/**
 * Matches in the order they were played.
 *
 * Date is what a coach means by "through the season", but two matches can share
 * a date — a tournament — so the stored order breaks the tie. That is the same
 * rule `lastLineupForTeam` uses, and the two must not disagree about which
 * match came last.
 */
export function inPlayedOrder(matches = []) {
    return matches
        .map((match, index) => ({ match, index }))
        .sort((a, b) =>
            a.match.date === b.match.date
                ? a.index - b.index
                : String(a.match.date).localeCompare(String(b.match.date)),
        )
        .map(({ match }) => match);
}

/**
 * One point per match, for charting.
 *
 * @param {Array<object>} matches one team's matches
 * @param {{playerId?: string|null}} [options] a player's own series, or the
 *   whole team's when omitted
 * @returns {Array<object>}
 */
export function seasonSeries(matches = [], { playerId = null } = {}) {
    return inPlayedOrder(matches).map((match, index) => {
        const sets = match.sets ?? [];
        const lines = aggregateMatch(match);
        const line = playerId ? (lines.get(playerId) ?? emptyLine()) : totalLine(lines.values());
        const breakdown = breakdownForSets(sets);

        return {
            index,
            matchId: match.id,
            date: match.date,
            opponent: match.opponent,
            label: shortDate(match.date),
            setsPlayed: sets.filter((set) => set.complete).length,
            // `played` is about this series' subject: a player who did not take
            // the floor should be a gap in her chart, not a zero that drags an
            // average down.
            played: playerId ? lines.has(playerId) : sets.length > 0,
            result: matchResult(match),
            line,
            derived: derive(line),
            breakdown,
            totals: breakdownTotals(breakdown),
            rotations: rotationBreakdown(sets),
        };
    });
}

/**
 * The metrics worth watching across a season, each as a chartable series.
 *
 * Kept as data rather than as chart-drawing code so the same definitions feed
 * the charts, the tooltips and the CSV, and so adding one is a line here rather
 * than a new panel.
 *
 * `lowerIsBetter` is what lets a chart say whether a line going up is good
 * news; without it every chart needs a human to remember which way to read it.
 */
export const TEAM_METRICS = [
    {
        key: 'sideout',
        label: 'Points won',
        hint: 'Points we scored, and how many of them we earned rather than were given',
        read: (point) => point.totals.us,
        parts: [
            { key: 'earned', label: 'Earned', read: (p) => p.breakdown.us.earned },
            { key: 'gifted', label: 'Their errors', read: (p) => p.breakdown.us.fromTheirErrors },
        ],
    },
    {
        key: 'given',
        label: 'Points given away',
        hint: 'Points the other team got from our errors rather than by earning them',
        lowerIsBetter: true,
        read: (point) => point.breakdown.them.fromOurErrors,
        parts: [
            { key: 'ours', label: 'Our errors', read: (p) => p.breakdown.them.fromOurErrors },
            { key: 'theirs', label: 'They earned', read: (p) => p.breakdown.them.earned },
        ],
    },
    {
        key: 'pass',
        label: 'Passing average',
        hint: 'Team passing average per match, on a 3-point scale',
        read: (point) => point.derived.passAvg,
        format: (value) => (value === null ? '—' : value.toFixed(2)),
        domain: [0, 3],
    },
    {
        key: 'hit',
        label: 'Hitting %',
        hint: 'Kills minus errors over attempts. Negative is possible and normal on a bad night',
        read: (point) => point.derived.hitPct,
        format: formatRate,
    },
    {
        key: 'errors',
        label: 'Errors per set',
        hint: 'Every error charged to a player, divided by sets played',
        lowerIsBetter: true,
        read: (point) => (point.setsPlayed ? point.derived.errorsCommitted / point.setsPlayed : null),
        format: (value) => (value === null ? '—' : value.toFixed(1)),
    },
    {
        key: 'serveErr',
        label: 'Serve error %',
        hint: 'Missed serves over serve attempts',
        lowerIsBetter: true,
        read: (point) => point.derived.serveErrPct,
        format: formatRate,
    },
];

/** The same idea for one player. Fewer metrics: these are the ones with enough volume to trend. */
export const PLAYER_METRICS = [
    {
        key: 'pass',
        label: 'Passing average',
        read: (point) => point.derived.passAvg,
        format: (value) => (value === null ? '—' : value.toFixed(2)),
        domain: [0, 3],
        volume: (point) => point.derived.passAtt,
    },
    {
        key: 'hit',
        label: 'Hitting %',
        read: (point) => point.derived.hitPct,
        format: formatRate,
        volume: (point) => point.derived.attackAtt,
    },
    {
        key: 'kills',
        label: 'Kills',
        read: (point) => point.line.attack.kills,
        format: (value) => (value === null ? '—' : String(value)),
    },
    {
        key: 'errors',
        label: 'Errors',
        lowerIsBetter: true,
        read: (point) => point.derived.errorsCommitted,
        format: (value) => (value === null ? '—' : String(value)),
    },
];

function formatRate(value) {
    if (value === null || value === undefined) return '—';
    const fixed = value.toFixed(3);
    return fixed.startsWith('0.') ? fixed.slice(1) : fixed.startsWith('-0.') ? `-${fixed.slice(2)}` : fixed;
}

/** `2026-09-14` → `9/14`, which is what fits under a chart point. */
export function shortDate(iso) {
    const parts = String(iso ?? '').split('-');
    if (parts.length !== 3) return String(iso ?? '');
    return `${Number(parts[1])}/${Number(parts[2])}`;
}

/**
 * A metric's values across the season, with the gaps kept as gaps.
 *
 * A match a player sat out has no value, not a zero — and the difference
 * matters, because a zero drawn on a line chart reads as "she passed terribly
 * that night" rather than "she was not there".
 */
export function seriesValues(points, metric) {
    return points.map((point) => (point.played ? (metric.read(point) ?? null) : null));
}

/**
 * Season totals per rotation, across every match given.
 *
 * `rotationBreakdown` already does this for a list of sets; this just pools the
 * sets of many matches so the question can be asked of a season.
 */
export function seasonRotations(matches = []) {
    return rotationBreakdown(matches.flatMap((match) => match.sets ?? []));
}

/** The whole season's point split, for the headline numbers. */
export function seasonBreakdown(matches = []) {
    const into = emptyBreakdown();
    for (const match of matches) breakdownForSets(match.sets ?? [], into);
    return { breakdown: into, totals: breakdownTotals(into) };
}
