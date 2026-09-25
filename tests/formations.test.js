/**
 * The 5-1, and what it shares with the 6-2.
 *
 * The base table is written out by hand so it can be read against a rotation
 * sheet, which means a typo in it is invisible — it would just draw somebody in
 * the wrong place, in a timeout, convincingly. So the rules are asserted here
 * instead of trusted there.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BASE,
    RECEIVE_OPTIONS,
    SERVE_RECEIVE,
    SERVING_ORDER_ROLES,
    SYSTEMS,
    assignRoles,
    anchoredRotation,
    formationLineup,
    formationPoints,
    lineupForRotation,
    receiveTable,
    receiveIsProvisional,
    roleExpectations,
    slotAtPosition,
} from '../js/formations.js';
import { FRONT_ROW } from '../js/model.js';

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Which court position each role stands in, rotationally. */
function positionsAt(rotation, system) {
    const roles = SERVING_ORDER_ROLES[system];
    const at = {};
    for (let position = 1; position <= 6; position++) at[roles[slotAtPosition(position, rotation)]] = position;
    return at;
}

test('the 5-1 is offered as a system', () => {
    assert.ok(SYSTEMS.some((system) => system.key === '5-1'));
});

test('the two systems share a serving order shape', () => {
    // This is what lets a lineup entered for one read correctly in the other,
    // and why rotations 1-3 of the 5-1 receive are the 6-2 sheet renamed.
    const sixTwo = SERVING_ORDER_ROLES['6-2'];
    const fiveOne = SERVING_ORDER_ROLES['5-1'];
    assert.equal(fiveOne.length, 6);
    assert.deepEqual(fiveOne, sixTwo.map((role) => (role === 'S1' ? 'S' : role === 'S2' ? 'OPP' : role)));
});

test('the setter is back row in rotations 1-3 and front row in 4-6', () => {
    for (let rotation = 1; rotation <= 6; rotation++) {
        const front = FRONT_ROW.includes(positionsAt(rotation, '5-1').S);
        assert.equal(front, rotation >= 4, `rotation ${rotation}`);
    }
});

test('the 5-1 base table follows its six rules in every rotation', () => {
    for (let rotation = 1; rotation <= 6; rotation++) {
        const at = positionsAt(rotation, '5-1');
        const front = (role) => FRONT_ROW.includes(at[role]);
        const setterUp = front('S');

        assert.deepEqual(
            BASE['5-1'][rotation],
            {
                1: setterUp ? 'OPP' : 'S',
                2: setterUp ? 'S' : 'OPP',
                3: front('MB1') ? 'MB1' : 'MB2',
                4: front('OH1') ? 'OH1' : 'OH2',
                5: front('OH1') ? 'OH2' : 'OH1',
                6: front('MB1') ? 'MB2' : 'MB1',
            },
            `rotation ${rotation}`,
        );
    }
});

test('every 5-1 table names all six roles exactly once', () => {
    const roles = [...SERVING_ORDER_ROLES['5-1']].sort();
    for (let rotation = 1; rotation <= 6; rotation++) {
        assert.deepEqual(Object.values(BASE['5-1'][rotation]).sort(), roles, `base ${rotation}`);
        for (const option of RECEIVE_OPTIONS['5-1']) {
            assert.deepEqual(
                Object.keys(receiveTable('5-1', rotation, option.key)).sort(),
                roles,
                `receive ${rotation} ${option.key}`,
            );
        }
    }
});

test('the 5-1 sheet offers two options in every rotation', () => {
    assert.equal(RECEIVE_OPTIONS['5-1'].length, 2);
    for (let rotation = 1; rotation <= 6; rotation++) {
        const [a, b] = RECEIVE_OPTIONS['5-1'].map((o) => receiveTable('5-1', rotation, o.key));
        assert.ok(a && b, `rotation ${rotation}`);
        assert.notDeepEqual(a, b, `rotation ${rotation}: two options that are the same are not two options`);
    }
});

test('an unknown or missing option falls back to the first rather than drawing nothing', () => {
    assert.deepEqual(receiveTable('5-1', 1, 'nonsense'), receiveTable('5-1', 1, 'opt1'));
    assert.deepEqual(receiveTable('5-1', 1), receiveTable('5-1', 1, 'opt1'));
});

test('the 6-2 has no options and is returned flat', () => {
    assert.equal(RECEIVE_OPTIONS['6-2'], undefined);
    assert.deepEqual(receiveTable('6-2', 1), SERVE_RECEIVE['6-2'][1]);
});

test('every receive formation has three players deep and the setter never among them', () => {
    // The shape of a serve receive: three passers back, the setter at the net
    // whether she came from the front row or released from behind.
    for (let rotation = 1; rotation <= 6; rotation++) {
        for (const option of RECEIVE_OPTIONS['5-1']) {
            const table = receiveTable('5-1', rotation, option.key);
            const deep = Object.entries(table).filter(([, point]) => point.y > 0.6);
            assert.equal(deep.length, 3, `rotation ${rotation} ${option.key} passers`);
            assert.ok(table.S.y <= 0.4, `rotation ${rotation} ${option.key}: the setter is not a passer`);
        }
    }
});

test('a 5-1 setter reads as a setter in the front row', () => {
    // The 6-2 calls a front-row setter slot the opposite, which is correct for
    // that system and wrong for this one. Getting it backwards would have the
    // app misreading the system it was just told it is in.
    assert.equal(roleExpectations('S', true, '5-1').label, 'S');
    assert.deepEqual(roleExpectations('S', true, '5-1').allowed, ['S']);
    assert.equal(roleExpectations('S1', true, '6-2').label, 'OPP');
});

test('a 5-1 lineup of setter-first does not raise a mismatch', () => {
    const player = (id, position) => ({ id, number: id, positions: [position] });
    const roster = {
        a: player('a', 'S'),
        b: player('b', 'OH'),
        c: player('c', 'MB'),
        d: player('d', 'OPP'),
        e: player('e', 'OH'),
        f: player('f', 'MB'),
    };
    for (let rotation = 1; rotation <= 6; rotation++) {
        // The lineup travels with the rotation: at rotation 3 the six have
        // moved two spots, so handing the same array over for every rotation
        // asks the app to check a lineup nobody is standing in.
        const lineup = lineupForRotation(SIX, rotation);
        const { mismatches } = assignRoles(lineup, rotation, (id) => roster[id], '5-1');
        assert.deepEqual(mismatches, [], `rotation ${rotation}`);
    }
});

test('the rotation view is the lineup itself, in either system', () => {
    for (const system of ['6-2', '5-1']) {
        assert.deepEqual(formationLineup({ lineup: SIX, rotation: 3, formation: 'rotation', system }), SIX);
    }
});

test('nothing is marked provisional any more — both systems come from the sheets', () => {
    for (const system of ['6-2', '5-1']) {
        for (let rotation = 1; rotation <= 6; rotation++) {
            assert.equal(receiveIsProvisional(rotation, system), false, `${system} r${rotation}`);
        }
    }
});

test("the 5-1 receive is its own sheet, not the 6-2's with the labels changed", () => {
    // Worth an assertion because an earlier release *did* derive rotations 1-3
    // that way, reasoning that the setter is back row in both so the picture
    // must be the same. The real sheet disagrees in every one of the three —
    // by more than a tenth of the court in places. The systems share a serving
    // order; they do not share a passing formation.
    const rename = (role) => (role === 'S1' ? 'S' : role === 'S2' ? 'OPP' : role);
    for (const rotation of [1, 2, 3]) {
        const renamed = Object.fromEntries(
            Object.entries(SERVE_RECEIVE['6-2'][rotation]).map(([role, point]) => [rename(role), point]),
        );
        assert.notDeepEqual(receiveTable('5-1', rotation, 'opt1'), renamed, `rotation ${rotation}`);
    }
});

test('every receive coordinate is on the court', () => {
    for (const system of Object.keys(SERVE_RECEIVE)) {
        const options = RECEIVE_OPTIONS[system] ?? [{ key: null }];
        for (let rotation = 1; rotation <= 6; rotation++) {
            for (const option of options) {
                for (const [role, point] of Object.entries(receiveTable(system, rotation, option.key))) {
                    assert.ok(point.x >= 0 && point.x <= 1, `${system} r${rotation} ${role} x`);
                    assert.ok(point.y >= 0 && point.y <= 1, `${system} r${rotation} ${role} y`);
                }
            }
        }
    }
});

/* -------------------------------------- the setter is a person, not a slot */

const FIVE_ONE_ROSTER = {
    s: { id: 's', number: '1', positions: ['S'] },
    oh1: { id: 'oh1', number: '2', positions: ['OH'] },
    mb1: { id: 'mb1', number: '3', positions: ['MB'] },
    opp: { id: 'opp', number: '4', positions: ['OPP'] },
    oh2: { id: 'oh2', number: '5', positions: ['OH'] },
    mb2: { id: 'mb2', number: '6', positions: ['MB'] },
};
const look = (id) => FIVE_ONE_ROSTER[id];

test('a 5-1 setter reads as the setter wherever she is standing', () => {
    // The reported bug: a set started on "rotation 4" with the setter typed
    // into position 1. The arithmetic was right and the answer was wrong — she
    // came out labelled the opposite while standing there setting.
    for (let position = 1; position <= 6; position++) {
        const lineup = [null, null, null, null, null, null];
        lineup[position - 1] = 's';
        // Anything in the other five spots; only the setter's spot matters here.
        const others = ['oh1', 'mb1', 'opp', 'oh2', 'mb2'];
        for (let i = 0, k = 0; i < 6; i++) if (!lineup[i]) lineup[i] = others[k++];

        for (const counter of [1, 2, 3, 4, 5, 6]) {
            const { roleOf } = assignRoles(lineup, counter, look, '5-1');
            assert.equal(roleOf.s, 'S', `setter at position ${position}, counter ${counter}`);
        }
    }
});

test('anchoring ignores the counter entirely, so it is idempotent', () => {
    const lineup = ['s', 'oh1', 'mb1', 'opp', 'oh2', 'mb2'];
    const once = anchoredRotation(lineup, 4, look, '5-1');
    assert.equal(once, 1, 'a setter at position 1 is rotation 1, whatever the counter says');
    assert.equal(anchoredRotation(lineup, once, look, '5-1'), once, 'anchoring twice changes nothing');
});

test('every setter position maps to the rotation that puts her there', () => {
    // The inverse of `slotAtPosition`, which is the only arithmetic here worth
    // getting wrong quietly.
    for (let rotation = 1; rotation <= 6; rotation++) {
        const lineup = lineupForRotation(['s', 'oh1', 'mb1', 'opp', 'oh2', 'mb2'], rotation);
        assert.equal(anchoredRotation(lineup, 99, look, '5-1'), rotation, `rotation ${rotation}`);
    }
});

test('the 6-2 is left alone — two setters, and the counter is right', () => {
    const lineup = ['s', 'oh1', 'mb1', 'opp', 'oh2', 'mb2'];
    for (const rotation of [1, 3, 5]) {
        assert.equal(anchoredRotation(lineup, rotation, look, '6-2'), rotation);
    }
});

test('no setter on court, or two, falls back to the counter rather than guessing', () => {
    const none = ['oh1', 'mb1', 'opp', 'oh2', 'mb2', null];
    assert.equal(anchoredRotation(none, 4, look, '5-1'), 4);

    const two = { ...FIVE_ONE_ROSTER, oh1: { id: 'oh1', number: '2', positions: ['S'] } };
    const lineup = ['s', 'oh1', 'mb1', 'opp', 'oh2', 'mb2'];
    assert.equal(anchoredRotation(lineup, 4, (id) => two[id], '5-1'), 4);
});

test('the base and receive drawings follow the setter too, not just the labels', () => {
    // Labels alone would be half a fix: the court would name her the setter and
    // then draw her in the opposite's base spot.
    const lineup = ['s', 'oh1', 'mb1', 'opp', 'oh2', 'mb2'];
    const drawn = formationLineup({ lineup, rotation: 4, formation: 'base', system: '5-1', playerLookup: look });
    assert.equal(drawn[0], 's', 'a back-row setter plays position 1');

    const points = formationPoints({
        lineup,
        rotation: 4,
        formation: 'receive',
        system: '5-1',
        playerLookup: look,
    });
    assert.deepEqual(points.s, receiveTable('5-1', 1, 'opt1').S, "and receives where rotation 1's sheet puts her");
});
