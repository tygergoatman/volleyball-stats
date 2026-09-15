/**
 * The precache list must name every module, in both directions.
 *
 * `libero.js`, `formations.js` and `ui/subs.js` each shipped missing from
 * `SHELL` and nothing noticed: the fetch handler caches what it serves, so one
 * online visit papers over the omission completely. The failure only bites an
 * install that never ran online — and since `store.js` imports `formations.js`,
 * that failure is the whole app rather than the one tab.
 *
 * Both directions matter. A module missing from the list breaks offline; a list
 * entry with no file behind it makes `cache.addAll` reject, which fails the
 * *whole* install and leaves the app with no worker at all.
 *
 * Note for whoever reads this next: this file was rewritten from its
 * description after the original suite was lost. It covers the same rule, but
 * it has not been diffed against the original.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/** The `SHELL` array, read as text so the worker never has to be imported. */
function shellList() {
    const source = readFileSync(join(root, 'sw.js'), 'utf8');
    const block = source.match(/const SHELL = \[([\s\S]*?)\];/);
    assert.ok(block, 'sw.js should declare a SHELL array');
    return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** Every `.js` file under `js/`, as the paths `SHELL` would spell them. */
function modulesOnDisk(dir = 'js') {
    const found = [];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (entry.isDirectory()) found.push(...modulesOnDisk(`${dir}/${entry.name}`));
        else if (entry.name.endsWith('.js')) found.push(`./${dir}/${entry.name}`);
    }
    return found;
}

test('every module on disk is in the precache list', () => {
    const shell = new Set(shellList());
    const missing = modulesOnDisk().filter((path) => !shell.has(path));
    assert.deepEqual(missing, [], `add these to SHELL in sw.js: ${missing.join(', ')}`);
});

test('every precache entry exists on disk', () => {
    // './' is the app's own address, served by index.html — it has no file.
    const missing = shellList()
        .filter((path) => path !== './')
        .filter((path) => !existsSync(join(root, path)));
    assert.deepEqual(missing, [], `SHELL names files that are not there: ${missing.join(', ')}`);
});

test('the precache list has no duplicates', () => {
    const shell = shellList();
    assert.equal(new Set(shell).size, shell.length);
});
