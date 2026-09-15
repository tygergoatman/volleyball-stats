/**
 * The whiteboard: a landscape scratch surface for a timeout or a practice plan.
 *
 * What makes it worth building over the board in the bag: it starts from the
 * real six, in the real rotation, with real numbers and position colours —
 * where a whiteboard starts blank every single time.
 *
 * **Nothing here is stored.** Not the ink, not where chips were dragged, not the
 * extras dropped on, not who was taken off. It is a scratchpad by the owner's
 * decision, and that keeps it entirely outside the store: no schema change, no
 * migration, nothing to back up, and no risk of a stray drawing outliving the
 * reason for it. State lives in one module-level object for as long as the app
 * is open, the same way the Court tab's chosen formation does.
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
 *
 * Move moves marks *and* ink: an arrow drawn a little short is nudged rather
 * than redrawn.
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
        /** Rotated 90° on screen, rather than by turning the phone. */
        turned: false,
        /** Whether the rotation still matches the live one. */
        live: true,
        showPlan: true,
        tool: 'move',
        ink: INKS[1],
        /** Committed strokes, oldest first. */
        strokes: [],
        /** Manual chip placement, by chip id. Overrides the formation. */
        moved: new Map(),
        /** Player ids taken off the board by hand; they go back to the bench. */
        hidden: new Set(),
        /** Marks tapped in from the bank. */
        extras: [],
    };
}

/** A rotation or view change starts a clean surface — see the file comment. */
function wipe() {
    board.strokes = [];
    board.moved = new Map();
    board.hidden = new Set();
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

    // Everything lives inside one frame so that turning the board is a single
    // transform on a single element, rather than something every child has to
    // know about.
    host.classList.toggle('wb--turned', board.turned);
    mount(
        host,
        el('div.wb__frame', {}, [
            topBar(store),
            el('div.wb__stage', {}, [bank(store), surface(store, chips, planBy), tools(store)]),
            el('p.wb__turnhint', { text: 'Cramped? Tap ⟲ to turn the board.' }),
        ]),
    );
}

const rerender = (store) => render(store);

function topBar(store) {
    const set = store.activeSet;
    const liveRotation = set ? store.liveState.rotation : null;

    return el('div.wb__bar', {}, [
        el('button.wb__back', { type: 'button', text: '☰', 'aria-label': 'Close whiteboard', onClick: closeWhiteboard }),

        // Turning the board on screen rather than turning the phone. Needed
        // because the manifest unlock only helps a phone whose auto-rotate is
        // on, and plenty of people keep rotation locked — for them the board
        // would otherwise be stuck in a portrait letterbox forever.
        el('button.wb__back.wb__turnbtn', {
            type: 'button',
            class: board.turned ? 'on' : '',
            text: '⟲',
            title: board.turned ? 'Turn the board back' : 'Turn the board sideways',
            'aria-label': board.turned ? 'Turn the board back' : 'Turn the board sideways',
            'aria-pressed': board.turned ? 'true' : 'false',
            onClick: () => {
                board.turned = !board.turned;
                rerender(store);
            },
        }),

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
        if (!id || board.hidden.has(id)) continue;
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
        el('p.wb__hint', { text: 'Tap to add, drag to place. Double-tap anything to take it off.' }),
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

/**
 * Whether the pointer belongs to the ink layer.
 *
 * Erase is deliberately not a drawing tool here even though it acts on ink: the
 * layer is a full-court box, so leaving it live would swallow every tap meant
 * for a chip underneath. With it inert, an erase tap falls through to whatever
 * is actually under the finger — a stroke's hit path, a mark, or a player.
 */
const isDrawing = () => board.tool !== 'move' && board.tool !== 'erase';

function surface(store, chips, planBy) {
    const court = el('div.wb__court', { class: isDrawing() ? 'wb__court--drawing' : '' }, [
        el('div.wb__their'),
        el('span.wb__theirlabel', { text: (store.activeMatch?.opponent ?? 'Them').toUpperCase() }),
        el('div.wb__net'),
        el('span.wb__netlabel', { text: 'NET' }),
        el('div.wb__attack'),

        // Ink goes under the chips, both to look right — magnets on top of what
        // is drawn — and so that in Move mode a chip always wins the pointer
        // over a line lying across it. Drawing still works over a chip because
        // chips go inert while a drawing tool is selected.
        inkLayer(store),

        ...chips.map((chip) => chipNode(store, chip, planBy.get(chip.id))),
        ...board.extras.map((extra) => extraNode(store, extra)),
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

    // Taking a six off the board is how you show what a rotation looks like with
    // someone out of it. They drop back to the bench rail, a tap from returning.
    const take = () => {
        board.hidden.add(chip.id);
        rerender(store);
        toast(`${player?.number ?? 'Chip'} to the bench — tap the number to put them back`);
    };
    node.addEventListener('dblclick', take);
    if (board.tool === 'erase') {
        node.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            take();
        });
    }
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
    // A second tap takes it off again, as does a tap in erase mode — either way
    // one mark goes without clearing the board.
    const take = () => {
        board.extras = board.extras.filter((e) => e.id !== extra.id);
        rerender(store);
    };
    node.addEventListener('dblclick', take);
    if (board.tool === 'erase') {
        node.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            take();
        });
    }
    return node;
}

/**
 * A client point in the court's own coordinates, as a fraction of its box.
 *
 * Goes through the ink layer's `getScreenCTM()` rather than doing the arithmetic
 * against `getBoundingClientRect()`. That matters because the board can be
 * rotated 90° by CSS: a rect is axis-aligned and knows nothing about the
 * rotation, so `(clientX - left) / width` silently swaps the axes and everything
 * lands sideways. The CTM is the actual transform from screen to user space, so
 * it is right in both orientations and would stay right under any future scale
 * or offset.
 *
 * @returns {{x: number, y: number}|null} null when the layer is not laid out yet
 */
function courtPoint(courtEl, clientX, clientY) {
    const svg = courtEl.querySelector('.wb__ink');
    const ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: point.x / INK_SPACE, y: point.y / INK_SPACE };
}

/** Drag a chip around the court, in fractions of the court box. */
function makeDraggable(store, node, commit) {
    node.addEventListener('pointerdown', (event) => {
        if (board.tool !== 'move') return;
        event.preventDefault();
        event.stopPropagation();
        const courtEl = node.parentElement;
        node.setPointerCapture(event.pointerId);
        node.classList.add('wb__pc--drag');

        const move = (moveEvent) => {
            const point = courtPoint(courtEl, moveEvent.clientX, moveEvent.clientY);
            if (!point) return;
            const x = clamp01(point.x);
            const y = clamp01(point.y);
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

    if (isDrawing()) svg.addEventListener('pointerdown', (event) => beginStroke(store, svg, event));
    return svg;
}

function arrowHeads() {
    return INKS.map(
        (colour, index) =>
            `<marker id="wbah${index}" markerWidth="6" markerHeight="6" refX="4.2" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="${colour}" /></marker>`,
    ).join('');
}

/**
 * One committed mark: a group holding the ink and, under it, a much fatter
 * transparent copy of the same geometry.
 *
 * The ink is 7px wide, which is nothing to hit with a thumb. Rather than fatten
 * what the coach sees, the hit copy is what receives the pointer, so tapping
 * *near* a line counts as tapping it. The group is what carries the translation,
 * so ink and hit area can never drift apart.
 */
function strokeNode(store, stroke) {
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('class', 'wb__strokeg');
    applyOffset(group, stroke);

    const geometry = () => {
        const node = document.createElementNS(ns, stroke.kind === 'circle' ? 'ellipse' : 'path');
        if (stroke.kind === 'circle') {
            node.setAttribute('cx', stroke.cx);
            node.setAttribute('cy', stroke.cy);
            node.setAttribute('rx', stroke.rx);
            node.setAttribute('ry', stroke.ry);
        } else {
            node.setAttribute('d', stroke.d);
        }
        node.setAttribute('fill', 'none');
        node.setAttribute('stroke-linecap', 'round');
        node.setAttribute('vector-effect', 'non-scaling-stroke');
        return node;
    };

    const hit = geometry();
    hit.setAttribute('class', 'wb__hit');

    const ink = geometry();
    ink.setAttribute('class', 'wb__stroke');
    ink.setAttribute('stroke', stroke.colour);
    ink.setAttribute('stroke-width', '7');
    if (stroke.kind === 'circle') ink.setAttribute('fill', `${stroke.colour}22`);
    if (stroke.kind === 'arrow') ink.setAttribute('marker-end', `url(#wbah${INKS.indexOf(stroke.colour)})`);

    group.append(hit, ink);

    // Erase is a mode, not a rubbing gesture: tap the thing you want gone. On a
    // phone a rubber that follows the finger deletes whatever it brushes past.
    if (board.tool === 'erase') {
        hit.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            board.strokes = board.strokes.filter((s) => s !== stroke);
            rerender(store);
        });
    } else if (board.tool === 'move') {
        makeStrokeDraggable(group, hit, stroke);
    }
    return group;
}

/** Where a mark has been dragged to, as an SVG transform. */
function applyOffset(group, stroke) {
    if (stroke.tx || stroke.ty) group.setAttribute('transform', `translate(${stroke.tx} ${stroke.ty})`);
    else group.removeAttribute('transform');
}

/**
 * Drag a committed mark.
 *
 * The points are left exactly as drawn and an offset is carried alongside them,
 * so a scribble of two hundred points moves by changing two numbers, and moving
 * something never quietly degrades what was drawn.
 */
function makeStrokeDraggable(group, hit, stroke) {
    hit.addEventListener('pointerdown', (event) => {
        const court = group.ownerSVGElement?.parentElement;
        const from = court && courtPoint(court, event.clientX, event.clientY);
        if (!from) return;
        event.preventDefault();
        event.stopPropagation();

        const originX = stroke.tx ?? 0;
        const originY = stroke.ty ?? 0;
        hit.setPointerCapture(event.pointerId);
        group.classList.add('wb__strokeg--drag');

        const move = (moveEvent) => {
            const to = courtPoint(court, moveEvent.clientX, moveEvent.clientY);
            if (!to) return;
            stroke.tx = originX + (to.x - from.x) * INK_SPACE;
            stroke.ty = originY + (to.y - from.y) * INK_SPACE;
            applyOffset(group, stroke);
        };
        const up = () => {
            group.classList.remove('wb__strokeg--drag');
            hit.removeEventListener('pointermove', move);
            hit.removeEventListener('pointerup', up);
            hit.removeEventListener('pointercancel', up);
        };
        hit.addEventListener('pointermove', move);
        hit.addEventListener('pointerup', up);
        hit.addEventListener('pointercancel', up);
    });
}

function beginStroke(store, svg, event) {
    event.preventDefault();
    // Same mapping the chips use, and for the same reason — see `courtPoint`.
    const court = svg.parentElement;
    const at = (e) => {
        const point = courtPoint(court, e.clientX, e.clientY);
        return point ? { x: point.x * INK_SPACE, y: point.y * INK_SPACE } : { x: 0, y: 0 };
    };

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
            // Never disabled: erase takes off players and marks as well as ink,
            // and there are always six players on the board.
            el('button.wb__fix', {
                type: 'button',
                class: board.tool === 'erase' ? 'on' : '',
                title: 'Tap a line, mark or player to take it off',
                'aria-label': 'Erase',
                text: '⌫',
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
