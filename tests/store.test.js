/**
 * Store actions. Rebuilt after the original suite was lost — this covers what
 * 2026.09.12a added, not the whole module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../js/store.js';

/** Minimal in-memory stand-in for localStorage. */
class MemoryStorage {
    constructor() {
        this.map = new Map();
    }
    getItem(key) {
        return this.map.has(key) ? this.map.get(key) : null;
    }
    setItem(key, value) {
        this.map.set(key, String(value));
    }
    removeItem(key) {
        this.map.delete(key);
    }
}

function seeded() {
    const storage = new MemoryStorage();
    const store = new Store(storage);
    const team = store.addTeam({ id: 'jv', name: 'JV', fullName: 'Junior Varsity' });
    const players = ['Sara', 'Olive', 'Maddy', 'Sky', 'Opal', 'Mabel', 'Nell'].map((name, index) =>
        store.addPlayer({ number: String(index + 1), name, teams: [team.id] }),
    );
    return { store, players, team, storage };
}

function startMatch(store, players, { opponent = 'Cornerstone', date = '2026-09-01' } = {}) {
    store.createMatch({ teamId: 'jv', opponent, date });
    store.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: players.slice(0, 6).map((p) => p.id),
    });
}

/* ------------------------------------------------------- court correction */

test('correcting the court moves rotation and serve but not the score', () => {
    const { store, players } = seeded();
    startMatch(store, players);
    store.recordTeamEvent('oppError');
    const before = store.liveState;

    store.correctCourt({ rotation: 4, serving: 'them' });
    const after = store.liveState;

    assert.equal(after.rotation, 4);
    assert.equal(after.serving, 'them');
    assert.equal(after.us, before.us, 'the score is not this control’s business');
    assert.equal(after.them, before.them);
});

test('undo takes a correction back', () => {
    const { store, players } = seeded();
    startMatch(store, players);
    const before = store.liveState.rotation;

    store.correctCourt({ rotation: 5, serving: 'us' });
    assert.equal(store.liveState.rotation, 5);

    store.undo();
    assert.equal(store.liveState.rotation, before);
});

test('an unrecognised side is recorded as ours rather than dropped', () => {
    const { store, players } = seeded();
    startMatch(store, players);
    store.correctCourt({ rotation: 2, serving: 'sideways' });
    assert.equal(store.liveState.serving, 'us');
});

/* ------------------------------------------------- carrying a lineup over */

test('a new match offers the last lineup this team played', () => {
    const { store, players } = seeded();
    startMatch(store, players, { opponent: 'Cornerstone', date: '2026-09-01' });
    const played = store.activeSet.startingLineup.slice();

    store.createMatch({ teamId: 'jv', opponent: 'Northside', date: '2026-09-08' });
    const carry = store.lastLineupForTeam('jv', store.activeMatch.id);

    assert.ok(carry, 'a previous match should be offered');
    assert.deepEqual(carry.lineup, played);
    assert.equal(carry.match.opponent, 'Cornerstone');
});

test('the current match is never its own source', () => {
    const { store, players } = seeded();
    startMatch(store, players);
    // Excluding the live match is what stops set 1 offering to copy itself.
    assert.equal(store.lastLineupForTeam('jv', store.activeMatch.id), null);
});

test('the most recent match wins, by date rather than entry order', () => {
    const { store, players } = seeded();
    // Entered out of order, the way a forgotten match gets back-filled later.
    startMatch(store, players, { opponent: 'Older', date: '2026-09-01' });
    store.createMatch({ teamId: 'jv', opponent: 'Newer', date: '2026-09-09' });
    store.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: [players[6], ...players.slice(1, 6)].map((p) => p.id),
    });

    store.createMatch({ teamId: 'jv', opponent: 'Today', date: '2026-09-12' });
    const carry = store.lastLineupForTeam('jv', store.activeMatch.id);
    assert.equal(carry.match.opponent, 'Newer');
});

test('nothing is offered when a player from that lineup has left the team', () => {
    // A partly filled court with silent gaps is worse than an empty one: the gap
    // is easy to miss on a phone, and a set started five-a-side cannot be undone.
    const { store, players } = seeded();
    startMatch(store, players);

    store.deletePlayer(players[2].id);
    store.createMatch({ teamId: 'jv', opponent: 'Northside', date: '2026-09-08' });

    assert.equal(store.lastLineupForTeam('jv', store.activeMatch.id), null);
});

test('another team’s lineup is never offered', () => {
    const { store, players } = seeded();
    store.addTeam({ id: 'var', name: 'Var', fullName: 'Varsity' });
    startMatch(store, players);

    store.createMatch({ teamId: 'var', opponent: 'Northside', date: '2026-09-08' });
    assert.equal(store.lastLineupForTeam('var', store.activeMatch.id), null);
});

test('a match with no sets started is not a source', () => {
    const { store, players } = seeded();
    startMatch(store, players, { opponent: 'Cornerstone', date: '2026-09-01' });
    // Created, then abandoned before a lineup was entered.
    store.createMatch({ teamId: 'jv', opponent: 'Abandoned', date: '2026-09-10' });
    store.createMatch({ teamId: 'jv', opponent: 'Today', date: '2026-09-12' });

    const carry = store.lastLineupForTeam('jv', store.activeMatch.id);
    assert.equal(carry.match.opponent, 'Cornerstone');
});

/* ---------------------------------------------------- editing match details */

test('renaming a match leaves its recorded stats alone', () => {
    const { store, players } = seeded();
    startMatch(store, players, { opponent: 'Cornerstoen' });
    store.recordStat(players[0].id, 'kill');

    store.updateMatch(store.activeMatch.id, { opponent: 'Cornerstone', venue: 'East Gym' });

    assert.equal(store.activeMatch.opponent, 'Cornerstone');
    assert.equal(store.activeMatch.venue, 'East Gym');
    assert.equal(store.activeSet.events.length, 1);
    assert.equal(store.liveState.us, 1);
});
