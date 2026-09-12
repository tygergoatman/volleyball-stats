/**
 * The one hard constraint on this project: **no player names in `roster.json`**.
 *
 * The reasoning, because it is not obvious from the file itself:
 *
 * - It is published on the open web at the app's own address. Anyone can fetch it.
 * - A private repository would not help — the app reads it over plain HTTP, so
 *   whatever the app can read, anyone can. Free GitHub Pages needs a public repo
 *   anyway.
 * - Git history is permanent. A name committed and deleted later stays publicly
 *   retrievable. So the rule has to hold on the **first** commit; there is no
 *   clean undo.
 *
 * These are minors' names, which is why this is enforced by a test rather than
 * left as a convention.
 *
 * Note for whoever reads this next: this file was rewritten from its
 * description after the original suite was lost. It covers the same rule, but
 * it has not been diffed against the original — if something here looks thinner
 * than you expected, it may be.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../roster.json', import.meta.url), 'utf8');
const roster = JSON.parse(raw);

/** Every field a player record is allowed to carry in the published file. */
const ALLOWED_PLAYER_KEYS = new Set(['id', 'number', 'teams', 'positions']);

test('no player in roster.json carries a name', () => {
    for (const player of roster.players ?? []) {
        assert.equal(player.name, undefined, `player ${player.number ?? player.id} has a name in the published file`);
        assert.equal(player.firstName, undefined, 'no first names either');
        assert.equal(player.lastName, undefined, 'no last names either');
    }
});

test('players in roster.json carry nothing but the fields we vetted', () => {
    // The point of listing allowed keys rather than banned ones: a future field
    // called `nickname`, `initials` or `parentEmail` fails by default instead of
    // shipping because nobody thought to ban it.
    for (const player of roster.players ?? []) {
        for (const key of Object.keys(player)) {
            assert.ok(
                ALLOWED_PLAYER_KEYS.has(key),
                `unvetted field "${key}" on player ${player.number ?? player.id} — if it is safe to publish, add it to ALLOWED_PLAYER_KEYS on purpose`,
            );
        }
    }
});

test('a jersey number is not smuggling a name', () => {
    // `"number": "7 Emma"` would pass the checks above. A number is digits.
    for (const player of roster.players ?? []) {
        assert.match(
            String(player.number ?? ''),
            /^\d{1,2}$/,
            `player number ${JSON.stringify(player.number)} should be digits and nothing else`,
        );
    }
});

test('the file still says why, in the file itself', () => {
    // The rule has to survive somebody editing roster.json by hand on a laptop,
    // without this test in front of them.
    assert.match(String(roster._privacy ?? ''), /NO PLAYER NAMES/i, 'the _privacy note must stay in roster.json');
});

test('team labels are the only other thing published', () => {
    // Team names are the whole reason the file exists. Anything else appearing
    // at the top level is worth a deliberate look before it ships.
    const topLevel = new Set(Object.keys(roster));
    for (const key of ['_readme', '_privacy', 'version', 'updated', 'teams', 'players']) topLevel.delete(key);
    assert.deepEqual([...topLevel], [], 'unexpected top-level keys in the published roster file');
});
