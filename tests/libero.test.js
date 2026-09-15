/**
 * The libero tracking sheet. Rebuilt after the original suite was lost — this
 * covers the substitution limit, not the whole module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SUB_LIMIT, liberoSheet } from '../js/libero.js';

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];
const set = (events) => ({ startingLineup: SIX.slice(), startingRotation: 1, startingServer: 'us', events });

test('the substitution limit is 18', () => {
    // This team's association. The point of the test is not the number but that
    // it is stated once — see the sheet below, which reads it rather than 15.
    assert.equal(SUB_LIMIT, 18);
});

test('a fresh set has the whole allowance', () => {
    const sheet = liberoSheet(set([]));
    assert.equal(sheet.subLimit, SUB_LIMIT);
    assert.equal(sheet.subsUsed, 0);
    assert.equal(sheet.subsLeft, SUB_LIMIT);
});

test('each substitution spends one', () => {
    const sheet = liberoSheet(set([{ type: 'sub', kind: 'sub', outId: 'a', inId: 'g' }]));
    assert.equal(sheet.subsUsed, 1);
    assert.equal(sheet.subsLeft, SUB_LIMIT - 1);
});

test('libero replacements are unlimited and spend none', () => {
    const events = Array.from({ length: 6 }, (_, i) => ({
        type: 'sub',
        kind: 'libero',
        outId: i % 2 === 0 ? 'a' : 'L',
        inId: i % 2 === 0 ? 'L' : 'a',
    }));
    const sheet = liberoSheet(set(events), { liberoIds: ['L'] });
    assert.equal(sheet.subsUsed, 0, 'libero swaps never count against the limit');
    assert.equal(sheet.subsLeft, SUB_LIMIT);
});

test('going past the limit is recorded, not blocked', () => {
    // Warn, never block: a courtside tool that refuses to record what happened
    // is worse than one that records it and says so.
    // Chained through one slot: each sub takes out whoever the previous one put
    // in. Substituting the same six starters over and over would only count
    // once each, because after the first round they are no longer on court.
    const events = Array.from({ length: SUB_LIMIT + 2 }, (_, i) => ({
        type: 'sub',
        kind: 'sub',
        outId: i === 0 ? 'a' : `bench${i - 1}`,
        inId: `bench${i}`,
    }));
    const sheet = liberoSheet(set(events));

    assert.equal(sheet.subsUsed, SUB_LIMIT + 2, 'every one is still counted');
    assert.equal(sheet.subsLeft, 0, 'but the remaining count floors at zero');
});

test('a caller can override the limit for another association', () => {
    // USAV and NCAA play 12. The sheet takes it as a parameter so that does not
    // need a code change.
    const sheet = liberoSheet(set([]), { subLimit: 12 });
    assert.equal(sheet.subLimit, 12);
    assert.equal(sheet.subsLeft, 12);
});
