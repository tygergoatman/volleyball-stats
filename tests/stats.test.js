/**
 * Stat aggregation. Rebuilt after the original suite was lost — this covers
 * passing, the fault counts, and the codes left behind by the short-lived
 * receive/rally split.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregate, derive, emptyLine, pointBreakdown } from '../js/stats.js';
import { pointFor } from '../js/model.js';

const stat = (code, playerId = 'p1') => ({ type: 'stat', playerId, code });
const team = (code) => ({ type: 'team', code });

function lineFor(codes, playerId = 'p1') {
    return aggregate(codes.map((code) => stat(code, playerId))).get(playerId) ?? emptyLine();
}

/* --------------------------------------------------------------- passing */

test('every passing rating lands in one line', () => {
    const line = lineFor(['pass3', 'pass2', 'pass1', 'pass05', 'pass0']);

    assert.equal(line.pass.att, 5);
    assert.equal(line.pass.total, 6.5);
    assert.deepEqual(
        { three: line.pass.three, two: line.pass.two, one: line.pass.one, half: line.pass.half, zero: line.pass.zero },
        { three: 1, two: 1, one: 1, half: 1, zero: 1 },
    );
});

test('the passing average is the rating over the attempts', () => {
    assert.equal(derive(lineFor(['pass3', 'pass0'])).passAvg, 1.5);
    assert.equal(derive(lineFor(['pass3', 'pass3'])).passAvg, 3);
});

test('the in-rally codes from the brief split still count as passes', () => {
    // 2026.09.13a split passing in two and 2026.09.15a put it back. Matches
    // recorded in between hold `rally*` codes; dropping them would silently
    // zero those matches, so they fold into the same line.
    const line = lineFor(['rally3', 'rally2', 'rally1', 'rally0']);

    assert.equal(line.pass.att, 4);
    assert.equal(line.pass.total, 6);
    assert.equal(derive(line).passAvg, 1.5);
});

test('old and new passing codes add together', () => {
    const line = lineFor(['pass3', 'rally3']);
    assert.equal(line.pass.att, 2);
    assert.equal(derive(line).passAvg, 3);
});

test('a dig is not a pass attempt', () => {
    // It is the same first contact, but a dig is not rated and would drag the
    // passing average around if it counted as an attempt.
    const line = lineFor(['dig', 'dig', 'pass3']);

    assert.equal(line.dig.digs, 2);
    assert.equal(line.pass.att, 1);
    assert.equal(derive(line).passAvg, 3);
});

test('an average is null rather than zero with no attempts', () => {
    assert.equal(derive(emptyLine()).passAvg, null);
});

/* ----------------------------------------------------------- faults */

test('faults are counted per kind', () => {
    const line = lineFor(['faultNet', 'faultNet', 'faultUnder', 'faultDouble']);
    assert.deepEqual(line.fault, { net: 2, under: 1, double: 1 });
});

test('faults count toward errors committed', () => {
    const d = derive(lineFor(['faultNet', 'faultUnder', 'faultDouble', 'pass0']));
    assert.equal(d.errorsCommitted, 4);
});

test('every fault concedes the point', () => {
    for (const code of ['faultNet', 'faultUnder', 'faultDouble']) {
        assert.equal(pointFor(stat(code)), 'them', `${code} should score for them`);
    }
});

/* --------------------------------------------- whose error was it */

test('out of rotation is a point we gave away, not one they earned', () => {
    // The misattribution this fixes: before, every team event scoring for them
    // counted as them earning it, so our own lineup fault flattered them.
    const b = pointBreakdown([team('outOfRotation')]);

    assert.equal(b.them.fromOurErrors, 1);
    assert.equal(b.them.earned, 0);
    assert.equal([...b.errorsBy.values()][0].name, 'Out of rotation');
});

test('an opponent point is still theirs', () => {
    const b = pointBreakdown([team('oppPoint')]);
    assert.equal(b.them.earned, 1);
    assert.equal(b.them.fromOurErrors, 0);
});

test('an opponent error is still a point we did not earn', () => {
    const b = pointBreakdown([team('oppError')]);
    assert.equal(b.us.fromTheirErrors, 1);
    assert.equal(b.us.earned, 0);
});

test('player faults are listed among the errors we gave away', () => {
    const b = pointBreakdown([stat('faultNet'), stat('pass0'), stat('kill')]);

    assert.equal(b.them.fromOurErrors, 2);
    assert.equal(b.us.earned, 1);
    assert.deepEqual(
        [...b.errorsBy.values()].map((row) => row.name).sort(),
        ['Net touch', 'Shank / pass error'],
    );
});

test('the breakdown totals match the points actually scored', () => {
    // The invariant that stops the panel drifting from the scoreboard: both
    // read `pointFor`, so every point lands in exactly one bucket.
    const events = [
        stat('kill'),
        stat('pass0'),
        stat('faultUnder'),
        team('oppError'),
        team('oppPoint'),
        team('outOfRotation'),
        stat('dig'),
        stat('pass3'),
    ];
    const b = pointBreakdown(events);
    const scored = events.filter((e) => pointFor(e)).length;

    assert.equal(b.us.earned + b.us.fromTheirErrors + b.them.earned + b.them.fromOurErrors, scored);
});

/* ------------------------------------------------------ dead wiring */

test('there is no dig error any more', () => {
    // `digErr` had a handler and a CSV column but no button anywhere, so the
    // column could only ever read zero. A misplayed first contact is `pass0`.
    const line = lineFor(['digErr']);
    assert.equal(line.dig.errors, undefined, 'dig.errors should be gone entirely');
    assert.equal(line.dig.digs, 0, 'and an unknown code should record nothing');
});
