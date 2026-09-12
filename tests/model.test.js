/**
 * Set replay. Rebuilt after the original suite was lost — this covers the
 * correction event added in 2026.09.12a, not the whole module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSetState, describeEvent, pointFor, rotateLineupBy } from '../js/model.js';

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];

function set(events, overrides = {}) {
    return { startingLineup: SIX.slice(), startingRotation: 1, startingServer: 'us', events, ...overrides };
}

test('a correction moves the rotation and the lineup together', () => {
    // Setting the counter without moving the six is the bug the starting-rotation
    // picker once had: the number changes, the court silently disagrees.
    const state = computeSetState(set([{ type: 'correct', rotation: 4, serving: 'us' }]));

    assert.equal(state.rotation, 4);
    assert.deepEqual(state.lineup, rotateLineupBy(SIX, 3), 'the court follows the number');
});

test('a correction leaves the score alone', () => {
    const events = [
        { type: 'team', code: 'oppError' },
        { type: 'team', code: 'oppPoint' },
        { type: 'correct', rotation: 5, serving: 'us' },
    ];
    const state = computeSetState(set(events));

    assert.equal(state.us, 1);
    assert.equal(state.them, 1);
    assert.equal(state.rallies, 2, 'a correction is not a rally');
    assert.equal(state.rotation, 5);
});

test('a correction sets who is serving', () => {
    // Without this the next rally decides whether to rotate from a stale flag,
    // and the rotation goes straight back out.
    const state = computeSetState(set([{ type: 'correct', rotation: 3, serving: 'them' }]));
    assert.equal(state.serving, 'them');
});

test('after a correction, play carries on from the corrected state', () => {
    const state = computeSetState(
        set([
            { type: 'correct', rotation: 3, serving: 'them' },
            // They were serving, we won it: a side-out, so we rotate to 4.
            { type: 'team', code: 'oppError' },
        ]),
    );

    assert.equal(state.rotation, 4);
    assert.equal(state.serving, 'us');
    assert.equal(state.us, 1);
});

test('a correction states a target, not a nudge', () => {
    // Two corrections in a row land on the second one's number rather than
    // compounding, which is what makes "we are actually in 4" mean that however
    // many times the coach re-reads the floor.
    const state = computeSetState(
        set([
            { type: 'correct', rotation: 4, serving: 'us' },
            { type: 'correct', rotation: 2, serving: 'us' },
        ]),
    );
    assert.equal(state.rotation, 2);
    assert.deepEqual(state.lineup, rotateLineupBy(SIX, 1));
});

test('a malformed correction is ignored rather than breaking replay', () => {
    // A set that will not compute is a set the coach cannot see at all, which is
    // far worse than one correction quietly doing nothing.
    for (const rotation of [0, 7, 'four', null, undefined, NaN]) {
        const state = computeSetState(set([{ type: 'correct', rotation, serving: 'us' }]));
        assert.equal(state.rotation, 1, `rotation ${JSON.stringify(rotation)} should fall back`);
        assert.deepEqual(state.lineup, SIX, 'and the court should not move');
    }
});

test('a correction lands in the timeline so it can be deleted', () => {
    const state = computeSetState(
        set([{ type: 'team', code: 'oppError' }, { type: 'correct', rotation: 3, serving: 'us' }]),
    );
    assert.equal(state.timeline.length, 2);
    assert.equal(state.timeline[1].winner, null);
    assert.deepEqual(state.timeline[1].scoreAfter, { us: 1, them: 0 }, 'shown at the score it was made at');
});

test('pointFor ignores a correction', () => {
    assert.equal(pointFor({ type: 'correct', rotation: 3, serving: 'us' }), null);
});

test('a correction reads as a sentence in the log', () => {
    assert.equal(
        describeEvent({ type: 'correct', rotation: 4, serving: 'us' }),
        'Corrected to rotation 4, we serve',
    );
    assert.equal(
        describeEvent({ type: 'correct', rotation: 2, serving: 'them' }),
        'Corrected to rotation 2, they serve',
    );
});

test('corrections do not survive into the next set', () => {
    // Nothing to reset: a new set is a new event list, which is the whole
    // mechanism.
    assert.equal(computeSetState(set([])).rotation, 1);
});
