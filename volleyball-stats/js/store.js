/**
 * Application state: a single observable object persisted to localStorage.
 *
 * Every mutation goes through an action on the store so that saving and
 * re-rendering happen in exactly one place.
 *
 * The program carries several teams (MS / JV / Varsity), each with its own
 * roster. Rosters normally come from the bundled `roster.json`, which is the
 * shared source of truth across every coach's device; anything added on the
 * device itself is kept alongside and never overwritten by a file refresh.
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

/** Normalise one player record from any source. */
function normalisePlayer(raw, { local = false } = {}) {
    return {
        id: String(raw.id ?? newId('p')),
        number: String(raw.number ?? '').trim(),
        name: String(raw.name ?? '').trim(),
        position: raw.position ?? '',
        isSetter: Boolean(raw.isSetter),
        isLibero: Boolean(raw.isLibero),
        local,
    };
}

/* ----------------------------------------------------------- initial state */

export function emptyState() {
    return {
        version: SCHEMA_VERSION,
        season: { name: `${new Date().getFullYear()} Season` },
        teams: [],
        /** Edits made in the app to players defined in roster.json. */
        playerOverrides: {},
        /** Players dropped from roster.json, kept so old stats still resolve. */
        archivedPlayers: {},
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
    state.archivedPlayers = raw.archivedPlayers ?? {};
    state.matches = Array.isArray(raw.matches) ? raw.matches : [];
    state.teams = Array.isArray(raw.teams) ? raw.teams : [];

    // v1 carried a single flat roster and a team name. Fold it into one team so
    // that a season captured before multi-team support is not stranded.
    if (state.teams.length === 0 && Array.isArray(raw.roster)) {
        const name = raw.team?.name?.trim() || 'My Team';
        state.teams = [
            {
                id: 'legacy',
                name,
                fullName: name,
                players: raw.roster.map((p) => normalisePlayer(p, { local: true })),
            },
        ];
    }
    delete state.roster;
    delete state.team;

    for (const team of state.teams) {
        team.id = String(team.id ?? newId('t'));
        team.name = String(team.name ?? team.id);
        team.fullName = team.fullName ?? team.name;
        team.players = Array.isArray(team.players)
            ? team.players.map((p) => normalisePlayer(p, { local: Boolean(p.local) }))
            : [];
        team.players.sort(sortByNumber);
    }

    const firstTeamId = state.teams[0]?.id ?? null;
    for (const match of state.matches) {
        match.teamId = match.teamId ?? firstTeamId;
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
     * File-defined players replace their previous file-defined counterparts;
     * players added on this device survive untouched, as do in-app edits, which
     * are stored separately and re-applied here. Anyone dropped from the file is
     * archived rather than deleted so past matches still name them.
     *
     * @param {{teams: Array<object>, updated?: string, version?: number}} file
     */
    applyRosterFile(file) {
        if (!file || !Array.isArray(file.teams)) return;

        this.update((state) => {
            state.rosterFile = { updated: file.updated ?? null, version: file.version ?? null };

            for (const incoming of file.teams) {
                const teamId = String(incoming.id ?? '').trim();
                if (!teamId) continue;

                let team = state.teams.find((t) => t.id === teamId);
                if (!team) {
                    team = { id: teamId, name: teamId, fullName: teamId, players: [] };
                    state.teams.push(team);
                }
                team.name = String(incoming.name ?? team.name);
                team.fullName = String(incoming.fullName ?? incoming.name ?? team.fullName);

                const fromFile = (incoming.players ?? []).map((p) => normalisePlayer(p));
                const fileIds = new Set(fromFile.map((p) => p.id));

                // Anyone previously supplied by the file but now absent is archived.
                for (const existing of team.players) {
                    if (!existing.local && !fileIds.has(existing.id)) {
                        state.archivedPlayers[existing.id] = { ...existing, teamId: team.id };
                    }
                }

                const localOnly = team.players.filter((p) => p.local && !fileIds.has(p.id));
                team.players = [...fromFile, ...localOnly];

                // Re-apply any edits made on this device.
                for (const player of team.players) {
                    const override = state.playerOverrides[player.id];
                    if (override) Object.assign(player, override);
                }
                team.players.sort(sortByNumber);
            }

            if (!state.teams.some((t) => t.id === state.activeTeamId)) {
                state.activeTeamId = state.teams[0]?.id ?? null;
            }
        });
    }

    /* -------------------------------------------------------------- lookups */

    get teams() {
        return this.state.teams;
    }

    team(id) {
        return this.state.teams.find((t) => t.id === id) ?? null;
    }

    /**
     * The team in context: whichever team the open match belongs to, falling
     * back to the team selected on the Roster tab.
     */
    get activeTeam() {
        const match = this.activeMatch;
        if (match) return this.team(match.teamId);
        return this.team(this.state.activeTeamId);
    }

    /** Roster of the team in context. */
    get roster() {
        return this.activeTeam?.players ?? [];
    }

    rosterFor(teamId) {
        return this.team(teamId)?.players ?? [];
    }

    /**
     * Look up a player anywhere — current rosters first, then the archive, so
     * historical stats keep a name even after a roster change.
     */
    player(id) {
        for (const team of this.state.teams) {
            const found = team.players.find((p) => p.id === id);
            if (found) return found;
        }
        return this.state.archivedPlayers[id];
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
            const team = {
                id: String(id ?? newId('t')),
                name: String(name ?? '').trim() || 'Team',
                fullName: String(fullName || name || '').trim(),
                players: [],
            };
            state.teams.push(team);
            state.activeTeamId = team.id;
            return team;
        });
    }

    /* --------------------------------------------------------------- roster */

    addPlayer(teamId, { number, name, position = '', isSetter = false, isLibero = false }) {
        return this.update((state) => {
            const team = state.teams.find((t) => t.id === teamId);
            if (!team) return null;
            const player = normalisePlayer(
                { id: newId('p'), number, name, position, isSetter, isLibero },
                { local: true },
            );
            team.players.push(player);
            team.players.sort(sortByNumber);
            return player;
        });
    }

    /**
     * Edit a player. Edits to a player defined in roster.json are also recorded
     * as an override so a later refresh of the file does not undo them.
     */
    updatePlayer(teamId, id, changes) {
        this.update((state) => {
            const team = state.teams.find((t) => t.id === teamId);
            const player = team?.players.find((p) => p.id === id);
            if (!player) return;
            Object.assign(player, changes);
            if (!player.local) {
                state.playerOverrides[id] = { ...(state.playerOverrides[id] ?? {}), ...changes };
            }
            team.players.sort(sortByNumber);
        });
    }

    /**
     * Remove a player from a roster. Historical events keep their player id, and
     * the player is archived, so past stats stay attributable.
     */
    removePlayer(teamId, id) {
        this.update((state) => {
            const team = state.teams.find((t) => t.id === teamId);
            if (!team) return;
            const player = team.players.find((p) => p.id === id);
            if (player) state.archivedPlayers[id] = { ...player, teamId };
            team.players = team.players.filter((p) => p.id !== id);
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
     *          startingLineup: Array<string|null>, liberoId?: string|null}} config
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
                liberoId: config.liberoId ?? null,
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

            // Keep names resolvable for any player we do not carry locally.
            for (const team of incoming.teams) {
                for (const player of team.players) {
                    if (!this.player(player.id)) {
                        state.archivedPlayers[player.id] = { ...player, teamId: team.id };
                    }
                }
            }
            Object.assign(state.archivedPlayers, incoming.archivedPlayers ?? {});

            state.matches.sort((a, b) => String(a.date).localeCompare(String(b.date)));
            return { added, skipped };
        });
    }

    reset() {
        this.state = emptyState();
        this.commit();
    }
}
