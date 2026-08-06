/** Point-by-point log for the active set, plus match and set navigation. */

import { computeSetState, describeEvent } from '../model.js';
import { el, mount, toast, confirmDialog } from './dom.js';

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
    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: `vs ${match.opponent}` }),
            el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Switch',
                onClick: actions.pickMatch,
            }),
        ]),
        el('p.panel__hint', { text: [match.date, match.venue].filter(Boolean).join(' · ') }),
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
    ]);
}

function setPanel(store, match) {
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
            el('button.seg.seg--add', {
                type: 'button',
                text: '+ New set',
                onClick: () => store.setActiveSet(null),
            }),
        ]),
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
                              el('span.log__text', { text: describeEvent(entry.event, lookup) }),
                              el('span.log__rot', { text: `R${entry.rotationAtEvent}` }),
                              el('button.log__del', {
                                  type: 'button',
                                  'aria-label': 'Delete entry',
                                  text: '✕',
                                  onClick: async () => {
                                      const confirmed = await confirmDialog({
                                          title: 'Delete this entry?',
                                          message:
                                              'The score and rotations after it will be recalculated from the remaining entries.',
                                          confirmLabel: 'Delete',
                                          danger: true,
                                      });
                                      if (confirmed) {
                                          store.deleteEvent(entry.event.id);
                                          toast('Entry deleted', 'warn');
                                      }
                                  },
                              }),
                          ]),
                      ),
              ),
    ]);
}
