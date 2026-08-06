import test from 'node:test';
import assert from 'node:assert/strict';

import {
    STAT_BY_CODE,
    applySub,
    computeSetState,
    describeEvent,
    nextRotation,
    pointFor,
    positionOf,
    rotateLineup,
    setWinner,
} from '../js/model.js';

const LINEUP = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

/** Build a set with the given events, using a known starting configuration. */
function makeSet(events, overrides = {}) {
    return {
        id: 's1',
        number: 1,
        startingServer: 'us',
        startingRotation: 1,
        startingLineup: LINEUP.slice(),
        target: 25,
        events,
        ...overrides,
    };
}

const stat = (playerId, code) => ({ id: `e${code}${playerId}`, type: 'stat', playerId, code });
const team = (code) => ({ id: `t${code}${Math.random()}`, type: 'team', code });

test('rotateLineup moves each player one position clockwise', () => {
    assert.deepEqual(rotateLineup(LINEUP), ['p2', 'p3', 'p4', 'p5', 'p6', 'p1']);
});

test('six rotations return to the starting lineup', () => {
    let lineup = LINEUP.slice();
    for (let i = 0; i < 6; i += 1) lineup = rotateLineup(lineup);
    assert.deepEqual(lineup, LINEUP);
});

test('nextRotation wraps from 6 back to 1', () => {
    assert.equal(nextRotation(1), 2);
    assert.equal(nextRotation(5), 6);
    assert.equal(nextRotation(6), 1);
});

test('applySub swaps the outgoing player in place', () => {
    const result = applySub(LINEUP, 'p3', 'p9');
    assert.deepEqual(result, ['p1', 'p2', 'p9', 'p4', 'p5', 'p6']);
    assert.deepEqual(LINEUP, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], 'input is not mutated');
});

test('applySub is a no-op when the outgoing player is not on the court', () => {
    assert.deepEqual(applySub(LINEUP, 'nobody', 'p9'), LINEUP);
});

test('positionOf reports one-based court positions', () => {
    assert.equal(positionOf(LINEUP, 'p1'), 1);
    assert.equal(positionOf(LINEUP, 'p6'), 6);
    assert.equal(positionOf(LINEUP, 'bench'), null);
});

test('pointFor maps stat outcomes to the scoring team', () => {
    assert.equal(pointFor({ type: 'stat', code: 'kill' }), 'us');
    assert.equal(pointFor({ type: 'stat', code: 'ace' }), 'us');
    assert.equal(pointFor({ type: 'stat', code: 'blockSolo' }), 'us');
    assert.equal(pointFor({ type: 'stat', code: 'attackErr' }), 'them');
    assert.equal(pointFor({ type: 'stat', code: 'serveErr' }), 'them');
    assert.equal(pointFor({ type: 'stat', code: 'pass0' }), 'them');
    assert.equal(pointFor({ type: 'stat', code: 'pass3' }), null);
    assert.equal(pointFor({ type: 'stat', code: 'dig' }), null);
    assert.equal(pointFor({ type: 'team', code: 'oppError' }), 'us');
    assert.equal(pointFor({ type: 'team', code: 'oppPoint' }), 'them');
    assert.equal(pointFor({ type: 'sub', outId: 'p1', inId: 'p9' }), null);
});

test('the attack buttons read K / A / 0, where A keeps the rally alive and 0 is the error', () => {
    assert.equal(STAT_BY_CODE.get('kill').label, 'K');
    assert.equal(STAT_BY_CODE.get('attackInPlay').label, 'A');
    assert.equal(STAT_BY_CODE.get('attackErr').label, '0');

    assert.equal(pointFor({ type: 'stat', code: 'attackInPlay' }), null, 'A stays in play');
    assert.equal(pointFor({ type: 'stat', code: 'attackErr' }), 'them', '0 hands over the point');
});

test('a .5 pass is an overpass that keeps the rally alive, unlike a 0 shank', () => {
    assert.equal(STAT_BY_CODE.get('pass05').label, '.5');
    assert.equal(pointFor({ type: 'stat', code: 'pass05' }), null);
    assert.equal(pointFor({ type: 'stat', code: 'pass0' }), 'them');
});

test('scoring while already serving does not rotate', () => {
    const set = makeSet([stat('p1', 'ace'), stat('p1', 'ace')]);
    const state = computeSetState(set);
    assert.equal(state.us, 2);
    assert.equal(state.them, 0);
    assert.equal(state.rotation, 1, 'no side-out, so no rotation');
    assert.deepEqual(state.lineup, LINEUP);
    assert.equal(state.serving, 'us');
});

test('winning a rally on the opponent serve is a side-out and rotates', () => {
    // They score (taking serve), then we side out.
    const set = makeSet([stat('p2', 'attackErr'), stat('p3', 'kill')]);
    const state = computeSetState(set);
    assert.equal(state.us, 1);
    assert.equal(state.them, 1);
    assert.equal(state.serving, 'us');
    assert.equal(state.rotation, 2);
    assert.deepEqual(state.lineup, ['p2', 'p3', 'p4', 'p5', 'p6', 'p1']);
});

test('a set that starts on the opponent serve rotates on the first point won', () => {
    const set = makeSet([stat('p4', 'kill')], { startingServer: 'them' });
    const state = computeSetState(set);
    assert.equal(state.rotation, 2);
    assert.equal(state.serving, 'us');
});

test('rotation counter wraps around after six side-outs', () => {
    const events = [];
    for (let i = 0; i < 6; i += 1) {
        events.push(stat('p1', 'serveErr')); // they score and serve
        events.push(stat('p1', 'kill')); // we side out and rotate
    }
    const state = computeSetState(makeSet(events));
    assert.equal(state.rotation, 1);
    assert.deepEqual(state.lineup, LINEUP);
    assert.equal(state.us, 6);
    assert.equal(state.them, 6);
});

test('rallies that stay in play never change the score', () => {
    const set = makeSet([
        stat('p1', 'serveIn'),
        stat('p5', 'pass3'),
        stat('p2', 'set3'),
        stat('p4', 'attackInPlay'),
        stat('p6', 'dig'),
        stat('p3', 'blockAssist'),
    ]);
    const state = computeSetState(set);
    assert.equal(state.us, 0);
    assert.equal(state.them, 0);
    assert.equal(state.serving, 'us');
});

test('substitutions change the lineup and survive later rotations', () => {
    const set = makeSet([
        { id: 'sub1', type: 'sub', outId: 'p3', inId: 'p9' },
        stat('p1', 'serveErr'),
        stat('p9', 'kill'),
    ]);
    const state = computeSetState(set);
    assert.deepEqual(state.lineup, ['p2', 'p9', 'p4', 'p5', 'p6', 'p1']);
    assert.equal(positionOf(state.lineup, 'p9'), 2, 'sub rotated from position 3 to 2');
});

test('the timeline records rotation and score at each event', () => {
    const set = makeSet([stat('p1', 'serveErr'), stat('p2', 'kill'), stat('p2', 'attackErr')]);
    const { timeline } = computeSetState(set);
    assert.equal(timeline.length, 3);
    assert.deepEqual(timeline[0].scoreAfter, { us: 0, them: 1 });
    assert.equal(timeline[0].rotationAtEvent, 1);
    assert.deepEqual(timeline[1].scoreAfter, { us: 1, them: 1 });
    assert.equal(timeline[1].rotationAtEvent, 1, 'rotation is recorded before the side-out applies');
    assert.equal(timeline[2].rotationAtEvent, 2);
    assert.equal(timeline[2].winner, 'them');
});

test('dropping the last event rewinds the score exactly', () => {
    const events = [stat('p1', 'ace'), stat('p1', 'serveErr'), stat('p2', 'kill')];
    const full = computeSetState(makeSet(events));
    assert.deepEqual([full.us, full.them, full.rotation], [2, 1, 2]);

    const undone = computeSetState(makeSet(events.slice(0, -1)));
    assert.deepEqual([undone.us, undone.them, undone.rotation], [1, 1, 1]);
    assert.deepEqual(undone.lineup, LINEUP, 'the rotation caused by the undone point is reversed');
});

test('deleting an event from the middle recalculates everything after it', () => {
    const events = [stat('p1', 'serveErr'), stat('p2', 'kill'), stat('p3', 'ace')];
    const without = events.filter((event) => event.code !== 'serveErr');
    const state = computeSetState(makeSet(without));
    assert.equal(state.them, 0);
    assert.equal(state.us, 2);
    assert.equal(state.rotation, 1, 'with no opponent point there is no side-out');
});

test('setWinner requires the target score and a two-point margin', () => {
    assert.equal(setWinner(25, 20), 'us');
    assert.equal(setWinner(20, 25), 'them');
    assert.equal(setWinner(25, 24), null);
    assert.equal(setWinner(26, 24), 'us');
    assert.equal(setWinner(24, 20), null);
    assert.equal(setWinner(15, 10, 15), 'us');
});

test('describeEvent names players, team events and subs', () => {
    const roster = new Map([
        ['p1', { number: '4', name: 'Tess' }],
        ['p9', { number: '16', name: 'McKenna' }],
    ]);
    const lookup = (id) => roster.get(id);

    assert.equal(describeEvent(stat('p1', 'kill'), lookup), '#4 Tess — Kill');
    assert.equal(describeEvent(team('oppError'), lookup), 'Opponent error');
    assert.equal(describeEvent({ type: 'sub', outId: 'p1', inId: 'p9' }, lookup), 'Sub: #16 McKenna in for #4 Tess');
});
