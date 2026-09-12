/** The capture view: scoreboard, court map, bench, and the stat entry sheet. */

import {
    COURT_GRID,
    DEFAULT_FORMAT,
    FRONT_ROW,
    HIGHLIGHTED_POSITIONS,
    MATCH_FORMATS,
    colorForPlayer,
    darkenHex,
    playerLabel,
    POSITION_LABELS,
    primaryPosition,
    positionsLabel,
    rotateLineupBy,
    STAT_GROUPS,
    STAT_BY_CODE,
    TEAM_EVENTS,
    TIMEOUTS_PER_SET,
    computeSetState,
    describeEvent,
    matchScore,
    positionOf,
    setWinner,
} from '../model.js';
import {
    DEFAULT_SYSTEM,
    FORMATIONS,
    RECEIVE_STAGES,
    SYSTEMS,
    afterReceiveFormation,
    assignRoles,
    formationPoints,
    keepsFrontRowOnReceive,
} from '../formations.js';
import { liberoSheet } from '../libero.js';
import { planPrompts } from '../plan.js';
import { el, mount, openSheet, closeSheet, toast, buzz, confirmDialog } from './dom.js';

/**
 * Which formation the court is drawing. Base is the default because that is
 * where play actually happens and therefore where stats get tapped; Rotation is
 * for checking the lineup against the referee.
 */
let formation = 'base';

/** Whether the serve-receive view is showing the receive or where it ends up. */
const isReceiveView = (key) => key === 'receive' || key === 'afterReceive';

/**
 * Positions captured just before a formation switch, so the new bubbles can be
 * animated from where the old ones were.
 *
 * The app re-renders wholesale — `mount` clears and rebuilds — so every bubble
 * is a fresh node with no previous position, and a plain CSS transition on
 * left/top has nothing to animate from. This is the FLIP approach instead:
 * measure, re-render, offset each bubble back to where it was, then let it
 * travel to its new home.
 */
let flipFrom = null;

function centresOfBubbles() {
    const centres = new Map();
    for (const node of document.querySelectorAll('.court__grid .bubble[data-player]')) {
        const rect = node.getBoundingClientRect();
        centres.set(node.dataset.player, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    return centres;
}

/** Switch view, remembering where everyone was standing. */
function setFormation(next, store) {
    if (next === formation) return;
    flipFrom = centresOfBubbles();
    formation = next;
    store.commit();
}

/** Run after the court re-renders: send each bubble back, then let it move. */
function runFlip(from) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    for (const node of document.querySelectorAll('.court__grid .bubble[data-player]')) {
        const previous = from.get(node.dataset.player);
        if (!previous) continue;
        const rect = node.getBoundingClientRect();
        const dx = previous.x - (rect.left + rect.width / 2);
        const dy = previous.y - (rect.top + rect.height / 2);
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

        node.style.transition = 'none';
        node.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
        void node.offsetWidth; // commit that position before animating away from it
        node.style.transition = '';
        node.classList.add('bubble--flip');
        node.style.transform = '';
        node.addEventListener('transitionend', () => node.classList.remove('bubble--flip'), { once: true });
    }
}

/**
 * Plan prompts the coach has waved away, and where they were standing when they
 * did. Session-only, like the chosen formation: a skipped prompt is a moment's
 * decision, not a fact about the match, and storing it would be the "applied"
 * flag that `js/plan.js` exists to avoid.
 */
const dismissedPrompts = new Set();
let dismissedAt = null;

/** Player currently selected for a substitution, if any. */

export function renderCourt(root, store, actions, dock = null) {
    const match = store.activeMatch;
    if (!match) return mount(root, noMatchPanel(store, actions));
    if (match.complete) return mount(root, matchCompletePanel(store, match, actions));

    const set = store.activeSet;
    if (!set) return mount(root, setupSetPanel(store, actions));

    const live = store.liveState;

    // +1 Us / +1 Them and Undo are docked, not scrolled. They are the controls
    // the coach reaches for between every rally, and on a phone they used to
    // sit below the fold — the court map alone is over half the screen, so no
    // amount of reordering keeps them in view once a plan prompt appears. The
    // dock is a grid row of the body, so it holds its place without positioning.
    if (dock) mount(dock, actionBar(store, live, set));

    mount(
        root,
        scoreboard(store, live, set),
        courtMap(store, live, set),
        planStrip(store, live, set),
        // What is left scrolls, ordered by how often it is read during a match.
        // The history sits at the bottom because the owner does not read it
        // courtside: Undo is docked, so the quick correction never needs it, and
        // an older one gets fixed on the Log tab. It has now moved down twice —
        // do not "restore" it above the fold without being asked.
        benchStrip(store, live, actions),
        serveStrip(store, live, set),
        recentStrip(store, live),
        endSetPanel(store, live, set, actions),
    );

    if (flipFrom) {
        const from = flipFrom;
        flipFrom = null;
        requestAnimationFrame(() => runFlip(from));
    }
    return root;
}

/* ------------------------------------------------------------- empty states */

function noMatchPanel(store, actions) {
    // A match needs some team with players tagged to it — not necessarily the
    // team that happens to be in context right now.
    const ready = store.teams.some((team) => store.playersForTeam(team.id).length > 0);

    return el('div.panel.panel--center', {}, [
        el('h2.panel__title', { text: 'No match in progress' }),
        el('p.panel__hint', {
            text: ready
                ? 'Start a match to begin capturing stats.'
                : 'No team has any players tagged to it yet. Set that up on the Roster tab first.',
        }),
        el('button.btn.btn--primary.btn--lg', {
            type: 'button',
            text: 'New Match',
            disabled: !ready,
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

/** Final scoreboard for a match that has been closed out. */
function matchCompletePanel(store, match, actions) {
    const score = matchScore(match);
    const team = store.activeTeam;

    return el('div.panel.panel--center', {}, [
        el('h2.panel__title', {
            text: score.winner === 'us' ? 'Match won' : score.winner === 'them' ? 'Match lost' : 'Match ended',
        }),
        el('div.finalscore', {}, [
            el('span.finalscore__side', { text: team?.name ?? 'Us' }),
            el('span.finalscore__value', { class: 'is-us', text: String(score.us) }),
            el('span.finalscore__dash', { text: '–' }),
            el('span.finalscore__value', { class: 'is-them', text: String(score.them) }),
            el('span.finalscore__side', { text: match.opponent }),
        ]),
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
        el('p.panel__hint', {
            text: `${score.format.label} · ${match.date}${match.venue ? ` · ${match.venue}` : ''}`,
        }),
        // Only actions that belong to *this* match live here. Starting a
        // different one is not one of them — that is what the ☰ menu is for.
        el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Reopen this match',
            onClick: () => {
                store.reopenMatch(match.id);
                toast('Match reopened');
            },
        }),
        el('p.panel__hint', { text: 'Use ☰ at the top to start another match or open a past one.' }),
    ]);
}

/**
 * Lineup builder shown between sets. Slots are laid out exactly like the court
 * so what you tap is where the player stands.
 */
/**
 * "#7 Emma serves first · rotation 3" — what the picks above actually mean.
 *
 * The rotation number is abstract and the court map is six unlabelled spots, so
 * neither says out loud who ends up on the line. Naming the server is the one
 * readback a coach can check against the floor without translating anything.
 */
function startingServerHint(store, draft) {
    const serverId = draft.lineup[0];
    if (!serverId) return null;
    const server = store.player(serverId);
    if (!server) return null;
    return el('p.panel__hint.panel__hint--read', {
        text: `${playerLabel(server)} serves first · rotation ${draft.startingRotation}`,
    });
}

function setupSetPanel(store, actions) {
    const match = store.activeMatch;
    const previous = match.sets.at(-1);
    // Who serves first is no longer asked here. It is not known until the
    // whistle, and guessing it at lineup time meant the lineup could be a
    // rotation out before the first rally. The set starts assuming we serve —
    // the Court tab flips it in one tap, and moves the court with it.
    const draft = {
        startingRotation: 1,
        format: match.format ?? DEFAULT_FORMAT,
        system: previous?.system ?? match.sets.at(-1)?.system ?? DEFAULT_SYSTEM,
        lineup: [null, null, null, null, null, null],
    };

    const container = el('div.panel');

    const rerender = () => mount(container, ...build());

    function build() {
        const chosen = new Set(draft.lineup.filter(Boolean));
        const ready = draft.lineup.every(Boolean);
        const team = store.activeTeam;
        const short = store.roster.length < 6;

        return [
            el('h2.panel__title', {
                text: `Set ${match.sets.length + 1} lineup${team ? ` · ${team.name}` : ''}`,
            }),
            short
                ? el('p.panel__hint', {
                      text: `${team?.fullName ?? 'This team'} has only ${store.roster.length} player${
                          store.roster.length === 1 ? '' : 's'
                      }. You need six to start a set — add them on the Roster tab, or to roster.json.`,
                  })
                : el('p.panel__hint', {
                      text: 'Tap a spot on the court and pick the player who starts there.',
                  }),

            // Format decides which set is played to 15, so it is only offered
            // before the first set — changing it mid-match would move the target
            // under sets already played.
            match.sets.length === 0
                ? el('div.field', {}, [
                      el('span.field__label', { text: 'Match format' }),
                      el(
                          'div.segmented',
                          {},
                          MATCH_FORMATS.map((option) =>
                              toggleButton(option.label, draft.format === option.sets, () => {
                                  draft.format = option.sets;
                                  rerender();
                              }),
                          ),
                      ),
                      el('p.panel__hint', {
                          text: `Sets to 25, deciding set ${draft.format} to 15.`,
                      }),
                  ])
                : matchProgressHint(store, match, actions),

            SYSTEMS.length > 1 &&
                el('div.field', {}, [
                    el('span.field__label', { text: 'Offense' }),
                    el(
                        'div.segmented',
                        {},
                        SYSTEMS.map((system) =>
                            toggleButton(system.label, draft.system === system.key, () => {
                                draft.system = system.key;
                                rerender();
                            }),
                        ),
                    ),
                ]),

            el('div.field', {}, [
                el('span.field__label', { text: 'Starting rotation' }),
                el(
                    'div.segmented',
                    {},
                    [1, 2, 3, 4, 5, 6].map((n) =>
                        toggleButton(String(n), draft.startingRotation === n, () => {
                            // Actually rotate what is on the map. Setting the
                            // number alone left the court unchanged, which made
                            // the control look broken — and it was: the lineup
                            // went in untouched and merely got labelled.
                            draft.lineup = rotateLineupBy(draft.lineup, n - draft.startingRotation);
                            draft.startingRotation = n;
                            rerender();
                        }),
                    ),
                ),
                el('p.panel__hint', {
                    text: 'Pick the rotation you are starting in — rotation 4 puts the 4th player of your serving order in the serving spot. The court below moves as you pick, so tap until it matches the floor.',
                }),
                // The reported mistake, called out where it gets made: the coach
                // set rotation 6 by hand *and* then flipped First serve to Them,
                // which shifted it back again to 5. Only one of those is theirs
                // to do.
                el('p.panel__hint.panel__hint--warn', {
                    text: 'Set this as if you are serving. If they serve first, say so on the Court tab afterwards — it shifts you back one rotation for you. Do not subtract it here as well.',
                }),
                // Plain-language readback, so a wrong tap is visible immediately
                // rather than at the first whistle.
                startingServerHint(store, draft),
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
                                player && player.name && el('span.slot__name', { text: player.name }),
                            ],
                        );
                    }),
                ),
            ]),

            // Within a match the last set is the obvious source. For set 1 there
            // is no such set, which used to mean no button at all — exactly the
            // moment six players have to be retyped. Fall back to the last set
            // this team actually played, whenever that was.
            (() => {
                const carry = previous
                    ? { lineup: previous.startingLineup.slice(), label: 'Use previous set’s lineup' }
                    : (() => {
                          const last = store.lastLineupForTeam(match.teamId, match.id);
                          return last
                              ? { lineup: last.lineup, label: `Use last match’s lineup (vs ${last.match.opponent})` }
                              : null;
                      })();
                return (
                    carry &&
                    el('button.btn.btn--ghost', {
                        type: 'button',
                        text: carry.label,
                        onClick: () => {
                            // Straight in as placed, then re-labelled as rotation
                            // 1: the stored lineup is already a court, so rotating
                            // it by the picker's current value would move it off
                            // the arrangement being copied.
                            draft.lineup = carry.lineup.slice();
                            draft.startingRotation = 1;
                            rerender();
                        },
                    })
                );
            })(),

            el('button.btn.btn--primary.btn--lg', {
                type: 'button',
                text: ready ? `Start Set ${match.sets.length + 1}` : 'Fill all six spots',
                disabled: !ready,
                onClick: () => actions.startSet(draft),
            }),

            match.sets.length > 0 &&
                el('button.btn.btn--ghost', {
                    type: 'button',
                    text: 'End Match',
                    onClick: () => actions.endMatch(),
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

/** Where the match stands between sets, and whether it is already settled. */
function matchProgressHint(store, match) {
    const score = matchScore(match);
    const nextSet = match.sets.length + 1;

    return el('div.field', {}, [
        el('span.field__label', { text: 'Match' }),
        el('p.panel__hint', {
            class: score.decided ? 'is-decided' : '',
            text: score.decided
                ? `${score.format.label} · sets ${score.us}–${score.them} · ${
                      score.winner === 'us' ? 'you have won the match' : 'the match is lost'
                  }. End it below, or play on.`
                : `${score.format.label} · sets ${score.us}–${score.them} · set ${nextSet} is to ${
                      nextSet >= score.format.sets ? 15 : 25
                  }.`,
        }),
    ]);
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
                    player.name && el('span.picker__name', { text: player.name }),
                    positionsLabel(player) && el('span.picker__pos', { text: positionsLabel(player) }),
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
            el('span.score__label', { text: store.activeTeam?.name ?? 'Us' }),
            el('span.score__value', { text: String(live.us) }),
            timeoutPips(store, live, 'us', store.activeTeam?.name ?? 'Us'),
        ]),
        el('div.scoreboard__mid', {}, [
            el('span.scoreboard__set', { text: `Set ${set.number}` }),
            el('span.scoreboard__target', { text: `to ${set.target ?? 25}` }),
            // Tappable: the rotation is where drift shows up, so it is also
            // where the fix belongs.
            el('button.scoreboard__rot', {
                type: 'button',
                text: `Rot ${live.rotation}`,
                title: 'Rotation or serve out of step? Tap to set it straight.',
                onClick: () => openCorrectSheet(store, live),
            }),
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
            timeoutPips(store, live, 'them', match.opponent),
        ]),
    ]);
}

/**
 * One side's timeouts: a pip per allowance, filled while unused.
 *
 * Tapping the row spends one, because an indicator you cannot set is an
 * indicator you will forget to keep true. Undo takes it straight back, and the
 * point log can delete one from further back — the same routes as every other
 * event, which is the point of recording it as one.
 *
 * Past the allowance it keeps recording and says so rather than refusing: the
 * count is a display allowance, not a rule (see `TIMEOUTS_PER_SET`).
 */
function timeoutPips(store, live, team, teamName) {
    const used = live.timeouts?.[team] ?? 0;
    const over = Math.max(0, used - TIMEOUTS_PER_SET);

    return el(
        'button.touts',
        {
            type: 'button',
            class: over > 0 ? 'touts--over' : used >= TIMEOUTS_PER_SET ? 'touts--spent' : '',
            title: `Timeouts — ${used} of ${TIMEOUTS_PER_SET} used. Tap to call one.`,
            'aria-label': `${teamName}: ${used} of ${TIMEOUTS_PER_SET} timeouts used. Call a timeout.`,
            onClick: () => {
                store.recordTimeout(team);
                buzz();
                const spent = used + 1;
                toast(
                    spent > TIMEOUTS_PER_SET
                        ? `${teamName} timeout ${spent} — over the ${TIMEOUTS_PER_SET} allowed`
                        : `${teamName} timeout — ${TIMEOUTS_PER_SET - spent} left`,
                    spent > TIMEOUTS_PER_SET ? 'warn' : 'ok',
                );
            },
        },
        [
            el('span.touts__label', { text: 'TO' }),
            ...Array.from({ length: TIMEOUTS_PER_SET }, (_, index) =>
                el('span.touts__pip', { class: index < used ? 'touts__pip--used' : '' }),
            ),
            over > 0 && el('span.touts__over', { text: `+${over}` }),
        ],
    );
}

/**
 * Put the app back in step with the floor, when a rally got missed.
 *
 * Shows a live court preview rather than just a number, because "rotation 4"
 * cannot be checked against anything — six jersey numbers in six spots can be
 * read straight off the floor. The coach taps until the preview matches.
 *
 * **The score is deliberately not editable here.** A rotation that is out and a
 * score that is out are two different mistakes, and the honest fix for a missed
 * rally is to record the rally — which puts score, serve and rotation right
 * together. The sheet says so, and this stays the escape hatch for when the
 * score is already correct.
 */
function openCorrectSheet(store, live) {
    const draft = { rotation: live.rotation, serving: live.serving };
    const body = el('div.form');

    const rerender = () => {
        // Where the six would stand at the chosen rotation, derived the same way
        // replay will derive it — so the preview cannot disagree with the result.
        const preview = rotateLineupBy(live.lineup, draft.rotation - live.rotation);
        const serverId = preview[0];
        const server = serverId ? store.player(serverId) : null;

        mount(body, [
            el('div.field', {}, [
                el('span.field__label', { text: 'Rotation' }),
                el(
                    'div.segmented',
                    {},
                    [1, 2, 3, 4, 5, 6].map((n) =>
                        toggleButton(String(n), draft.rotation === n, () => {
                            draft.rotation = n;
                            rerender();
                        }),
                    ),
                ),
            ]),

            el('div.field', {}, [
                el('span.field__label', { text: 'Serving' }),
                el('div.segmented', {}, [
                    toggleButton(store.activeTeam?.name ?? 'Us', draft.serving === 'us', () => {
                        draft.serving = 'us';
                        rerender();
                    }),
                    toggleButton('Them', draft.serving === 'them', () => {
                        draft.serving = 'them';
                        rerender();
                    }),
                ]),
                el('p.panel__hint', {
                    // Why serve is here at all, and not a separate fix.
                    text: 'Set both. Whether the next point rotates you depends on who is serving, so fixing the rotation alone would go out again on the next rally.',
                }),
            ]),

            el('div.court.court--setup.court--preview', {}, [
                el('div.court__net', { text: 'NET' }),
                el(
                    'div.court__grid',
                    {},
                    COURT_GRID.map((position) => {
                        const player = preview[position - 1] ? store.player(preview[position - 1]) : null;
                        return el('div.slot.slot--filled', {}, [
                            el('span.slot__pos', { text: `${position} ${POSITION_LABELS[position]}` }),
                            el('span.slot__num', { text: player ? `#${player.number}` : '—' }),
                            player?.name && el('span.slot__name', { text: player.name }),
                        ]);
                    }),
                ),
            ]),
            el('p.panel__hint.panel__hint--read', {
                text: server
                    ? `${playerLabel(server)} in the serving spot · ${draft.serving === 'us' ? 'we serve' : 'they serve'}`
                    : 'Tap until this matches the floor.',
            }),

            el('p.panel__hint', {
                text: 'Missed a rally? Recording it with +1 Us or +1 Them fixes the score, the serve and the rotation together. Use this when the score is already right.',
            }),

            el('div.form__actions', {}, [
                el('button.btn.btn--primary', {
                    type: 'button',
                    text: 'Set it straight',
                    disabled: draft.rotation === live.rotation && draft.serving === live.serving,
                    onClick: () => {
                        store.correctCourt(draft);
                        buzz();
                        closeSheet();
                        toast(`Rotation ${draft.rotation} · ${draft.serving === 'us' ? 'we serve' : 'they serve'}`, 'warn');
                    },
                }),
            ]),
        ]);
    };

    rerender();
    openSheet({ title: 'Match the floor', subtitle: 'Score is left alone', body });
}

/* -------------------------------------------------------------- court map */

function courtMap(store, live, set) {
    const system = set?.system ?? DEFAULT_SYSTEM;
    const lookup = (id) => store.player(id);
    const points = formationPoints({
        lineup: live.lineup,
        rotation: live.rotation,
        formation,
        system,
        playerLookup: lookup,
    });
    const { roleOf, mismatches } = assignRoles(live.lineup, live.rotation, lookup, system);
    const current =
        formation === 'afterReceive'
            ? {
                  label: 'Serve Rcv',
                  note:
                      afterReceiveFormation(live.rotation, system) === 'rotation'
                          ? 'Where they attack from after the pass — no switch this rotation'
                          : 'Where they attack from after the pass',
              }
            : (FORMATIONS.find((f) => f.key === formation) ?? FORMATIONS[0]);
    const noSwitch = formation === 'receive' && keepsFrontRowOnReceive(live.rotation, system);

    return el('section.court', {}, [
        // The net doubles as the label for which view is on screen.
        el('div.court__net', { text: `NET · ${current.label.toUpperCase()}` }),
        el(
            'div.court__grid',
            { class: formation === 'receive' ? 'court__grid--receive' : '' },
            // Drawn in a stable order — by rotational position, never by where
            // they currently stand — so each bubble is the same DOM node across
            // views and CSS can carry it from one formation to the next.
            live.lineup.map((_, index) => bubble(store, live, index + 1, points, roleOf)),
        ),
        el(
            'div.segmented.segmented--sm',
            {},
            FORMATIONS.map((option) =>
                toggleButton(
                    option.label,
                    option.key === 'receive' ? isReceiveView(formation) : formation === option.key,
                    () => setFormation(option.key, store),
                ),
            ),
        ),
        isReceiveView(formation) &&
            el(
                'div.segmented.segmented--sm.segmented--sub',
                {},
                RECEIVE_STAGES.map((stage) =>
                    toggleButton(stage.label, formation === stage.key, () => setFormation(stage.key, store)),
                ),
            ),

        el('p.court__hint', { text: current.note }),

        noSwitch &&
            el('p.court__hint.court__hint--note', {
                text:
                    formation === 'afterReceive'
                        ? `Rotation ${live.rotation}: no switch — the outside stays right and the opposite stays outside, so they attack from where they received.`
                        : `Rotation ${live.rotation}: the front row does not switch after this receive. Tap After pass to see where they attack from.`,
            }),
        mismatches.length > 0 &&
            el('p.court__hint.court__hint--warn', {
                text: `Lineup does not look like a ${system}: ${mismatches
                    .map(
                        (m) =>
                            `${playerLabel(store.player(m.playerId))} is ${m.actual}, expected ${m.expected} at ${m.role}`,
                    )
                    .join('; ')}.`,
            }),
    ]);
}

function bubble(store, live, rotationalPosition, points, roleOf) {
    const playerId = live.lineup[rotationalPosition - 1];
    const player = playerId ? store.player(playerId) : null;
    // Everything legal stays rotational: which position a player occupies, and
    // therefore who serves, does not change because the court is drawn
    // differently. Only where the bubble sits moves.
    const point = (playerId && points[playerId]) || { x: 0.5, y: 0.5 };
    const isServer = live.serving === 'us' && rotationalPosition === 1;
    const isFront = FRONT_ROW.includes(rotationalPosition);

    // Hue says what they play, lightness says which row they are in — so
    // colouring by position does not cost the front/back read. Must come after
    // isFront: reading it earlier is a temporal dead zone error that kills the
    // whole court render, and the unit tests cannot see it.
    //
    // The row also decides *which* position a player who goes all the way
    // around is playing right now: an S/OH reads as a setter in the back and an
    // outside in the front, because a 6-2 setter cannot set from the front row.
    const row = isFront ? 'front' : 'back';
    const colour = player ? colorForPlayer(player, store.state.positionColors, row) : null;
    const fill = player ? (isFront ? colour : darkenHex(colour)) : null;

    const classes = ['bubble'];
    classes.push(isFront ? 'bubble--front' : 'bubble--back');
    if (isServer) classes.push('bubble--server');
    if (!player) classes.push('bubble--empty');

    return el(
        'button',
        {
            type: 'button',
            class: classes.join(' '),
            // Deeper players sit in front, so an overlapped bubble still has
            // its own edge to tap.
            style:
                `left:${point.x * 100}%;top:${point.y * 100}%;z-index:${Math.round(point.y * 100)}` +
                (fill ? `;background:${fill}` : ''),
            dataset: player ? { player: player.id } : {},
            disabled: !player,
            onClick: () => {
                if (!player) return;
                openStatSheet(store, player, live);
            },
        },
        [
            el('span.bubble__pos', { text: String(rotationalPosition) }),
            isServer && el('span.bubble__serve', { text: '🏐', title: 'Serving' }),
            el('span.bubble__num', { text: player ? `#${player.number}` : '—' }),
            (player ? player.name : 'empty') && el('span.bubble__name', { text: player ? player.name : 'empty' }),
            player && roleOf?.[player.id] && el('span.bubble__role', { text: roleOf[player.id] }),
            // Setter and libero are the two worth seeing mid-rally — but the
            // role already says "S1", so the badge is only needed without one.
            // The badge follows the same row rule as the colour, so an S/OH
            // wears "S" in the back and nothing in the front, where she is
            // playing outside. A pure setter in the front row keeps her S: she
            // really is one, she just cannot set from there.
            player &&
                !roleOf?.[player.id] &&
                HIGHLIGHTED_POSITIONS.includes(primaryPosition(player, row)) &&
                el('span.bubble__tag', { text: primaryPosition(player, row) }),
        ],
    );
}

/* ------------------------------------------------------------------ bench */

function benchStrip(store, live, actions) {
    const onCourt = new Set(live.lineup.filter(Boolean));
    const bench = store.roster.filter((player) => !onCourt.has(player.id));

    if (bench.length === 0) {
        return el('section.bench', {}, [
            el('span.bench__empty', { text: 'No bench players' }),
            el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Subs & libero →',
                onClick: () => actions.goToTab('subs'),
            }),
        ]);
    }

    return el('section.bench', {}, [
        el('span.bench__label', { text: 'Bench' }),
        el(
            'div.bench__scroll',
            {},
            bench.map((player) =>
                el('span.chip.chip--static', {}, [
                    el('span.chip__dot', {
                        style: `background:${colorForPlayer(player, store.state.positionColors)}`,
                        title: positionsLabel(player, ' · ') || 'No position',
                    }),
                    el('span.chip__num', { text: `#${player.number}` }),
                    player.name && el('span.chip__name', { text: player.name }),
                ]),
            ),
        ),
        // Substitutions live on the Subs tab so there is one record of them.
        el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Subs & libero →',
            onClick: () => actions.goToTab('subs'),
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

/* ------------------------------------------------------------- first serve */

/**
 * Who served first, changeable for as long as the set is open.
 *
 * This used to be asked on the lineup screen, before the set began — but nobody
 * knows it then. The ref says at the whistle, by which point the lineup is
 * already entered, and getting it wrong left the whole set a rotation out.
 *
 * Tapping **Them** starts the set one rotation behind (rotation 1 becomes 6) and
 * shifts the six on court to match, so the first side-out brings the coach's
 * intended first server to the line. The court redraws as you tap, which is the
 * confirmation that it took.
 *
 * It stays available all set, not just before the first rally: the score counts
 * point events and does not care who served, so a late correction moves the
 * rotation and nothing else. That is precisely what a coach who notices at 5-3
 * wants.
 */
function serveStrip(store, live, set) {
    const choose = (server) => {
        if (set.startingServer === server) return;
        store.setStartingServer(server);
        buzz();
        toast(live.rallies > 0 ? 'First serve changed — rotation moved, score unchanged' : 'First serve set');
    };

    return el('section.servestrip', {}, [
        el('span.servestrip__label', { text: 'First serve' }),
        el('div.segmented.segmented--tight', {}, [
            el('button.seg', {
                type: 'button',
                class: set.startingServer === 'us' ? 'seg--on' : '',
                text: store.activeTeam?.name ?? 'Us',
                onClick: () => choose('us'),
            }),
            el('button.seg', {
                type: 'button',
                class: set.startingServer === 'them' ? 'seg--on' : '',
                text: 'Them',
                onClick: () => choose('them'),
            }),
        ]),
        el('span.servestrip__rot', { text: `Rot ${set.startingRotation}` }),
    ]);
}

/* -------------------------------------------------------------- game plan */

/**
 * Prompts from the plan for the position right now — the swap the coach already
 * decided on, offered at the moment it becomes legal.
 *
 * Three rules, and they are the whole design:
 *
 * - **Never auto-apply.** Deviating from the plan is normal coaching, and a
 *   sub recorded that did not happen is worse than one missed.
 * - **Always dismissible**, and a dismissal lasts until the rotation moves on,
 *   so ignoring it does not mean fighting it every rally.
 * - **Nothing is stored about having taken it.** Whether to show is derived
 *   from the live lineup, which is what makes a second pass through the same
 *   rotation, a new set, and undo all behave without a flag to keep in step.
 */
function planStrip(store, live, set) {
    const plan = store.planFor();
    if (!plan.libero && plan.subs.length === 0) return null;

    const sheet = liberoSheet(set, { liberoIds: store.liberoIds });
    const onCourt = new Set(live.lineup.filter(Boolean));
    // Everyone off court, which deliberately includes the player the libero
    // replaced. The Subs tab hides her from its picker because she is reserved
    // rather than benched — but she is exactly who the libero-return prompt
    // needs, so here "off court" is the right test.
    const available = store.roster.filter((player) => !onCourt.has(player.id)).map((player) => player.id);

    // A dismissal lasts only while the team is standing in this rotation of this
    // set. Rotate away and back and the offer returns, because that is a fresh
    // chance to make the sub — but it will not re-ask every rally in between.
    const here = `${set.id}:${live.rotation}`;
    if (dismissedAt !== here) {
        dismissedPrompts.clear();
        dismissedAt = here;
    }

    const prompts = planPrompts({
        plan,
        lineup: live.lineup,
        rotation: live.rotation,
        available,
        liberoReplaced: sheet.awaitingLiberoReturn[0] ?? null,
        // Lets a planned sub follow the slot when an ad-hoc swap has already
        // moved somebody else into it.
        rows: sheet.rows,
    }).filter((prompt) => !dismissedPrompts.has(prompt.id));

    if (prompts.length === 0) return null;

    return el(
        'section.planstrip',
        {},
        prompts.map((prompt) =>
            el('div.planstrip__row', {}, [
                el('span.planstrip__label', { text: prompt.kind === 'libero' ? 'Libero' : `Rot ${prompt.rotation}` }),
                el('span.planstrip__swap', {}, [
                    el('span', {
                        text: `${playerLabel(store.player(prompt.inId))} > ${playerLabel(store.player(prompt.outId))}`,
                    }),
                    // Say so when the plan named somebody else: the swap on
                    // offer is not the one that was written down.
                    prompt.plannedOutId &&
                        el('span.planstrip__was', {
                            text: ` (planned for ${playerLabel(store.player(prompt.plannedOutId))})`,
                        }),
                ]),
                el('button.btn.btn--primary.btn--sm', {
                    type: 'button',
                    text: 'Make sub',
                    onClick: () => {
                        store.recordSub(prompt.outId, prompt.inId, prompt.kind === 'libero' ? 'libero' : 'sub');
                        buzz();
                        toast('Sub recorded');
                    },
                }),
                el('button.planstrip__skip', {
                    type: 'button',
                    'aria-label': 'Skip',
                    text: '✕',
                    onClick: () => {
                        dismissedPrompts.add(prompt.id);
                        store.commit();
                    },
                }),
            ]),
        ),
    );
}

/* ------------------------------------------------------------- action bar */

/**
 * The docked controls: score a rally nobody's stat line covers, and undo.
 *
 * One row on purpose. Every pixel here is taken off the court map above it, and
 * these three are what the coach taps between rallies. End Set is once a set
 * and lives at the bottom of the scroll instead.
 */
function actionBar(store, live, set) {
    return el('div.actions__row', {}, [
        // Out of rotation is rare and is not one of the fast scoring buttons.
        ...TEAM_EVENTS.filter((event) => !event.fault).map((event) =>
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
        el('button.btn.btn--ghost.btn--undo', {
            type: 'button',
            // Kept as a word, not just the glyph. The row has the width for it,
            // and this is the button reached for in a hurry after a mis-tap.
            text: '↶ Undo',
            title: 'Undo the last entry',
            disabled: set.events.length === 0,
            onClick: () => {
                const removed = store.undo();
                if (removed) {
                    buzz();
                    toast('Undone', 'warn');
                }
            },
        }),
    ]);
}

/**
 * Stoppage-time actions, at the very bottom of the scroll.
 *
 * Out of rotation is a **team** fault, not one player's, so it is not in the
 * stat sheet's Fault row with the net touches — and it happens a handful of
 * times a season, so it does not earn a place in the dock beside the two
 * buttons that carry every rally. When it is called, play has stopped and there
 * is time to scroll.
 */
function endSetPanel(store, live, set, actions) {
    const rotationFault = TEAM_EVENTS.find((event) => event.fault);

    return el('section.actions', {}, [
        rotationFault &&
            el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: `${rotationFault.name} → +1 them`,
                onClick: () => {
                    store.recordTeamEvent(rotationFault.code);
                    buzz();
                    toast(rotationFault.name, 'them');
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
                                toast(`${playerLabel(player)} — ${option.name}`, scored ?? 'ok');
                            },
                        }),
                    ),
                ),
            ]),
        ),
    );

    openSheet({
        title: playerLabel(player),
        subtitle: position
            ? `Position ${position} · ${POSITION_LABELS[position]}${positionsLabel(player) ? ` · ${positionsLabel(player, ' · ')}` : ''}`
            : positionsLabel(player, ' · '),
        body,
    });
}

/** Colour a stat button by its effect on the scoreboard. */
function toneClass(option) {
    if (option.point === 'us') return 'statbtn--good';
    if (option.point === 'them') return 'statbtn--bad';
    return 'statbtn--neutral';
}

/**
 * Hook for leaving the capture tab. The court holds no half-finished state now
 * that substitutions live on their own tab, but the tab bar calls this on every
 * switch and a future interaction will want it.
 */
export function resetCourtInteraction() {}
