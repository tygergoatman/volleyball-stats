import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../js/store.js';
import { computeSetState, matchScore, targetForSet } from '../js/model.js';
import { aggregateMatch } from '../js/stats.js';

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

/** A store with one team of seven and a match ready to start sets in. */
function seeded({ format = 3 } = {}) {
    const store = new Store(new MemoryStorage());
    const team = store.addTeam({ id: 'var', name: 'Var', fullName: 'Varsity' });
    const players = ['Jane', 'Tess', 'McKenna', 'Ella', 'Hailey', 'Hannah', 'Bench'].map((name, i) =>
        store.addPlayer({ number: String(i + 1), name, teams: [team.id] }),
    );
    store.createMatch({ teamId: team.id, opponent: 'Cornerstone', format });
    return { store, players, team };
}

function startSet(store, players) {
    return store.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: players.slice(0, 6).map((p) => p.id),
    });
}

/** Win the current set for one side by the shortest legal route. */
function winSet(store, side, target) {
    for (let i = 0; i < target; i += 1) {
        store.recordTeamEvent(side === 'us' ? 'oppError' : 'oppPoint');
    }
    store.markSetComplete(store.activeSet.id, true);
}

/* -------------------------------------------------------- set targets */

test('the deciding set is played to 15 and the rest to 25', () => {
    assert.equal(targetForSet(1, 3), 25);
    assert.equal(targetForSet(2, 3), 25);
    assert.equal(targetForSet(3, 3), 15);

    assert.equal(targetForSet(1, 5), 25);
    assert.equal(targetForSet(4, 5), 25);
    assert.equal(targetForSet(5, 5), 15);
});

test('a new set takes its target from the match format', () => {
    const { store, players } = seeded({ format: 3 });
    assert.equal(startSet(store, players).target, 25);
    winSet(store, 'us', 25);
    assert.equal(startSet(store, players).target, 25);
    winSet(store, 'them', 25);
    assert.equal(startSet(store, players).target, 15, 'set 3 of 3 is the decider');
});

test('best of 5 keeps sets at 25 until the fifth', () => {
    const { store, players } = seeded({ format: 5 });
    const targets = [];
    for (let i = 0; i < 5; i += 1) {
        targets.push(startSet(store, players).target);
        // Alternate winners so the match is never decided before set 5.
        winSet(store, i % 2 === 0 ? 'us' : 'them', targets.at(-1));
    }
    assert.deepEqual(targets, [25, 25, 25, 25, 15]);
});

test('the format chosen at the first set is stored on the match', () => {
    const { store, players } = seeded({ format: 3 });
    store.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: players.slice(0, 6).map((p) => p.id),
        format: 5,
    });
    assert.equal(store.activeMatch.format, 5);
    assert.equal(store.activeSet.target, 25);
});

/* --------------------------------------------------------- match score */

test('only ended sets count toward the match score', () => {
    const { store, players } = seeded();
    startSet(store, players);
    for (let i = 0; i < 25; i += 1) store.recordTeamEvent('oppError');

    assert.equal(computeSetState(store.activeSet).us, 25);
    assert.deepEqual(
        [matchScore(store.activeMatch).us, matchScore(store.activeMatch).them],
        [0, 0],
        'a set at 25-0 that has not been closed out is still in progress',
    );

    store.markSetComplete(store.activeSet.id, true);
    assert.equal(matchScore(store.activeMatch).us, 1);
});

test('best of 3 is decided at two sets', () => {
    const { store, players } = seeded({ format: 3 });

    startSet(store, players);
    winSet(store, 'us', 25);
    assert.equal(matchScore(store.activeMatch).decided, false);

    startSet(store, players);
    winSet(store, 'us', 25);

    const score = matchScore(store.activeMatch);
    assert.deepEqual([score.us, score.them], [2, 0]);
    assert.equal(score.winner, 'us');
    assert.equal(score.decided, true);
});

test('best of 5 needs three sets, so 2-1 is not decided', () => {
    const { store, players } = seeded({ format: 5 });
    startSet(store, players);
    winSet(store, 'us', 25);
    startSet(store, players);
    winSet(store, 'them', 25);
    startSet(store, players);
    winSet(store, 'us', 25);

    const score = matchScore(store.activeMatch);
    assert.deepEqual([score.us, score.them], [2, 1]);
    assert.equal(score.decided, false);
});

test('a match can be ended and reopened without touching its stats', () => {
    const { store, players } = seeded();
    startSet(store, players);
    store.recordStat(players[0].id, 'kill');
    winSet(store, 'us', 24);

    store.endMatch();
    assert.equal(store.activeMatch.complete, true);
    assert.equal(store.activeSet, null, 'no set is left open');

    const before = aggregateMatch(store.activeMatch).get(players[0].id).attack.kills;
    store.reopenMatch();
    assert.equal(store.activeMatch.complete, false);
    assert.equal(aggregateMatch(store.activeMatch).get(players[0].id).attack.kills, before);
});

/* ---------------------------------------------------------- editing */

test('correcting the player on an entry moves the stat and leaves the score alone', () => {
    const { store, players } = seeded();
    startSet(store, players);
    const event = store.recordStat(players[0].id, 'kill');

    assert.equal(store.liveState.us, 1);
    store.updateEvent(event.id, { playerId: players[1].id });

    const lines = aggregateMatch(store.activeMatch);
    assert.equal(lines.has(players[0].id), false, 'the wrong player no longer has it');
    assert.equal(lines.get(players[1].id).attack.kills, 1);
    assert.equal(store.liveState.us, 1, 'the score is unchanged — a kill is still a kill');
});

test('correcting the stat on an entry rescores the set', () => {
    const { store, players } = seeded();
    startSet(store, players);
    const event = store.recordStat(players[0].id, 'kill');
    assert.deepEqual([store.liveState.us, store.liveState.them], [1, 0]);

    store.updateEvent(event.id, { code: 'attackErr' });

    assert.deepEqual([store.liveState.us, store.liveState.them], [0, 1], 'the point switches sides');
    assert.equal(store.liveState.serving, 'them');
    const line = aggregateMatch(store.activeMatch).get(players[0].id);
    assert.equal(line.attack.kills, 0);
    assert.equal(line.attack.errors, 1);
});

test('correcting an entry re-attributes the rotations of everything after it', () => {
    const { store, players } = seeded();
    startSet(store, players);

    store.recordStat(players[0].id, 'serveErr'); // they score and take serve
    const event = store.recordStat(players[1].id, 'kill'); // side-out, we rotate to 2
    store.recordStat(players[1].id, 'ace'); // served from rotation 2

    const before = computeSetState(store.activeSet);
    assert.deepEqual([before.us, before.them], [2, 1]);
    assert.equal(before.timeline.at(-1).rotationAtEvent, 2, 'the ace happened in rotation 2');

    // That "kill" was really an attack error, so the side-out never happened
    // there — it moves to the ace instead.
    store.updateEvent(event.id, { code: 'attackErr' });

    const after = computeSetState(store.activeSet);
    assert.deepEqual([after.us, after.them], [1, 2], 'the point switches sides');
    assert.equal(after.timeline.at(-1).rotationAtEvent, 1, 'the ace is now the side-out, from rotation 1');
    assert.equal(after.rotation, 2, 'so the team still ends up in rotation 2, for a different reason');
});

test('an edited entry is flagged so it can be spotted later', () => {
    const { store, players } = seeded();
    startSet(store, players);
    const event = store.recordStat(players[0].id, 'kill');
    assert.equal(event.editedAt, undefined);

    store.updateEvent(event.id, { playerId: players[1].id });
    assert.ok(store.activeSet.events[0].editedAt > 0);
});

test('updateEvent on an unknown id is a no-op', () => {
    const { store, players } = seeded();
    startSet(store, players);
    store.recordStat(players[0].id, 'kill');
    assert.equal(store.updateEvent('nope', { code: 'ace' }), null);
    assert.equal(store.liveState.us, 1);
});

/* ------------------------------------------------------ deleting sets */

test('deleting a set removes its stats and renumbers the rest', () => {
    const { store, players } = seeded({ format: 5 });

    const first = startSet(store, players);
    store.recordStat(players[0].id, 'kill');
    store.markSetComplete(first.id, true);

    const second = startSet(store, players);
    store.recordStat(players[1].id, 'kill');
    store.markSetComplete(second.id, true);

    startSet(store, players);
    store.recordStat(players[2].id, 'kill');

    assert.equal(store.activeMatch.sets.length, 3);

    store.setActiveSet(first.id);
    store.deleteSet(first.id);

    assert.deepEqual(
        store.activeMatch.sets.map((s) => s.number),
        [1, 2],
    );
    const lines = aggregateMatch(store.activeMatch);
    assert.equal(lines.has(players[0].id), false, 'the deleted set takes its stats with it');
    assert.equal(lines.get(players[1].id).attack.kills, 1);
    assert.equal(matchScore(store.activeMatch).us, 1, 'and the match score drops to one set');
});

test('deleting a set re-targets the remaining ones', () => {
    const { store, players } = seeded({ format: 3 });

    startSet(store, players);
    winSet(store, 'us', 25);
    startSet(store, players);
    winSet(store, 'them', 25);
    const third = startSet(store, players);

    assert.equal(third.target, 15, 'set 3 of 3 starts as the decider');

    store.deleteSet(store.activeMatch.sets[0].id);

    assert.deepEqual(
        store.activeMatch.sets.map((s) => [s.number, s.target]),
        [
            [1, 25],
            [2, 25],
        ],
        'what was the decider is now set 2, so it is played to 25',
    );
});

test('deleting the open set leaves a sensible set selected', () => {
    const { store, players } = seeded();
    const first = startSet(store, players);
    store.markSetComplete(first.id, true);
    const second = startSet(store, players);

    store.deleteSet(second.id);
    assert.equal(store.state.activeSetId, first.id);
});
