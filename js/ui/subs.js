/**
 * The subs tab: a libero tracking sheet laid out like the paper one.
 *
 * Six serving-order rows, each showing who started there and everyone who has
 * been on since, plus the set's substitution counter. This is where every
 * replacement is made — the court map is read-only for subs, because they only
 * ever happen at a stoppage and doing them here keeps one record rather than
 * two ways of writing it.
 */

import { SERVING_ORDER, liberoSheet } from '../libero.js';
import { playerLabel } from '../model.js';
import { el, mount, openSheet, closeSheet, toast, buzz } from './dom.js';

export function renderSubs(root, store, actions) {
    const set = store.activeSet;
    if (!set) {
        return mount(
            root,
            el('section.panel.panel--center', {}, [
                el('p.panel__hint', {
                    text: store.activeMatch
                        ? 'Start a set on the Court tab to begin tracking subs.'
                        : 'No match selected.',
                }),
                !store.activeMatch &&
                    store.state.matches.length > 0 &&
                    el('button.btn.btn--ghost', {
                        type: 'button',
                        text: 'Open a past match',
                        onClick: actions.pickMatch,
                    }),
            ]),
        );
    }

    const sheet = liberoSheet(set, { liberoIds: store.liberoIds });
    mount(root, countPanel(store, set, sheet), rowsPanel(store, sheet));
    return root;
}

/* ------------------------------------------------------------- sub counter */

function countPanel(store, set, sheet) {
    const liberos = store.liberoIds.map((id) => store.player(id)).filter(Boolean);

    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: `Set ${set.number} · Subs` }),
            el('span.panel__count', {
                class: sheet.subsLeft === 0 ? 'is-bad' : '',
                text: `${sheet.subsUsed} of ${sheet.subLimit}`,
            }),
        ]),

        // The row of numbers off the paper sheet: cross one off per substitution.
        el(
            'div.subcount',
            {},
            Array.from({ length: sheet.subLimit }, (_, index) =>
                el('span.subcount__n', {
                    class: index < sheet.subsUsed ? 'subcount__n--used' : '',
                    text: String(index + 1),
                }),
            ),
        ),

        el('p.panel__hint', {
            text:
                sheet.subsLeft === 0
                    ? 'No substitutions left this set. Libero replacements are still unlimited.'
                    : `${sheet.subsLeft} substitution${sheet.subsLeft === 1 ? '' : 's'} left. Libero replacements do not count.`,
        }),

        liberos.length === 0
            ? el('p.panel__hint.panel__hint--warn', {
                  text: 'No libero on the roster. Tag a player with position L to track libero replacements separately from substitutions.',
              })
            : el('p.panel__hint', {
                  text: `Libero: ${liberos.map((player) => playerLabel(player)).join(', ')}`,
              }),

        sheet.liberoServeRow !== null &&
            el('p.panel__hint', {
                text: `▲ Libero serves in order ${SERVING_ORDER[sheet.liberoServeRow]} — set the first time they served, and the only rotation they may serve in.`,
            }),

        ...sheet.warnings.map((warning) => el('p.panel__hint.panel__hint--warn', { text: `⚠ ${warning}` })),
    ]);
}

/* ------------------------------------------------------------------- rows */

function rowsPanel(store, sheet) {
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Serving order' }),
        el('p.panel__hint', { text: 'Tap a row to send the libero on or off, or to substitute.' }),
        el(
            'ul.lts',
            {},
            sheet.rows.map((row) => ltsRow(store, sheet, row)),
        ),
    ]);
}

function ltsRow(store, sheet, row) {
    const current = store.player(row.currentPlayerId);
    const manyLiberos = store.liberoIds.length > 1;

    return el('li.lts__row', { class: row.hasLibero ? 'lts__row--libero' : '' }, [
        el('button.lts__main', { type: 'button', onClick: () => openRowSheet(store, sheet, row) }, [
            el('span.lts__order', {
                class: [row.serving ? 'lts__order--serving' : '', row.liberoServes ? 'lts__order--liberoserve' : '']
                    .filter(Boolean)
                    .join(' '),
                text: row.order,
                title: row.liberoServes ? 'The libero serves in this rotation' : '',
            }),
            el('span.lts__serves', {
                text: row.serves > 0 ? '|'.repeat(Math.min(row.serves, 6)) : '',
                title: `${row.serves} term${row.serves === 1 ? '' : 's'} of service`,
            }),
            el('span.lts__pos', { text: `P${row.courtPosition}` }),
            el(
                'span.lts__entries',
                {},
                row.entries.length === 0
                    ? [el('span.lts__empty', { text: '—' })]
                    : row.entries.map((entry) =>
                          el('span.lts__mark', {
                              class: entry.left ? 'lts__mark--left' : 'lts__mark--on',
                              text: entry.libero
                                  ? manyLiberos
                                      ? `L${store.player(entry.playerId)?.number ?? ''}`
                                      : 'L'
                                  : (store.player(entry.playerId)?.number ?? '?'),
                          }),
                      ),
            ),
            current && el('span.lts__who', { text: current.name || '' }),
        ]),
    ]);
}

/* ---------------------------------------------------------- row action sheet */

function openRowSheet(store, sheet, row) {
    const current = store.player(row.currentPlayerId);
    const returning = store.player(row.previousPlayerId);
    const liberos = store.liberoIds.map((id) => store.player(id)).filter(Boolean);
    const onCourt = new Set(sheet.rows.map((r) => r.currentPlayerId).filter(Boolean));

    const body = el('div.form');
    const done = (message) => {
        buzz();
        closeSheet();
        toast(message);
    };

    const parts = [];

    if (!current) {
        parts.push(el('p.panel__hint', { text: 'Nobody is in this position — set the lineup on the Court tab.' }));
    } else if (row.hasLibero) {
        // The libero is on. The only legal exit is the player they replaced.
        parts.push(
            el('p.panel__hint', {
                text: `Libero ${playerLabel(current)} is on for ${playerLabel(returning)}.`,
            }),
            returning &&
                el('button.btn.btn--primary', {
                    type: 'button',
                    text: `Libero out — ${playerLabel(returning)} back on`,
                    onClick: () => {
                        store.recordSub(current.id, returning.id, 'libero');
                        done(`${playerLabel(returning)} back on`);
                    },
                }),
            el('p.panel__hint', {
                text: 'A libero replacement is unlimited and does not count against the 15.',
            }),
        );
    } else if (sheet.liberosOnCourt.length > 0) {
        // Two liberos may be designated, but only one is ever on court.
        const on = store.player(sheet.liberosOnCourt[0]);
        parts.push(
            el('p.panel__hint', {
                text: `Libero ${playerLabel(on)} is already on court. Take them off before sending the other on.`,
            }),
        );
    } else {
        for (const libero of liberos) {
            parts.push(
                el('button.btn.btn--primary', {
                    type: 'button',
                    text: `Libero ${playerLabel(libero)} in for ${playerLabel(current)}`,
                    onClick: () => {
                        store.recordSub(current.id, libero.id, 'libero');
                        done(`Libero in for ${playerLabel(current)}`);
                    },
                }),
            );
        }
    }

    // A substitution is available regardless, including for the libero's slot.
    const reserved = new Set(sheet.awaitingLiberoReturn);
    const bench = store.roster.filter(
        (player) => !onCourt.has(player.id) && !reserved.has(player.id) && !store.liberoIds.includes(player.id),
    );

    parts.push(
        el('div.field', {}, [
            el('span.field__label', {
                text: sheet.subsLeft === 0 ? 'Substitute (none left this set)' : 'Substitute',
            }),
            sheet.subsLeft === 0 &&
                el('p.panel__hint.panel__hint--warn', {
                    text: 'All 15 are used. Recorded anyway if you go ahead — the sheet shows what happened, it does not referee.',
                }),
            bench.length === 0
                ? el('p.panel__hint', { text: 'Nobody on the bench.' })
                : el(
                      'div.chipgrid',
                      {},
                      bench.map((player) =>
                          el(
                              'button.chip',
                              {
                                  type: 'button',
                                  onClick: () => {
                                      if (!current) return;
                                      store.recordSub(current.id, player.id, 'sub');
                                      done(`${playerLabel(player)} in for ${playerLabel(current)}`);
                                  },
                              },
                              [
                                  el('span.chip__num', { text: `#${player.number}` }),
                                  player.name && el('span.chip__name', { text: player.name }),
                              ],
                          ),
                      ),
                  ),
        ]),
        el('div.form__actions', {}, [
            el('button.btn.btn--ghost', { type: 'button', text: 'Close', onClick: closeSheet }),
        ]),
    );

    mount(body, ...parts.filter(Boolean));
    openSheet({
        title: `Order ${row.order} · ${current ? playerLabel(current) : 'empty'}`,
        subtitle: `Position ${row.courtPosition}${row.serving ? ' · serving' : ''} · started ${playerLabel(store.player(row.startingPlayerId))}`,
        body,
    });
}
