/**
 * Application state: a single observable object persisted to localStorage.
 *
 * Every mutation goes through an action on the store so that saving and
 * re-rendering happen in exactly one place.
 *
 * There is ONE roster of players for the whole program. Teams (MS / JV /
 * Varsity) are tags a player carries, so somebody who swings between JV and
 * Varsity is one person with two tags rather than two records — and removing a
 * team removes a label, not people or the matches they played.
 */

import { DEFAULT_FORMAT, SCHEMA_VERSION, computeSetState, targetForSet } from './model.js';

const STORAGE_KEY = 'volleyball-stats.v1';

/* -------------------------------------------------------------- utilities */

let idCounter = 0;

/** Monotonic, collision-resistant id that does not depend on crypto APIs. */
export function newId(prefix = 'id') {
    idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function todayIso() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function sortByNumber(a, b) {
    const left = Number.parseInt(a.number, 10);
    const right = Number.parseInt(b.number, 10);
    if (Number.isNaN(left) && Number.isNaN(right)) return (a.name ?? '').localeCompare(b.name ?? '');
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left - right;
}

function uniq(values) {
    return [...new Set(values.filter(Boolean))];
}

/**
 * Normalise one player record from any source.
 *
 * Setter and libero used to be separate booleans alongside `position`, which
 * meant the roster could say a player was an outside hitter and the libero at
 * the same time. They are folded into `position` here, so older saved data and
 * older roster.json files still land in the right place.
 */
function normalisePlayer(raw, { local = false, teams = [] } = {}) {
    let position = raw.position ?? '';
    if (!position && raw.isSetter) position = 'S';
    if (!position && raw.isLibero) position = 'L';

    return {
        id: String(raw.id ?? newId('p')),
        number: String(raw.number ?? '').trim(),
        name: String(raw.name ?? '').trim(),
        position,
        teams: uniq([...(raw.teams ?? []), ...teams].map(String)),
        local,
    };
}

function normaliseTeam(raw, { local = false } = {}) {
    const id = String(raw.id ?? newId('t'));
    const name = String(raw.name ?? id).trim() || id;
    return { id, name, fullName: String(raw.fullName ?? name).trim() || name, local };
}

/* ----------------------------------------------------------- initial state */

export function emptyState() {
    return {
        version: SCHEMA_VERSION,
        season: { name: `${new Date().getFullYear()} Season` },
        /** Team labels. Players point at these by id. */
        teams: [],
        /** The whole program's roster, in one list. */
        players: [],
        /** Edits made in the app to players defined in roster.json. */
        playerOverrides: {},
        /** Edits made in the app to team names defined in roster.json. */
        teamOverrides: {},
        /**
         * Teams removed on this device. roster.json is shared and cannot be
         * edited from a phone, so a removal has to outlast a file refresh.
         */
        hiddenTeamIds: [],
        /** Players and teams removed, kept so old matches still read properly. */
        archivedPlayers: {},
        archivedTeams: {},
        matches: [],
        activeTeamId: null,
        activeMatchId: null,
        activeSetId: null,
        rosterFile: null,
    };
}

/**
 * Bring a persisted blob up to the current shape. Kept deliberately tolerant:
 * a stat app that loses a season to a schema change is worse than useless.
 */
function migrate(raw) {
    const state = { ...emptyState(), ...raw };
    state.version = SCHEMA_VERSION;
    state.season = { ...emptyState().season, ...(raw.season ?? {}) };
    state.playerOverrides = raw.playerOverrides ?? {};
    state.teamOverrides = raw.teamOverrides ?? {};
    state.hiddenTeamIds = Array.isArray(raw.hiddenTeamIds) ? raw.hiddenTeamIds : [];
    state.archivedPlayers = raw.archivedPlayers ?? {};
    state.archivedTeams = raw.archivedTeams ?? {};
    state.matches = Array.isArray(raw.matches) ? raw.matches : [];
    state.teams = Array.isArray(raw.teams) ? raw.teams.map((t) => normaliseTeam(t, { local: t.local })) : [];
    state.players = Array.isArray(raw.players)
        ? raw.players.map((p) => normalisePlayer(p, { local: Boolean(p.local) }))
        : [];

    // v1 kept one flat roster and a single team name.
    if (state.teams.length === 0 && Array.isArray(raw.roster)) {
        const name = raw.team?.name?.trim() || 'My Team';
        state.teams = [normaliseTeam({ id: 'legacy', name, fullName: name }, { local: true })];
        state.players = raw.roster.map((p) => normalisePlayer(p, { local: true, teams: ['legacy'] }));
    }

    // v2 nested a roster inside each team. Flatten, merging anyone who appeared
    // on more than one team into a single record carrying both tags.
    if (state.players.length === 0 && Array.isArray(raw.teams) && raw.teams.some((t) => t.players)) {
        const byId = new Map();
        for (const team of raw.teams) {
            for (const player of team.players ?? []) {
                const existing = byId.get(String(player.id));
                if (existing) existing.teams = uniq([...existing.teams, team.id]);
                else byId.set(String(player.id), normalisePlayer(player, { local: player.local, teams: [team.id] }));
            }
        }
        state.players = [...byId.values()];
    }

    delete state.roster;
    delete state.team;
    for (const team of state.teams) delete team.players;
    state.players.sort(sortByNumber);

    const firstTeamId = state.teams[0]?.id ?? null;
    for (const match of state.matches) {
        match.teamId = match.teamId ?? firstTeamId;
        match.format = match.format ?? DEFAULT_FORMAT;
        match.complete = Boolean(match.complete);
        match.sets = Array.isArray(match.sets) ? match.sets : [];
        for (const set of match.sets) {
            set.events = Array.isArray(set.events) ? set.events : [];
            set.startingLineup = Array.isArray(set.startingLineup)
                ? set.startingLineup
                : [null, null, null, null, null, null];
        }
    }

    if (!state.teams.some((t) => t.id === state.activeTeamId)) {
        state.activeTeamId = firstTeamId;
    }
    return state;
}

/* ------------------------------------------------------------------ store */

export class Store {
    /**
     * @param {Storage|null} storage a localStorage-compatible object, or null
     *   to run entirely in memory (used by tests)
     */
    constructor(storage = null) {
        this.storage = storage;
        this.listeners = new Set();
        this.state = this.load();
    }

    /* --------------------------------------------------------- persistence */

    load() {
        if (!this.storage) return emptyState();
        try {
            const raw = this.storage.getItem(STORAGE_KEY);
            if (!raw) return emptyState();
            return migrate(JSON.parse(raw));
        } catch (error) {
            console.error('Could not read saved data, starting fresh.', error);
            return emptyState();
        }
    }

    save() {
        if (!this.storage) return;
        try {
            this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (error) {
            console.error('Could not save data.', error);
        }
    }

    /* ------------------------------------------------------------ observers */

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Persist the current state and notify subscribers. */
    commit() {
        this.save();
        for (const listener of this.listeners) listener(this.state);
    }

    /**
     * Run a mutation, then persist and notify once.
     *
     * @param {(state: object) => any} mutator
     */
    update(mutator) {
        const result = mutator(this.state);
        this.commit();
        return result;
    }

    /* ----------------------------------------------------------- roster file */

    /**
     * Fold the shared roster file into local state.
     *
     * Accepts both shapes: the current one, with a flat `players` list whose
     * entries carry `teams` tags, and the older one that nested a roster inside
     * each team — an old file on a device that has updated must keep working.
     *
     * File-defined records replace their previous file-defined counterparts;
     * anything added on this device survives, as do in-app edits, which are
     * stored separately and re-applied here. Players dropped from the file are
     * archived rather than deleted so past matches still name them.
     *
     * @param {{teams: Array<object>, players?: Array<object>, updated?: string,
     *          version?: number}} file
     */
    applyRosterFile(file) {
        if (!file || !Array.isArray(file.teams)) return;

        this.update((state) => {
            state.rosterFile = {
                updated: file.updated ?? null,
                version: file.version ?? null,
                teamIds: file.teams.map((t) => String(t.id ?? '')).filter(Boolean),
            };

            /* ---- teams ---- */
            for (const incoming of file.teams) {
                const teamId = String(incoming.id ?? '').trim();
                if (!teamId || state.hiddenTeamIds.includes(teamId)) continue;

                const index = state.teams.findIndex((t) => t.id === teamId);
                const team = normaliseTeam(incoming);
                Object.assign(team, state.teamOverrides[teamId] ?? {});
                if (index === -1) state.teams.push(team);
                else state.teams[index] = { ...state.teams[index], ...team };
            }

            /* ---- players ---- */
            const fromFile = [];
            if (Array.isArray(file.players)) {
                for (const player of file.players) fromFile.push(normalisePlayer(player));
            } else {
                // Older file shape: a roster nested under each team.
                const byId = new Map();
                for (const team of file.teams) {
                    for (const player of team.players ?? []) {
                        const id = String(player.id ?? '');
                        const existing = byId.get(id);
                        if (existing) existing.teams = uniq([...existing.teams, team.id]);
                        else byId.set(id, normalisePlayer(player, { teams: [team.id] }));
                    }
                }
                fromFile.push(...byId.values());
            }

            // A removed team's tag must not come back with the file.
            for (const player of fromFile) {
                player.teams = player.teams.filter((t) => !state.hiddenTeamIds.includes(t));
            }

            const fileIds = new Set(fromFile.map((p) => p.id));
            for (const existing of state.players) {
                if (!existing.local && !fileIds.has(existing.id)) {
                    state.archivedPlayers[existing.id] = { ...existing };
                }
            }

            const localOnly = state.players.filter((p) => p.local && !fileIds.has(p.id));
            state.players = [...fromFile, ...localOnly];

            for (const player of state.players) {
                Object.assign(player, state.playerOverrides[player.id] ?? {});
            }
            state.players.sort(sortByNumber);

            // Keep the on-screen order matching the file, with locally added
            // teams after it, so a restored team returns to its own place.
            const order = state.rosterFile.teamIds;
            state.teams.sort((a, b) => {
                const left = order.indexOf(a.id);
                const right = order.indexOf(b.id);
                if (left === -1 && right === -1) return 0;
                if (left === -1) return 1;
                if (right === -1) return -1;
                return left - right;
            });

            if (!state.teams.some((t) => t.id === state.activeTeamId)) {
                state.activeTeamId = state.teams[0]?.id ?? null;
            }
        });
    }

    /* -------------------------------------------------------------- lookups */

    /** Team labels that can be picked. Removed ones are not in here. */
    get teams() {
        return this.state.teams;
    }

    /** The whole program's roster, regardless of team. */
    get players() {
        return this.state.players;
    }

    /**
     * Look up a team, falling back to one that was removed so an old match can
     * still show which team played it.
     */
    team(id) {
        return this.state.teams.find((t) => t.id === id) ?? this.state.archivedTeams[id] ?? null;
    }

    /** Whether a team's definition came from the shared roster file. */
    isFromRosterFile(teamId) {
        return (this.state.rosterFile?.teamIds ?? []).includes(teamId);
    }

    /** Teams removed here that the shared file would otherwise still provide. */
    get restorableTeamIds() {
        return this.state.hiddenTeamIds.filter((id) => this.isFromRosterFile(id));
    }

    /** Everyone tagged with a team — the pool a match of that team draws from. */
    playersForTeam(teamId) {
        return this.state.players.filter((p) => p.teams.includes(teamId));
    }

    /** Players carrying no team tag at all, so they cannot be picked yet. */
    get untaggedPlayers() {
        return this.state.players.filter((p) => p.teams.length === 0);
    }

    /**
     * The team in context: whichever team the open match belongs to, falling
     * back to the team last used.
     */
    get activeTeam() {
        const match = this.activeMatch;
        if (match) return this.team(match.teamId);
        return this.team(this.state.activeTeamId);
    }

    /** The pool the court and bench draw from for the team in context. */
    get roster() {
        const team = this.activeTeam;
        return team ? this.playersForTeam(team.id) : [];
    }

    /**
     * Look up a player anywhere — the roster first, then the archive, so
     * historical stats keep a name even after a roster change.
     */
    player(id) {
        return this.state.players.find((p) => p.id === id) ?? this.state.archivedPlayers[id];
    }

    get activeMatch() {
        return this.state.matches.find((m) => m.id === this.state.activeMatchId) ?? null;
    }

    get activeSet() {
        const match = this.activeMatch;
        if (!match) return null;
        return match.sets.find((s) => s.id === this.state.activeSetId) ?? null;
    }

    /** Every match belonging to one team, oldest first. */
    matchesFor(teamId) {
        return this.state.matches.filter((m) => m.teamId === teamId);
    }

    /** Derived live state (score, rotation, lineup) for the active set. */
    get liveState() {
        const set = this.activeSet;
        return set ? computeSetState(set) : null;
    }

    /* ----------------------------------------------------------------- teams */

    setActiveTeam(id) {
        this.update((state) => {
            state.activeTeamId = id;
        });
    }

    addTeam({ id, name, fullName = '' }) {
        return this.update((state) => {
            const team = normaliseTeam({ id: id ?? newId('t'), name, fullName }, { local: true });
            state.teams.push(team);
            // Re-adding under a previously removed id should stick.
            state.hiddenTeamIds = state.hiddenTeamIds.filter((h) => h !== team.id);
            delete state.archivedTeams[team.id];
            state.activeTeamId = team.id;
            return team;
        });
    }

    renameTeam(id, { name, fullName }) {
        this.update((state) => {
            const team = state.teams.find((t) => t.id === id);
            if (!team) return;
            const changes = {};
            if (name !== undefined) changes.name = String(name).trim() || team.name;
            if (fullName !== undefined) changes.fullName = String(fullName).trim() || changes.name || team.fullName;
            Object.assign(team, changes);
            // Survive the next roster.json refresh, which would otherwise
            // overwrite the name straight back.
            if (!team.local) {
                state.teamOverrides[id] = { ...(state.teamOverrides[id] ?? {}), ...changes };
            }
        });
    }

    /**
     * Remove a team.
     *
     * This drops a label, nothing more: every player stays on the roster minus
     * that one tag, and every match played by the team is kept with its stats
     * intact. The team is archived so those matches can still show whose they
     * were, and the id is remembered so a roster.json refresh cannot recreate
     * a team someone deliberately removed.
     *
     * @returns {{playersUntagged: number, matchesKept: number}}
     */
    deleteTeam(id) {
        return this.update((state) => {
            const team = state.teams.find((t) => t.id === id);
            if (!team) return { playersUntagged: 0, matchesKept: 0 };

            state.archivedTeams[id] = { id: team.id, name: team.name, fullName: team.fullName };

            let playersUntagged = 0;
            for (const player of state.players) {
                if (!player.teams.includes(id)) continue;
                player.teams = player.teams.filter((t) => t !== id);
                playersUntagged += 1;
                if (!player.local) {
                    const override = state.playerOverrides[player.id] ?? {};
                    state.playerOverrides[player.id] = { ...override, teams: player.teams.slice() };
                }
            }

            state.teams = state.teams.filter((t) => t.id !== id);
            if (!state.hiddenTeamIds.includes(id)) state.hiddenTeamIds.push(id);

            // The matches survive, but the court has no pool to draw from, so
            // close the one on screen rather than showing an unusable lineup.
            const matchesKept = state.matches.filter((m) => m.teamId === id).length;
            if (this.activeMatch?.teamId === id) {
                state.activeMatchId = null;
                state.activeSetId = null;
            }
            if (state.activeTeamId === id) state.activeTeamId = state.teams[0]?.id ?? null;

            return { playersUntagged, matchesKept };
        });
    }

    /**
     * Let a hidden team come back from roster.json. It reappears the next time
     * the file loads, which needs a connection.
     */
    restoreTeam(id) {
        this.update((state) => {
            state.hiddenTeamIds = state.hiddenTeamIds.filter((h) => h !== id);
            // Drop the stored tag removals so the file can re-tag people.
            for (const override of Object.values(state.playerOverrides)) {
                if (Array.isArray(override.teams)) delete override.teams;
            }
        });
    }

    /* --------------------------------------------------------------- players */

    addPlayer({ number, name, position = '', teams = [] }) {
        return this.update((state) => {
            const player = normalisePlayer({ id: newId('p'), number, name, position, teams }, { local: true });
            state.players.push(player);
            state.players.sort(sortByNumber);
            return player;
        });
    }

    /**
     * Edit a player. Edits to a player defined in roster.json are also recorded
     * as an override so a later refresh of the file does not undo them.
     */
    updatePlayer(id, changes) {
        this.update((state) => {
            const player = state.players.find((p) => p.id === id);
            if (!player) return;
            if (changes.teams) changes = { ...changes, teams: uniq(changes.teams.map(String)) };
            Object.assign(player, changes);
            if (!player.local) {
                state.playerOverrides[id] = { ...(state.playerOverrides[id] ?? {}), ...changes };
            }
            state.players.sort(sortByNumber);
        });
    }

    /** Add or remove one team tag. */
    togglePlayerTeam(id, teamId) {
        const player = this.player(id);
        if (!player) return;
        const teams = player.teams.includes(teamId)
            ? player.teams.filter((t) => t !== teamId)
            : [...player.teams, teamId];
        this.updatePlayer(id, { teams });
    }

    /**
     * Remove a player from the roster entirely. Historical events keep their
     * player id and the player is archived, so past stats stay attributable.
     *
     * To take somebody off one team without losing them, drop the tag instead.
     */
    deletePlayer(id) {
        this.update((state) => {
            const player = state.players.find((p) => p.id === id);
            if (player) state.archivedPlayers[id] = { ...player };
            state.players = state.players.filter((p) => p.id !== id);
        });
    }

    /* --------------------------------------------------------------- matches */

    createMatch({ teamId, opponent, date = todayIso(), venue = '', format = DEFAULT_FORMAT }) {
        return this.update((state) => {
            const match = {
                id: newId('m'),
                teamId: teamId ?? state.activeTeamId,
                opponent: String(opponent ?? '').trim() || 'Opponent',
                date,
                venue: String(venue ?? '').trim(),
                format,
                complete: false,
                sets: [],
            };
            state.matches.push(match);
            state.activeMatchId = match.id;
            state.activeSetId = null;
            if (match.teamId) state.activeTeamId = match.teamId;
            return match;
        });
    }

    updateMatch(id, changes) {
        this.update((state) => {
            const match = state.matches.find((m) => m.id === id);
            if (match) Object.assign(match, changes);
        });
    }

    deleteMatch(id) {
        this.update((state) => {
            state.matches = state.matches.filter((m) => m.id !== id);
            if (state.activeMatchId === id) {
                state.activeMatchId = null;
                state.activeSetId = null;
            }
        });
    }

    setActiveMatch(id) {
        this.update((state) => {
            state.activeMatchId = id;
            const match = state.matches.find((m) => m.id === id);
            state.activeSetId = match?.sets.at(-1)?.id ?? null;
            if (match?.teamId) state.activeTeamId = match.teamId;
        });
    }

    /**
     * Set the match format (best of 3 or 5). Only meaningful before any set has
     * been played, because it decides which set is played to 15.
     */
    setMatchFormat(id, format) {
        this.update((state) => {
            const match = state.matches.find((m) => m.id === id);
            if (match) match.format = format;
        });
    }

    /** Close a match out. Sets already recorded are untouched. */
    endMatch(id = this.state.activeMatchId) {
        this.update((state) => {
            const match = state.matches.find((m) => m.id === id);
            if (!match) return;
            match.complete = true;
            state.activeSetId = null;
        });
    }

    /** Undo an end-match, e.g. a tournament match that turned out to continue. */
    reopenMatch(id = this.state.activeMatchId) {
        this.update((state) => {
            const match = state.matches.find((m) => m.id === id);
            if (match) match.complete = false;
        });
    }

    /* ------------------------------------------------------------------ sets */

    /**
     * Start a new set in the active match.
     *
     * @param {{startingServer: 'us'|'them', startingRotation: number,
     *          startingLineup: Array<string|null>, format?: number}} config
     */
    startSet(config) {
        return this.update((state) => {
            const match = state.matches.find((m) => m.id === state.activeMatchId);
            if (!match) return null;
            if (config.format) match.format = config.format;
            const number = match.sets.length + 1;
            const set = {
                id: newId('s'),
                number,
                startingServer: config.startingServer ?? 'us',
                startingRotation: config.startingRotation ?? 1,
                startingLineup: (config.startingLineup ?? []).slice(0, 6),
                // The deciding set is played to 15, so the target follows the format.
                target: config.target ?? targetForSet(number, match.format ?? DEFAULT_FORMAT),
                events: [],
                complete: false,
            };
            match.sets.push(set);
            state.activeSetId = set.id;
            return set;
        });
    }

    setActiveSet(id) {
        this.update((state) => {
            state.activeSetId = id;
        });
    }

    deleteSet(id) {
        this.update((state) => {
            const match = state.matches.find((m) => m.id === state.activeMatchId);
            if (!match) return;
            match.sets = match.sets.filter((s) => s.id !== id);
            // Renumbering can change which set is the decider, so targets follow.
            match.sets.forEach((set, index) => {
                set.number = index + 1;
                set.target = targetForSet(set.number, match.format ?? DEFAULT_FORMAT);
            });
            if (state.activeSetId === id) state.activeSetId = match.sets.at(-1)?.id ?? null;
        });
    }

    markSetComplete(id, complete = true) {
        this.update((state) => {
            const match = state.matches.find((m) => m.id === state.activeMatchId);
            const set = match?.sets.find((s) => s.id === id);
            if (set) set.complete = complete;
        });
    }

    /* ---------------------------------------------------------------- events */

    /** Record a player stat in the active set. */
    recordStat(playerId, code) {
        return this.pushEvent({ type: 'stat', playerId, code });
    }

    /** Record a rally outcome that no player stat covers. */
    recordTeamEvent(code) {
        return this.pushEvent({ type: 'team', code });
    }

    /** Record a substitution in the active set. */
    recordSub(outId, inId) {
        return this.pushEvent({ type: 'sub', outId, inId });
    }

    pushEvent(event) {
        return this.update((state) => {
            const match = state.matches.find((m) => m.id === state.activeMatchId);
            const set = match?.sets.find((s) => s.id === state.activeSetId);
            if (!set) return null;
            const stored = { id: newId('e'), ts: Date.now(), ...event };
            set.events.push(stored);
            return stored;
        });
    }

    /** Remove the most recent event from the active set. */
    undo() {
        return this.update((state) => {
            const match = state.matches.find((m) => m.id === state.activeMatchId);
            const set = match?.sets.find((s) => s.id === state.activeSetId);
            if (!set || set.events.length === 0) return null;
            return set.events.pop();
        });
    }

    /**
     * Correct an entry already in the log — typically the wrong player was
     * credited during a rally that carried on. Because the score and rotations
     * are replayed from the event list, everything after the corrected entry is
     * recalculated automatically.
     *
     * @param {string} eventId
     * @param {{playerId?: string, code?: string}} changes
     * @returns {object|null} the updated event
     */
    updateEvent(eventId, changes) {
        return this.update((state) => {
            const match = state.matches.find((m) => m.id === state.activeMatchId);
            const set = match?.sets.find((s) => s.id === state.activeSetId);
            const event = set?.events.find((e) => e.id === eventId);
            if (!event) return null;
            Object.assign(event, changes);
            event.editedAt = Date.now();
            return event;
        });
    }

    /** Remove one event by id, from anywhere in the active set. */
    deleteEvent(eventId) {
        this.update((state) => {
            const match = state.matches.find((m) => m.id === state.activeMatchId);
            const set = match?.sets.find((s) => s.id === state.activeSetId);
            if (!set) return;
            set.events = set.events.filter((e) => e.id !== eventId);
        });
    }

    /* ---------------------------------------------------------- import/export */

    exportJson() {
        return JSON.stringify(this.state, null, 2);
    }

    /**
     * A backup containing one match and only what is needed to read it.
     *
     * This is what a coach sends after their game: small enough to message, and
     * it merges into the season keeper's device exactly like a full backup,
     * because it is one — just a narrower slice.
     *
     * @param {string} matchId
     * @returns {string|null}
     */
    exportMatchJson(matchId) {
        const match = this.state.matches.find((m) => m.id === matchId);
        if (!match) return null;

        // Everyone the match refers to, whether or not they are still rostered.
        const involved = new Set();
        for (const set of match.sets ?? []) {
            for (const id of set.startingLineup ?? []) if (id) involved.add(id);
            for (const event of set.events ?? []) {
                for (const id of [event.playerId, event.inId, event.outId]) if (id) involved.add(id);
            }
        }

        const payload = {
            ...emptyState(),
            season: this.state.season,
            teams: this.state.teams.filter((t) => t.id === match.teamId),
            players: this.state.players.filter((p) => involved.has(p.id)),
            archivedPlayers: Object.fromEntries(
                Object.entries(this.state.archivedPlayers).filter(([id]) => involved.has(id)),
            ),
            archivedTeams: Object.fromEntries(
                Object.entries(this.state.archivedTeams).filter(([id]) => id === match.teamId),
            ),
            matches: [match],
        };
        return JSON.stringify(payload, null, 2);
    }

    /**
     * A filename that says what the file is without opening it, and that sorts
     * by date when a season's worth land in one folder.
     */
    matchFileName(matchId) {
        const match = this.state.matches.find((m) => m.id === matchId);
        if (!match) return 'volleyball-match.json';
        const slug = (value) =>
            String(value ?? '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
        const team = slug(this.team(match.teamId)?.name) || 'team';
        return `vbstats-${match.date}-${team}-vs-${slug(match.opponent) || 'opponent'}.json`;
    }

    /**
     * Replace everything with the contents of a backup file.
     *
     * @see mergeJson for combining another device's matches into this one.
     */
    importJson(text) {
        const parsed = JSON.parse(text);
        this.state = migrate(parsed);
        this.commit();
    }

    /**
     * Fold another device's backup into this one: their matches are added,
     * yours are kept, and anything already present (same match id) is left
     * alone. This is what makes the "one scorer per match, combine afterwards"
     * workflow possible.
     *
     * @returns {{added: number, skipped: number}}
     */
    mergeJson(text) {
        const incoming = migrate(JSON.parse(text));
        return this.update((state) => {
            const known = new Set(state.matches.map((m) => m.id));
            let added = 0;
            let skipped = 0;

            for (const match of incoming.matches) {
                if (known.has(match.id)) {
                    skipped += 1;
                    continue;
                }
                state.matches.push(match);
                known.add(match.id);
                added += 1;
            }

            // Keep names resolvable for anything we do not carry locally.
            for (const player of incoming.players) {
                if (!this.player(player.id)) state.archivedPlayers[player.id] = { ...player };
            }
            for (const team of incoming.teams) {
                if (!this.team(team.id)) state.archivedTeams[team.id] = { ...team };
            }
            Object.assign(state.archivedPlayers, incoming.archivedPlayers ?? {});
            Object.assign(state.archivedTeams, incoming.archivedTeams ?? {});

            state.matches.sort((a, b) => String(a.date).localeCompare(String(b.date)));
            return { added, skipped };
        });
    }

    reset() {
        this.state = emptyState();
        this.commit();
    }
}
