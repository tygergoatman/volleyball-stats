/** The capture view: scoreboard, court map, bench, and the stat entry sheet. */

import {
    COURT_GRID,
    FRONT_ROW,
    POSITION_LABELS,
    STAT_GROUPS,
    STAT_BY_CODE,
    TEAM_EVENTS,
    describeEvent,
    positionOf,
    setWinner,
} from '../model.js';
import { el, mount, openSheet, closeSheet, toast, buzz, confirmDialog } from './dom.js';

/** Player currently selected for a substitution, if any. */
let pendingSubId = null;

export function renderCourt(root, store, actions) {
    const match = store.activeMatch;
    if (!match) return mount(root, noMatchPanel(store, actions));

    const set = store.activeSet;
    if (!set) return mount(root, setupSetPanel(store, actions));

    const live = store.liveState;
    mount(
        root,
        scoreboard(store, live, set),
        courtMap(store, live),
        benchStrip(store, live),
        recentStrip(store, live),
        actionBar(store, live, set, actions),
    );
    return root;
}

/* ------------------------------------------------------------- empty states */

function noMatchPanel(store, actions) {
    return el('div.panel.panel--center', {}, [
        el('h2.panel__title', { text: 'No match in progress' }),
        el('p.panel__hint', {
            text:
                store.roster.length === 0
                    ? 'Add your players on the Roster tab first, then start a match.'
                    : 'Start a match to begin capturing stats.',
        }),
        el('button.btn.btn--primary.btn--lg', {
            type: 'button',
            text: 'New Match',
            disabled: store.roster.length === 0,
            onClick: actions.newMatch,
        }),
        store.state.matches.length > 0 &&
            el('button.btn.btn--ghost', {
                type: 'button',
                text: 'Open a past match',
                onClick: actions.pickMatch,
            }),
    ]);
}

/**
 * Lineup builder shown between sets. Slots are laid out exactly like the court
 * so what you tap is where the player stands.
 */
function setupSetPanel(store, actions) {
    const match = store.activeMatch;
    const previous = match.sets.at(-1);
    const draft = {
        startingServer: previous ? (previous.startingServer === 'us' ? 'them' : 'us') : 'us',
        startingRotation: 1,
        lineup: [null, null, null, null, null, null],
    };

    const container = el('div.panel');

    const rerender = () => mount(container, ...build());

    function build() {
        const chosen = new Set(draft.lineup.filter(Boolean));
        const ready = draft.lineup.every(Boolean);

        return [
            el('h2.panel__title', { text: `Set ${match.sets.length + 1} lineup` }),
            el('p.panel__hint', {
                text: 'Tap a spot on the court and pick the player who starts there.',
            }),

            el('div.field', {}, [
                el('span.field__label', { text: 'First serve' }),
                el('div.segmented', {}, [
                    toggleButton('Us', draft.startingServer === 'us', () => {
                        draft.startingServer = 'us';
                        rerender();
                    }),
                    toggleButton('Them', draft.startingServer === 'them', () => {
                        draft.startingServer = 'them';
                        rerender();
                    }),
                ]),
            ]),

            el('div.field', {}, [
                el('span.field__label', { text: 'Starting rotation' }),
                el(
                    'div.segmented',
                    {},
                    [1, 2, 3, 4, 5, 6].map((n) =>
                        toggleButton(String(n), draft.startingRotation === n, () => {
                            draft.startingRotation = n;
                            rerender();
                        }),
                    ),
                ),
            ]),

            el('div.court.court--setup', {}, [
                el('div.court__net', { text: 'NET' }),
                el(
                    'div.court__grid',
                    {},
                    COURT_GRID.map((position) => {
                        const playerId = draft.lineup[position - 1];
                        const player = playerId ? store.player(playerId) : null;
                        return el(
                            'button.slot',
                            {
                                type: 'button',
                                class: player ? 'slot--filled' : 'slot--empty',
                                onClick: () =>
                                    pickPlayerForSlot(store, position, chosen, (id) => {
                                        draft.lineup[position - 1] = id;
                                        rerender();
                                    }),
                            },
                            [
                                el('span.slot__pos', { text: `${position} ${POSITION_LABELS[position]}` }),
                                player
                                    ? el('span.slot__num', { text: `#${player.number}` })
                                    : el('span.slot__plus', { text: '+' }),
                                player && el('span.slot__name', { text: player.name }),
                            ],
                        );
                    }),
                ),
            ]),

            previous &&
                el('button.btn.btn--ghost', {
                    type: 'button',
                    text: 'Use previous set’s lineup',
                    onClick: () => {
                        draft.lineup = previous.startingLineup.slice();
                        rerender();
                    },
                }),

            el('button.btn.btn--primary.btn--lg', {
                type: 'button',
                text: ready ? 'Start Set' : 'Fill all six spots',
                disabled: !ready,
                onClick: () => actions.startSet(draft),
            }),

            match.sets.length === 0 &&
                el('button.btn.btn--ghost', {
                    type: 'button',
                    text: 'Cancel match',
                    onClick: actions.cancelMatch,
                }),
        ];
    }

    rerender();
    return container;
}

function pickPlayerForSlot(store, position, chosen, onPick) {
    const body = el(
        'div.picker',
        {},
        store.roster.map((player) =>
            el(
                'button.picker__row',
                {
                    type: 'button',
                    class: chosen.has(player.id) ? 'picker__row--used' : '',
                    onClick: () => {
                        onPick(player.id);
                        closeSheet();
                    },
                },
                [
                    el('span.picker__num', { text: `#${player.number}` }),
                    el('span.picker__name', { text: player.name }),
                    player.position && el('span.picker__pos', { text: player.position }),
                    chosen.has(player.id) && el('span.picker__flag', { text: 'on court' }),
                ],
            ),
        ),
    );
    openSheet({
        title: `Position ${position} — ${POSITION_LABELS[position]}`,
        subtitle: 'Choose the player who starts here',
        body,
    });
}

function toggleButton(label, active, onClick) {
    return el('button.seg', {
        type: 'button',
        class: active ? 'seg--on' : '',
        text: label,
        onClick,
    });
}

/* ------------------------------------------------------------- scoreboard */

function scoreboard(store, live, set) {
    const match = store.activeMatch;
    const winner = setWinner(live.us, live.them, set.target ?? 25);

    return el('section.scoreboard', {}, [
        el('div.score.score--us', { class: live.serving === 'us' ? 'score--serving' : '' }, [
            el('span.score__label', { text: store.state.team.name }),
            el('span.score__value', { text: String(live.us) }),
        ]),
        el('div.scoreboard__mid', {}, [
            el('span.scoreboard__set', { text: `Set ${set.number}` }),
            el('span.scoreboard__rot', { text: `Rot ${live.rotation}` }),
            el('span.scoreboard__serve', {
                class: live.serving === 'us' ? 'is-us' : 'is-them',
                text: live.serving === 'us' ? '● serving' : 'serving ●',
            }),
            winner &&
                el('span.scoreboard__won', {
                    class: winner === 'us' ? 'is-us' : 'is-them',
                    text: winner === 'us' ? 'Set point won' : 'Set lost',
                }),
        ]),
        el('div.score.score--them', { class: live.serving === 'them' ? 'score--serving' : '' }, [
            el('span.score__label', { text: match.opponent }),
            el('span.score__value', { text: String(live.them) }),
        ]),
    ]);
}

/* -------------------------------------------------------------- court map */

function courtMap(store, live) {
    return el('section.court', {}, [
        el('div.court__net', { text: 'NET' }),
        el(
            'div.court__grid',
            {},
            COURT_GRID.map((position) => bubble(store, live, position)),
        ),
        pendingSubId &&
            el('div.court__hint', {
                text: `Tap the player coming off for #${store.player(pendingSubId)?.number ?? ''}`,
            }),
    ]);
}

function bubble(store, live, position) {
    const playerId = live.lineup[position - 1];
    const player = playerId ? store.player(playerId) : null;
    const isServer = position === 1 && live.serving === 'us';
    const isFront = FRONT_ROW.includes(position);

    const classes = ['bubble'];
    classes.push(isFront ? 'bubble--front' : 'bubble--back');
    if (isServer) classes.push('bubble--server');
    if (pendingSubId) classes.push('bubble--subtarget');
    if (!player) classes.push('bubble--empty');

    return el(
        'button',
        {
            type: 'button',
            class: classes.join(' '),
            disabled: !player,
            onClick: () => {
                if (!player) return;
                if (pendingSubId) {
                    const incoming = pendingSubId;
                    pendingSubId = null;
                    store.recordSub(player.id, incoming);
                    buzz();
                    toast(`#${store.player(incoming)?.number} in for #${player.number}`, 'ok');
                    return;
                }
                openStatSheet(store, player, live);
            },
        },
        [
            el('span.bubble__pos', { text: String(position) }),
            isServer && el('span.bubble__serve', { text: '🏐', title: 'Serving' }),
            el('span.bubble__num', { text: player ? `#${player.number}` : '—' }),
            el('span.bubble__name', { text: player ? player.name : 'empty' }),
            player?.isSetter && el('span.bubble__tag', { text: 'S' }),
        ],
    );
}

/* ------------------------------------------------------------------ bench */

function benchStrip(store, live) {
    const onCourt = new Set(live.lineup.filter(Boolean));
    const bench = store.roster.filter((player) => !onCourt.has(player.id));

    if (bench.length === 0) {
        return el('section.bench', {}, [el('span.bench__empty', { text: 'No bench players' })]);
    }

    return el('section.bench', {}, [
        el('span.bench__label', { text: 'Bench' }),
        el(
            'div.bench__scroll',
            {},
            bench.map((player) =>
                el(
                    'button.chip',
                    {
                        type: 'button',
                        class: pendingSubId === player.id ? 'chip--armed' : '',
                        onClick: () => {
                            pendingSubId = pendingSubId === player.id ? null : player.id;
                            buzz();
                            store.commit();
                        },
                    },
                    [el('span.chip__num', { text: `#${player.number}` }), el('span.chip__name', { text: player.name })],
                ),
            ),
        ),
        pendingSubId &&
            el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Cancel sub',
                onClick: () => {
                    pendingSubId = null;
                    store.commit();
                },
            }),
    ]);
}

/* ----------------------------------------------------------- recent plays */

/**
 * The last few entries, so a mistap can be spotted without leaving the court.
 * Newest first — the same order the Log tab uses.
 */
function recentStrip(store, live) {
    const recent = live.timeline.slice(-4).reverse();
    if (recent.length === 0) {
        return el('section.recent', {}, [el('p.recent__empty', { text: 'Tap a player to record their first stat.' })]);
    }

    return el(
        'section.recent',
        {},
        recent.map((entry) =>
            el('div.recent__row', { class: entry.winner ? `recent__row--${entry.winner}` : '' }, [
                el('span.recent__score', {
                    text: entry.winner ? `${entry.scoreAfter.us}–${entry.scoreAfter.them}` : '·',
                }),
                el('span.recent__text', { text: describeEvent(entry.event, (id) => store.player(id)) }),
            ]),
        ),
    );
}

/* ------------------------------------------------------------- action bar */

function actionBar(store, live, set, actions) {
    return el('section.actions', {}, [
        el(
            'div.actions__row',
            {},
            TEAM_EVENTS.map((event) =>
                el(
                    'button.btn.btn--team',
                    {
                        type: 'button',
                        class: event.point === 'us' ? 'btn--us' : 'btn--them',
                        onClick: () => {
                            store.recordTeamEvent(event.code);
                            buzz();
                            toast(event.name, event.point);
                        },
                    },
                    [
                        el('span', { text: event.point === 'us' ? '+1 Us' : '+1 Them' }),
                        el('span.btn__caption', {
                            text: event.point === 'us' ? 'opp error' : 'opp point',
                        }),
                    ],
                ),
            ),
        ),
        el('div.actions__row', {}, [
            el('button.btn.btn--ghost', {
                type: 'button',
                text: '↶ Undo',
                disabled: set.events.length === 0,
                onClick: () => {
                    const removed = store.undo();
                    if (removed) {
                        buzz();
                        toast('Undone', 'warn');
                    }
                },
            }),
            el('button.btn.btn--ghost', {
                type: 'button',
                text: 'End Set',
                onClick: async () => {
                    const confirmed = await confirmDialog({
                        title: `End set ${set.number}?`,
                        message: `Final score ${live.us}–${live.them}. You can still start another set afterwards.`,
                        confirmLabel: 'End Set',
                    });
                    if (confirmed) actions.endSet(set.id);
                },
            }),
        ]),
    ]);
}

/* -------------------------------------------------------------- stat sheet */

function openStatSheet(store, player, live) {
    const position = positionOf(live.lineup, player.id);
    const body = el(
        'div.statsheet',
        {},
        STAT_GROUPS.map((group) =>
            el('div.statgroup', { class: `statgroup--${group.accent}` }, [
                el('span.statgroup__label', { text: group.label }),
                el(
                    'div.statgroup__buttons',
                    {},
                    group.options.map((option) =>
                        el('button.statbtn', {
                            type: 'button',
                            class: toneClass(option),
                            text: option.label,
                            title: option.name,
                            onClick: () => {
                                store.recordStat(player.id, option.code);
                                buzz(option.point ? [10, 30, 10] : 12);
                                closeSheet();
                                const scored = STAT_BY_CODE.get(option.code)?.point;
                                toast(`#${player.number} ${player.name} — ${option.name}`, scored ?? 'ok');
                            },
                        }),
                    ),
                ),
            ]),
        ),
    );

    openSheet({
        title: `#${player.number} ${player.name}`,
        subtitle: position
            ? `Position ${position} · ${POSITION_LABELS[position]}${player.position ? ` · ${player.position}` : ''}`
            : player.position,
        body,
    });
}

/** Colour a stat button by its effect on the scoreboard. */
function toneClass(option) {
    if (option.point === 'us') return 'statbtn--good';
    if (option.point === 'them') return 'statbtn--bad';
    return 'statbtn--neutral';
}

/** Clear any half-finished substitution, e.g. when leaving the capture tab. */
export function resetCourtInteraction() {
    pendingSubId = null;
}
