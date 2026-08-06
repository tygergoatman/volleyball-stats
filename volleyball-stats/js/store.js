/**
 * Application state: a single observable object persisted to localStorage.
 *
 * Every mutation goes through an action on the store so that saving and
 * re-rendering happen in exactly one place.
 */

import { SCHEMA_VERSION, computeSetState } from './model.js';

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

/* ----------------------------------------------------------- initial state */

export function emptyState() {
    return {
        version: SCHEMA_VERSION,
        team: { name: 'My Team' },
        season: { name: `${new Date().getFullYear()} Season` },
        roster: [],
        matches: [],
        activeMatchId: null,
        activeSetId: null,
    };
}

/**
 * Bring a persisted blob up to the current shape. Kept deliberately tolerant:
 * a stat app that loses a season to a schema change is worse than useless.
 */
function migrate(raw) {
    const state = { ...emptyState(), ...raw };
    state.version = SCHEMA_VERSION;
    state.team = { ...emptyState().team, ...(raw.team ?? {}) };
    state.season = { ...emptyState().season, ...(raw.season ?? {}) };
    state.roster = Array.isArray(raw.roster) ? raw.roster : [];
    state.matches = Array.isArray(raw.matches) ? raw.matches : [];
    for (const match of state.matches) {
        match.sets = Array.isArray(match.sets) ? match.sets : [];
        for (const set of match.sets) {
            set.events = Array.isArray(set.events) ? set.events : [];
            set.startingLineup = Array.isArray(set.startingLineup)
                ? set.startingLineup
                : [null, null, null, null, null, null];
        }
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

    /* -------------------------------------------------------------- lookups */

    get roster() {
        return this.state.roster;
    }

    player(id) {
        return this.state.roster.find((p) => p.id === id);
    }

    get activeMatch() {
        return this.state.matches.find((m) => m.id === this.state.activeMatchId) ?? null;
    }

    get activeSet() {
        const match = this.activeMatch;
        if (!match) return null;
        return match.sets.find((s) => s.id === this.state.activeSetId) ?? null;
    }

    /** Derived live state (score, rotation, lineup) for the active set. */
    get liveState() {
        const set = this.activeSet;
        return set ? computeSetState(set) : null;
    }

    /* --------------------------------------------------------------- roster */

    addPlayer({ number, name, position = '', isSetter = false, isLibero = false }) {
        return this.update((state) => {
            const player = {
                id: newId('p'),
                number: String(number ?? '').trim(),
                name: String(name ?? '').trim(),
                position,
                isSetter,
                isLibero,
                active: true,
            };
            state.roster.push(player);
            state.roster.sort(sortByNumber);
            return player;
        });
    }

    updatePlayer(id, changes) {
        this.update((state) => {
            const player = state.roster.find((p) => p.id === id);
            if (!player) return;
            Object.assign(player, changes);
            state.roster.sort(sortByNumber);
        });
    }

    /**
     * Remove a player from the roster. Historical events keep their player id,
     * so past stats stay attributable even after a removal.
     */
    removePlayer(id) {
        this.update((state) => {
            state.roster = state.roster.filter((p) => p.id !== id);
        });
    }

    /* --------------------------------------------------------------- matches */

    createMatch({ opponent, date = todayIso(), venue = '' }) {
        return this.update((state) => {
            const match = {
                id: newId('m'),
                opponent: String(opponent ?? '').trim() || 'Opponent',
                date,
                venue: String(venue ?? '').trim(),
                sets: [],
            };
            state.matches.push(match);
            state.activeMatchId = match.id;
            state.activeSetId = null;
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
            const set = {
                id: newId('s'),
                number: match.sets.length + 1,
                startingServer: config.startingServer ?? 'us',
                startingRotation: config.startingRotation ?? 1,
                startingLineup: (config.startingLineup ?? []).slice(0, 6),
                liberoId: config.liberoId ?? null,
                target: config.target ?? 25,
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
            match.sets.forEach((set, index) => {
                set.number = index + 1;
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

    importJson(text) {
        const parsed = JSON.parse(text);
        this.state = migrate(parsed);
        this.commit();
    }

    reset() {
        this.state = emptyState();
        this.commit();
    }
}

function sortByNumber(a, b) {
    const left = Number.parseInt(a.number, 10);
    const right = Number.parseInt(b.number, 10);
    if (Number.isNaN(left) && Number.isNaN(right)) return a.name.localeCompare(b.name);
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left - right;
}
