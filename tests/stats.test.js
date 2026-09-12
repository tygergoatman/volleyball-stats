/**
 * Stat aggregation. Rebuilt after the original suite was lost — this covers the
 * receive/rally split and the fault counts added in 2026.09.13a.
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

/* ------------------------------------------------- receive vs in-rally */

test('serve receive and in-rally passing are counted apart', () => {
    const line = lineFor(['pass3', 'pass1', 'rally3', 'rally3', 'rally0']);

    assert.equal(line.receive.att, 2);
    assert.equal(line.rally.att, 3);
    assert.equal(line.receive.total, 4);
    assert.equal(line.rally.total, 6);
});

test('each has its own average', () => {
    const d = derive(lineFor(['pass3', 'pass0', 'rally3', 'rally3']));

    assert.equal(d.receiveAvg, 1.5, '3 and 0 over two attempts');
    assert.equal(d.rallyAvg, 3);
});

test('the combined passing average spans the split', () => {
    // The number that keeps a season comparable across the taxonomy change:
    // matches recorded before it have everything under `receive`.
    const d = derive(lineFor(['pass3', 'pass0', 'rally3', 'rally3']));

    assert.equal(d.passAtt, 4);
    assert.equal(d.passAvg, 9 / 4);
});

test('a dig is not a rated in-rally pass', () => {
    // The distinction the two rows exist for: a free ball you played is a pass,
    // a ball you dug off a swing is a dig, and lumping them inflates both.
    const line = lineFor(['dig', 'dig', 'rally3']);

    assert.equal(line.dig.digs, 2);
    assert.equal(line.rally.att, 1, 'digs do not count as in-rally pass attempts');
    assert.equal(derive(line).rallyAvg, 3, 'and do not drag the average');
});

test('an average is null rather than zero with no attempts', () => {
    const d = derive(emptyLine());
    assert.equal(d.receiveAvg, null);
    assert.equal(d.rallyAvg, null);
    assert.equal(d.passAvg, null);
});

/* ----------------------------------------------------------- faults */

test('faults are counted per kind', () => {
    const line = lineFor(['faultNet', 'faultNet', 'faultUnder', 'faultDouble']);
    assert.deepEqual(line.fault, { net: 2, under: 1, double: 1 });
});

test('faults count toward errors committed', () => {
    const d = derive(lineFor(['faultNet', 'faultUnder', 'faultDouble', 'rally0', 'pass0']));
    assert.equal(d.errorsCommitted, 5);
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
    const b = pointBreakdown([stat('faultNet'), stat('rally0'), stat('kill')]);

    assert.equal(b.them.fromOurErrors, 2);
    assert.equal(b.us.earned, 1);
    assert.deepEqual(
        [...b.errorsBy.values()].map((row) => row.name).sort(),
        ['In-rally passing error', 'Net touch'],
    );
});

test('the breakdown totals match the points actually scored', () => {
    // The invariant that stops the panel drifting from the scoreboard: both
    // read `pointFor`, so every point lands in exactly one bucket.
    const events = [
        stat('kill'),
        stat('pass0'),
        stat('rally0'),
        stat('faultUnder'),
        team('oppError'),
        team('oppPoint'),
        team('outOfRotation'),
        stat('dig'),
        stat('rally3'),
    ];
    const b = pointBreakdown(events);
    const scored = events.filter((e) => pointFor(e)).length;

    assert.equal(b.us.earned + b.us.fromTheirErrors + b.them.earned + b.them.fromOurErrors, scored);
});

/* ------------------------------------------------------ dead wiring */

test('there is no dig error any more', () => {
    // `digErr` had a handler and a CSV column but no button anywhere, so the
    // column could only ever read zero. The in-rally error is `rally0` now.
    const line = lineFor(['digErr']);
    assert.equal(line.dig.errors, undefined, 'dig.errors should be gone entirely');
    assert.equal(line.dig.digs, 0, 'and an unknown code should record nothing');
});
