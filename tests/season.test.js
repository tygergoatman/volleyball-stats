/**
 * A season as a sequence.
 *
 * The thing these guard is the difference between **no value** and **zero**. A
 * match a player sat out is a gap in her chart; a zero there would draw a line
 * saying she passed terribly that night, and a coach reading it would be misled
 * by the app rather than by the data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYER_METRICS, TEAM_METRICS, inPlayedOrder, seasonSeries, seriesValues, shortDate } from '../js/season.js';

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];
const stat = (playerId, code) => ({ type: 'stat', playerId, code });

function set(number, events, complete = true) {
    return {
        id: `s${number}`,
        number,
        complete,
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: SIX.slice(),
        events,
    };
}

function match(id, date, events, overrides = {}) {
    return { id, teamId: 't', opponent: id.toUpperCase(), date, format: 3, sets: [set(1, events)], ...overrides };
}

test('matches come back in the order they were played, not the order they were entered', () => {
    const matches = [match('c', '2026-09-20', []), match('a', '2026-09-01', []), match('b', '2026-09-10', [])];
    assert.deepEqual(
        inPlayedOrder(matches).map((m) => m.id),
        ['a', 'b', 'c'],
    );
});

test('two matches on one day keep the order they were entered', () => {
    // A tournament. Date cannot separate them, so the stored order has to —
    // the same tie-break `lastLineupForTeam` uses, and they must not disagree.
    const matches = [match('first', '2026-09-20', []), match('second', '2026-09-20', [])];
    assert.deepEqual(
        inPlayedOrder(matches).map((m) => m.id),
        ['first', 'second'],
    );
});

test('a team series has one point per match', () => {
    const series = seasonSeries([
        match('a', '2026-09-01', [stat('a', 'pass3'), stat('b', 'pass1')]),
        match('b', '2026-09-08', [stat('a', 'pass2')]),
    ]);

    assert.equal(series.length, 2);
    assert.deepEqual(
        series.map((p) => p.opponent),
        ['A', 'B'],
    );
    // Team passing average is everybody's, not one player's: (3 + 1) / 2.
    assert.equal(series[0].derived.passAvg, 2);
    assert.equal(series[1].derived.passAvg, 2);
});

test('a player who did not play is a gap, not a zero', () => {
    const series = seasonSeries(
        [
            match('a', '2026-09-01', [stat('a', 'pass3')]),
            match('b', '2026-09-08', [stat('b', 'pass1')]),
            match('c', '2026-09-15', [stat('a', 'pass1')]),
        ],
        { playerId: 'a' },
    );

    assert.deepEqual(
        series.map((p) => p.played),
        [true, false, true],
    );

    const pass = PLAYER_METRICS.find((m) => m.key === 'pass');
    assert.deepEqual(seriesValues(series, pass), [3, null, 1], 'the middle match has no value at all');
});

test('a metric with no attempts is null rather than zero', () => {
    // Nobody served in this match, so the serve error rate is unknown — not
    // perfect. A zero would read as a flawless serving night.
    const series = seasonSeries([match('a', '2026-09-01', [stat('a', 'pass3')])]);
    const serve = TEAM_METRICS.find((m) => m.key === 'serveErr');
    assert.deepEqual(seriesValues(series, serve), [null]);
});

test('only completed sets count toward a match point', () => {
    const live = match('a', '2026-09-01', [stat('a', 'kill')]);
    live.sets.push(set(2, [stat('a', 'kill')], false));
    const [point] = seasonSeries([live]);
    assert.equal(point.setsPlayed, 1, 'the set still being played is not counted');
});

test('every team metric reads without throwing on an empty season', () => {
    const series = seasonSeries([match('a', '2026-09-01', [])]);
    for (const metric of [...TEAM_METRICS, ...PLAYER_METRICS]) {
        const values = seriesValues(series, metric);
        assert.equal(values.length, 1, metric.key);
        const format = metric.format ?? String;
        assert.doesNotThrow(() => format(values[0]), metric.key);
    }
});

test('the result of each match travels with its point', () => {
    const won = match('a', '2026-09-01', [], { complete: true });
    won.sets = [
        set(1, Array.from({ length: 25 }, () => ({ type: 'team', code: 'oppError' }))),
        set(2, Array.from({ length: 25 }, () => ({ type: 'team', code: 'oppError' }))),
    ];
    const [point] = seasonSeries([won]);
    assert.equal(point.result.kind, 'win');
    assert.equal(point.result.label, 'W 2–0');
});

test('short dates are what fits under a chart point', () => {
    assert.equal(shortDate('2026-09-04'), '9/4');
    assert.equal(shortDate('2026-11-21'), '11/21');
    assert.equal(shortDate(''), '');
    assert.equal(shortDate(undefined), '');
});
