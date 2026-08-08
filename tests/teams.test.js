import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../js/store.js';
import { STAT_BY_CODE, STAT_GROUPS, pointFor } from '../js/model.js';
import { aggregateSeason, derive } from '../js/stats.js';

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

/** One roster, team tags per player, including a JV/Varsity swing player. */
const ROSTER_FILE = {
    version: 2,
    updated: '2026-08-06',
    teams: [
        { id: 'ms', name: 'MS', fullName: 'Middle School' },
        { id: 'jv', name: 'JV', fullName: 'Junior Varsity' },
        { id: 'var', name: 'Var', fullName: 'Varsity' },
    ],
    players: [
        { id: 'p-mia', number: '1', name: 'Mia', teams: ['ms'] },
        { id: 'p-tess', number: '4', name: 'Tess', isSetter: true, teams: ['jv'] },
        { id: 'p-ella', number: '8', name: 'Ella', teams: ['jv'] },
        { id: 'p-sam', number: '7', name: 'Sam', teams: ['jv', 'var'] },
        { id: 'p-hailey', number: '11', name: 'Hailey', teams: ['var'] },
    ],
};

const rosterFile = () => JSON.parse(JSON.stringify(ROSTER_FILE));

/* ---------------------------------------------------------- roster file */

test('the shared roster file gives one roster plus team labels', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    assert.deepEqual(
        store.teams.map((t) => t.id),
        ['ms', 'jv', 'var'],
    );
    assert.equal(store.players.length, 5, 'one entry per person, not per team place');
    assert.equal(store.team('jv').fullName, 'Junior Varsity');
    assert.equal(store.state.rosterFile.updated, '2026-08-06');
});

test('a team pool is everyone carrying that tag', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    assert.deepEqual(
        store.playersForTeam('jv').map((p) => p.id),
        ['p-tess', 'p-sam', 'p-ella'],
    );
    assert.deepEqual(
        store.playersForTeam('var').map((p) => p.id),
        ['p-sam', 'p-hailey'],
    );
    assert.deepEqual(
        store.playersForTeam('ms').map((p) => p.id),
        ['p-mia'],
    );
});

test('a swing player is one record on two teams', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    const sam = store.player('p-sam');
    assert.deepEqual(sam.teams, ['jv', 'var']);
    assert.equal(store.players.filter((p) => p.name === 'Sam').length, 1);
    assert.ok(store.playersForTeam('jv').includes(sam));
    assert.ok(store.playersForTeam('var').includes(sam));
});

test('reloading the file is idempotent', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    store.applyRosterFile(rosterFile());
    assert.equal(store.players.length, 5);
    assert.equal(store.playersForTeam('jv').length, 3);
});

test('the older nested-roster file shape still loads', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile({
        version: 1,
        teams: [
            { id: 'jv', name: 'JV', players: [{ id: 'x', number: '1', name: 'Both' }] },
            { id: 'var', name: 'Var', players: [{ id: 'x', number: '1', name: 'Both' }] },
        ],
    });

    assert.equal(store.players.length, 1, 'the duplicate id becomes one player');
    assert.deepEqual(store.player('x').teams, ['jv', 'var'], 'tagged for both');
});

test('players added on the device survive a roster file refresh', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    const local = store.addPlayer({ number: '99', name: 'Call-up', teams: ['var'] });

    store.applyRosterFile(rosterFile());

    assert.ok(store.player(local.id), 'still on the roster');
    assert.ok(store.playersForTeam('var').some((p) => p.id === local.id));
});

test('a player dropped from the file is archived, not lost', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    const trimmed = rosterFile();
    trimmed.players = trimmed.players.filter((p) => p.id !== 'p-ella');
    store.applyRosterFile(trimmed);

    assert.equal(store.players.length, 4);
    assert.equal(store.player('p-ella')?.name, 'Ella', 'still resolvable for past stats');
});

test('edits made in the app survive a roster file refresh', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.updatePlayer('p-tess', { number: '5' });
    store.applyRosterFile(rosterFile());

    assert.equal(store.player('p-tess').number, '5', 'the override is re-applied');
    assert.equal(store.player('p-tess').name, 'Tess', 'unedited fields still track the file');
});

test('a malformed roster file leaves the roster intact', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    store.applyRosterFile(null);
    store.applyRosterFile({ teams: 'nope' });
    assert.equal(store.teams.length, 3);
    assert.equal(store.players.length, 5);
});

/* ------------------------------------------------------------- tagging */

test('tagging a player adds them to that team pool', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    assert.equal(store.playersForTeam('var').length, 2);
    store.togglePlayerTeam('p-tess', 'var');

    assert.equal(store.playersForTeam('var').length, 3);
    assert.deepEqual(store.player('p-tess').teams, ['jv', 'var']);
});

test('untagging takes a player off one team without touching the other', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.togglePlayerTeam('p-sam', 'var');

    assert.deepEqual(store.player('p-sam').teams, ['jv'], 'still on JV');
    assert.ok(store.playersForTeam('jv').some((p) => p.id === 'p-sam'));
    assert.ok(!store.playersForTeam('var').some((p) => p.id === 'p-sam'));
    assert.ok(store.player('p-sam'), 'and still on the program roster');
});

test('a tag change survives a roster file refresh', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.togglePlayerTeam('p-tess', 'var');
    store.applyRosterFile(rosterFile());

    assert.deepEqual(store.player('p-tess').teams, ['jv', 'var'], 'the file does not undo it');
});

test('a player with no tags is listed but cannot be picked', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.updatePlayer('p-mia', { teams: [] });

    assert.ok(store.player('p-mia'), 'still on the roster');
    assert.deepEqual(
        store.untaggedPlayers.map((p) => p.id),
        ['p-mia'],
    );
    assert.equal(store.playersForTeam('ms').length, 0);
});

test('deleting a player removes them from every team at once', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.deletePlayer('p-sam');

    assert.equal(store.players.length, 4);
    assert.ok(!store.playersForTeam('jv').some((p) => p.id === 'p-sam'));
    assert.ok(!store.playersForTeam('var').some((p) => p.id === 'p-sam'));
    assert.equal(store.player('p-sam')?.name, 'Sam', 'archived so old stats still name them');
});

/* -------------------------------------------------------- team scoping */

test('a match draws its pool from the team tag', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.createMatch({ teamId: 'var', opponent: 'Cornerstone' });

    assert.equal(store.activeTeam.id, 'var');
    assert.deepEqual(
        store.roster.map((p) => p.name),
        ['Sam', 'Hailey'],
    );
});

test('season totals stay separate for a swing player', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    const lineup = (id) => [id, null, null, null, null, null];

    store.createMatch({ teamId: 'jv', opponent: 'A' });
    store.startSet({ startingServer: 'us', startingRotation: 1, startingLineup: lineup('p-sam') });
    store.recordStat('p-sam', 'kill');
    store.recordStat('p-sam', 'kill');

    store.createMatch({ teamId: 'var', opponent: 'B' });
    store.startSet({ startingServer: 'us', startingRotation: 1, startingLineup: lineup('p-sam') });
    store.recordStat('p-sam', 'kill');

    assert.equal(aggregateSeason(store.matchesFor('jv')).get('p-sam').attack.kills, 2);
    assert.equal(aggregateSeason(store.matchesFor('var')).get('p-sam').attack.kills, 1);
});

/* ------------------------------------------------------- removing teams */

test('removing a team drops the tag but keeps the players', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    const result = store.deleteTeam('jv');

    assert.equal(result.playersUntagged, 3);
    assert.equal(store.players.length, 5, 'nobody is deleted');
    assert.deepEqual(store.player('p-sam').teams, ['var'], 'the swing player keeps Varsity');
    assert.deepEqual(store.player('p-tess').teams, [], 'a JV-only player is left untagged');
    assert.equal(store.team('jv')?.fullName, 'Junior Varsity', 'archived for labelling old matches');
    assert.ok(!store.teams.some((t) => t.id === 'jv'), 'but not pickable');
});

test('removing a team keeps its matches and their stats', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.createMatch({ teamId: 'jv', opponent: 'A' });
    store.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: ['p-tess', null, null, null, null, null],
    });
    store.recordStat('p-tess', 'kill');

    const result = store.deleteTeam('jv');

    assert.equal(result.matchesKept, 1);
    assert.equal(store.matchesFor('jv').length, 1, 'the match is still there');
    assert.equal(aggregateSeason(store.matchesFor('jv')).get('p-tess').attack.kills, 1);
    assert.equal(store.activeMatch, null, 'but it is closed, having no pool to draw from');
});

test('a removed team does not come back on the next file load', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    store.deleteTeam('ms');

    store.applyRosterFile(rosterFile());

    assert.ok(!store.teams.some((t) => t.id === 'ms'));
    assert.deepEqual(store.player('p-mia').teams, [], 'and the tag does not come back either');
});

test('restoring a team brings the team and its tags back', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    store.deleteTeam('jv');
    assert.deepEqual(store.restorableTeamIds, ['jv']);

    store.restoreTeam('jv');
    store.applyRosterFile(rosterFile());

    assert.equal(store.team('jv')?.fullName, 'Junior Varsity');
    assert.equal(store.playersForTeam('jv').length, 3, 'the file re-tags everyone');
    assert.deepEqual(store.player('p-sam').teams, ['jv', 'var']);
});

test('a locally added team is not offered for restore', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    store.addTeam({ id: 'c-team', name: 'C' });
    store.deleteTeam('c-team');

    assert.equal(
        store.teams.some((t) => t.id === 'c-team'),
        false,
    );
    assert.deepEqual(store.restorableTeamIds, []);
});

test('team order follows roster.json, with locally added teams after it', () => {
    const store = new Store(new MemoryStorage());
    store.addTeam({ id: 'c-team', name: 'C' });
    store.applyRosterFile(rosterFile());

    assert.deepEqual(
        store.teams.map((t) => t.id),
        ['ms', 'jv', 'var', 'c-team'],
    );
});

test('renaming a team survives a roster file refresh', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.renameTeam('jv', { name: 'JV2', fullName: 'JV Gold' });
    store.applyRosterFile(rosterFile());

    assert.equal(store.team('jv').name, 'JV2');
    assert.equal(store.team('jv').fullName, 'JV Gold');
    assert.equal(store.playersForTeam('jv').length, 3, 'players still track the file');
});

/* -------------------------------------------------------------- merging */

test('merging another device adds its matches and keeps yours', () => {
    const theirs = new Store(new MemoryStorage());
    theirs.applyRosterFile(rosterFile());
    theirs.createMatch({ teamId: 'jv', opponent: 'Their Game', date: '2026-09-02' });
    theirs.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: ['p-tess', null, null, null, null, null],
    });
    theirs.recordStat('p-tess', 'kill');

    const mine = new Store(new MemoryStorage());
    mine.applyRosterFile(rosterFile());
    mine.createMatch({ teamId: 'jv', opponent: 'My Game', date: '2026-09-01' });

    assert.deepEqual(mine.mergeJson(theirs.exportJson()), { added: 1, skipped: 0 });
    assert.deepEqual(
        mine.state.matches.map((m) => m.opponent),
        ['My Game', 'Their Game'],
    );
    assert.equal(aggregateSeason(mine.matchesFor('jv')).get('p-tess').attack.kills, 1);
});

test('merging the same file twice does not duplicate matches', () => {
    const theirs = new Store(new MemoryStorage());
    theirs.applyRosterFile(rosterFile());
    theirs.createMatch({ teamId: 'jv', opponent: 'Their Game' });
    const payload = theirs.exportJson();

    const mine = new Store(new MemoryStorage());
    mine.applyRosterFile(rosterFile());

    assert.deepEqual(mine.mergeJson(payload), { added: 1, skipped: 0 });
    assert.deepEqual(mine.mergeJson(payload), { added: 0, skipped: 1 });
});

test('merging keeps names resolvable for players and teams we do not carry', () => {
    const theirs = new Store(new MemoryStorage());
    theirs.addTeam({ id: 'other', name: 'Other', fullName: 'Other Team' });
    const guest = theirs.addPlayer({ number: '77', name: 'Guest', teams: ['other'] });
    theirs.createMatch({ teamId: 'other', opponent: 'X' });

    const mine = new Store(new MemoryStorage());
    mine.applyRosterFile(rosterFile());
    mine.mergeJson(theirs.exportJson());

    assert.equal(mine.player(guest.id)?.name, 'Guest');
    assert.equal(mine.team('other')?.fullName, 'Other Team');
});

/* -------------------------------------------------------------- migration */

test('a v2 blob with nested rosters migrates to tagged players', () => {
    const storage = new MemoryStorage();
    storage.setItem(
        'volleyball-stats.v1',
        JSON.stringify({
            version: 2,
            teams: [
                { id: 'jv', name: 'JV', players: [{ id: 'swing', number: '7', name: 'Sam' }] },
                { id: 'var', name: 'Var', players: [{ id: 'swing', number: '7', name: 'Sam' }] },
            ],
            matches: [{ id: 'm1', teamId: 'jv', sets: [] }],
        }),
    );

    const store = new Store(storage);

    assert.equal(store.players.length, 1, 'the duplicated swing player becomes one record');
    assert.deepEqual(store.player('swing').teams, ['jv', 'var']);
    assert.equal(store.teams.length, 2);
    assert.equal(store.matchesFor('jv').length, 1, 'matches survive the migration');
});

test('a v1 blob with a flat roster still migrates', () => {
    const storage = new MemoryStorage();
    storage.setItem(
        'volleyball-stats.v1',
        JSON.stringify({ team: { name: 'Griffins' }, roster: [{ id: 'x', number: '1', name: 'One' }] }),
    );

    const store = new Store(storage);

    assert.equal(store.teams.length, 1);
    assert.equal(store.teams[0].name, 'Griffins');
    assert.deepEqual(store.player('x').teams, [store.teams[0].id]);
});

/* ------------------------------------------------- stat sheet ordering */

test('the stat sheet is ordered Pass, Set, Attack, Block, Serve', () => {
    assert.deepEqual(
        STAT_GROUPS.map((g) => g.key),
        ['pass', 'set', 'attack', 'block', 'serve'],
    );
});

test('dig sits in the pass row, keeps the rally alive, and is not a dig group', () => {
    const pass = STAT_GROUPS.find((g) => g.key === 'pass');
    assert.deepEqual(
        pass.options.map((o) => o.label),
        ['3', '2', '1', '.5', 'D', '0'],
    );
    assert.equal(pointFor({ type: 'stat', code: 'dig' }), null);
    assert.ok(!STAT_GROUPS.some((g) => g.key === 'dig'));
});

test('every row ends on its point-conceding button, so all the red sits right', () => {
    for (const group of STAT_GROUPS) {
        const last = group.options.at(-1);
        assert.equal(last.point, 'them', `${group.label} should end on the error button`);

        const earlierErrors = group.options.slice(0, -1).filter((o) => o.point === 'them');
        assert.deepEqual(earlierErrors, [], `${group.label} has an error button out of place`);
    }
});

test('a dig counts as a dig, not toward the passing average', () => {
    const lines = aggregateSeason([
        {
            sets: [
                {
                    events: [
                        { type: 'stat', playerId: 'a', code: 'pass3' },
                        { type: 'stat', playerId: 'a', code: 'dig' },
                        { type: 'stat', playerId: 'a', code: 'dig' },
                    ],
                },
            ],
        },
    ]);
    const line = lines.get('a');
    assert.equal(line.dig.digs, 2);
    assert.equal(line.pass.att, 1);
    assert.equal(derive(line).passAvg, 3);
});

test('a retired code still scores correctly when replaying an old match', () => {
    assert.equal(STAT_BY_CODE.get('digErr')?.retired, true);
    assert.equal(pointFor({ type: 'stat', code: 'digErr' }), 'them');
});
