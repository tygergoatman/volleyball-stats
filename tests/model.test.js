/**
 * Set replay. Rebuilt after the original suite was lost — this covers the
 * correction event added in 2026.09.12a, not the whole module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSetState, describeEvent, lineupAsEntered, pointFor, rotateLineupBy } from '../js/model.js';

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

/* --------------------------------------- replaying a lineup into a new set */

const SIX_IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

test('a lineup we served for comes back exactly as entered', () => {
    const entered = lineupAsEntered({
        startingLineup: SIX_IDS.slice(),
        startingRotation: 4,
        startingServer: 'us',
    });

    assert.equal(entered.rotation, 4, 'the rotation travels with the court');
    assert.deepEqual(entered.lineup, SIX_IDS, 'and the court is untouched');
});

test('the their-serve shift is undone, so the picker gets what it means', () => {
    // Choosing "they serve" moved both back one when the set started. The setup
    // picker means "the rotation as if we are serving", so handing it the stored
    // number would shift a second time the moment they serve again.
    const stored = {
        startingLineup: rotateLineupBy(SIX_IDS, -1),
        startingRotation: 3,
        startingServer: 'them',
    };
    const entered = lineupAsEntered(stored);

    assert.equal(entered.rotation, 4);
    assert.deepEqual(entered.lineup, SIX_IDS);
});

test('undoing the shift wraps at the ends', () => {
    assert.equal(lineupAsEntered({ startingRotation: 6, startingServer: 'them' }).rotation, 1);
    assert.equal(lineupAsEntered({ startingRotation: 1, startingServer: 'them' }).rotation, 2);
});

test('a set with nothing recorded does not throw', () => {
    // Replay must never blow up on a half-built set: the carry-over button reads
    // whatever the last set happens to hold.
    assert.deepEqual(lineupAsEntered({}), { lineup: [], rotation: 1 });
    assert.deepEqual(lineupAsEntered(undefined), { lineup: [], rotation: 1 });
});

test('a malformed rotation falls back rather than throwing', () => {
    for (const rotation of [0, 7, 'four', null, NaN]) {
        assert.equal(lineupAsEntered({ startingRotation: rotation }).rotation, 1);
    }
});
