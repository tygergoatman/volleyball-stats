/**
 * The shareable report.
 *
 * Two things are worth guarding here and the rest is detail.
 *
 * **The report must not be able to disagree with the app.** Its tables are
 * built from the same `COLUMNS` the Stats tab draws, so the test re-derives a
 * cell the long way and insists on the same string. If somebody ever gives the
 * report its own arithmetic "just for the export", this fails.
 *
 * **The file leaves the owner's control the moment it is sent.** So: the
 * numbers-only copy must contain no names anywhere, and a name must never be
 * able to become markup — the recipient is a coach double-clicking an
 * attachment, with no app, no updates and nobody to notice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../js/store.js';
import { COLUMNS, aggregate, derive } from '../js/stats.js';
import { REPORT_FORMAT, reportData, reportHtml } from '../js/report.js';

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

const stat = (playerId, code) => ({ type: 'stat', playerId, code });

/**
 * A two-match season: the first won 2–0, the second lost 0–1.
 *
 * Numbers chosen so no two cells share a value by accident — a table that is
 * silently showing the wrong scope is the failure this fixture has to expose.
 */
function seeded({ names = ['Sara', 'Olive', 'Maddy', 'Sky', 'Opal', 'Mabel'] } = {}) {
    const store = new Store(new MemoryStorage());
    const team = store.addTeam({ id: 'jv', name: 'JV', fullName: 'Junior Varsity' });
    const players = names.map((name, index) =>
        store.addPlayer({ number: String(index + 1), name, positions: ['OH'], teams: [team.id] }),
    );
    const six = players.slice(0, 6).map((p) => p.id);
    const [a, b] = six;

    const set = (number, events) => ({
        id: `s${number}-${Math.random().toString(36).slice(2, 8)}`,
        number,
        target: 25,
        complete: true,
        system: '6-2',
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: six.slice(),
        events,
    });

    store.state.matches = [
        {
            id: 'm1',
            teamId: team.id,
            opponent: 'Rockets',
            date: '2026-09-01',
            format: 3,
            complete: true,
            sets: [
                // Set 1: three kills for a, one ace for b. 4–0, ours.
                set(1, [stat(a, 'kill'), stat(a, 'kill'), stat(a, 'kill'), stat(b, 'ace')]),
                // Set 2: one kill and three aces against two attack errors. 4–2, ours.
                set(2, [
                    stat(a, 'kill'),
                    stat(b, 'ace'),
                    stat(b, 'ace'),
                    stat(b, 'ace'),
                    stat(b, 'attackErr'),
                    stat(b, 'attackErr'),
                ]),
            ],
        },
        {
            id: 'm2',
            teamId: team.id,
            opponent: 'Comets',
            date: '2026-09-08',
            format: 3,
            complete: true,
            sets: [set(1, [stat(b, 'attackErr'), stat(b, 'attackErr'), stat(b, 'attackErr')])],
        },
    ];

    return { store, team, players, ids: { a, b } };
}

const scopeOf = (data, id) => data.scopes.find((scope) => scope.id === id);

test('every slice of the season gets its own scope, with sets hung off their match', () => {
    const { store, team } = seeded();
    const data = reportData(store, team);

    assert.equal(data.format, REPORT_FORMAT);
    assert.deepEqual(
        data.scopes.map((scope) => scope.kind),
        ['season', 'match', 'set', 'set', 'match', 'set'],
    );

    const sets = data.scopes.filter((scope) => scope.kind === 'set');
    assert.deepEqual(
        sets.map((scope) => scope.parent),
        ['m:m1', 'm:m1', 'm:m2'],
        'each set names the match it belongs to, which is how the viewer nests them',
    );
    assert.equal(data.record.label, '1–1');
});

test('a cell in the report is the cell the Stats tab would draw', () => {
    const { store, team, ids } = seeded();
    const data = reportData(store, team);

    const set1 = store.state.matches[0].sets[0];
    const lines = aggregate(set1.events);
    const line = lines.get(ids.a);
    const expected = COLUMNS.attack.map((column) => String(column.read(line, derive(line))));

    const table = scopeOf(data, `m:m1:s:${set1.id}`).tables.attack;
    const row = table.rows.find((candidate) => candidate.name.startsWith('#1'));
    assert.deepEqual(row.cells, expected);
    assert.equal(row.cells[0], '3', 'three kills in set 1, so this is not quietly showing another scope');
});

test('each scope counts only itself', () => {
    const { store, team } = seeded();
    const data = reportData(store, team);
    const kills = (id) => {
        const row = scopeOf(data, id).tables.attack.rows.find((r) => r.name.startsWith('#1'));
        return row ? Number(row.cells[0]) : 0;
    };
    const [one, two] = store.state.matches[0].sets;

    assert.equal(kills(`m:m1:s:${one.id}`), 3);
    assert.equal(kills(`m:m1:s:${two.id}`), 1);
    assert.equal(kills('m:m1'), 4, 'the match is its sets added up');
    assert.equal(kills('season'), 4, 'and the season is its matches added up');
});

test('players who did nothing in a slice are absent from it, not present as zeroes', () => {
    const { store, team } = seeded();
    const data = reportData(store, team);

    const names = scopeOf(data, 'm:m2').tables.attack.rows.map((row) => row.name);
    assert.deepEqual(names, ['#2 Olive'], 'only the player with a recorded action in that match');
    assert.equal(scopeOf(data, 'season').tables.attack.rows.length, 2);
});

test('the TEAM row totals the rows above it', () => {
    const { store, team } = seeded();
    const table = scopeOf(reportData(store, team), 'season').tables.attack;
    const column = COLUMNS.attack.findIndex((c) => c.label === 'K');
    const sum = table.rows.reduce((total, row) => total + Number(row.cells[column]), 0);
    assert.equal(table.total[column], String(sum));
});

test('points are split the way the Stats tab splits them', () => {
    const { store, team } = seeded();
    const points = scopeOf(reportData(store, team), 'm:m1').points;

    assert.equal(points.usEarned, 8, 'four kills and four aces');
    assert.equal(points.themGiven, 2, 'two attack errors handed over');
    assert.equal(points.us + points.them, points.usEarned + points.usGiven + points.themEarned + points.themGiven);
    assert.ok(points.errorsBy.some((row) => row.count === 2));
});

/* ------------------------------------------------------------- the file */

test('the file is standalone — nothing to fetch, nowhere to phone home', () => {
    const { store, team } = seeded();
    const html = reportHtml(reportData(store, team), '2026.10.22a');

    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    assert.doesNotMatch(html, /<link[^>]+stylesheet/i);
    assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|https?:\/\//i);
});

test('the embedded data parses back out', () => {
    const { store, team } = seeded();
    const data = reportData(store, team);
    const html = reportHtml(data);

    const json = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
    const parsed = JSON.parse(json);
    assert.equal(parsed.scopes.length, data.scopes.length);
    assert.equal(parsed.team.fullName, 'Junior Varsity');
});

test('numbers only means no names anywhere in the file', () => {
    const names = ['Sara', 'Olive', 'Maddy', 'Sky', 'Opal', 'Mabel'];
    const { store, team } = seeded({ names });
    const html = reportHtml(reportData(store, team, { includeNames: false }));

    for (const name of names) assert.ok(!html.includes(name), `"${name}" leaked into the numbers-only report`);
    assert.ok(html.includes('#1'), 'jersey numbers are still there — it is a report, not a redaction');

    const withNames = reportHtml(reportData(store, team, { includeNames: true }));
    assert.ok(withNames.includes('Sara'), 'and the other copy does carry them');
});

test('a name cannot become markup', () => {
    // Not paranoia about this roster: the owner types these on a phone, and the
    // recipient opens the result as a local file with full script privileges.
    const hostile = '</script><img src=x onerror=alert(1)>';
    const { store, team } = seeded({ names: [hostile, 'Olive', 'Maddy', 'Sky', 'Opal', 'Mabel'] });
    const html = reportHtml(reportData(store, team));

    assert.ok(!html.includes('</script><img'), 'the raw payload is nowhere in the file');
    assert.ok(html.includes('\\u003c/script>'), 'its "<" is escaped inside the JSON island');

    const json = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
    assert.ok(
        JSON.parse(json).scopes[0].tables.attack.rows.some((row) => row.name.includes(hostile)),
        'and it survives intact as text, because the viewer writes it with textContent',
    );
});

test('a season with no matches does not produce a broken file', () => {
    const store = new Store(new MemoryStorage());
    const team = store.addTeam({ id: 'jv', name: 'JV', fullName: 'Junior Varsity' });
    const data = reportData(store, team);

    assert.equal(data.scopes.length, 1);
    assert.equal(data.record.label, '0–0');
    assert.match(reportHtml(data), /^<!doctype html>/);
});

test('chart markup passed in by the browser reaches the file', () => {
    const { store, team } = seeded();
    const charts = { 'Points for': '<svg data-test="chart"></svg>' };
    const html = reportHtml(reportData(store, team, { charts }));
    assert.ok(html.includes('data-test=\\"chart\\"'), 'carried through the JSON island, not dropped');
});
