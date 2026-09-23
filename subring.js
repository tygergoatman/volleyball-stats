/**
 * Press and hold a player on the court map to substitute them.
 *
 * The gesture: hold for {@link HOLD_MS} without moving, the court dims and up to
 * four bubbles fan out. Slide onto one and let go to make the swap; let go
 * anywhere else and nothing happens. Let go **without** having moved and the
 * bubbles stay up to be tapped — a swipe that has to land is a bad bet at 23-22,
 * and the same ring serves both hands.
 *
 * **The fan always opens toward the middle of the court.** A fixed direction
 * works until you hold somebody on the right-hand column, where half the ring
 * would be off the screen; mirroring costs a little muscle memory and is the
 * only thing that fits. Five slots, 35 degrees apart — at this radius a bubble
 * needs about that much arc to clear its neighbour — across the half-turn facing
 * away from the nearer sideline, so nothing ever crosses it.
 *
 * Which players appear is decided in `subring.js`, which is pure. This file is
 * only the pointer and the paint.
 */

import { playerLabel } from '../model.js';
import { subOptions } from '../subring.js';
import { el, buzz, toast } from './dom.js';

/** How long a press has to last before it is a hold rather than a tap. */
const HOLD_MS = 350;

/** How far a finger may drift during that press and still count as still. */
const SLOP_PX = 10;

/** Ring geometry, in pixels from the centre of the held bubble. */
const RADIUS = 84;
const SLOTS = [-70, -35, 0, 35, 70];

/** How close a finger must be to a bubble's centre to be choosing it. */
const CATCH_PX = 38;

let open = null;

/**
 * Set when a hold fires, so the click ending that same pointer sequence opens
 * no stat sheet.
 *
 * It has to be cleared by the *next gesture* rather than by the click it is
 * waiting for, because a hold that ends in a swipe produces no click at all —
 * and a flag left standing then eats the next genuine tap on a player instead.
 * That is exactly what happened the first time this ran.
 */
let swallowClick = false;
document.addEventListener(
    'pointerdown',
    () => {
        swallowClick = false;
    },
    true,
);

export function subRingIsOpen() {
    return open !== null;
}

export function closeSubRing() {
    open?.host.remove();
    open = null;
}

/**
 * Wire the gesture onto one court bubble.
 *
 * @param {HTMLElement} node the bubble
 * @param {object} context `{ store, live, set, playerId, onDone }`
 */
export function attachSubRing(node, context) {
    node.addEventListener('pointerdown', (event) => {
        if (open) return;
        // A hold is one finger. A second one on the court is somebody fumbling.
        if (!event.isPrimary) return;

        const start = { x: event.clientX, y: event.clientY };
        let timer = null;

        const cancel = () => {
            clearTimeout(timer);
            node.removeEventListener('pointermove', watch);
            node.removeEventListener('pointerup', cancel);
            node.removeEventListener('pointercancel', cancel);
        };

        const watch = (moveEvent) => {
            if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > SLOP_PX) cancel();
        };

        timer = setTimeout(() => {
            cancel();
            // The click that follows this pointer sequence belongs to the hold,
            // not to the stat sheet the bubble normally opens.
            swallowClick = true;
            openRing(node, context, event, start);
        }, HOLD_MS);

        node.addEventListener('pointermove', watch);
        node.addEventListener('pointerup', cancel);
        node.addEventListener('pointercancel', cancel);
    });

    // Capture phase, so it runs before the bubble's own handler.
    node.addEventListener(
        'click',
        (event) => {
            if (!swallowClick) return;
            swallowClick = false;
            event.preventDefault();
            event.stopPropagation();
        },
        true,
    );
}

/* ------------------------------------------------------------------ the ring */

function openRing(node, context, downEvent, start) {
    const { store, live, set, playerId } = context;
    const rows = context.rows ?? [];
    const onCourt = new Set(live.lineup.filter(Boolean));
    const offCourt = store.roster.filter((player) => !onCourt.has(player.id)).map((player) => player.id);

    const options = subOptions({
        playerId,
        lineup: live.lineup,
        rotation: live.rotation,
        plan: store.planFor(),
        rows,
        liberoIds: store.liberoIds,
        offCourt,
    });

    const held = store.player(playerId);
    const box = node.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };

    /** Bubbles, in the order they take slots outward from the middle of the fan. */
    const items = [];
    if (options.planned) {
        items.push({
            key: 'planned',
            move: options.planned,
            label: store.player(options.planned.inId)?.number ?? '?',
            note: 'PLAN',
            className: 'ring__b--plan',
            size: 58,
        });
    }
    if (options.back) {
        items.push({
            key: 'back',
            move: options.back,
            label: store.player(options.back.inId)?.number ?? '?',
            note: 'BACK',
            className: 'ring__b--back',
            size: 50,
        });
    }
    if (options.libero) {
        items.push({
            key: 'libero',
            move: options.libero,
            label: store.player(options.libero.inId)?.number ?? '?',
            note: 'LIB',
            className: 'ring__b--lib',
            size: 50,
        });
    }

    const host = el('div.ring', { role: 'dialog', 'aria-label': `Substitute ${playerLabel(held)}` });
    const scrim = el('div.ring__scrim', {
        onPointerDown: (event) => {
            event.preventDefault();
            closeSubRing();
        },
    });
    host.append(scrim);

    host.append(
        el('div.ring__halo', {
            style:
                `left:${centre.x}px;top:${centre.y}px;` +
                `width:${box.width + 10}px;height:${box.height + 10}px`,
        }),
    );

    // Fan toward the middle of the court, never across the nearer sideline.
    const away = centre.x > window.innerWidth / 2 ? 180 : 0;
    const slots = SLOTS.map((offset) => away + offset);
    // Subs is the bottom-most slot whichever way the fan points, so it means the
    // same flick every time.
    const subsDeg = slots.reduce((a, b) => (Math.sin(rad(b)) > Math.sin(rad(a)) ? b : a));
    const openSlots = slots
        .filter((deg) => deg !== subsDeg)
        .sort((a, b) => Math.abs(a - away) - Math.abs(b - away));

    const targets = [];
    items.forEach((item, index) => {
        const deg = openSlots[index];
        if (deg === undefined) return;
        targets.push({ ...item, ...place(centre, deg) });
    });
    targets.push({
        key: 'subs',
        label: '⋯',
        note: 'SUBS',
        className: 'ring__b--subs',
        size: 52,
        ...place(centre, subsDeg),
    });

    const nodes = new Map();
    for (const target of targets) {
        const bubble = el(
            'button.ring__b',
            {
                type: 'button',
                class: target.className,
                style: `left:${target.x}px;top:${target.y}px;width:${target.size}px;height:${target.size}px`,
                onClick: () => choose(target),
            },
            [el('span.ring__n', { text: target.label }), el('span.ring__t', { text: target.note })],
        );
        nodes.set(target.key, bubble);
        host.append(bubble);
    }

    host.append(
        el('p.ring__hint', {
            style: `top:${Math.min(centre.y + RADIUS + 54, window.innerHeight - 96)}px`,
            text: targets.length > 1 ? 'Slide to one and let go' : 'Nothing planned — ⋯ for the sub sheet',
        }),
    );

    document.body.append(host);
    buzz();
    open = { host, context };

    /* ---------------------------------------------------- finishing the hold */

    const choose = (target) => {
        closeSubRing();
        if (target.key === 'subs') {
            context.onSubs?.(playerId);
            return;
        }
        store.recordSub(target.move.outId, target.move.inId, target.move.kind);
        buzz();
        const incoming = store.player(target.move.inId);
        toast(`${playerLabel(incoming)} in for ${playerLabel(held)}`);
    };

    const nearest = (x, y) => {
        let best = null;
        let bestDistance = CATCH_PX;
        for (const target of targets) {
            const distance = Math.hypot(x - target.x, y - target.y);
            if (distance < Math.max(bestDistance, target.size / 2)) {
                best = target;
                bestDistance = distance;
            }
        }
        return best;
    };

    // The finger is still down from the press. Follow it: if it leaves on a
    // bubble, that is the choice. If it never moved, the ring stays up to be
    // tapped, which is what the buttons above are for.
    let moved = false;
    let hot = null;

    const track = (moveEvent) => {
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > SLOP_PX) moved = true;
        const next = nearest(moveEvent.clientX, moveEvent.clientY);
        if (next === hot) return;
        if (hot) nodes.get(hot.key)?.classList.remove('ring__b--hot');
        hot = next;
        if (hot) {
            nodes.get(hot.key)?.classList.add('ring__b--hot');
            buzz();
        }
    };

    const release = (upEvent) => {
        window.removeEventListener('pointermove', track);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
        if (!moved) return; // Stays open for tapping.
        const target = nearest(upEvent.clientX, upEvent.clientY);
        if (target) choose(target);
        else closeSubRing();
    };

    window.addEventListener('pointermove', track);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    void downEvent;
}

const rad = (deg) => (deg * Math.PI) / 180;

function place(centre, deg) {
    return { x: centre.x + Math.cos(rad(deg)) * RADIUS, y: centre.y + Math.sin(rad(deg)) * RADIUS };
}
