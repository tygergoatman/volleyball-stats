/**
 * The published roster file carries no names.
 *
 * `roster.json` is served on the open web at the app's own URL, and anything
 * committed to it stays in the public git history even after it is deleted. So
 * "no names in the file" is not a style preference — it is the property that
 * keeps a roster of minors off the internet, and it is one careless paste away
 * from being lost. Hence a test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Store } from '../js/store.js';
import { describeEvent, playerLabel } from '../js/model.js';

const rosterFile = JSON.parse(readFileSync(fileURLToPath(new URL('../roster.json', import.meta.url)), 'utf8'));

test('the published roster file identifies players by number only', () => {
    for (const player of rosterFile.players) {
        assert.equal(
            player.name,
            undefined,
            `Player ${player.id} has a name in roster.json. Names must be typed on each ` +
                `coach's device — see ROSTER.md. Anything committed here is public forever.`,
        );
        assert.ok(player.number, `Player ${player.id} needs a number — it is their only identifier`);
    }
});

test('every player in the file is still uniquely identifiable', () => {
    const ids = rosterFile.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'player ids must be unique');

    // Numbers repeat across teams, which is normal — but not within one team,
    // or the coach cannot tell two bubbles apart.
    for (const team of rosterFile.teams) {
        const numbers = rosterFile.players.filter((p) => p.teams.includes(team.id)).map((p) => p.number);
        assert.equal(new Set(numbers).size, numbers.length, `duplicate jersey number within ${team.name}`);
    }
});

test('a nameless player still reads correctly everywhere', () => {
    assert.equal(playerLabel({ number: '7', name: '' }), '#7');
    assert.equal(playerLabel({ number: '7', name: 'Emma' }), '#7 Emma');
    assert.equal(playerLabel(undefined), 'Unknown player');
    assert.equal(playerLabel({ number: '', name: '' }), 'Unnamed player');

    const lookup = (id) => ({ 'p-1': { number: '7', name: '' } })[id];
    assert.equal(describeEvent({ type: 'stat', playerId: 'p-1', code: 'kill' }, lookup), '#7 — Kill');
    assert.equal(describeEvent({ type: 'sub', inId: 'p-1', outId: 'p-1' }, lookup), 'Sub: #7 in for #7');
});

test('the published file seeds the teams and no players', () => {
    assert.deepEqual(rosterFile.players, [], 'players are managed in the app, not in this file');
    assert.ok(rosterFile.teams.length > 0, 'the file exists to save typing team labels on a phone');
});

test('a fresh device gets the teams from the file and an empty roster', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile);

    assert.deepEqual(
        store.teams.map((t) => t.id),
        rosterFile.teams.map((t) => t.id),
    );
    assert.deepEqual(store.players, []);
});

test('players added in the app survive every refresh of the shared file', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile);

    store.addPlayer({ number: '7', name: 'Emma', position: 'OH', teams: ['jv'] });
    const id = store.players[0].id;

    // The file is re-fetched every time the app opens online. A locally added
    // player is not in it, and must not be treated as one that was removed.
    store.applyRosterFile(rosterFile);
    store.applyRosterFile(rosterFile);

    assert.equal(store.players.length, 1);
    assert.equal(store.player(id).name, 'Emma');
    assert.equal(store.player(id).number, '7');
    assert.deepEqual(
        store.playersForTeam('jv').map((p) => p.id),
        [id],
    );
});

test('deleting a player in the app sticks, because the file cannot put them back', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile);
    store.addPlayer({ number: '7', name: 'Emma', teams: ['jv'] });
    const id = store.players[0].id;

    store.deletePlayer(id);
    assert.deepEqual(store.players, []);

    store.applyRosterFile(rosterFile);
    assert.deepEqual(store.players, [], 'a deleted player must not come back on the next load');
});

/**
 * Kept for the day somebody does put players in the file: the same guarantees
 * have to hold, and this is the shape they have to hold for.
 */
test('a file that does carry players still supplies no names', () => {
    const withPlayers = {
        ...rosterFile,
        players: [{ id: 'p-101', number: '1', position: 'OH', teams: ['jv'] }],
    };
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(withPlayers);

    assert.equal(store.player('p-101').name, '', 'the file must not supply a name');

    // A coach types one in. It is a local override, so re-fetching must not wipe it.
    store.updatePlayer('p-101', { name: 'Emma' });
    store.applyRosterFile(withPlayers);
    assert.equal(store.player('p-101').name, 'Emma');
    assert.equal(withPlayers.players[0].name, undefined, 'and it never goes back to anything shared');
});

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
