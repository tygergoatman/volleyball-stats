/** Application shell: tab routing, match lifecycle actions, and bootstrap. */

import { Store, todayIso } from './store.js';
import { matchScore } from './model.js';
import { renderCourt, resetCourtInteraction } from './ui/court.js';
import { renderRoster } from './ui/roster.js';
import { renderStats } from './ui/statsview.js';
import { renderLog } from './ui/log.js';
import { el, mount, $, openSheet, closeSheet, toast, confirmDialog } from './ui/dom.js';

const store = new Store(window.localStorage);

const TABS = [
    { key: 'court', label: 'Court', icon: '🏐' },
    { key: 'stats', label: 'Stats', icon: '📊' },
    { key: 'log', label: 'Log', icon: '📋' },
    { key: 'roster', label: 'Roster', icon: '👥' },
];

let activeTab = 'court';

/* ---------------------------------------------------------------- actions */

const actions = {
    newMatch() {
        const draft = {
            teamId: store.state.activeTeamId ?? store.teams[0]?.id ?? null,
            opponent: '',
            date: todayIso(),
            venue: '',
        };

        // Which team is playing decides which roster the whole match uses, so
        // it is asked first and cannot be changed once sets have been captured.
        const teamRow = el(
            'div.segmented.segmented--wrap',
            {},
            store.teams.map((team) =>
                el('button.seg', {
                    type: 'button',
                    class: draft.teamId === team.id ? 'seg--on' : '',
                    text: team.name,
                    title: team.fullName,
                    onClick: (event) => {
                        draft.teamId = team.id;
                        for (const sibling of teamRow.children) sibling.classList.remove('seg--on');
                        event.currentTarget.classList.add('seg--on');
                    },
                }),
            ),
        );

        const body = el('div.form', {}, [
            el('div.field', {}, [
                el('span.field__label', { text: 'Team' }),
                store.teams.length
                    ? teamRow
                    : el('p.panel__hint', { text: 'No teams yet — add one on the Roster tab.' }),
            ]),
            el('label.field', {}, [
                el('span.field__label', { text: 'Opponent' }),
                el('input.input', {
                    type: 'text',
                    placeholder: 'Opponent name',
                    onInput: (event) => {
                        draft.opponent = event.target.value;
                    },
                }),
            ]),
            el('div.form__row', {}, [
                el('label.field.field--grow', {}, [
                    el('span.field__label', { text: 'Date' }),
                    el('input.input', {
                        type: 'date',
                        value: draft.date,
                        onInput: (event) => {
                            draft.date = event.target.value;
                        },
                    }),
                ]),
                el('label.field.field--grow', {}, [
                    el('span.field__label', { text: 'Venue' }),
                    el('input.input', {
                        type: 'text',
                        placeholder: 'Gym',
                        onInput: (event) => {
                            draft.venue = event.target.value;
                        },
                    }),
                ]),
            ]),
            el('div.form__actions', {}, [
                el('button.btn.btn--primary', {
                    type: 'button',
                    text: 'Create Match',
                    onClick: () => {
                        if (!draft.teamId) {
                            toast('Pick a team first', 'warn');
                            return;
                        }
                        store.createMatch(draft);
                        closeSheet();
                        activeTab = 'court';
                        render();
                    },
                }),
            ]),
        ]);
        openSheet({ title: 'New match', body });
    },

    pickMatch() {
        const matches = store.state.matches.slice().reverse();
        const body = el('div.picker', {}, [
            ...matches.map((match) =>
                el(
                    'button.picker__row',
                    {
                        type: 'button',
                        class: match.id === store.state.activeMatchId ? 'picker__row--used' : '',
                        onClick: () => {
                            store.setActiveMatch(match.id);
                            closeSheet();
                            render();
                        },
                    },
                    [
                        el('span.picker__num.picker__num--team', {
                            text: store.team(match.teamId)?.name ?? '—',
                        }),
                        el('span.picker__name', { text: `vs ${match.opponent}` }),
                        el('span.picker__pos', { text: match.date }),
                        el('span.picker__flag', {
                            text: `${match.sets.length} set${match.sets.length === 1 ? '' : 's'}`,
                        }),
                    ],
                ),
            ),
            el('button.btn.btn--primary', {
                type: 'button',
                text: '+ New match',
                onClick: () => {
                    closeSheet();
                    actions.newMatch();
                },
            }),
        ]);
        openSheet({ title: 'Matches', subtitle: store.state.season.name, body });
    },

    startSet(draft) {
        store.startSet({
            startingServer: draft.startingServer,
            startingRotation: draft.startingRotation,
            startingLineup: draft.lineup,
            format: draft.format,
        });
        resetCourtInteraction();
        toast('Set started — good luck');
    },

    async endSet(setId) {
        store.markSetComplete(setId, true);
        store.setActiveSet(null);
        resetCourtInteraction();

        // Closing that set may have settled the match; offer to finish here
        // rather than leaving the coach on a "start set 4 of 3" screen.
        const match = store.activeMatch;
        const score = matchScore(match);
        if (!score.decided) return;

        const confirmed = await confirmDialog({
            title: score.winner === 'us' ? 'Match won' : 'Match lost',
            message: `Sets ${score.us}–${score.them} in a ${score.format.label.toLowerCase()}. End the match now?`,
            confirmLabel: 'End Match',
        });
        if (confirmed) store.endMatch(match.id);
    },

    async endMatch() {
        const match = store.activeMatch;
        if (!match) return;
        const score = matchScore(match);
        const confirmed = await confirmDialog({
            title: 'End this match?',
            message: `Final sets ${score.us}–${score.them}. Stats are kept, and you can reopen the match afterwards if you need to.`,
            confirmLabel: 'End Match',
        });
        if (confirmed) {
            store.endMatch(match.id);
            toast('Match ended');
        }
    },

    async cancelMatch() {
        const confirmed = await confirmDialog({
            title: 'Cancel this match?',
            message: 'The match will be deleted. No stats have been recorded yet.',
            confirmLabel: 'Delete match',
            danger: true,
        });
        if (confirmed) store.deleteMatch(store.state.activeMatchId);
    },
};

/* ----------------------------------------------------------------- render */

function render() {
    renderHeader();
    renderTabs();

    const view = $('#view');
    if (activeTab === 'court') renderCourt(view, store, actions);
    else if (activeTab === 'stats') renderStats(view, store);
    else if (activeTab === 'log') renderLog(view, store, actions);
    else renderRoster(view, store);

    view.dataset.tab = activeTab;
}

function renderHeader() {
    const match = store.activeMatch;
    const team = store.activeTeam;
    mount(
        $('#header'),
        el('div.header__line', {}, [
            el('span.header__team', { text: team?.name ?? 'Volleyball Stats' }),
            match && el('span.header__vs', { text: 'vs' }),
            match && el('span.header__opp', { text: match.opponent }),
            !match && el('span.header__opp', { text: store.state.season.name }),
        ]),
        el('button.header__menu', {
            type: 'button',
            'aria-label': 'Matches',
            text: '☰',
            onClick: actions.pickMatch,
        }),
    );
}

function renderTabs() {
    mount(
        $('#tabs'),
        TABS.map((tab) =>
            el(
                'button.tab',
                {
                    type: 'button',
                    class: activeTab === tab.key ? 'tab--on' : '',
                    onClick: () => {
                        activeTab = tab.key;
                        resetCourtInteraction();
                        render();
                    },
                },
                [el('span.tab__icon', { text: tab.icon }), el('span.tab__label', { text: tab.label })],
            ),
        ),
    );
}

store.subscribe(render);

/* -------------------------------------------------------------- wake lock */

/**
 * Keep the screen awake while the app is in the foreground — a phone that
 * sleeps between rallies is unusable for live capture. Chrome on Android
 * releases the lock when the tab is hidden, so it is re-acquired on return.
 */
let wakeLock = null;

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
            wakeLock = null;
        });
    } catch {
        // Denied (low battery, permissions policy) — capture still works fine.
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
});

/* ----------------------------------------------------------- shared roster */

/**
 * Pull the program's shared rosters from the file published alongside the app.
 *
 * This is what keeps every coach's device on the same player list: edit
 * roster.json once on GitHub and each app picks it up the next time it loads
 * with a connection. A failure here is not fatal — the last-known rosters are
 * already in local storage, which is exactly what matters in a gym with no
 * signal.
 */
async function loadSharedRoster() {
    try {
        // Bypass the cache so an updated file is seen on the next load rather
        // than whenever the service worker happens to refresh.
        const response = await fetch('./roster.json', { cache: 'no-cache' });
        if (!response.ok) throw new Error(`roster.json responded ${response.status}`);
        store.applyRosterFile(await response.json());
    } catch (error) {
        console.warn('Using the rosters already on this device.', error);
    }
}

/* ------------------------------------------------------------------ boot */

render();
requestWakeLock();
loadSharedRoster();

if ('serviceWorker' in navigator) {
    // When a new worker takes over, the page in front of the user was built
    // from the previous one. Reload once so what is on screen matches what is
    // now installed, instead of asking anyone to close and reopen the app.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
    });

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('./sw.js');

            // Look for a new version on launch and whenever the app comes back
            // to the foreground, which is when a coach would notice.
            registration.update().catch(() => {});
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') registration.update().catch(() => {});
            });
        } catch (error) {
            console.warn('Offline mode unavailable:', error);
        }
    });
}

// Exposed for debugging from the browser console.
window.vb = { store, actions };
