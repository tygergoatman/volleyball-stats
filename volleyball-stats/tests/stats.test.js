import test from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregate,
    aggregateMatch,
    aggregateSeason,
    derive,
    emptyLine,
    formatAvg,
    formatPct,
    rotationBreakdown,
    toCsv,
    totalLine,
} from '../js/stats.js';

const stat = (playerId, code) => ({ type: 'stat', playerId, code });

test('aggregate counts passing attempts and totals', () => {
    const lines = aggregate([stat('a', 'pass3'), stat('a', 'pass2'), stat('a', 'pass05'), stat('a', 'pass0')]);
    const line = lines.get('a');
    assert.equal(line.pass.att, 4);
    assert.equal(line.pass.total, 5.5);
    assert.equal(line.pass.three, 1);
    assert.equal(line.pass.zero, 1);
    assert.equal(derive(line).passAvg, 5.5 / 4);
});

test('hitting percentage is (kills - errors) / attempts', () => {
    const lines = aggregate([
        stat('a', 'kill'),
        stat('a', 'kill'),
        stat('a', 'kill'),
        stat('a', 'attackErr'),
        stat('a', 'attackInPlay'),
        stat('a', 'attackInPlay'),
        stat('a', 'attackInPlay'),
    ]);
    const line = lines.get('a');
    assert.equal(line.attack.att, 7);
    assert.equal(line.attack.kills, 3);
    assert.equal(line.attack.errors, 1);
    const derived = derive(line);
    assert.equal(derived.hitPct, 2 / 7);
    assert.equal(derived.killPct, 3 / 7);
});

test('hitting percentage can be negative', () => {
    const line = aggregate([stat('a', 'kill'), stat('a', 'attackErr'), stat('a', 'attackErr')]).get('a');
    assert.equal(derive(line).hitPct, -1 / 3);
    assert.equal(formatPct(derive(line).hitPct), '-.333');
});

test('rates are null with no attempts so the UI can show a dash', () => {
    const derived = derive(emptyLine());
    assert.equal(derived.passAvg, null);
    assert.equal(derived.hitPct, null);
    assert.equal(derived.setAvg, null);
    assert.equal(derived.acePct, null);
    assert.equal(formatPct(derived.hitPct), '—');
    assert.equal(formatAvg(derived.passAvg), '—');
});

test('set ratings average and count errors separately', () => {
    const line = aggregate([stat('s', 'set3'), stat('s', 'set3'), stat('s', 'set1'), stat('s', 'set0')]).get('s');
    assert.equal(line.set.att, 4);
    assert.equal(line.set.total, 7);
    assert.equal(line.set.errors, 1);
    assert.equal(derive(line).setAvg, 1.75);
});

test('serve, block and dig counters accumulate', () => {
    const line = aggregate([
        stat('a', 'ace'),
        stat('a', 'serveIn'),
        stat('a', 'serveErr'),
        stat('a', 'blockSolo'),
        stat('a', 'blockAssist'),
        stat('a', 'blockAssist'),
        stat('a', 'blockErr'),
        stat('a', 'dig'),
        stat('a', 'digErr'),
    ]).get('a');

    assert.equal(line.serve.att, 3);
    assert.equal(line.serve.aces, 1);
    assert.equal(line.serve.errors, 1);
    assert.equal(line.block.solo, 1);
    assert.equal(line.block.assist, 2);
    assert.equal(line.dig.digs, 1);

    const derived = derive(line);
    assert.equal(derived.blockTotal, 3);
    assert.equal(derived.acePct, 1 / 3);
    assert.equal(derived.pointsScored, 2, 'one ace plus one solo block');
});

test('errorsCommitted counts every rally handed to the opponent', () => {
    const line = aggregate([
        stat('a', 'attackErr'),
        stat('a', 'serveErr'),
        stat('a', 'set0'),
        stat('a', 'blockErr'),
        stat('a', 'digErr'),
        stat('a', 'pass0'),
        stat('a', 'pass3'),
    ]).get('a');
    assert.equal(derive(line).errorsCommitted, 6);
});

test('non-stat events are ignored by aggregation', () => {
    const lines = aggregate([
        { type: 'team', code: 'oppError' },
        { type: 'sub', outId: 'a', inId: 'b' },
        { type: 'stat', playerId: 'a', code: 'notARealCode' },
        stat('a', 'kill'),
    ]);
    assert.equal(lines.size, 1);
    assert.equal(lines.get('a').attack.kills, 1);
    assert.equal(lines.get('a').attack.att, 1);
});

test('match and season aggregation roll sets up without double counting', () => {
    const match = {
        sets: [
            { events: [stat('a', 'kill'), stat('b', 'dig')] },
            { events: [stat('a', 'kill'), stat('a', 'attackErr')] },
        ],
    };
    const matchLines = aggregateMatch(match);
    assert.equal(matchLines.get('a').attack.kills, 2);
    assert.equal(matchLines.get('a').attack.att, 3);
    assert.equal(matchLines.get('b').dig.digs, 1);

    const seasonLines = aggregateSeason([match, match]);
    assert.equal(seasonLines.get('a').attack.kills, 4);
    assert.equal(seasonLines.get('b').dig.digs, 2);
});

test('totalLine sums every counter across players', () => {
    const lines = aggregate([stat('a', 'kill'), stat('b', 'kill'), stat('b', 'pass3')]);
    const total = totalLine([...lines.values()]);
    assert.equal(total.attack.kills, 2);
    assert.equal(total.pass.att, 1);
    assert.equal(total.pass.total, 3);
});

test('rotationBreakdown splits points won and lost by rotation', () => {
    const set = {
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: ['a', 'b', 'c', 'd', 'e', 'f'],
        events: [
            stat('a', 'ace'), // R1, us
            stat('a', 'serveErr'), // R1, them
            stat('b', 'kill'), // R1 side-out -> now R2
            stat('b', 'attackErr'), // R2, them
        ],
    };
    const rows = rotationBreakdown([set]);
    assert.deepEqual(
        rows.map((row) => [row.rotation, row.won, row.lost]),
        [
            [1, 2, 1],
            [2, 0, 1],
            [3, 0, 0],
            [4, 0, 0],
            [5, 0, 0],
            [6, 0, 0],
        ],
    );
    assert.equal(rows[0].diff, 1);
    assert.equal(rows[1].diff, -1);
});

test('formatPct renders volleyball-style leading-dot figures', () => {
    assert.equal(formatPct(0.286), '.286');
    assert.equal(formatPct(0), '.000');
    assert.equal(formatPct(1), '1.000');
    assert.equal(formatPct(-0.071), '-.071');
    assert.equal(formatPct(null), '—');
});

test('CSV export includes only players with recorded stats', () => {
    const roster = [
        { id: 'a', number: '4', name: 'Tess' },
        { id: 'z', number: '9', name: 'Did Not Play' },
    ];
    const lines = aggregate([stat('a', 'kill'), stat('a', 'pass3')]);
    const csv = toCsv(roster, lines);
    const rows = csv.split('\n');

    assert.equal(rows.length, 2, 'header plus one player');
    assert.ok(rows[0].startsWith('#,Name,Pass Att,Pass Avg'));
    assert.ok(rows[1].startsWith('4,Tess,1,3.00'));
    assert.ok(!csv.includes('Did Not Play'));
});

test('CSV export quotes names containing commas', () => {
    const roster = [{ id: 'a', number: '4', name: 'Smith, Jr.' }];
    const csv = toCsv(roster, aggregate([stat('a', 'kill')]));
    assert.ok(csv.includes('"Smith, Jr."'));
});
