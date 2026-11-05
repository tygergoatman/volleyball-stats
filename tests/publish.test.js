/**
 * Publishing a season to a public repository.
 *
 * The rule this guards is the project's only hard one: **minors' names never
 * reach the repository.** Everything here exists because this file is destined
 * for the open web, where a mistake is permanent — git history keeps a name
 * that was committed and deleted later.
 *
 * So the central test is not "did we strip `name`" but "does any name appear
 * anywhere in the output at all", checked against the whole serialised file
 * rather than the fields we remembered to look at. The second is that the
 * allowlist is exhaustive: a field added to a player next season must fail
 * here rather than ship.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../js/store.js';
import {
    PUBLISHED_PLAYER_KEYS,
    applyPublishedSeason,
    describePull,
    publishedJson,
    publishedSeason,
} from '../js/publish.js';

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

const NAMES = ['Sara', 'Olive', 'Maddy', 'Sky', 'Opal', 'Mabel', 'Nell'];

/** A season with everything a real one carries: plan, colours, two teams. */
function seeded() {
    const store = new Store(new MemoryStorage());
    store.addTeam({ id: 'jv', name: 'JV', fullName: 'Junior Varsity' });
    store.addTeam({ id: 'var', name: 'Var', fullName: 'Varsity' });
    const ids = NAMES.map((name, index) =>
        store.addPlayer({
            number: String(index + 1),
            name,
            positions: [index === 0 ? 'S' : index === 6 ? 'L' : 'OH'],
            teams: ['jv'],
        }).id,
    );

    store.update((state) => {
        state.season.name = '2026 Fall';
        state.positionColors.S = '#ea580c';
        state.archivedPlayers.gone = { id: 'gone', number: '12', name: 'Departed', positions: ['MB'], teams: ['jv'] };
        state.archivedTeams.old = { id: 'old', name: 'MS', fullName: 'Middle School' };
        state.playerOverrides[ids[0]] = { name: 'Sara B' };
        state.matches = [
            {
                id: 'm1',
                teamId: 'jv',
                opponent: 'Rockets',
                date: '2026-09-01',
                format: 3,
                complete: true,
                sets: [
                    {
                        id: 's1',
                        number: 1,
                        target: 25,
                        complete: true,
                        system: '5-1',
                        startingServer: 'us',
                        startingRotation: 4,
                        startingLineup: ids.slice(0, 6),
                        events: [
                            { id: 'e1', at: 1, type: 'stat', playerId: ids[0], code: 'kill' },
                            { id: 'e2', at: 2, type: 'stat', playerId: ids[1], code: 'pass3' },
                        ],
                    },
                ],
            },
        ];
        state.activeTeamId = 'jv';
        state.activeMatchId = 'm1';
        state.activeSetId = 's1';
    });
    store.setLiberoPlan({ liberoId: ids[6], replacesId: ids[4] }, 'jv');
    return { store, ids };
}

/* ------------------------------------------------------------- the rule */

test('no name appears anywhere in the published file', () => {
    const { store } = seeded();
    const published = store.publishJson();

    for (const name of [...NAMES, 'Departed', 'Sara B']) {
        assert.ok(!published.includes(name), `"${name}" reached the published season file`);
    }
});

test('the allowlist is exhaustive, so a new player field cannot ship by accident', () => {
    // Fails the day somebody adds `nickname` or `parentEmail` to a player and
    // does not decide about it here — which is the only way an allowlist helps.
    const { store } = seeded();
    const player = store.state.players[0];
    const unvetted = Object.keys(player).filter((key) => ![...PUBLISHED_PLAYER_KEYS, 'name', 'local'].includes(key));
    assert.deepEqual(unvetted, [], `unvetted player field(s): ${unvetted.join(', ')}`);
});

test('a published player keeps her number and role and nothing else', () => {
    const { store } = seeded();
    const player = publishedSeason(store.state).players[0];
    assert.deepEqual(Object.keys(player).sort(), [...PUBLISHED_PLAYER_KEYS].sort());
    assert.equal(player.number, '1');
    assert.deepEqual(player.positions, ['S']);
});

test('device-local opinions stay on the device', () => {
    const { store } = seeded();
    const published = publishedSeason(store.state);

    // Overrides can carry a name, the rest is one phone's state of mind, and
    // syncing the open match would yank another coach's screen mid-set.
    for (const key of ['playerOverrides', 'teamOverrides', 'rosterFile', 'hiddenTeamIds', 'activeMatchId', 'activeSetId']) {
        assert.equal(published[key], undefined, `${key} should not be published`);
    }
});

test('the file says why it has no names, to whoever finds it', () => {
    const { store } = seeded();
    assert.match(publishedSeason(store.state)._privacy, /minors/i);
});

/* ---------------------------------------------------- what does survive */

test('everything that is not a name survives the round trip', () => {
    const { store } = seeded();
    const fresh = new Store(new MemoryStorage());
    fresh.pullPublished(store.publishJson());

    assert.equal(fresh.state.season.name, '2026 Fall');
    assert.deepEqual(
        fresh.state.teams.map((team) => team.fullName),
        ['Junior Varsity', 'Varsity'],
    );
    assert.deepEqual(fresh.state.matches, store.state.matches, 'every match and event, unchanged');
    assert.deepEqual(fresh.state.plans.jv, store.state.plans.jv, 'including the libero pairing');
    assert.equal(fresh.state.positionColors.S, '#ea580c');
    assert.equal(fresh.state.archivedTeams.old.fullName, 'Middle School');
});

test('a phone that has never seen the squad shows numbers, not blanks', () => {
    const { store } = seeded();
    const fresh = new Store(new MemoryStorage());
    fresh.pullPublished(store.publishJson());

    assert.equal(fresh.state.players.length, NAMES.length);
    assert.deepEqual(
        fresh.state.players.map((player) => player.number),
        ['1', '2', '3', '4', '5', '6', '7'],
    );
    assert.deepEqual(
        fresh.state.players.map((player) => player.name),
        NAMES.map(() => ''),
    );
    assert.deepEqual(fresh.state.players[0].positions, ['S'], 'and her position came too');
});

/* -------------------------------------------------------- the pull rules */

test('a pull never overwrites a name this phone already knows', () => {
    // The reason the whole scheme is safe: the coach with the names can pull
    // the published season as often as she likes and lose nothing.
    const { store } = seeded();
    const published = store.publishJson();

    const before = store.state.players.map((player) => player.name);
    store.pullPublished(published);
    assert.deepEqual(
        store.state.players.map((player) => player.name),
        before,
        'names survived a pull on the phone that has them',
    );
    assert.deepEqual(store.state.matches.length, 1, 'and the match was not duplicated');
});

test('a pull is repeatable', () => {
    const { store } = seeded();
    const published = store.publishJson();
    const fresh = new Store(new MemoryStorage());

    const first = fresh.pullPublished(published);
    const snapshot = fresh.exportJson();
    const second = fresh.pullPublished(published);

    assert.equal(first.matches, 1);
    assert.deepEqual(second, { matches: 0, skipped: 1, players: 0, teams: 0 });
    assert.equal(fresh.exportJson(), snapshot, 'the second pull changed nothing at all');
});

test('a pull adds matches rather than replacing them', () => {
    const { store } = seeded();
    const other = new Store(new MemoryStorage());
    other.addTeam({ id: 'jv', name: 'JV', fullName: 'Junior Varsity' });
    other.update((state) => {
        state.matches = [{ id: 'mine', teamId: 'jv', opponent: 'Comets', date: '2026-09-15', format: 3, sets: [] }];
    });

    const result = other.pullPublished(store.publishJson());
    assert.equal(result.matches, 1);
    assert.deepEqual(
        other.state.matches.map((match) => match.id),
        ['m1', 'mine'],
        'both are there, in date order',
    );
});

test('a correction made locally is not undone by a pull', () => {
    const { store } = seeded();
    const published = store.publishJson();

    store.update((state) => {
        state.matches[0].sets[0].events[0].code = 'attackErr';
    });
    store.pullPublished(published);
    assert.equal(
        store.state.matches[0].sets[0].events[0].code,
        'attackErr',
        'the match was already here by id, so the file left it alone',
    );
});

test('a freshly seeded phone lands on the team it just pulled', () => {
    // roster.json defines several teams and the Stats tab falls back to the
    // first; without this she pulls a season and sees an empty table.
    const { store } = seeded();
    const fresh = new Store(new MemoryStorage());
    fresh.addTeam({ id: 'ms', name: 'MS', fullName: 'Middle School' });

    fresh.pullPublished(store.publishJson());
    assert.equal(fresh.state.activeTeamId, 'jv', 'not Middle School, which has no matches');
});

test('a phone with its own matches keeps its own view', () => {
    const { store } = seeded();
    const other = new Store(new MemoryStorage());
    other.update((state) => {
        state.activeTeamId = 'ms';
        state.matches = [{ id: 'mine', teamId: 'ms', opponent: 'Comets', date: '2026-09-15', format: 3, sets: [] }];
    });

    other.pullPublished(store.publishJson());
    assert.equal(other.state.activeTeamId, 'ms', 'not switched out from under her');
});

test('a phone with its own matches keeps its own season name', () => {
    const { store } = seeded();
    const other = new Store(new MemoryStorage());
    other.update((state) => {
        state.season.name = 'Her Season';
        state.matches = [{ id: 'mine', teamId: 'jv', opponent: 'Comets', date: '2026-09-15', format: 3, sets: [] }];
    });

    other.pullPublished(store.publishJson());
    assert.equal(other.state.season.name, 'Her Season', 'not renamed out from under her');
});

test('a pull does not touch a sub plan this phone already has', () => {
    const { store, ids } = seeded();
    const other = new Store(new MemoryStorage());
    other.addTeam({ id: 'jv', name: 'JV', fullName: 'Junior Varsity' });
    other.setLiberoPlan({ liberoId: ids[5], replacesId: ids[1] }, 'jv');
    const hers = JSON.stringify(other.state.plans.jv);

    other.pullPublished(store.publishJson());
    assert.equal(JSON.stringify(other.state.plans.jv), hers, 'her own plan stood');
});

test('a team hidden on this phone stays hidden', () => {
    const { store } = seeded();
    const other = new Store(new MemoryStorage());
    other.update((state) => {
        state.hiddenTeamIds = ['var'];
    });
    other.pullPublished(store.publishJson());
    assert.deepEqual(
        other.state.teams.map((team) => team.id),
        ['jv'],
        'Varsity was not quietly reinstated',
    );
});

test('rubbish in is an error, not a wiped season', () => {
    const { store } = seeded();
    const before = store.exportJson();

    assert.throws(() => store.pullPublished('{"hello":"world"}'), /matches/i);
    assert.throws(() => store.pullPublished('not json at all'));
    assert.equal(store.exportJson(), before, 'the season is untouched either way');
});

test('applyPublishedSeason reports what it did, for the toast', () => {
    assert.match(describePull({ matches: 2, skipped: 0, players: 7, teams: 1 }), /2 matches/);
    assert.equal(describePull({ matches: 0, skipped: 3, players: 0, teams: 0 }), 'Already up to date');
    assert.equal(describePull({ matches: 0, skipped: 0, players: 0, teams: 0 }), 'Nothing in that file');
});

test('the file is pretty-printed, so a GitHub diff is readable', () => {
    const { store } = seeded();
    assert.ok(publishedJson(store.state).includes('\n  '), 'indented rather than one long line');
});

test('applyPublishedSeason works on a bare draft, with no Store around it', () => {
    // It is a pure function over a state object; the Store method is a wrapper.
    const { store } = seeded();
    const draft = JSON.parse(new Store(new MemoryStorage()).exportJson());
    const result = applyPublishedSeason(draft, JSON.parse(store.publishJson()));
    assert.equal(result.matches, 1);
    assert.equal(draft.players.length, NAMES.length);
});
