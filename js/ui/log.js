/** Point-by-point log for the active set, plus match and set navigation. */

import { STAT_GROUPS, TEAM_EVENTS, computeSetState, describeEvent, matchScore } from '../model.js';
import { el, mount, openSheet, closeSheet, toast, confirmDialog, shareFile } from './dom.js';

export function renderLog(root, store, actions) {
    const match = store.activeMatch;
    if (!match) {
        return mount(
            root,
            el('div.panel.panel--center', {}, [
                el('p.panel__hint', { text: 'No match selected.' }),
                store.state.matches.length > 0 &&
                    el('button.btn.btn--ghost', {
                        type: 'button',
                        text: 'Open a past match',
                        onClick: actions.pickMatch,
                    }),
            ]),
        );
    }

    mount(root, matchPanel(store, match, actions), setPanel(store, match), eventPanel(store));
    return root;
}

function matchPanel(store, match, actions) {
    const score = matchScore(match);

    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: `vs ${match.opponent}` }),
            el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Switch',
                onClick: actions.pickMatch,
            }),
        ]),
        el('p.panel__hint', {
            text: [match.date, match.venue, score.format.label, match.complete ? 'ended' : null]
                .filter(Boolean)
                .join(' · '),
        }),
        el(
            'div.setline',
            {},
            match.sets.map((set) => {
                const { us, them } = computeSetState(set);
                return el('span.setline__score', {
                    class: us > them ? 'is-won' : them > us ? 'is-lost' : '',
                    text: `S${set.number} ${us}–${them}`,
                });
            }),
        ),
        el('p.panel__hint', { text: `Sets ${score.us}–${score.them}` }),

        // The post-game action: send this one match on, without the rest of the
        // season riding along.
        el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Share this match',
            onClick: async () => {
                const payload = store.exportMatchJson(match.id);
                if (!payload) {
                    toast('Nothing to share', 'warn');
                    return;
                }
                const result = await shareFile(store.matchFileName(match.id), payload, {
                    title: `${match.date} · ${store.team(match.teamId)?.name ?? ''} vs ${match.opponent}`.trim(),
                });
                if (result === 'shared') toast('Shared');
                else if (result === 'downloaded') toast('Downloaded — sharing is not available here');
            },
        }),
        el('p.panel__hint', {
            text: 'Sends just this match, small enough to message. Whoever keeps season totals merges it in from the Roster tab.',
        }),

        el('button.btn.btn--danger.btn--sm', {
            type: 'button',
            text: 'Delete Match',
            onClick: async () => {
                const entries = match.sets.reduce((total, set) => total + (set.events?.length ?? 0), 0);
                const confirmed = await confirmDialog({
                    title: `Delete the match vs ${match.opponent}?`,
                    message: `${match.date} · ${match.sets.length} set${
                        match.sets.length === 1 ? '' : 's'
                    }, ${entries} recorded ${entries === 1 ? 'entry' : 'entries'}. This cannot be undone — export a backup first if you might want it.`,
                    confirmLabel: 'Delete Match',
                    danger: true,
                });
                if (confirmed) {
                    store.deleteMatch(match.id);
                    toast('Match deleted', 'warn');
                }
            },
        }),
    ]);
}

function setPanel(store, match) {
    const active = store.activeSet;

    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Sets' }),
        el('div.segmented.segmented--wrap', {}, [
            ...match.sets.map((set) =>
                el('button.seg', {
                    type: 'button',
                    class: store.state.activeSetId === set.id ? 'seg--on' : '',
                    text: `Set ${set.number}`,
                    onClick: () => store.setActiveSet(set.id),
                }),
            ),
            !match.complete &&
                el('button.seg.seg--add', {
                    type: 'button',
                    text: '+ New set',
                    onClick: () => store.setActiveSet(null),
                }),
        ]),
        active &&
            el('button.btn.btn--danger.btn--sm', {
                type: 'button',
                text: `Delete Set ${active.number}`,
                onClick: async () => {
                    const { us, them } = computeSetState(active);
                    const confirmed = await confirmDialog({
                        title: `Delete set ${active.number}?`,
                        message: `Every stat recorded in this set (${us}–${them}) is deleted for good. Later sets are renumbered.`,
                        confirmLabel: 'Delete Set',
                        danger: true,
                    });
                    if (confirmed) {
                        store.deleteSet(active.id);
                        toast('Set deleted', 'warn');
                    }
                },
            }),
    ]);
}

function eventPanel(store) {
    const set = store.activeSet;
    if (!set) {
        return el('section.panel', {}, [
            el('p.panel__hint', { text: 'Start a set on the Court tab to begin logging.' }),
        ]);
    }

    const { timeline } = computeSetState(set);
    const lookup = (id) => store.player(id);

    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: `Set ${set.number} log` }),
            el('span.panel__count', { text: `${timeline.length} entries` }),
        ]),
        el('p.panel__hint', { text: 'Tap an entry to correct who it was credited to, or what it was.' }),
        timeline.length === 0
            ? el('p.panel__hint', { text: 'Nothing recorded yet.' })
            : el(
                  'ul.log',
                  {},
                  timeline
                      .slice()
                      .reverse()
                      .map((entry) =>
                          el('li.log__row', { class: entry.winner ? `log__row--${entry.winner}` : '' }, [
                              el('span.log__score', {
                                  text: entry.winner ? `${entry.scoreAfter.us}–${entry.scoreAfter.them}` : '·',
                              }),
                              el('button.log__text', {
                                  type: 'button',
                                  text: describeEvent(entry.event, lookup),
                                  onClick: () => openEntrySheet(store, entry, set),
                              }),
                              entry.event.editedAt &&
                                  el('span.log__edited', { text: 'edited', title: 'Corrected later' }),
                              el('span.log__rot', { text: `R${entry.rotationAtEvent}` }),
                          ]),
                      ),
              ),
    ]);
}

/* ------------------------------------------------------------ entry editor */

/**
 * Correct one log entry. Both pickers apply immediately and the sheet stays
 * open, because the common case — the wrong player was credited during a rally
 * that carried on — often comes with a second correction right behind it.
 */
function openEntrySheet(store, entry, set) {
    const event = entry.event;

    const body = el('div.form');
    const rerender = () => {
        const current = store.activeSet?.events.find((e) => e.id === event.id);
        if (!current) {
            closeSheet();
            return;
        }
        mount(body, ...build(current));
    };

    function build(current) {
        const parts = [];

        if (current.type === 'stat') {
            parts.push(
                el('div.field', {}, [
                    el('span.field__label', { text: 'Credited to' }),
                    el(
                        'div.chipgrid',
                        {},
                        playerChoices(store, set).map((player) =>
                            el(
                                'button.chip',
                                {
                                    type: 'button',
                                    class: player.id === current.playerId ? 'chip--armed' : '',
                                    onClick: () => {
                                        store.updateEvent(current.id, { playerId: player.id });
                                        toast(`Credited to #${player.number} ${player.name}`);
                                        rerender();
                                    },
                                },
                                [
                                    el('span.chip__num', { text: `#${player.number}` }),
                                    el('span.chip__name', { text: player.name }),
                                ],
                            ),
                        ),
                    ),
                ]),
                el('div.field', {}, [
                    el('span.field__label', { text: 'Stat' }),
                    el(
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
                                            class: `${toneClass(option)}${
                                                option.code === current.code ? ' statbtn--on' : ''
                                            }`,
                                            text: option.label,
                                            title: option.name,
                                            onClick: () => {
                                                store.updateEvent(current.id, { code: option.code });
                                                toast(option.name);
                                                rerender();
                                            },
                                        }),
                                    ),
                                ),
                            ]),
                        ),
                    ),
                ]),
            );
        } else if (current.type === 'team') {
            parts.push(
                el('div.field', {}, [
                    el('span.field__label', { text: 'Outcome' }),
                    el(
                        'div.segmented',
                        {},
                        TEAM_EVENTS.map((option) =>
                            el('button.seg', {
                                type: 'button',
                                class: option.code === current.code ? 'seg--on' : '',
                                text: option.name,
                                onClick: () => {
                                    store.updateEvent(current.id, { code: option.code });
                                    toast(option.name);
                                    rerender();
                                },
                            }),
                        ),
                    ),
                ]),
            );
        } else {
            parts.push(
                el('p.panel__hint', {
                    text: 'Substitutions cannot be edited in place — delete this one and record it again from the court.',
                }),
            );
        }

        parts.push(
            el('div.form__actions', {}, [
                el('button.btn.btn--danger.btn--sm', {
                    type: 'button',
                    text: 'Delete entry',
                    onClick: async () => {
                        const confirmed = await confirmDialog({
                            title: 'Delete this entry?',
                            message: 'The score and rotations after it are recalculated from what is left.',
                            confirmLabel: 'Delete',
                            danger: true,
                        });
                        if (confirmed) {
                            store.deleteEvent(current.id);
                            closeSheet();
                            toast('Entry deleted', 'warn');
                        }
                    },
                }),
                el('button.btn.btn--primary', { type: 'button', text: 'Done', onClick: closeSheet }),
            ]),
        );

        return parts;
    }

    rerender();
    openSheet({
        title: 'Correct entry',
        subtitle: entry.winner
            ? `Was ${entry.scoreAfter.us}–${entry.scoreAfter.them} · rotation ${entry.rotationAtEvent}`
            : `Rally continued · rotation ${entry.rotationAtEvent}`,
        body,
    });
}

/**
 * Everyone who could plausibly be credited: the six on court when the entry was
 * recorded, plus the rest of the roster, since the whole point of editing is
 * that the wrong person was tapped.
 */
function playerChoices(store, set) {
    const onCourt = new Set(computeSetState(set).lineup.filter(Boolean));
    const roster = store.roster;
    return [...roster.filter((p) => onCourt.has(p.id)), ...roster.filter((p) => !onCourt.has(p.id))];
}

function toneClass(option) {
    if (option.point === 'us') return 'statbtn--good';
    if (option.point === 'them') return 'statbtn--bad';
    return 'statbtn--neutral';
}
