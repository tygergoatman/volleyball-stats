/**
 * The libero tracking sheet.
 *
 * The thing worth guarding here is the substitution count. A team gets 15 a set
 * and libero replacements are unlimited and separate; miscount either and a
 * coach makes a substitution the referee will not allow, in a game, on the
 * strength of what this app told them. Everything else on the sheet is a
 * convenience — this part has a consequence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SUB_LIMIT, liberoSheet } from '../js/libero.js';

const LINEUP = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const LIBERO = 'lib';

const usPoint = () => ({ type: 'team', code: 'oppError' });
const themPoint = () => ({ type: 'team', code: 'oppPoint' });
const sub = (outId, inId) => ({ type: 'sub', kind: 'sub', outId, inId });
const liberoSwap = (outId, inId) => ({ type: 'sub', kind: 'libero', outId, inId });

function sheet(events = [], { startingServer = 'us', lineup = LINEUP } = {}) {
    return liberoSheet(
        { startingLineup: lineup, startingRotation: 1, startingServer, events },
        { liberoIds: [LIBERO] },
    );
}

const numbers = (row) => row.entries.map((e) => (e.libero ? 'L' : e.playerId) + (e.left ? '*' : ''));

test('serving order is the starting lineup, and rows start in matching court positions', () => {
    const { rows } = sheet();
    assert.deepEqual(
        rows.map((r) => r.order),
        ['I', 'II', 'III', 'IV', 'V', 'VI'],
    );
    assert.deepEqual(
        rows.map((r) => r.startingPlayerId),
        LINEUP,
    );
    assert.deepEqual(
        rows.map((r) => r.courtPosition),
        [1, 2, 3, 4, 5, 6],
    );
});

test('serving from the first whistle counts as row I’s term of service', () => {
    const { rows } = sheet();
    assert.deepEqual(
        rows.map((r) => r.serves),
        [1, 0, 0, 0, 0, 0],
    );
    assert.equal(rows[0].serving, true);
});

test('receiving first, nobody has served until the side-out', () => {
    assert.deepEqual(
        sheet([], { startingServer: 'them' }).rows.map((r) => r.serves),
        [0, 0, 0, 0, 0, 0],
    );

    // Win the rally they served: we rotate, and row II lands in position 1.
    const { rows } = sheet([usPoint()], { startingServer: 'them' });
    assert.deepEqual(
        rows.map((r) => r.serves),
        [0, 1, 0, 0, 0, 0],
    );
    assert.equal(rows[1].courtPosition, 1);
    assert.equal(rows[0].courtPosition, 6, 'the first server rotated back to position 6');
});

test('a run of points on our own serve is one term, not one per point', () => {
    const { rows } = sheet([usPoint(), usPoint(), usPoint(), usPoint()]);
    assert.deepEqual(
        rows.map((r) => r.serves),
        [1, 0, 0, 0, 0, 0],
        'four points without losing serve is still a single term',
    );
});

test('losing serve and winning it back starts a new term for the next row', () => {
    const { rows } = sheet([themPoint(), usPoint(), themPoint(), usPoint()]);
    assert.deepEqual(
        rows.map((r) => r.serves),
        [1, 1, 1, 0, 0, 0],
        'row I served first, then rows II and III after each side-out',
    );
});

test('a libero replacement never counts against the 15', () => {
    const { subsUsed, subsLeft, subLimit, rows, liberoOnCourt } = sheet([
        liberoSwap('p5', LIBERO),
        usPoint(),
        liberoSwap(LIBERO, 'p5'),
        usPoint(),
        liberoSwap('p5', LIBERO),
    ]);

    assert.equal(subsUsed, 0);
    assert.equal(subLimit, SUB_LIMIT);
    assert.equal(subsLeft, 15);
    assert.equal(liberoOnCourt, LIBERO);

    // The paper sheet's row for p5 reads: 5, L, 5, L — all but the last struck.
    assert.deepEqual(numbers(rows[4]), ['p5*', 'L*', 'p5*', 'L']);
    assert.equal(rows[4].currentPlayerId, LIBERO);
    assert.equal(rows[4].hasLibero, true);
});

test('an ordinary substitution does count, and lands in the right row', () => {
    const { subsUsed, subsLeft, rows } = sheet([sub('p3', 'p9'), sub('p1', 'p8')]);

    assert.equal(subsUsed, 2);
    assert.equal(subsLeft, 13);
    assert.deepEqual(numbers(rows[2]), ['p3*', 'p9']);
    assert.deepEqual(numbers(rows[0]), ['p1*', 'p8']);
    assert.deepEqual(numbers(rows[1]), ['p2'], 'untouched rows are left alone');
});

test('a substitute can be replaced by the libero, and both are counted correctly', () => {
    const { subsUsed, rows } = sheet([sub('p5', 'p9'), usPoint(), liberoSwap('p9', LIBERO)]);
    assert.equal(subsUsed, 1, 'the substitution counts, the libero swap does not');
    assert.deepEqual(numbers(rows[4]), ['p5*', 'p9*', 'L']);
});

test('sets recorded before the app knew the difference still read sensibly', () => {
    // No `kind` at all — the old shape. Anything involving the libero is a
    // replacement, so an old set does not report 15 subs used by the third game.
    const { subsUsed } = sheet([
        { type: 'sub', outId: 'p5', inId: LIBERO },
        { type: 'sub', outId: LIBERO, inId: 'p5' },
        { type: 'sub', outId: 'p2', inId: 'p9' },
    ]);
    assert.equal(subsUsed, 1);
});

test('the sheet warns when the libero rotates into the front row', () => {
    // Libero into row V, which starts in position 5. Four side-outs bring that
    // row round to position 1, six more and it is front row.
    const rally = [themPoint(), usPoint()];
    const events = [liberoSwap('p5', LIBERO), ...rally, ...rally, ...rally];
    const { rows, warnings } = sheet(events);

    const liberoRow = rows.find((r) => r.hasLibero);
    assert.equal(liberoRow.courtPosition, 2, 'row V has rotated to position 2');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /front row/);
});

test('no warning while the libero is legally in the back row', () => {
    assert.deepEqual(sheet([liberoSwap('p5', LIBERO)]).warnings, []);
});

test('a replacement for somebody not on court is ignored rather than corrupting the sheet', () => {
    const { rows, subsUsed } = sheet([sub('p99', 'p9')]);
    assert.equal(subsUsed, 0);
    assert.deepEqual(
        rows.map((r) => r.currentPlayerId),
        LINEUP,
    );
});

test('an empty or half-filled lineup still produces six rows', () => {
    assert.equal(liberoSheet({}, {}).rows.length, 6);
    assert.equal(liberoSheet({ startingLineup: ['p1', 'p2'] }, {}).rows.length, 6);
});

test('a player the libero replaced is not a bench player', () => {
    // The bug this guards: while the libero is on for #5, #5 looks "not on
    // court" and could be substituted into another row — then the libero comes
    // off, #5 returns, and the same player is on court twice.
    const { awaitingLiberoReturn } = sheet([liberoSwap('p5', LIBERO)]);
    assert.deepEqual(awaitingLiberoReturn, ['p5']);

    // Once they are back, nothing is reserved.
    assert.deepEqual(sheet([liberoSwap('p5', LIBERO), liberoSwap(LIBERO, 'p5')]).awaitingLiberoReturn, []);
    assert.deepEqual(sheet([]).awaitingLiberoReturn, []);
});

test('substituting for the libero strands nobody', () => {
    // Legal route when the replaced player is not coming back: sub for the
    // libero directly. Row V then holds the substitute and reserves no one.
    const { rows, subsUsed, awaitingLiberoReturn } = sheet([liberoSwap('p5', LIBERO), sub(LIBERO, 'p9')]);
    assert.equal(rows[4].currentPlayerId, 'p9');
    assert.equal(subsUsed, 1);
    assert.deepEqual(awaitingLiberoReturn, []);
});

/* --------------------------------------------- the triangle: libero serving */

const LIBERO_B = 'lib2';
const twoLiberoSheet = (events, startingServer = 'us') =>
    liberoSheet(
        { startingLineup: LINEUP, startingRotation: 1, startingServer, events },
        { liberoIds: [LIBERO, LIBERO_B] },
    );

test('the libero serving row is derived from actually serving, not declared', () => {
    // Nobody has served as libero yet, so no row is marked.
    assert.equal(sheet([liberoSwap('p5', LIBERO)]).liberoServeRow, null);

    // Row V is in position 5. Four side-outs bring it to position 1, and the
    // libero standing there serves — that fixes the row.
    const rally = [themPoint(), usPoint()];
    const toPositionOne = [...rally, ...rally, ...rally, ...rally];
    const { liberoServeRow, rows, warnings } = sheet([liberoSwap('p5', LIBERO), ...toPositionOne]);

    assert.equal(liberoServeRow, 4, 'row V');
    assert.equal(rows[4].liberoServes, true, 'the triangle sits on row V');
    assert.equal(rows[4].serving, true);
    assert.deepEqual(
        rows.filter((r) => r.liberoServes).map((r) => r.order),
        ['V'],
        'exactly one row is ever marked',
    );
    assert.deepEqual(warnings, [], 'serving from the locked row is not a warning');
});

test('serving from a second row is flagged as the violation it is', () => {
    const rally = [themPoint(), usPoint()];
    const events = [
        liberoSwap('p5', LIBERO),
        ...rally,
        ...rally,
        ...rally,
        ...rally, // row V serves — locks the row
        liberoSwap(LIBERO, 'p5'), // libero off
        liberoSwap('p6', LIBERO), // back on, different player
        ...rally, // row VI comes round to serve
    ];
    const { liberoServeRow, warnings } = sheet(events);

    assert.equal(liberoServeRow, 4, 'the row stays locked to the first one');
    assert.equal(warnings.filter((w) => /only serve in one rotation/.test(w)).length, 1);
});

test('the libero can replace different players — only serving is restricted', () => {
    const { subsUsed, warnings } = sheet([
        liberoSwap('p5', LIBERO),
        usPoint(),
        liberoSwap(LIBERO, 'p5'),
        liberoSwap('p6', LIBERO),
    ]);
    assert.equal(subsUsed, 0, 'swapping between players is still not a substitution');
    assert.deepEqual(warnings, [], 'and is perfectly legal on its own');
});

test('two liberos share one serving row between them', () => {
    const rally = [themPoint(), usPoint()];
    const events = [
        liberoSwap('p5', LIBERO),
        ...rally,
        ...rally,
        ...rally,
        ...rally, // libero A serves from row V
        liberoSwap(LIBERO, 'p5'),
        liberoSwap('p6', LIBERO_B), // the other libero, row VI
        ...rally,
    ];
    const { liberoServeRow, warnings } = twoLiberoSheet(events);

    assert.equal(liberoServeRow, 4);
    assert.equal(
        warnings.filter((w) => /only serve in one rotation/.test(w)).length,
        1,
        'the second libero does not get a second row',
    );
});

test('only one libero may be on court at a time', () => {
    const both = twoLiberoSheet([liberoSwap('p5', LIBERO), liberoSwap('p6', LIBERO_B)]);
    assert.equal(both.liberosOnCourt.length, 2);
    assert.equal(both.warnings.filter((w) => /Only one may be on/.test(w)).length, 1);

    const one = twoLiberoSheet([liberoSwap('p5', LIBERO)]);
    assert.deepEqual(one.liberosOnCourt, [LIBERO]);
    assert.deepEqual(one.warnings, []);
});

test('both liberos are reserved-aware independently', () => {
    const { awaitingLiberoReturn } = twoLiberoSheet([liberoSwap('p5', LIBERO), liberoSwap('p6', LIBERO_B)]);
    assert.deepEqual(awaitingLiberoReturn.sort(), ['p5', 'p6']);
});

test('a libero adrift in the rotation is reported once, not twice', () => {
    // A libero never rotates towards serving: they stand in 1, 5 and 6, entering
    // at position 1. Being in position 2 — one rotation from serving — means the
    // record is wrong, and that is already a front-row error. It must not also be
    // reported as an impending serve violation.
    const rally = [themPoint(), usPoint()];
    // Four side-outs put row V in position 1 (the libero serves, locking it) and
    // row VI in position 2. Moving the libero there is the mistake.
    const lock = [liberoSwap('p5', LIBERO), ...rally, ...rally, ...rally, ...rally];
    const adrift = [...lock, liberoSwap(LIBERO, 'p5'), liberoSwap('p6', LIBERO)];

    const { rows, warnings } = sheet(adrift);
    assert.equal(rows[5].courtPosition, 2, 'row VI is in position 2');
    assert.deepEqual(warnings, ['Libero is in position 2 — front row.']);
});

test('serving from a second row is still reported after the fact', () => {
    const rally = [themPoint(), usPoint()];
    const events = [
        liberoSwap('p5', LIBERO),
        ...rally,
        ...rally,
        ...rally,
        ...rally,
        liberoSwap(LIBERO, 'p5'),
        liberoSwap('p6', LIBERO),
        ...rally,
    ];
    const serveWarnings = sheet(events).warnings.filter((w) => /serve/.test(w));
    assert.equal(serveWarnings.length, 1, `one warning, got: ${JSON.stringify(serveWarnings)}`);
    assert.match(serveWarnings[0], /only serve in one rotation/);
});
