/**
 * Charts, drawn as inline SVG.
 *
 * No library, for the same reason the app has no build step: a chart dependency
 * is a thing that rots, and everything needed here is a path and some text.
 *
 * The one rule worth stating: **a gap in the data is drawn as a gap.** A match a
 * player sat out has no value, and joining across it would draw a line implying
 * a performance that never happened. `null` breaks the path.
 */

const NS = 'http://www.w3.org/2000/svg';

/**
 * The drawing space is **measured, not assumed**: one SVG unit is one CSS pixel.
 *
 * The obvious alternative — a fixed viewBox scaled by CSS — was tried first and
 * is wrong here. An SVG scaled to fill a 1150px desk screen scales its *text*
 * too, so the axis labels came out at 18px and the chart stood 420px tall;
 * shrink the same viewBox onto a 360px phone and the labels drop to 5px. There
 * is no single ratio that serves both, so the caller passes the width it has and
 * the type stays 11px everywhere.
 */
const H = 260;
const PAD = { top: 18, right: 16, bottom: 34, left: 46 };

function node(name, attrs = {}, text = null) {
    const element = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) {
        if (value !== null && value !== undefined) element.setAttribute(key, String(value));
    }
    if (text !== null) element.textContent = text;
    return element;
}

/**
 * Round a range outward to friendly numbers, so the axis reads 0 / .1 / .2
 * rather than 0.037 / 0.114 / 0.191.
 */
function niceDomain(values, explicit) {
    const real = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    if (explicit) return explicit;
    if (real.length === 0) return [0, 1];

    // Counts get whole-number gridlines. A kills chart labelled 1.125 / 0.375
    // is arithmetically fine and reads as a mistake.
    const whole = real.every((v) => Number.isInteger(v));

    let min = Math.min(...real);
    let max = Math.max(...real);
    if (min === max) {
        // A flat series still needs height, or the line sits on an edge.
        const pad = Math.abs(min) || 1;
        min -= pad / 2;
        max += pad / 2;
    }
    // Always show zero when the data crosses it or sits near it — a hitting
    // percentage chart that hides the zero line is lying about the shape.
    if (min > 0 && min < (max - min) * 0.6) min = 0;
    if (max < 0 && max > -(max - min) * 0.6) max = 0;

    const span = max - min;
    const step = Math.pow(10, Math.floor(Math.log10(span / 3)));
    const unit = [1, 2, 2.5, 5, 10].find((m) => span / 3 <= step * m) ?? 10;
    let tick = step * unit;
    if (whole) tick = Math.max(1, Math.round(tick));
    return [Math.floor(min / tick) * tick, Math.ceil(max / tick) * tick];
}

/**
 * Gridline values. Fewer than four when the range is a handful of whole
 * numbers, so a chart from 0 to 3 is not labelled in quarters.
 */
function ticksFor([min, max], count = 4) {
    const span = max - min;
    const steps = Number.isInteger(min) && Number.isInteger(max) && span <= count ? Math.max(span, 1) : count;
    const out = [];
    for (let i = 0; i <= steps; i++) out.push(min + (span * i) / steps);
    return out;
}

/**
 * A line chart over evenly spaced points.
 *
 * @param {object} config
 * @param {string[]} config.labels one per x position
 * @param {Array<{key: string, label: string, values: Array<number|null>}>} config.series
 * @param {(value: number) => string} [config.format]
 * @param {[number, number]} [config.domain] force the y range
 * @param {string[]} [config.titles] hover text per x position
 * @returns {SVGElement}
 */
export function lineChart({ labels = [], series = [], format = (v) => String(v), domain, titles = [], width = 720 }) {
    const W = Math.max(280, Math.round(width));
    const svg = node('svg', {
        class: 'chart',
        viewBox: `0 0 ${W} ${H}`,
        width: W,
        height: H,
        role: 'img',
        'aria-label': series.map((s) => s.label).join(', '),
    });

    const all = series.flatMap((s) => s.values);
    const [min, max] = niceDomain(all, domain);
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const x = (index) => (labels.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (plotW * index) / (labels.length - 1));
    const y = (value) => PAD.top + plotH - ((value - min) / (max - min || 1)) * plotH;

    // Gridlines and their labels.
    for (const tick of ticksFor([min, max])) {
        const yy = y(tick);
        svg.append(node('line', { class: 'chart__grid', x1: PAD.left, x2: W - PAD.right, y1: yy, y2: yy }));
        svg.append(node('text', { class: 'chart__ylab', x: PAD.left - 8, y: yy + 4, 'text-anchor': 'end' }, format(tick)));
    }

    // Zero is worth its own weight when the data straddles it.
    if (min < 0 && max > 0) {
        svg.append(node('line', { class: 'chart__zero', x1: PAD.left, x2: W - PAD.right, y1: y(0), y2: y(0) }));
    }

    // X labels, thinned so they never collide. How many fit depends on how wide
    // the chart actually is, which is the other reason the width is measured.
    const every = Math.ceil(labels.length / Math.max(3, Math.floor(plotW / 58)));
    labels.forEach((label, index) => {
        if (index % every !== 0 && index !== labels.length - 1) return;
        svg.append(
            node('text', { class: 'chart__xlab', x: x(index), y: H - 12, 'text-anchor': 'middle' }, label),
        );
    });

    series.forEach((line, order) => {
        // Split on nulls so a gap stays a gap rather than being bridged.
        let run = [];
        const runs = [];
        line.values.forEach((value, index) => {
            if (value === null || value === undefined || !Number.isFinite(value)) {
                if (run.length) runs.push(run);
                run = [];
                return;
            }
            run.push([x(index), y(value)]);
        });
        if (run.length) runs.push(run);

        for (const segment of runs) {
            if (segment.length === 1) continue; // a lone point is drawn as a dot below
            svg.append(
                node('path', {
                    class: `chart__line chart__line--${order}`,
                    d: segment.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' '),
                }),
            );
        }

        line.values.forEach((value, index) => {
            if (value === null || value === undefined || !Number.isFinite(value)) return;
            const dot = node('circle', {
                class: `chart__dot chart__dot--${order}`,
                cx: x(index),
                cy: y(value),
                r: 4,
            });
            dot.append(
                node('title', {}, `${titles[index] ?? labels[index] ?? ''} — ${line.label}: ${format(value)}`),
            );
            svg.append(dot);
        });
    });

    return svg;
}

/**
 * A bar chart for one value per category, with negatives below the line.
 *
 * Used for rotation differential, where the sign is the whole message.
 */
export function barChart({ labels = [], values = [], format = (v) => String(v), width = 720 }) {
    const W = Math.max(280, Math.round(width));
    const svg = node('svg', { class: 'chart chart--bars', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    const [min, max] = niceDomain(values.concat([0]));
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const y = (value) => PAD.top + plotH - ((value - min) / (max - min || 1)) * plotH;
    const band = plotW / Math.max(values.length, 1);
    const barWidth = Math.min(band * 0.62, 64);

    for (const tick of ticksFor([min, max])) {
        const yy = y(tick);
        svg.append(node('line', { class: 'chart__grid', x1: PAD.left, x2: W - PAD.right, y1: yy, y2: yy }));
        svg.append(node('text', { class: 'chart__ylab', x: PAD.left - 8, y: yy + 4, 'text-anchor': 'end' }, format(tick)));
    }
    svg.append(node('line', { class: 'chart__zero', x1: PAD.left, x2: W - PAD.right, y1: y(0), y2: y(0) }));

    values.forEach((value, index) => {
        const centre = PAD.left + band * index + band / 2;
        const top = y(Math.max(value, 0));
        const height = Math.abs(y(value) - y(0));
        svg.append(
            node('rect', {
                class: `chart__bar ${value < 0 ? 'chart__bar--neg' : 'chart__bar--pos'}`,
                x: centre - barWidth / 2,
                y: top,
                width: barWidth,
                height: Math.max(height, 1),
                rx: 3,
            }),
        );
        svg.append(
            node(
                'text',
                {
                    class: 'chart__barval',
                    x: centre,
                    y: value < 0 ? y(value) + 14 : top - 5,
                    'text-anchor': 'middle',
                },
                format(value),
            ),
        );
        svg.append(node('text', { class: 'chart__xlab', x: centre, y: H - 12, 'text-anchor': 'middle' }, labels[index] ?? ''));
    });

    return svg;
}

/** A key for a chart's series, matching the line colours by order. */
export function legend(series) {
    const wrap = document.createElement('div');
    wrap.className = 'legend';
    series.forEach((line, order) => {
        const item = document.createElement('span');
        item.className = `legend__item legend__item--${order}`;
        item.textContent = line.label;
        wrap.append(item);
    });
    return wrap;
}
