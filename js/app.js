/** Application shell: tab routing, match lifecycle actions, and bootstrap. */

import { Store, todayIso } from './store.js';
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
        const draft = { opponent: '', date: todayIso(), venue: '' };
        const body = el('div.form', {}, [
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
        });
        resetCourtInteraction();
        toast('Set started — good luck');
    },

    endSet(setId) {
        store.markSetComplete(setId, true);
        store.setActiveSet(null);
        resetCourtInteraction();
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
    mount(
        $('#header'),
        el('div.header__line', {}, [
            el('span.header__team', { text: store.state.team.name }),
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

/* ------------------------------------------------------------------ boot */

render();
requestWakeLock();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((error) => {
            console.warn('Offline mode unavailable:', error);
        });
    });
}

// Exposed for debugging from the browser console.
window.vb = { store, actions };
