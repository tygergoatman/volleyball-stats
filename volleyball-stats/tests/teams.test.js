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

const ROSTER_FILE = {
    version: 1,
    updated: '2026-08-06',
    teams: [
        {
            id: 'ms',
            name: 'MS',
            fullName: 'Middle School',
            players: [{ id: 'ms-1', number: '1', name: 'Mia' }],
        },
        {
            id: 'jv',
            name: 'JV',
            fullName: 'Junior Varsity',
            players: [
                { id: 'jv-4', number: '4', name: 'Tess', isSetter: true },
                { id: 'jv-8', number: '8', name: 'Ella' },
            ],
        },
        {
            id: 'var',
            name: 'Var',
            fullName: 'Varsity',
            players: [{ id: 'var-11', number: '11', name: 'Hailey' }],
        },
    ],
};

/** Deep copy so a test mutating the fixture cannot leak into another. */
const rosterFile = () => JSON.parse(JSON.stringify(ROSTER_FILE));

/* ---------------------------------------------------------- roster file */

test('the shared roster file creates every team with its own players', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    assert.deepEqual(
        store.teams.map((t) => t.id),
        ['ms', 'jv', 'var'],
    );
    assert.equal(store.team('jv').fullName, 'Junior Varsity');
    assert.equal(store.rosterFor('jv').length, 2);
    assert.equal(store.rosterFor('ms').length, 1);
    assert.equal(store.state.rosterFile.updated, '2026-08-06');
});

test('rosters stay separate per team', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    const jvIds = store.rosterFor('jv').map((p) => p.id);
    const varIds = store.rosterFor('var').map((p) => p.id);
    assert.ok(!jvIds.some((id) => varIds.includes(id)));
});

test('reloading the file is idempotent — players are not duplicated', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    store.applyRosterFile(rosterFile());
    assert.equal(store.rosterFor('jv').length, 2);
});

test('players added on the device survive a roster file refresh', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    const local = store.addPlayer('jv', { number: '99', name: 'Call-up' });

    store.applyRosterFile(rosterFile());

    assert.ok(
        store.rosterFor('jv').some((p) => p.id === local.id),
        'the locally added player is still on the roster',
    );
    assert.equal(store.rosterFor('jv').length, 3);
});

test('a player dropped from the file is archived, not lost', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    const trimmed = rosterFile();
    trimmed.teams[1].players = trimmed.teams[1].players.filter((p) => p.id !== 'jv-8');
    store.applyRosterFile(trimmed);

    assert.equal(store.rosterFor('jv').length, 1, 'no longer on the active roster');
    assert.equal(store.player('jv-8')?.name, 'Ella', 'but still resolvable for past stats');
});

test('edits made in the app survive a roster file refresh', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.updatePlayer('jv', 'jv-4', { number: '5' });
    assert.equal(store.player('jv-4').number, '5');

    store.applyRosterFile(rosterFile());
    assert.equal(store.player('jv-4').number, '5', 'the override is re-applied');
    assert.equal(store.player('jv-4').name, 'Tess', 'unedited fields still track the file');
});

test('a malformed roster file leaves existing rosters intact', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    store.applyRosterFile(null);
    store.applyRosterFile({ teams: 'nope' });
    assert.equal(store.teams.length, 3);
});

/* -------------------------------------------------------- team scoping */

test('a match belongs to one team and the active team follows it', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.setActiveTeam('ms');
    assert.equal(store.activeTeam.id, 'ms');

    store.createMatch({ teamId: 'var', opponent: 'Cornerstone' });
    assert.equal(store.activeMatch.teamId, 'var');
    assert.equal(store.activeTeam.id, 'var', 'the open match decides the team in context');
    assert.deepEqual(
        store.roster.map((p) => p.id),
        ['var-11'],
        'and therefore which roster the court uses',
    );
});

test('matchesFor keeps each team season separate', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());

    store.createMatch({ teamId: 'jv', opponent: 'A' });
    store.createMatch({ teamId: 'jv', opponent: 'B' });
    store.createMatch({ teamId: 'var', opponent: 'C' });

    assert.equal(store.matchesFor('jv').length, 2);
    assert.equal(store.matchesFor('var').length, 1);
    assert.equal(store.matchesFor('ms').length, 0);
});

test('season totals do not bleed between teams', () => {
    const store = new Store(new MemoryStorage());
    store.applyRosterFile(rosterFile());
    const lineup = (id) => [id, null, null, null, null, null];

    store.createMatch({ teamId: 'jv', opponent: 'A' });
    store.startSet({ startingServer: 'us', startingRotation: 1, startingLineup: lineup('jv-4') });
    store.recordStat('jv-4', 'kill');
    store.recordStat('jv-4', 'kill');

    store.createMatch({ teamId: 'var', opponent: 'B' });
    store.startSet({ startingServer: 'us', startingRotation: 1, startingLineup: lineup('var-11') });
    store.recordStat('var-11', 'kill');

    const jv = aggregateSeason(store.matchesFor('jv'));
    const varsity = aggregateSeason(store.matchesFor('var'));

    assert.equal(jv.get('jv-4').attack.kills, 2);
    assert.equal(jv.has('var-11'), false);
    assert.equal(varsity.get('var-11').attack.kills, 1);
    assert.equal(varsity.has('jv-4'), false);
});

/* -------------------------------------------------------------- merging */

test('merging another device adds its matches and keeps yours', () => {
    const theirs = new Store(new MemoryStorage());
    theirs.applyRosterFile(rosterFile());
    theirs.createMatch({ teamId: 'jv', opponent: 'Their Game', date: '2026-09-02' });
    theirs.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: ['jv-4', null, null, null, null, null],
    });
    theirs.recordStat('jv-4', 'kill');
    const payload = theirs.exportJson();

    const mine = new Store(new MemoryStorage());
    mine.applyRosterFile(rosterFile());
    mine.createMatch({ teamId: 'jv', opponent: 'My Game', date: '2026-09-01' });

    const result = mine.mergeJson(payload);

    assert.deepEqual(result, { added: 1, skipped: 0 });
    assert.deepEqual(
        mine.state.matches.map((m) => m.opponent),
        ['My Game', 'Their Game'],
        'both are present, ordered by date',
    );
    assert.equal(aggregateSeason(mine.matchesFor('jv')).get('jv-4').attack.kills, 1);
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
    assert.equal(mine.state.matches.length, 1);
});

test('merging keeps names resolvable for players this device does not carry', () => {
    const theirs = new Store(new MemoryStorage());
    theirs.addTeam({ id: 'other', name: 'Other' });
    const guest = theirs.addPlayer('other', { number: '77', name: 'Guest' });
    theirs.createMatch({ teamId: 'other', opponent: 'X' });
    theirs.startSet({
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: [guest.id, null, null, null, null, null],
    });
    theirs.recordStat(guest.id, 'kill');

    const mine = new Store(new MemoryStorage());
    mine.applyRosterFile(rosterFile());
    mine.mergeJson(theirs.exportJson());

    assert.equal(mine.player(guest.id)?.name, 'Guest');
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
    assert.equal(line.pass.att, 1, 'digs do not become passing attempts');
    assert.equal(derive(line).passAvg, 3, 'so the passing average is unaffected');
});

test('a retired code still scores correctly when replaying an old match', () => {
    // digErr lost its button but may exist in matches captured earlier.
    assert.equal(STAT_BY_CODE.get('digErr')?.retired, true);
    assert.equal(pointFor({ type: 'stat', code: 'digErr' }), 'them');
});
