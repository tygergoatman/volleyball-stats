/** Tiny DOM helpers. No framework — the whole UI is a few hundred elements. */

/**
 * Create an element.
 *
 * @param {string} tag tag name with optional `#id` and `.class` suffixes
 *   (`div.card.wide`, `div#toast.toast`)
 * @param {object} [props] attributes; `text`, `html`, `class`, `dataset` and
 *   `on*` handlers are treated specially
 * @param {Array<Node|string|null|false>} [children]
 */
export function el(tag, props = {}, children = []) {
    const [head, ...classes] = tag.split('.');
    const [name, id] = head.split('#');
    const node = document.createElement(name || 'div');
    if (id) node.id = id;
    if (classes.length) node.classList.add(...classes);

    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'class') node.classList.add(...String(value).split(' ').filter(Boolean));
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
    }

    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

export function mount(node, ...children) {
    clear(node).append(...children.flat().filter(Boolean));
    return node;
}

export function $(selector, root = document) {
    return root.querySelector(selector);
}

/** Short vibration for tap confirmation, where the device supports it. */
export function buzz(pattern = 12) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

/* ------------------------------------------------------------------ sheet */

let activeSheet = null;

/**
 * Open a bottom sheet. Only one is ever open; opening a second replaces it.
 *
 * @param {{title: string, subtitle?: string, body: Node, accent?: string}} config
 * @returns {() => void} a function that closes the sheet
 */
export function openSheet({ title, subtitle = '', body, accent = '' }) {
    closeSheet();

    const panel = el('div.sheet', { role: 'dialog', 'aria-modal': 'true' }, [
        el('div.sheet__grab'),
        el('header.sheet__head', {}, [
            el('div.sheet__titles', {}, [
                el('h2.sheet__title', { text: title }),
                subtitle && el('p.sheet__subtitle', { text: subtitle }),
            ]),
            el('button.sheet__close', {
                type: 'button',
                'aria-label': 'Close',
                text: '✕',
                onClick: closeSheet,
            }),
        ]),
        el('div.sheet__body', {}, [body]),
    ]);
    if (accent) panel.classList.add(`sheet--${accent}`);

    const scrim = el('div.scrim', { onClick: closeSheet }, [panel]);
    panel.addEventListener('click', (event) => event.stopPropagation());

    document.body.append(scrim);
    document.body.classList.add('sheet-open');
    // Next frame, so the transition has a starting state to animate from.
    requestAnimationFrame(() => scrim.classList.add('scrim--visible'));

    activeSheet = scrim;
    return closeSheet;
}

export function closeSheet() {
    if (!activeSheet) return;
    const scrim = activeSheet;
    activeSheet = null;
    document.body.classList.remove('sheet-open');
    scrim.classList.remove('scrim--visible');
    setTimeout(() => scrim.remove(), 180);
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet();
});

/* ------------------------------------------------------------------ toast */

let toastTimer = null;

/**
 * Flash a short confirmation.
 *
 * @param {string} message
 * @param {'ok'|'us'|'them'|'warn'} [tone]
 */
export function toast(message, tone = 'ok') {
    let node = $('#toast');
    if (!node) {
        node = el('div#toast.toast', { role: 'status', 'aria-live': 'polite' });
        document.body.append(node);
    }
    node.className = `toast toast--${tone} toast--visible`;
    node.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('toast--visible'), 1600);
}

/* ------------------------------------------------------------------ dialog */

/**
 * Promise-based confirmation, styled like the rest of the app.
 *
 * @param {{title: string, message: string, confirmLabel?: string, danger?: boolean}} config
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
        const finish = (value) => {
            closeSheet();
            resolve(value);
        };
        const body = el('div.confirm', {}, [
            el('p.confirm__message', { text: message }),
            el('div.confirm__actions', {}, [
                el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onClick: () => finish(false) }),
                el(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, {
                    type: 'button',
                    text: confirmLabel,
                    onClick: () => finish(true),
                }),
            ]),
        ]);
        openSheet({ title, body });
    });
}

/** Trigger a file download from a string. */
export function downloadText(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
