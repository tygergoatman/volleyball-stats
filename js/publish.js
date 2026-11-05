/**
 * Publishing a season to the open web, and pulling it back down.
 *
 * The app's one hard rule is that **minors' names never reach the repository**
 * (see `ROSTER.md` and `tests/privacy.test.js`). Everything else in a backup —
 * who played which rotation, every pass and kill, the sub plan — is just
 * numbers, and numbers are safe to publish. So a season can be shared through
 * GitHub after all, as long as the names stay on the phones.
 *
 * That gives a one-way sync: the coach who keeps the season commits
 * `season.json` beside `index.html`, and every other phone pulls it. There is
 * no upload path and there is not going to be one — GitHub Pages serves files,
 * it does not accept them. Publishing stays a deliberate act by one person.
 *
 * **Names are restored locally, not transmitted.** A phone that already knows
 * #7 is Nell keeps calling her Nell; a phone that does not shows `#7`. The
 * pulled file never overwrites a name, which is what makes it safe to pull on
 * a phone that has them.
 *
 * Pure and DOM-free, so the whole thing is testable without a browser.
 */

import { sortPositions } from './model.js';

/** Bumped if the published shape changes in a way an older app cannot read. */
export const PUBLISHED_FORMAT = 1;

/**
 * The only fields allowed to leave the device, listed rather than banned.
 *
 * An allowlist is the whole defence: a field added next season called
 * `nickname`, `initials` or `parentEmail` is dropped by default instead of
 * published because nobody thought to ban it. `tests/publish.test.js` asserts
 * the list is exhaustive against a real player record, so adding a field to
 * the app without deciding about it here fails the suite.
 */
export const PUBLISHED_PLAYER_KEYS = ['id', 'number', 'positions', 'teams'];

/** Team labels are the squad's, not a child's: "JV", "Junior Varsity". */
export const PUBLISHED_TEAM_KEYS = ['id', 'name', 'fullName'];

function pick(source, keys) {
    const out = {};
    for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
    return out;
}

/** A player record stripped to its jersey number and role. */
function publishPlayer(player) {
    const clean = pick(player, PUBLISHED_PLAYER_KEYS);
    clean.id = String(clean.id ?? '');
    clean.number = String(clean.number ?? '').trim();
    clean.positions = sortPositions(Array.isArray(clean.positions) ? clean.positions : []);
    clean.teams = (clean.teams ?? []).map(String);
    return clean;
}

/**
 * The publishable form of a season.
 *
 * Left behind deliberately, as well as the names:
 *
 * - `playerOverrides` / `teamOverrides` — in-app edits to roster.json records.
 *   They can carry a name, and they are this device's opinion anyway.
 * - `rosterFile` — a cache of what roster.json last said. Redundant once
 *   published, and it would go stale in the repository.
 * - `hiddenTeamIds` — one coach hiding Varsity on her phone is not a fact
 *   about the season.
 * - `activeTeamId` / `activeMatchId` / `activeSetId` — which match somebody
 *   happens to have open. Syncing that would yank another coach's screen
 *   mid-set.
 *
 * @param {object} state a Store state
 * @param {{generatedAt?: Date}} [options]
 */
export function publishedSeason(state, { generatedAt = new Date() } = {}) {
    const archivedPlayers = {};
    for (const [id, player] of Object.entries(state.archivedPlayers ?? {})) {
        archivedPlayers[id] = publishPlayer(player);
    }
    const archivedTeams = {};
    for (const [id, team] of Object.entries(state.archivedTeams ?? {})) {
        archivedTeams[id] = pick(team, PUBLISHED_TEAM_KEYS);
    }

    return {
        format: PUBLISHED_FORMAT,
        version: state.version,
        generated: generatedAt.toISOString(),
        // Said in the file itself, so anyone who finds it knows the omission is
        // deliberate rather than a bug, and does not "helpfully" add names.
        _privacy:
            'Numbers only, never names. This file is published on the open web; the players are minors. ' +
            'Names live on each coach’s phone and are matched up by jersey number locally. See ROSTER.md.',
        season: { name: state.season?.name ?? 'Season' },
        teams: (state.teams ?? []).map((team) => pick(team, PUBLISHED_TEAM_KEYS)),
        players: (state.players ?? []).map(publishPlayer),
        archivedPlayers,
        archivedTeams,
        positionColors: { ...(state.positionColors ?? {}) },
        plans: structuredCloneish(state.plans ?? {}),
        matches: structuredCloneish(state.matches ?? []),
    };
}

/** A deep copy without depending on `structuredClone` being available. */
function structuredCloneish(value) {
    return JSON.parse(JSON.stringify(value));
}

/** The file to commit, pretty-printed so a diff in GitHub is readable. */
export function publishedJson(state, options) {
    return JSON.stringify(publishedSeason(state, options), null, 2);
}

/**
 * Fold a published season into a device's state.
 *
 * The rules, in the order they matter:
 *
 * 1. **A local name always wins.** A pulled player never overwrites one this
 *    device already knows, so pulling on the phone that has the names is safe
 *    and repeatable. A player this device has never seen arrives with an empty
 *    name and shows as her number until somebody types one.
 * 2. **Matches are added, never replaced.** Same rule as merging another
 *    coach's backup: a match already here by id is left alone, so a pull cannot
 *    undo a correction made locally.
 * 3. **Plans and colours are adopted only where this device has none.**
 *    Overwriting a coach's own sub plan from a file would be a nasty surprise
 *    mid-season.
 * 4. **The season's name, and which team is in view, are taken only by a phone
 *    with no matches of its own** — a phone being set up from the published
 *    season. Once it has recorded anything, both are the coach's own. Pointing
 *    a blank phone at the right team matters more than it sounds: `roster.json`
 *    defines several, the Stats tab falls back to the first of them, and a
 *    coach who has just pulled a season would otherwise find an empty table.
 *
 * Returns what changed, so the UI can say something truthful.
 *
 * @param {object} state mutable draft, as handed to `Store.update`
 * @param {object} incoming a parsed published season
 * @returns {{matches: number, skipped: number, players: number, teams: number}}
 */
export function applyPublishedSeason(state, incoming) {
    const result = { matches: 0, skipped: 0, players: 0, teams: 0 };
    if (!incoming || typeof incoming !== 'object') throw new Error('Not a published season file');
    if (!Array.isArray(incoming.matches)) throw new Error('No matches in that file');

    // Rule 4: a blank phone is being seeded and should look like everyone
    // else's; a phone with history has its own name for the season.
    const blank = (state.matches ?? []).length === 0;
    if (blank && incoming.season?.name) state.season = { ...state.season, name: incoming.season.name };

    /* ---- teams ---- */
    const knownTeams = new Set((state.teams ?? []).map((team) => team.id));
    for (const team of incoming.teams ?? []) {
        const id = String(team.id ?? '').trim();
        if (!id || knownTeams.has(id) || (state.hiddenTeamIds ?? []).includes(id)) continue;
        state.teams.push({ ...pick(team, PUBLISHED_TEAM_KEYS), local: true });
        knownTeams.add(id);
        result.teams += 1;
    }

    /* ---- players ---- */
    const byId = new Map((state.players ?? []).map((player) => [player.id, player]));
    for (const incomingPlayer of incoming.players ?? []) {
        const clean = publishPlayer(incomingPlayer);
        if (!clean.id) continue;
        const existing = byId.get(clean.id);

        if (!existing) {
            // No name to restore: she is a number until this phone is told
            // otherwise, which is the whole point of the exercise.
            state.players.push({ ...clean, name: '', local: true });
            byId.set(clean.id, clean);
            result.players += 1;
            continue;
        }

        // Rule 1. Everything else about her may be updated from the file; the
        // name is this device's and is not up for discussion.
        existing.positions = clean.positions.length ? clean.positions : existing.positions;
        existing.number = clean.number || existing.number;
        existing.teams = [...new Set([...(existing.teams ?? []), ...clean.teams])];
    }

    /* ---- archived, so old matches still resolve to a number ---- */
    for (const [id, player] of Object.entries(incoming.archivedPlayers ?? {})) {
        if (byId.has(id) || state.archivedPlayers[id]) continue;
        state.archivedPlayers[id] = { ...publishPlayer(player), name: '' };
    }
    for (const [id, team] of Object.entries(incoming.archivedTeams ?? {})) {
        if (knownTeams.has(id) || state.archivedTeams[id]) continue;
        state.archivedTeams[id] = pick(team, PUBLISHED_TEAM_KEYS);
    }

    /* ---- matches ---- */
    const knownMatches = new Set((state.matches ?? []).map((match) => match.id));
    for (const match of incoming.matches) {
        if (!match?.id) continue;
        if (knownMatches.has(match.id)) {
            result.skipped += 1;
            continue;
        }
        state.matches.push(structuredCloneish(match));
        knownMatches.add(match.id);
        result.matches += 1;
    }
    state.matches.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // Rule 4, second half: land a freshly seeded phone on the team whose
    // season it just pulled, rather than on whichever team roster.json lists
    // first.
    if (blank && result.matches > 0) {
        const teamId = state.matches.find((match) => match.teamId)?.teamId ?? null;
        if (teamId) state.activeTeamId = teamId;
    }

    /* ---- plans and colours, only where this device is silent ---- */
    for (const [teamId, plan] of Object.entries(incoming.plans ?? {})) {
        if (!state.plans[teamId]) state.plans[teamId] = structuredCloneish(plan);
    }
    for (const [position, color] of Object.entries(incoming.positionColors ?? {})) {
        if (!state.positionColors[position]) state.positionColors[position] = color;
    }

    return result;
}

/** A one-line summary of a pull, for a toast. */
export function describePull({ matches, skipped, players, teams }) {
    if (matches === 0 && players === 0 && teams === 0) {
        return skipped > 0 ? 'Already up to date' : 'Nothing in that file';
    }
    const parts = [];
    if (matches) parts.push(`${matches} match${matches === 1 ? '' : 'es'}`);
    if (players) parts.push(`${players} player${players === 1 ? '' : 's'}`);
    if (teams) parts.push(`${teams} team${teams === 1 ? '' : 's'}`);
    return `Pulled ${parts.join(', ')}`;
}
