/**
 * What a press-and-hold offers, and — more importantly — what it does not.
 *
 * The rules here were argued down from a longer list. Two are worth stating
 * because a future change could quietly undo them:
 *
 * - **No position matching.** An earlier version ranked the bench by position,
 *   a middle for a middle. The owner rejected it: this roster moves players
 *   around and nobody is fixed, so it was inventing a signal. The ring offers
 *   only what the set itself knows; everything else goes through the sheet.
 * - **The libero is back row only**, which is not the app declining to referee.
 *   She may not play front row at all, so offering her there is offering
 *   something that never happens — and recording it would corrupt the sub count.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { subOptions, liberoAllowedAt } from '../js/subring.js';

/** Lineup by court position: 1 = p1, 2 = p2, and so on. */
const LINEUP = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

/** Sheet rows, only the fields `subOptions` reads. */
function rows(overrides = {}) {
    return LINEUP.map((id, index) => ({
        index,
        currentPlayerId: id,
        previousPlayerId: null,
        ...(overrides[id] ?? {}),
    }));
}

const offCourt = ['pBench', 'pLib', 'pOther'];

test('a plan row due at this rotation is offered', () => {
    const options = subOptions({
        playerId: 'p4',
        lineup: LINEUP,
        rotation: 3,
        plan: { libero: null, subs: [{ id: 'a', rotation: 3, inId: 'pBench', outId: 'p4' }] },
        rows: rows(),
        offCourt,
    });
    assert.deepEqual(options.planned, { kind: 'sub', inId: 'pBench', outId: 'p4' });
});

test('a plan row for another rotation is not', () => {
    const options = subOptions({
        playerId: 'p4',
        lineup: LINEUP,
        rotation: 3,
        plan: { libero: null, subs: [{ id: 'a', rotation: 5, inId: 'pBench', outId: 'p4' }] },
        rows: rows(),
        offCourt,
    });
    assert.equal(options.planned, null);
});

test('the player this one replaced is offered back', () => {
    const options = subOptions({
        playerId: 'p4',
        lineup: LINEUP,
        rotation: 1,
        rows: rows({ p4: { previousPlayerId: 'pOther' } }),
        offCourt,
    });
    assert.deepEqual(options.back, { kind: 'sub', inId: 'pOther', outId: 'p4' });
});

test('but not when they are already back on court', () => {
    const options = subOptions({
        playerId: 'p4',
        lineup: LINEUP,
        rotation: 1,
        rows: rows({ p4: { previousPlayerId: 'p2' } }),
        offCourt,
    });
    assert.equal(options.back, null);
});

test('a swap involving the libero is a libero replacement, not a substitution', () => {
    // She is on court in position 5, standing in for pOther.
    const lineup = ['p1', 'p2', 'p3', 'p4', 'pLib', 'p6'];
    const options = subOptions({
        playerId: 'pLib',
        lineup,
        rotation: 1,
        rows: rows().map((row) => (row.index === 4 ? { ...row, currentPlayerId: 'pLib', previousPlayerId: 'pOther' } : row)),
        liberoIds: ['pLib'],
        offCourt: ['pOther', 'pBench'],
    });
    // Unlimited, and must not count against the set's 18.
    assert.equal(options.back.kind, 'libero');
    assert.equal(options.back.inId, 'pOther');
});

test('the libero is offered for a back-row player', () => {
    for (const position of [1, 5, 6]) {
        const playerId = LINEUP[position - 1];
        const options = subOptions({
            playerId,
            lineup: LINEUP,
            rotation: 1,
            rows: rows(),
            liberoIds: ['pLib'],
            offCourt,
        });
        assert.deepEqual(options.libero, { kind: 'libero', inId: 'pLib', outId: playerId }, `position ${position}`);
    }
});

test('the libero is never offered for a front-row player', () => {
    for (const position of [2, 3, 4]) {
        const playerId = LINEUP[position - 1];
        const options = subOptions({
            playerId,
            lineup: LINEUP,
            rotation: 1,
            rows: rows(),
            liberoIds: ['pLib'],
            offCourt,
        });
        assert.equal(options.libero, null, `position ${position} should not offer the libero`);
    }
});

test('a second libero is not offered while the first is on', () => {
    const lineup = ['p1', 'p2', 'p3', 'p4', 'pLib', 'p6'];
    const options = subOptions({
        playerId: 'p1',
        lineup,
        rotation: 1,
        rows: rows().map((row) => (row.index === 4 ? { ...row, currentPlayerId: 'pLib' } : row)),
        liberoIds: ['pLib', 'pLib2'],
        offCourt: ['pLib2', 'pBench'],
    });
    assert.equal(options.libero, null);
});

test('nothing is offered for somebody who is not on court', () => {
    const options = subOptions({ playerId: 'pBench', lineup: LINEUP, rotation: 1, rows: rows(), offCourt });
    assert.deepEqual(options, { planned: null, back: null, libero: null });
});

test('no bench candidates are offered — that is the sheet, deliberately', () => {
    const options = subOptions({
        playerId: 'p1',
        lineup: LINEUP,
        rotation: 1,
        rows: rows(),
        offCourt: ['pBench', 'pOther'],
    });
    assert.deepEqual(options, { planned: null, back: null, libero: null });
});

test('liberoAllowedAt knows the front row', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(liberoAllowedAt), [true, false, false, false, true, true]);
});
