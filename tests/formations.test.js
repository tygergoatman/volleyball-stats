/**
 * The base formation tables.
 *
 * These were transcribed by hand from the 6-2 rotation sheets, which is exactly
 * the kind of data that is easy to get subtly wrong and impossible to notice
 * courtside — a coach would just see one player standing in the wrong place and
 * assume they had misremembered. The structural tests below catch a fat-fingered
 * cell without anyone having to re-read the sheets.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BASE,
    DEFAULT_SYSTEM,
    SERVING_ORDER_ROLES,
    SERVE_RECEIVE,
    assignRoles,
    formationLineup,
    formationPoints,
    keepsFrontRowOnReceive,
    lineupForRotation,
} from '../js/formations.js';

const ROLES = ['S1', 'S2', 'OH1', 'OH2', 'MB1', 'MB2'];

// Serving order for a 6-2: S1, OH1, MB1, S2, OH2, MB2.
const LINEUP = ['s1', 'oh1', 'mb1', 's2', 'oh2', 'mb2'];
const PLAYERS = {
    s1: { id: 's1', number: '1', position: 'S' },
    oh1: { id: 'oh1', number: '2', position: 'OH' },
    mb1: { id: 'mb1', number: '3', position: 'MB' },
    s2: { id: 's2', number: '4', position: 'S' },
    oh2: { id: 'oh2', number: '5', position: 'OH' },
    mb2: { id: 'mb2', number: '6', position: 'MB' },
};
const lookup = (id) => PLAYERS[id];

test('every base rotation places all six roles exactly once', () => {
    for (const [system, rotations] of Object.entries(BASE)) {
        for (let rotation = 1; rotation <= 6; rotation++) {
            const table = rotations[rotation];
            assert.ok(table, `${system} rotation ${rotation} is missing`);

            const positions = Object.keys(table)
                .map(Number)
                .sort((a, b) => a - b);
            assert.deepEqual(positions, [1, 2, 3, 4, 5, 6], `${system} r${rotation}: positions`);

            const placed = Object.values(table).sort();
            assert.deepEqual(placed, ROLES.slice().sort(), `${system} r${rotation}: each role once`);
        }
    }
});

test('base always has a setter at position 1 and the opposite at position 2', () => {
    // The property the whole 6-2 turns on: whichever setter is back row runs the
    // offence from right back, and the other plays opposite in the front right.
    // It holds in all six rotations on the sheets, so a transcription slip that
    // breaks it is a transcription slip.
    for (let rotation = 1; rotation <= 6; rotation++) {
        const table = BASE['6-2'][rotation];
        assert.match(table[1], /^S[12]$/, `rotation ${rotation}: position 1 should be a setter`);
        assert.match(table[2], /^S[12]$/, `rotation ${rotation}: position 2 should be the opposite`);
        assert.notEqual(table[1], table[2], `rotation ${rotation}: the two setters are different people`);
    }
});

test('the setters swap duty halfway round, matching the sheets', () => {
    // S1 serves in rotation 1, so S1 sets while they are back row (rotations
    // 1-3) and plays opposite once they rotate front (4-6).
    for (const rotation of [1, 2, 3]) assert.equal(BASE['6-2'][rotation][1], 'S1');
    for (const rotation of [4, 5, 6]) assert.equal(BASE['6-2'][rotation][1], 'S2');
});

test('a middle and an outside are always front row together', () => {
    // Front row is positions 2, 3 and 4: the opposite, a middle and an outside.
    for (let rotation = 1; rotation <= 6; rotation++) {
        const front = [2, 3, 4].map((p) => BASE['6-2'][rotation][p]);
        assert.equal(front.filter((r) => r.startsWith('MB')).length, 1, `rotation ${rotation}: one middle front`);
        assert.equal(front.filter((r) => r.startsWith('OH')).length, 1, `rotation ${rotation}: one outside front`);
        assert.equal(front.filter((r) => r.startsWith('S')).length, 1, `rotation ${rotation}: one setter front`);
    }
});

test('roles come from serving order without anything extra being typed', () => {
    const { byRole, roleOf, mismatches } = assignRoles(LINEUP, 1, lookup);
    assert.deepEqual(byRole, { S1: 's1', OH1: 'oh1', MB1: 'mb1', S2: 's2', OH2: 'oh2', MB2: 'mb2' });
    assert.equal(roleOf.mb2, 'MB2');
    assert.deepEqual(mismatches, [], 'a canonical lineup raises nothing');
    assert.deepEqual(SERVING_ORDER_ROLES[DEFAULT_SYSTEM], ['S1', 'OH1', 'MB1', 'S2', 'OH2', 'MB2']);
});

test('a lineup entered in a different order is reported, not silently drawn', () => {
    // Setter and middle swapped: slot III now holds someone tagged S.
    const scrambled = ['s1', 'oh1', 's2', 'mb1', 'oh2', 'mb2'];
    const { mismatches } = assignRoles(scrambled, 1, lookup);
    assert.equal(mismatches.length, 2);
    assert.deepEqual(mismatches.map((m) => `${m.role}:${m.actual}`).sort(), ['MB1:S', 'S2:MB']);
});

test('untagged players raise nothing, since they claim nothing', () => {
    const bare = (id) => ({ id, number: '9' });
    assert.deepEqual(assignRoles(LINEUP, 1, bare).mismatches, []);
});

test('the rotation view is the lineup exactly as it stands', () => {
    const lineup = ['a', 'b', 'c', 'd', 'e', 'f'];
    assert.deepEqual(
        formationLineup({ lineup, startingLineup: LINEUP, rotation: 3, formation: 'rotation', playerLookup: lookup }),
        lineup,
    );
});

test('base redraws rotation 1: the outside and the opposite switch sides', () => {
    // Rotation 1 rotational order puts S2 at position 4 and OH1 at position 2.
    const lineup = lineupForRotation(LINEUP, 1);
    assert.deepEqual(lineup, LINEUP);

    const drawn = formationLineup({
        lineup,
        rotation: 1,
        formation: 'base',
        playerLookup: lookup,
    });

    // Position (index + 1): 1 S1, 2 S2, 3 MB1, 4 OH1, 5 OH2, 6 MB2.
    assert.deepEqual(drawn, ['s1', 's2', 'mb1', 'oh1', 'oh2', 'mb2']);
    assert.equal(drawn[3], 'oh1', 'the outside moved to position 4');
    assert.equal(drawn[1], 's2', 'the opposite moved to position 2');
});

test('base holds the same six players as the rotation it redraws', () => {
    for (let rotation = 1; rotation <= 6; rotation++) {
        const lineup = lineupForRotation(LINEUP, rotation);
        const drawn = formationLineup({
            lineup,
            rotation,
            formation: 'base',
            playerLookup: lookup,
        });
        assert.deepEqual(drawn.slice().sort(), lineup.slice().sort(), `rotation ${rotation}: same people`);
        assert.equal(new Set(drawn).size, 6, `rotation ${rotation}: nobody drawn twice`);
    }
});

test('a substitute inherits the role of the slot they come into', () => {
    // #7 comes on for the second middle. A role belongs to the rotation slot,
    // not the person, so #7 is MB2 for as long as they are on — and base places
    // them where MB2 plays, not where the person they replaced happened to be.
    const lineup = ['s1', 'oh1', 'mb1', 's2', 'oh2', 'sub7'];
    const withSub = (id) => PLAYERS[id] ?? { id, number: '7', position: 'MB' };

    const { byRole, roleOf, mismatches } = assignRoles(lineup, 1, withSub);
    assert.equal(byRole.MB2, 'sub7');
    assert.equal(roleOf.sub7, 'MB2');
    assert.deepEqual(mismatches, [], 'a middle replacing a middle is no mismatch');

    const drawn = formationLineup({ lineup, rotation: 1, formation: 'base', playerLookup: withSub });
    assert.deepEqual(drawn.slice().sort(), lineup.slice().sort(), 'the same six are on court');
    assert.equal(drawn[5], 'sub7', 'drawn where MB2 plays');
});

test('roles follow the rotation, so the same slot means different people later', () => {
    // Rotation 3 puts MB1 in to serve. Position 1 therefore holds MB1, not S1.
    const lineup = lineupForRotation(LINEUP, 3);
    const { byRole } = assignRoles(lineup, 3, lookup);
    assert.deepEqual(byRole, { S1: 's1', OH1: 'oh1', MB1: 'mb1', S2: 's2', OH2: 'oh2', MB2: 'mb2' });
    assert.equal(lineup[0], 'mb1', 'the third of the order is serving');

    // And base still releases the back-row setter to position 1.
    const drawn = formationLineup({ lineup, rotation: 3, formation: 'base', playerLookup: lookup });
    assert.equal(drawn[0], 's1', 'S1 is still back row in rotation 3, so still sets');
});

test('an unknown system or rotation falls back to the rotation view', () => {
    const lineup = ['a', 'b', 'c', 'd', 'e', 'f'];
    assert.deepEqual(
        formationLineup({ lineup, startingLineup: LINEUP, rotation: 1, formation: 'base', system: '5-1' }),
        lineup,
        'a system with no table drawn yet must not blank the court',
    );
});

/* ------------------------------------------------- serve-receive placement */

test('every serve-receive rotation places all six roles', () => {
    for (const [system, rotations] of Object.entries(SERVE_RECEIVE)) {
        for (let rotation = 1; rotation <= 6; rotation++) {
            const table = rotations[rotation];
            assert.ok(table, `${system} rotation ${rotation} is missing`);
            assert.deepEqual(Object.keys(table).sort(), ROLES.slice().sort(), `${system} r${rotation}`);
            for (const [role, point] of Object.entries(table)) {
                assert.ok(point.x >= 0 && point.x <= 1, `${role} x on court`);
                assert.ok(point.y >= 0 && point.y <= 1, `${role} y on court`);
            }
        }
    }
});

test('serve-receive keeps three passers deep and the setter up', () => {
    // The shape that makes it a receive formation rather than a jumble: the
    // three deepest players are the passing seam, and a setter is nearer the net
    // than at least one of them.
    for (let rotation = 1; rotation <= 6; rotation++) {
        const table = SERVE_RECEIVE['6-2'][rotation];
        const byDepth = Object.entries(table).sort((a, b) => b[1].y - a[1].y);
        const deepest = byDepth.slice(0, 3).map(([role]) => role);
        assert.equal(new Set(deepest).size, 3, `rotation ${rotation}: three distinct passers`);

        const setters = ['S1', 'S2'].map((r) => table[r].y);
        assert.ok(
            Math.min(...setters) < Math.max(...Object.values(table).map((p) => p.y)),
            `rotation ${rotation}: a setter is nearer the net than the deepest passer`,
        );
    }
});

test('points are produced for every player, in every view', () => {
    const lineup = lineupForRotation(LINEUP, 2);
    for (const formation of ['rotation', 'base', 'receive']) {
        const points = formationPoints({ lineup, rotation: 2, formation, playerLookup: lookup });
        assert.equal(Object.keys(points).length, 6, `${formation}: all six placed`);
        for (const id of lineup) {
            assert.ok(points[id], `${formation}: ${id} has a point`);
            assert.ok(points[id].x >= 0 && points[id].x <= 1);
            assert.ok(points[id].y >= 0 && points[id].y <= 1);
        }
    }
});

test('switching view moves players rather than replacing them', () => {
    // What makes the transition animate: the same ids appear in both views, so
    // the court can carry each bubble from one point to the other.
    const lineup = lineupForRotation(LINEUP, 1);
    const base = formationPoints({ lineup, rotation: 1, formation: 'base', playerLookup: lookup });
    const receive = formationPoints({ lineup, rotation: 1, formation: 'receive', playerLookup: lookup });

    assert.deepEqual(Object.keys(base).sort(), Object.keys(receive).sort());
    const moved = Object.keys(base).filter((id) => base[id].x !== receive[id].x || base[id].y !== receive[id].y);
    assert.ok(moved.length >= 4, 'most players move between the two');
});

test('rotations 1 and 4 are the ones that do not switch after receiving', () => {
    assert.equal(keepsFrontRowOnReceive(1), true);
    assert.equal(keepsFrontRowOnReceive(4), true);
    for (const rotation of [2, 3, 5, 6]) {
        assert.equal(keepsFrontRowOnReceive(rotation), false, `rotation ${rotation} switches`);
    }

    // And "not switching" is exactly the rotational arrangement, which is why no
    // extra table is needed — the destination is a view the app already draws.
    for (const rotation of [1, 4]) {
        const lineup = lineupForRotation(LINEUP, rotation);
        const rotational = formationPoints({ lineup, rotation, formation: 'rotation', playerLookup: lookup });
        const base = formationPoints({ lineup, rotation, formation: 'base', playerLookup: lookup });
        const frontRowDiffers = Object.keys(rotational).some(
            (id) => rotational[id].x !== base[id].x || rotational[id].y !== base[id].y,
        );
        assert.ok(frontRowDiffers, `rotation ${rotation}: base and rotational differ, so the note matters`);
    }
});
