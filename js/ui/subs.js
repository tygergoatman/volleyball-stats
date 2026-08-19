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
import { POSITION_LABELS, isLibero, playerLabel } from '../model.js';
import { plannedSubCost } from '../plan.js';
import { el, mount, openSheet, closeSheet, toast, buzz } from './dom.js';

/**
 * Which team the plan panel is showing while no match is open. Session-only:
 * it is a viewing choice, not a fact about the season.
 */
let planTeamId = null;

/** The team the plan panel edits: the match's if one is open, else the pick. */
function planTeam(store) {
    if (store.activeMatch) return store.activeTeam;
    return store.team(planTeamId) ?? store.activeTeam ?? store.teams[0] ?? null;
}

export function renderSubs(root, store, actions) {
    const set = store.activeSet;
    if (!set) {
        // The plan still shows: it is written *before* a match, so gating it
        // behind a live set would put it out of reach exactly when it is needed.
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
            planPanel(store),
        );
    }

    const sheet = liberoSheet(set, { liberoIds: store.liberoIds });
    mount(root, countPanel(store, set, sheet), planPanel(store), rowsPanel(store, sheet));
    return root;
}

/* -------------------------------------------------------------- game plan */

/**
 * The planned substitutions, written the way the coach writes them on paper:
 * `L > 19`, `8 > 4`, `4 > 8` — read as **in > out**.
 *
 * Returns are ordinary rows rather than something the app infers. Guessing when
 * a player should come back means prompting at the wrong moment, which is worse
 * than not prompting at all.
 */
function planPanel(store) {
    const team = planTeam(store);
    if (!team) return null;

    // The team in context is the one picked on the Roster tab, which for a coach
    // with one team is simply theirs — so this opens on the right plan without
    // being told. The picker stays for the weeks somebody runs two, and only
    // while no match is open: once one is running the team is settled by the
    // match, and offering a different one here would just be a way to edit the
    // wrong plan.
    const locked = Boolean(store.activeMatch);
    const teams = store.teams;

    const plan = store.planFor(team.id);
    const cost = plannedSubCost(plan);
    const rows = [];

    if (plan.libero) {
        rows.push(
            planRow(store, {
                lead: 'L',
                inId: plan.libero.liberoId,
                outId: plan.libero.replacesId,
                note: 'whenever they rotate back',
                onRemove: () => {
                    store.setLiberoPlan(null, team.id);
                    toast('Libero plan cleared');
                },
            }),
        );
    }

    for (const row of plan.subs) {
        rows.push(
            planRow(store, {
                lead: `Rot ${row.rotation}`,
                inId: row.inId,
                outId: row.outId,
                onRemove: () => {
                    store.removePlanSub(row.id, team.id);
                    toast('Planned sub removed');
                },
            }),
        );
    }

    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: locked ? `Plan · ${team.name}` : 'Plan' }),
            el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: '+ Add',
                onClick: () => openPlanSheet(store, team),
            }),
        ]),
        !locked &&
            teams.length > 1 &&
            el(
                'div.segmented',
                {},
                teams.map((option) =>
                    el('button.seg', {
                        type: 'button',
                        class: option.id === team.id ? 'seg--on' : '',
                        text: option.name,
                        title: option.fullName,
                        onClick: () => {
                            planTeamId = option.id;
                            store.commit();
                        },
                    }),
                ),
            ),
        rows.length === 0
            ? el('p.panel__hint', {
                  text: 'Nothing planned. Add the swaps you already know — the libero pairing, and any sub keyed to a rotation — and the Court tab will prompt you when each one comes up.',
              })
            : el('ul.planlist', {}, rows),
        rows.length > 0 &&
            el('p.panel__hint', {
                text:
                    cost === 0
                        ? 'Libero replacements are unlimited and cost nothing against the 15.'
                        : `${cost} of the 15 substitutions per set, if every row is taken. Libero replacements cost nothing.`,
            }),
    ]);
}

function planRow(store, { lead, inId, outId, note, onRemove }) {
    const arriving = store.player(inId);
    const leaving = store.player(outId);
    // A plan outlives roster changes, so a row can end up pointing at somebody
    // who has left. Say so rather than dropping it silently — the coach is the
    // one who decides whether it should go.
    const stale = !arriving || !leaving;

    return el('li.planlist__row', { class: stale ? 'planlist__row--stale' : '' }, [
        el('span.planlist__lead', { text: lead }),
        el('span.planlist__swap', {
            text: `${arriving ? playerLabel(arriving) : '—'} > ${leaving ? playerLabel(leaving) : '—'}`,
        }),
        note && !stale && el('span.planlist__note', { text: note }),
        stale && el('span.tag.tag--warn', { text: 'not on the roster' }),
        el('button.planlist__remove', { type: 'button', 'aria-label': 'Remove', text: '✕', onClick: onRemove }),
    ]);
}

function openPlanSheet(store, team) {
    // The team's own players, not `store.roster` — with no match open those are
    // two different teams, and picking from the wrong one builds a plan whose
    // rows can never fire.
    const roster = store.playersForTeam(team.id);
    const liberos = roster.filter(isLibero);
    const draft = { kind: liberos.length > 0 ? 'libero' : 'sub', rotation: 1, inId: '', outId: '' };

    const body = el('div.form', {}, []);

    const rebuild = () => {
        const isLiberoPlan = draft.kind === 'libero';
        const inPool = isLiberoPlan ? liberos : roster;

        mount(
            body,
            el('div.field', {}, [
                el('span.field__label', { text: 'What kind' }),
                el('div.segmented', {}, [
                    el('button.seg', {
                        type: 'button',
                        class: isLiberoPlan ? 'seg--on' : '',
                        text: 'Libero',
                        disabled: liberos.length === 0,
                        onClick: () => {
                            draft.kind = 'libero';
                            draft.inId = '';
                            rebuild();
                        },
                    }),
                    el('button.seg', {
                        type: 'button',
                        class: !isLiberoPlan ? 'seg--on' : '',
                        text: 'Sub at a rotation',
                        onClick: () => {
                            draft.kind = 'sub';
                            rebuild();
                        },
                    }),
                ]),
                el('p.panel__hint', {
                    text: isLiberoPlan
                        ? 'A standing pairing — no rotation needed. The prompt appears whenever the player she replaces rotates to the back row, and again when she has to come off.'
                        : 'Prompted as you rotate into this number, which is when the ball is dead and the sub is legal.',
                }),
            ]),
            !isLiberoPlan &&
                el('div.field', {}, [
                    el('span.field__label', { text: 'Rotation' }),
                    el(
                        'div.segmented',
                        {},
                        [1, 2, 3, 4, 5, 6].map((rotation) =>
                            el('button.seg', {
                                type: 'button',
                                class: draft.rotation === rotation ? 'seg--on' : '',
                                text: String(rotation),
                                onClick: () => {
                                    draft.rotation = rotation;
                                    rebuild();
                                },
                            }),
                        ),
                    ),
                ]),
            playerField(inPool, 'In', draft.inId, (id) => {
                draft.inId = id;
                rebuild();
            }),
            playerField(
                roster.filter((p) => p.id !== draft.inId),
                'Out',
                draft.outId,
                (id) => {
                    draft.outId = id;
                    rebuild();
                },
            ),
            el('div.form__actions', {}, [
                el('button.btn.btn--primary', {
                    type: 'button',
                    text: 'Add to plan',
                    disabled: !draft.inId || !draft.outId,
                    onClick: () => {
                        if (draft.kind === 'libero') {
                            store.setLiberoPlan({ liberoId: draft.inId, replacesId: draft.outId }, team.id);
                        } else {
                            store.addPlanSub(
                                { rotation: draft.rotation, inId: draft.inId, outId: draft.outId },
                                team.id,
                            );
                        }
                        closeSheet();
                        toast('Added to the plan');
                    },
                }),
            ]),
        );
    };

    rebuild();
    openSheet({ title: 'Add to plan', subtitle: `${team.name} · in > out`, body });
}

function playerField(pool, label, selectedId, onPick) {
    if (pool.length === 0) {
        return el('div.field', {}, [
            el('span.field__label', { text: label }),
            el('p.panel__hint', { text: 'Nobody available.' }),
        ]);
    }

    return el('div.field', {}, [
        el('span.field__label', { text: label }),
        el(
            'div.segmented.segmented--wrap',
            {},
            pool.map((player) =>
                el('button.seg', {
                    type: 'button',
                    class: selectedId === player.id ? 'seg--on' : '',
                    text: `#${player.number}`,
                    title: playerLabel(player),
                    onClick: () => onPick(selectedId === player.id ? '' : player.id),
                }),
            ),
        ),
    ]);
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
                text: `Libero serves in order ${SERVING_ORDER[sheet.liberoServeRow]} — triangled below. Set the first time they served, and the only rotation they may serve in.`,
            }),

        ...sheet.warnings.map((warning) => el('p.panel__hint.panel__hint--warn', { text: `⚠ ${warning}` })),
    ]);
}

/* ------------------------------------------------------------------- rows */

function rowsPanel(store, sheet) {
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Serving order' }),
        el('p.panel__hint', { text: 'Tap a row to send the libero on or off, or to substitute.' }),

        // Four columns that are not self-explanatory without a label: the fixed
        // serving order, terms of service, where the row is standing right now,
        // and its history.
        el('div.lts__head', {}, [
            el('span', { text: 'ORDER' }),
            el('span', { text: 'SVC' }),
            el('span', { text: 'POS' }),
            el('span', { text: 'ON COURT' }),
        ]),

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
            el('span.lts__pos', {}, [
                el('span.lts__posnum', { text: `P${row.courtPosition}` }),
                el('span.lts__poslabel', { text: POSITION_LABELS[row.courtPosition] ?? '' }),
            ]),
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
