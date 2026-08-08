import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../js/store.js';
import { computeSetState } from '../js/model.js';

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

/** A store with six players on court and a set already started. */
function seeded(storage = new MemoryStorage()) {
    const store = new Store(storage);
    const team = store.addTeam({ id: 'var', name: 'Var', fullName: 'Varsity' });
    const players = ['Jane', 'Tess', 'McKenna', 'Ella', 'Hailey', 'Hannah', 'Bench One'].map((name, index) =>
        store.addPlayer({ number: String(index + 1), name, teams: [team.id] }),
    );
    store.createMatch({ teamId: team.id, opponent: 'Cornerstone', date: '2026-08-06', venue: 'RRC' });
    store.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: players.slice(0, 6).map((p) => p.id),
    });
    return { store, players, storage, team };
}

test('addPlayer keeps the roster sorted by jersey number', () => {
    const store = new Store(new MemoryStorage());
    const team = store.addTeam({ id: 'var', name: 'Var' });
    store.addPlayer({ number: '16', name: 'McKenna', teams: [team.id] });
    store.addPlayer({ number: '2', name: 'Jane', teams: [team.id] });
    store.addPlayer({ number: '8', name: 'Ella', teams: [team.id] });
    assert.deepEqual(
        store.roster.map((p) => p.number),
        ['2', '8', '16'],
    );
});

test('players without a numeric jersey sort to the end', () => {
    const store = new Store(new MemoryStorage());
    const team = store.addTeam({ id: 'var', name: 'Var' });
    store.addPlayer({ number: '5', name: 'Five', teams: [team.id] });
    store.addPlayer({ number: '', name: 'Nameless', teams: [team.id] });
    assert.deepEqual(
        store.roster.map((p) => p.name),
        ['Five', 'Nameless'],
    );
});

test('recording a stat updates the derived score', () => {
    const { store, players } = seeded();
    store.recordStat(players[0].id, 'ace');
    assert.equal(store.liveState.us, 1);
    assert.equal(store.liveState.them, 0);

    store.recordStat(players[1].id, 'attackErr');
    assert.equal(store.liveState.them, 1);
    assert.equal(store.liveState.serving, 'them');
});

test('undo removes the last event and rewinds the score', () => {
    const { store, players } = seeded();
    store.recordStat(players[0].id, 'ace');
    store.recordStat(players[0].id, 'ace');
    assert.equal(store.liveState.us, 2);

    const removed = store.undo();
    assert.equal(removed.code, 'ace');
    assert.equal(store.liveState.us, 1);
    assert.equal(store.activeSet.events.length, 1);
});

test('undo on an empty set is a no-op', () => {
    const { store } = seeded();
    assert.equal(store.undo(), null);
    assert.equal(store.liveState.us, 0);
});

test('team events score without attributing a stat to anyone', () => {
    const { store } = seeded();
    store.recordTeamEvent('oppError');
    store.recordTeamEvent('oppPoint');
    assert.equal(store.liveState.us, 1);
    assert.equal(store.liveState.them, 1);
    assert.ok(store.activeSet.events.every((event) => !event.playerId));
});

test('substitutions put the bench player on the court', () => {
    const { store, players } = seeded();
    const bench = players[6];
    store.recordSub(players[2].id, bench.id);

    const live = store.liveState;
    assert.ok(live.lineup.includes(bench.id));
    assert.ok(!live.lineup.includes(players[2].id));
});

test('deleteEvent recalculates the score from the remaining events', () => {
    const { store, players } = seeded();
    store.recordStat(players[0].id, 'ace');
    const middle = store.recordStat(players[1].id, 'attackErr');
    store.recordStat(players[2].id, 'kill');
    assert.deepEqual([store.liveState.us, store.liveState.them], [2, 1]);

    store.deleteEvent(middle.id);
    assert.deepEqual([store.liveState.us, store.liveState.them], [2, 0]);
    assert.equal(store.liveState.rotation, 1, 'the side-out that followed no longer applies');
});

test('a second set starts at 0-0 with its own lineup', () => {
    const { store, players } = seeded();
    store.recordStat(players[0].id, 'ace');
    const first = store.activeSet.id;

    store.startSet({
        startingServer: 'them',
        startingRotation: 3,
        startingLineup: players.slice(1, 7).map((p) => p.id),
    });

    assert.notEqual(store.activeSet.id, first);
    assert.equal(store.activeSet.number, 2);
    assert.equal(store.liveState.us, 0);
    assert.equal(store.liveState.rotation, 3);
    assert.equal(store.activeMatch.sets.length, 2);

    // The first set keeps its own history.
    const original = store.activeMatch.sets[0];
    assert.equal(computeSetState(original).us, 1);
});

test('state survives a reload from storage', () => {
    const { store, players, storage } = seeded();
    store.recordStat(players[0].id, 'kill');
    store.recordStat(players[1].id, 'pass3');

    const reloaded = new Store(storage);
    assert.equal(reloaded.roster.length, 7);
    assert.equal(reloaded.activeMatch.opponent, 'Cornerstone');
    assert.equal(reloaded.liveState.us, 1);
    assert.equal(reloaded.activeSet.events.length, 2);
});

test('corrupt saved data falls back to an empty state instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem('volleyball-stats.v1', '{not json');
    const store = new Store(storage);
    assert.deepEqual(store.roster, []);
    assert.deepEqual(store.state.matches, []);
});

test('a partial saved blob is filled in with defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem('volleyball-stats.v1', JSON.stringify({ roster: [{ id: 'x', number: '1' }] }));
    const store = new Store(storage);
    assert.equal(store.roster.length, 1);
    assert.equal(store.teams.length, 1, 'the flat v1 roster becomes one team');
    assert.deepEqual(store.state.matches, []);
});

test('export then import round-trips the whole season', () => {
    const { store, players } = seeded();
    store.recordStat(players[0].id, 'kill');
    const json = store.exportJson();

    const fresh = new Store(new MemoryStorage());
    fresh.importJson(json);
    assert.equal(fresh.roster.length, 7);
    assert.equal(fresh.liveState.us, 1);
    assert.equal(fresh.activeMatch.opponent, 'Cornerstone');
});

test('subscribers are notified on every mutation', () => {
    const { store, players } = seeded();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
        calls += 1;
    });

    store.recordStat(players[0].id, 'ace');
    store.recordTeamEvent('oppError');
    assert.equal(calls, 2);

    unsubscribe();
    store.recordStat(players[0].id, 'ace');
    assert.equal(calls, 2, 'unsubscribed listeners stop firing');
});

test('deleting a set renumbers the remaining sets', () => {
    const { store, players } = seeded();
    const lineup = players.slice(0, 6).map((p) => p.id);
    store.startSet({ startingServer: 'us', startingRotation: 1, startingLineup: lineup });
    store.startSet({ startingServer: 'us', startingRotation: 1, startingLineup: lineup });
    assert.deepEqual(
        store.activeMatch.sets.map((s) => s.number),
        [1, 2, 3],
    );

    store.deleteSet(store.activeMatch.sets[0].id);
    assert.deepEqual(
        store.activeMatch.sets.map((s) => s.number),
        [1, 2],
    );
});

test('removing a player leaves their recorded stats intact', () => {
    const { store, players, team } = seeded();
    store.recordStat(players[0].id, 'kill');
    store.deletePlayer(players[0].id);

    assert.equal(store.roster.length, 6);
    assert.equal(store.activeSet.events[0].playerId, players[0].id);
    assert.equal(store.liveState.us, 1);
});
