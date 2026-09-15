/**
 * The whiteboard: a landscape scratch surface for a timeout or a practice plan.
 *
 * What makes it worth building over the board in the bag: it starts from the
 * real six, in the real rotation, with real numbers and position colours —
 * where a whiteboard starts blank every single time.
 *
 * **Nothing here is stored.** Not the ink, not where chips were dragged, not the
 * extras dropped on. It is a scratchpad by the owner's decision, and that keeps
 * it entirely outside the store: no schema change, no migration, nothing to back
 * up, and no risk of a stray drawing outliving the reason for it. State lives in
 * one module-level object for as long as the app is open, the same way the Court
 * tab's chosen formation does.
 *
 * **Ink clears when the rotation changes**, also the owner's call. It clears on a
 * view change too — Base and Serve Rcv put the same six in very different
 * places, so ink drawn against one points at nothing in the other, and leaving it
 * there is worse than losing it.
 */

import { POSITION_LABELS, colorForPlayer, playerLabel, primaryPosition, rotateLineupBy } from '../model.js';
import { FORMATIONS, DEFAULT_SYSTEM, formationPoints } from '../formations.js';
import { planPrompts } from '../plan.js';
import { liberoSheet } from '../libero.js';
import { el, mount, toast } from './dom.js';

/** Ink colours, in the order they appear on the rail. */
const INKS = ['#ffffff', '#f59e0b', '#22c55e', '#ef4444', '#2f81f7', '#ff4d8d'];

/**
 * Tools. `move` is not a drawing tool and that is the point: chips and ink both
 * want the same pointer, so exactly one of them owns it at a time. Without a
 * mode you cannot draw across a player, which is most of what a coach draws.
 */
const TOOLS = [
    { key: 'move', label: 'Move', icon: '✥' },
    { key: 'arrow', label: 'Arrow', icon: '↗' },
    { key: 'draw', label: 'Draw', icon: '✎' },
    { key: 'circle', label: 'Circle', icon: '◌' },
];

/** Marks that are not players, tapped in from the bank. */
const EXTRAS = [
    { kind: 'opp', label: '?', title: 'Opponent' },
    { kind: 'ball', label: '●', title: 'Ball' },
    { kind: 'cone', label: '△', title: 'Target' },
];

/** Ink is stored in this square space, so it survives the court resizing. */
const INK_SPACE = 1000;

let board = null;
let host = null;
let extraSeq = 0;

function freshBoard(rotation) {
    return {
        view: 'base',
        rotation,
        /** Whether the rotation still matches the live one. */
        live: true,
        showPlan: true,
        tool: 'move',
        ink: INKS[1],
        /** Committed strokes, oldest first. */
        strokes: [],
        /** Manual chip placement, by chip id. Overrides the formation. */
        moved: new Map(),
        /** Marks tapped in from the bank. */
        extras: [],
    };
}

/** A rotation or view change starts a clean surface — see the file comment. */
function wipe() {
    board.strokes = [];
    board.moved = new Map();
    board.extras = [];
}

/* --------------------------------------------------------------- open/close */

export function openWhiteboard(store) {
    const live = store.activeSet ? store.liveState : null;
    board = freshBoard(live?.rotation ?? 1);
    if (!live) board.live = false;

    host = el('div.wb', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Whiteboard' });
    document.body.append(host);
    document.body.classList.add('wb-open');
    render(store);
    return closeWhiteboard;
}

export function closeWhiteboard() {
    host?.remove();
    host = null;
    board = null;
    document.body.classList.remove('wb-open');
}

/* ------------------------------------------------------------------ render */

function render(store) {
    if (!host) return;
    const { chips, planBy } = chipsFor(store);

    mount(
        host,
        topBar(store),
        el('div.wb__stage', {}, [bank(store), surface(store, chips, planBy), tools(store)]),
        // The layout is landscape by design; portrait still works, it is just
        // cramped. Saying so beats silently looking broken.
        el('p.wb__turn', { text: 'Turn your phone sideways' }),
    );
}

const rerender = (store) => render(store);

function topBar(store) {
    const set = store.activeSet;
    const liveRotation = set ? store.liveState.rotation : null;

    return el('div.wb__bar', {}, [
        el('button.wb__back', { type: 'button', text: '☰', 'aria-label': 'Close whiteboard', onClick: closeWhiteboard }),
        el('span.wb__title', { text: 'Whiteboard' }),

        el(
            'div.wb__seg',
            {},
            FORMATIONS.map((formation) =>
                el('button', {
                    type: 'button',
                    class: board.view === formation.key ? 'on' : '',
                    text: formation.label,
                    onClick: () => {
                        if (board.view === formation.key) return;
                        board.view = formation.key;
                        wipe();
                        rerender(store);
                    },
                }),
            ),
        ),

        el('span.wb__spacer'),

        el('div.wb__rot', {}, [
            el('button', { type: 'button', text: '◀', 'aria-label': 'Previous rotation', onClick: () => step(store, -1) }),
            el('span.wb__rotn', { text: `ROT ${board.rotation}` }),
            el('button', { type: 'button', text: '▶', 'aria-label': 'Next rotation', onClick: () => step(store, 1) }),
        ]),

        liveRotation !== null &&
            (board.rotation === liveRotation
                ? el('span.wb__live', { text: '● LIVE' })
                : el('button.wb__live.wb__live--off', {
                      type: 'button',
                      text: '↺ live',
                      title: `Back to rotation ${liveRotation}`,
                      onClick: () => {
                          board.rotation = liveRotation;
                          wipe();
                          rerender(store);
                      },
                  })),

        el('button.wb__toggle', {
            type: 'button',
            class: board.showPlan ? 'on' : '',
            onClick: () => {
                board.showPlan = !board.showPlan;
                rerender(store);
            },
        }, [el('span.wb__dot'), el('span', { text: 'Sub plan' })]),
    ]);
}

function step(store, by) {
    board.rotation = ((((board.rotation - 1 + by) % 6) + 6) % 6) + 1;
    wipe();
    rerender(store);
}

/* -------------------------------------------------------------------- chips */

/**
 * Who is on the board and where, before any manual dragging.
 *
 * The lineup is rotated to the chosen rotation rather than read live, which is
 * what lets the stepper walk through all six without a match being in progress.
 */
function chipsFor(store) {
    const set = store.activeSet;
    const live = set ? store.liveState : null;
    const lookup = (id) => store.player(id);

    let lineup;
    if (live) {
        lineup = rotateLineupBy(live.lineup, board.rotation - live.rotation);
    } else {
        // No match running: the roster's first six, so the board is usable at
        // the kitchen table. Six is the court; anybody else is bench.
        lineup = store.roster.slice(0, 6).map((p) => p.id);
    }

    const points = formationPoints({
        lineup,
        rotation: board.rotation,
        formation: board.view,
        system: set?.system ?? DEFAULT_SYSTEM,
        playerLookup: lookup,
    });

    const chips = [];
    for (let position = 1; position <= 6; position++) {
        const id = lineup[position - 1];
        if (!id) continue;
        const player = lookup(id);
        const point = points[id] ?? { x: 0.5, y: 0.5 };
        chips.push({
            id,
            player,
            // Their half is the bottom 78% of the board, so a court point maps
            // into that band rather than the whole surface.
            x: point.x,
            y: 0.22 + point.y * 0.78,
            position,
        });
    }

    return { chips, planBy: board.showPlan ? plannedSubsAt(store, lineup) : new Map() };
}

/**
 * Planned substitutions that fire at the rotation being shown, keyed by the
 * player going out — so the badge can sit on the chip it is about.
 *
 * Reuses `planPrompts` rather than re-reading the plan, so the board says
 * exactly what the Court tab would prompt, including a sub that has moved to
 * follow an ad-hoc swap.
 */
function plannedSubsAt(store, lineup) {
    const set = store.activeSet;
    const team = store.activeTeam;
    if (!team) return new Map();

    const onCourt = new Set(lineup.filter(Boolean));
    const available = store.roster.map((p) => p.id).filter((id) => !onCourt.has(id));
    const sheet = set ? liberoSheet(set, { liberoIds: store.liberoIds }) : { rows: [] };

    const prompts = planPrompts({
        plan: store.planFor(team.id),
        lineup,
        rotation: board.rotation,
        available,
        rows: sheet.rows,
    });

    const byOut = new Map();
    for (const prompt of prompts) {
        const incoming = store.player(prompt.inId);
        if (incoming) byOut.set(prompt.outId, `▲ ${incoming.number} in`);
    }
    return byOut;
}

/* ------------------------------------------------------------------- bank */

function bank(store) {
    const onCourt = new Set();
    const { chips } = chipsFor(store);
    for (const chip of chips) onCourt.add(chip.id);

    const bench = store.roster.filter((player) => !onCourt.has(player.id));

    return el('div.wb__rail.wb__rail--left', {}, [
        bench.length > 0 && el('span.wb__raillabel', { text: 'Bench' }),
        bench.length > 0 &&
            el(
                'div.wb__chiprow',
                {},
                bench.map((player) =>
                    el('button.wb__chip', {
                        type: 'button',
                        style: `background:${colorForPlayer(player, store.state.positionColors)}`,
                        text: player.number,
                        title: `Add ${playerLabel(player)}`,
                        onClick: () => addExtra(store, { kind: 'player', label: player.number, player }),
                    }),
                ),
            ),

        el('span.wb__raillabel', { text: 'Marks' }),
        el(
            'div.wb__chiprow',
            {},
            EXTRAS.map((extra) =>
                el('button.wb__chip', {
                    type: 'button',
                    class: `wb__chip--${extra.kind}`,
                    text: extra.label,
                    title: extra.title,
                    onClick: () => addExtra(store, extra),
                }),
            ),
        ),
        el('p.wb__hint', { text: 'Tap to drop one on, then drag it.' }),
    ]);
}

/**
 * Tapped from the bank rather than dragged off it.
 *
 * A drag out of a narrow rail is a fiddly gesture on a phone and easy to start
 * by accident while scrolling the rail. Two deliberate actions — tap to add,
 * drag to place — are slower to describe and faster to do.
 */
function addExtra(store, spec) {
    extraSeq += 1;
    board.extras.push({
        id: `x${extraSeq}`,
        kind: spec.kind,
        label: spec.label,
        player: spec.player ?? null,
        // An opponent lands on *their* side of the net; everything else on ours,
        // just behind the attack line where there is usually room. Dropping a
        // blocker into our own back row means dragging it across the net before
        // it says anything.
        x: 0.5,
        y: spec.kind === 'opp' ? 0.11 : 0.34,
    });
    board.tool = 'move';
    rerender(store);
}

/* ----------------------------------------------------------------- surface */

function surface(store, chips, planBy) {
    const drawing = board.tool !== 'move';

    const court = el('div.wb__court', { class: drawing ? 'wb__court--drawing' : '' }, [
        el('div.wb__their'),
        el('span.wb__theirlabel', { text: (store.activeMatch?.opponent ?? 'Them').toUpperCase() }),
        el('div.wb__net'),
        el('span.wb__netlabel', { text: 'NET' }),
        el('div.wb__attack'),

        ...chips.map((chip) => chipNode(store, chip, planBy.get(chip.id))),
        ...board.extras.map((extra) => extraNode(store, extra)),

        inkLayer(store),
    ]);

    return el('div.wb__surface', {}, [court]);
}

function chipNode(store, chip, plan) {
    const player = chip.player;
    const moved = board.moved.get(chip.id);
    const x = moved?.x ?? chip.x;
    const y = moved?.y ?? chip.y;
    const row = chip.position >= 2 && chip.position <= 4 ? 'front' : 'back';

    const node = el(
        'div.wb__pc',
        {
            style: `left:${x * 100}%; top:${y * 100}%; background:${colorForPlayer(player, store.state.positionColors, row)}`,
            'data-chip': chip.id,
        },
        [
            el('span.wb__pcn', { text: player?.number ?? '?' }),
            el('span.wb__pcp', { text: primaryPosition(player, row) || POSITION_LABELS[chip.position] }),
            plan && el('span.wb__pcsub', { text: plan }),
        ],
    );
    makeDraggable(store, node, (nx, ny) => board.moved.set(chip.id, { x: nx, y: ny }));
    return node;
}

function extraNode(store, extra) {
    const node = el(
        'div.wb__pc',
        {
            class: `wb__pc--${extra.kind}`,
            style: `left:${extra.x * 100}%; top:${extra.y * 100}%`,
            'data-extra': extra.id,
        },
        [el('span.wb__pcn', { text: extra.label })],
    );
    makeDraggable(store, node, (nx, ny) => {
        extra.x = nx;
        extra.y = ny;
    });
    // A second tap takes it off again — the only way to remove one mark without
    // clearing the board.
    node.addEventListener('dblclick', () => {
        board.extras = board.extras.filter((e) => e.id !== extra.id);
        rerender(store);
    });
    return node;
}

/** Drag a chip around the court, in fractions of the court box. */
function makeDraggable(store, node, commit) {
    node.addEventListener('pointerdown', (event) => {
        if (board.tool !== 'move') return;
        event.preventDefault();
        event.stopPropagation();
        const court = node.parentElement.getBoundingClientRect();
        node.setPointerCapture(event.pointerId);
        node.classList.add('wb__pc--drag');

        const move = (moveEvent) => {
            const x = clamp01((moveEvent.clientX - court.left) / court.width);
            const y = clamp01((moveEvent.clientY - court.top) / court.height);
            node.style.left = `${x * 100}%`;
            node.style.top = `${y * 100}%`;
            commit(x, y);
        };
        const up = () => {
            node.classList.remove('wb__pc--drag');
            node.removeEventListener('pointermove', move);
            node.removeEventListener('pointerup', up);
            node.removeEventListener('pointercancel', up);
        };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up);
        node.addEventListener('pointercancel', up);
    });
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/* --------------------------------------------------------------------- ink */

function inkLayer(store) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'wb__ink');
    svg.setAttribute('viewBox', `0 0 ${INK_SPACE} ${INK_SPACE}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = arrowHeads();

    for (const stroke of board.strokes) svg.append(strokeNode(store, stroke));

    if (board.tool !== 'move') svg.addEventListener('pointerdown', (event) => beginStroke(store, svg, event));
    return svg;
}

function arrowHeads() {
    return INKS.map(
        (colour, index) =>
            `<marker id="wbah${index}" markerWidth="6" markerHeight="6" refX="4.2" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="${colour}" /></marker>`,
    ).join('');
}

function strokeNode(store, stroke) {
    const ns = 'http://www.w3.org/2000/svg';
    const node = document.createElementNS(ns, stroke.kind === 'circle' ? 'ellipse' : 'path');

    if (stroke.kind === 'circle') {
        node.setAttribute('cx', stroke.cx);
        node.setAttribute('cy', stroke.cy);
        node.setAttribute('rx', stroke.rx);
        node.setAttribute('ry', stroke.ry);
        node.setAttribute('fill', `${stroke.colour}22`);
    } else {
        node.setAttribute('d', stroke.d);
        node.setAttribute('fill', 'none');
        if (stroke.kind === 'arrow') node.setAttribute('marker-end', `url(#wbah${INKS.indexOf(stroke.colour)})`);
    }
    node.setAttribute('stroke', stroke.colour);
    node.setAttribute('stroke-width', '7');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    node.setAttribute('class', 'wb__stroke');

    // Erase is a mode, not a rubbing gesture: tap the thing you want gone. On a
    // phone a rubber that follows the finger deletes whatever it brushes past.
    if (board.tool === 'erase') {
        node.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            board.strokes = board.strokes.filter((s) => s !== stroke);
            rerender(store);
        });
    }
    return node;
}

function beginStroke(store, svg, event) {
    event.preventDefault();
    const box = svg.getBoundingClientRect();
    const at = (e) => ({
        x: ((e.clientX - box.left) / box.width) * INK_SPACE,
        y: ((e.clientY - box.top) / box.height) * INK_SPACE,
    });

    const start = at(event);
    const points = [start];
    const kind = board.tool;
    const colour = board.ink;

    const preview = document.createElementNS('http://www.w3.org/2000/svg', kind === 'circle' ? 'ellipse' : 'path');
    preview.setAttribute('stroke', colour);
    preview.setAttribute('stroke-width', '7');
    preview.setAttribute('stroke-linecap', 'round');
    preview.setAttribute('vector-effect', 'non-scaling-stroke');
    preview.setAttribute('fill', kind === 'circle' ? `${colour}22` : 'none');
    svg.append(preview);

    svg.setPointerCapture(event.pointerId);

    const shape = () => {
        if (kind === 'circle') {
            const last = points.at(-1);
            return {
                kind,
                colour,
                cx: (start.x + last.x) / 2,
                cy: (start.y + last.y) / 2,
                rx: Math.abs(last.x - start.x) / 2,
                ry: Math.abs(last.y - start.y) / 2,
            };
        }
        if (kind === 'arrow') {
            const last = points.at(-1);
            return { kind, colour, d: `M${start.x},${start.y} L${last.x},${last.y}` };
        }
        return { kind, colour, d: `M${points.map((p) => `${p.x},${p.y}`).join(' L')}` };
    };

    const paint = () => {
        const s = shape();
        if (s.kind === 'circle') {
            preview.setAttribute('cx', s.cx);
            preview.setAttribute('cy', s.cy);
            preview.setAttribute('rx', s.rx);
            preview.setAttribute('ry', s.ry);
        } else {
            preview.setAttribute('d', s.d);
        }
    };

    const move = (moveEvent) => {
        points.push(at(moveEvent));
        paint();
    };
    const up = () => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        svg.removeEventListener('pointercancel', up);
        preview.remove();
        // A tap with no drag is not a stroke; it is a mis-tap.
        const last = points.at(-1);
        if (Math.hypot(last.x - start.x, last.y - start.y) < 12 && kind !== 'draw') return;
        if (points.length < 2) return;
        board.strokes.push(shape());
        rerender(store);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    paint();
}

/* ------------------------------------------------------------------- tools */

function tools(store) {
    return el('div.wb__rail.wb__rail--right', {}, [
        el('span.wb__raillabel', { text: 'Ink' }),
        el(
            'div.wb__swatches',
            {},
            INKS.map((colour) =>
                el('button.wb__sw', {
                    type: 'button',
                    class: board.ink === colour ? 'on' : '',
                    style: `background:${colour}`,
                    'aria-label': `Ink ${colour}`,
                    onClick: () => {
                        board.ink = colour;
                        rerender(store);
                    },
                }),
            ),
        ),

        el('span.wb__raillabel', { text: 'Tool' }),
        ...TOOLS.map((tool) =>
            el('button.wb__tool', {
                type: 'button',
                class: board.tool === tool.key ? 'on' : '',
                onClick: () => {
                    board.tool = tool.key;
                    rerender(store);
                },
            }, [el('span.wb__toolico', { text: tool.icon }), el('span', { text: tool.label })]),
        ),

        el('span.wb__raillabel', { text: 'Fix' }),
        // Three across rather than three stacked: on a landscape phone the rail
        // has about 350px, and stacked these pushed Clear off the bottom —
        // reachable only by scrolling a narrow rail to find the button you want
        // when you have five seconds.
        el('div.wb__fixrow', {}, [
            el('button.wb__fix', {
                type: 'button',
                title: 'Undo the last mark',
                'aria-label': 'Undo the last mark',
                text: '↶',
                disabled: board.strokes.length === 0,
                onClick: () => {
                    board.strokes.pop();
                    rerender(store);
                },
            }),
            el('button.wb__fix', {
                type: 'button',
                class: board.tool === 'erase' ? 'on' : '',
                title: 'Tap a mark to remove it',
                'aria-label': 'Erase a mark',
                text: '⌫',
                disabled: board.strokes.length === 0,
                onClick: () => {
                    board.tool = board.tool === 'erase' ? 'move' : 'erase';
                    rerender(store);
                },
            }),
            el('button.wb__fix.wb__fix--danger', {
                type: 'button',
                title: 'Clear the board',
                'aria-label': 'Clear the board',
                text: '🗑',
                onClick: () => {
                    wipe();
                    board.tool = 'move';
                    rerender(store);
                    toast('Board cleared', 'warn');
                },
            }),
        ]),
    ]);
}
