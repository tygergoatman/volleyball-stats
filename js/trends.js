/**
 * The season dashboard: a desk page for reading a season, not capturing one.
 *
 * **It shares the app's brain and none of its body.** Data is loaded into a real
 * `Store` and every number comes from the same pure modules the Stats tab uses,
 * so the dashboard cannot drift from the app. What it does not share is the
 * shell — no tab bar, no dock, no service worker registration — because nothing
 * here may put a finger on the thing that records matches.
 *
 * **Nothing is uploaded.** The page is published; the data never is. It reads
 * the season already on this device, or a backup file you pick, and both stay
 * in the browser. That is the same rule as `roster.json`: minors' names do not
 * leave the phone.
 */

import { Store } from './store.js';
import { playerLabel } from './model.js';
import { aggregateSeason, derive, formatAvg, formatPct } from './stats.js';
import {
    PLAYER_METRICS,
    TEAM_METRICS,
    inPlayedOrder,
    seasonBreakdown,
    seasonRotations,
    seasonSeries,
    seriesValues,
    shortDate,
} from './season.js';
import { barChart, legend, lineChart } from './ui/chart.js';
import { reportData, reportHtml } from './report.js';
import { el, mount, shareFile } from './ui/dom.js';
import { APP_VERSION } from './version.js';

/** Where the season on screen came from, so the page can say so. */
const view = { store: null, source: null, teamId: null, playerId: null, error: null };

const root = () => document.getElementById('trends');

/**
 * Charts are drawn *after* layout, because each one needs the width it actually
 * got — see `chart.js` for why that is not negotiable.
 *
 * So a panel puts an empty box in the tree with its spec attached, and one pass
 * over the page fills them in once the browser has settled the widths.
 */
const pending = new WeakMap();

function chartSlot(spec) {
    const slot = el('div.chartslot');
    pending.set(slot, spec);
    return slot;
}

function drawCharts() {
    for (const slot of root().querySelectorAll('.chartslot')) {
        const spec = pending.get(slot);
        if (!spec) continue;
        const width = slot.clientWidth || slot.parentElement?.clientWidth || 720;
        slot.replaceChildren(spec.kind === 'bar' ? barChart({ ...spec, width }) : lineChart({ ...spec, width }));
    }
}

let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    // Redraw rather than rescale: the whole point is that one unit is one pixel.
    resizeTimer = setTimeout(drawCharts, 150);
});

/* ------------------------------------------------------------------ data */

function open(store, source) {
    view.error = null;
    view.store = store;
    view.source = source;
    const teams = teamsWithMatches(store);
    view.teamId = teams[0]?.id ?? null;
    view.playerId = null;
    render();
}

/** Only teams that actually played: an empty team is a row of nothing. */
function teamsWithMatches(store) {
    return store.teams.filter((team) => store.matchesFor(team.id).length > 0);
}

function loadFromDevice() {
    const store = new Store(window.localStorage);
    if (store.state.matches.length === 0) return null;
    return store;
}

async function loadFromFile(file) {
    const store = new Store(null);
    store.importJson(await file.text());
    return store;
}

/* ---------------------------------------------------------------- render */

function render() {
    if (!view.store) return renderWelcome();

    const store = view.store;
    const teams = teamsWithMatches(store);
    const team = store.team(view.teamId) ?? teams[0] ?? null;
    const matches = team ? inPlayedOrder(store.matchesFor(team.id)) : [];
    const series = seasonSeries(matches);

    mount(
        root(),
        header(store, teams, team, matches),
        matches.length === 0
            ? el('p.trends__empty', { text: 'No matches recorded for this team yet.' })
            : el('div.trends__body', {}, [
                  seasonStrip(series),
                  headline(matches, series),
                  teamCharts(series),
                  rotationPanel(matches),
                  playerPanel(store, team, matches, series),
                  seasonTable(store, team, matches),
                  reportPanel(store, team, matches, series),
              ]),
    );
    drawCharts();
}

function renderWelcome() {
    const onDevice = loadFromDevice();

    mount(
        root(),
        el('div.trends__welcome', {}, [
            el('h1.trends__title', { text: 'Season Trends' }),
            el('p.trends__lede', {
                text: 'Match-by-match trends for a season captured in the Volleyball Stats app.',
            }),

            onDevice &&
                el('button.btn.btn--primary', {
                    type: 'button',
                    text: `Read the season on this device (${onDevice.state.matches.length} matches)`,
                    onClick: () => open(onDevice, 'this device'),
                }),

            el('label.trends__file', {}, [
                el('span', { text: onDevice ? 'Or open a backup file' : 'Open a backup file' }),
                el('input', {
                    type: 'file',
                    accept: 'application/json,.json',
                    onChange: async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                            open(await loadFromFile(file), file.name);
                        } catch (error) {
                            console.error(error);
                            view.error = `${file.name} could not be read as a backup.`;
                            render();
                        }
                    },
                }),
            ]),

            view.error && el('p.trends__error', { text: view.error }),

            el('p.trends__note', {
                text:
                    'Use Roster → Data → Share backup on the phone to produce the file. ' +
                    'Nothing is uploaded: the file is read in this browser and stays there.',
            }),
            el('a.btn.btn--ghost.btn--sm.trends__back', {
                href: './index.html',
                text: '← Back to the app',
            }),
            el('p.trends__ver', { text: `v${APP_VERSION}` }),
        ]),
    );
}

/* ---------------------------------------------------------------- header */

function header(store, teams, team, matches) {
    return el('header.trends__head', {}, [
        el('div', {}, [
            el('h1.trends__title', { text: store.state.season.name }),
            el('p.trends__source', {
                text: `${matches.length} match${matches.length === 1 ? '' : 'es'} · from ${view.source}`,
            }),
        ]),
        teams.length > 1 &&
            el(
                'div.segmented.segmented--wrap',
                {},
                teams.map((option) =>
                    el('button.seg', {
                        type: 'button',
                        class: option.id === team?.id ? 'seg--on' : '',
                        text: option.name,
                        title: option.fullName,
                        onClick: () => {
                            view.teamId = option.id;
                            view.playerId = null;
                            render();
                        },
                    }),
                ),
            ),
        el('a.btn.btn--ghost.btn--sm.trends__back', {
            href: './index.html',
            text: '← Back to the app',
        }),
        el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Open another file',
            onClick: () => {
                view.store = null;
                render();
            },
        }),
    ]);
}

/* ------------------------------------------------------- shareable report */

/**
 * Build a standalone HTML report of this team's season and hand it off.
 *
 * The charts are rendered *here* rather than in `report.js`, because a chart
 * has to be drawn at the width it will occupy and only a browser knows that.
 * `REPORT_WIDTH` is the report's own content width, so the SVG that lands in
 * the file is 1:1 on a laptop rather than a stretched viewBox with the text
 * scaled up — the mistake this dashboard already made once.
 */
const REPORT_WIDTH = 848;

function seasonChartMarkup(series) {
    const labels = series.map((point) => point.label);
    const titles = series.map((point) => `${point.date} vs ${point.opponent}`);
    const markup = {};

    for (const metric of TEAM_METRICS) {
        const format = metric.format ?? ((v) => (v === null ? '—' : String(Math.round(v))));
        const lines = metric.parts
            ? metric.parts.map((part) => ({
                  key: part.key,
                  label: part.label,
                  values: series.map((point) => (point.played ? part.read(point) : null)),
              }))
            : [{ key: metric.key, label: metric.label, values: seriesValues(series, metric) }];

        const svg = lineChart({ labels, series: lines, format, domain: metric.domain, titles, width: REPORT_WIDTH });
        const key = metric.lowerIsBetter ? `${metric.label} (lower is better)` : metric.label;
        markup[key] = svg.outerHTML + (lines.length > 1 ? legend(lines).outerHTML : '');
    }
    return markup;
}

async function shareReport(store, team, matches, series, includeNames) {
    if (matches.length === 0) {
        view.error = 'No matches to report on.';
        return render();
    }

    const data = reportData(store, team, { includeNames, charts: seasonChartMarkup(series) });
    const slug = `${team.name} ${store.state.season?.name ?? ''}`.trim().toLowerCase().replace(/\W+/g, '-');
    const filename = `${slug || 'season'}-report${includeNames ? '' : '-numbers-only'}.html`;

    await shareFile(filename, reportHtml(data, APP_VERSION), { mime: 'text/html', title: `${team.name} season report` });
}

/**
 * The export, and the one sentence about it that matters.
 *
 * Two buttons rather than a toggle: a toggle has a current position you can
 * misread, and the difference between these two files is whose names are in
 * them. Making it two deliberate taps means you cannot hand over the wrong one
 * by not having noticed a switch.
 */
function reportPanel(store, team, matches, series) {
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Share this season' }),
        el('p.trends__note', {
            text:
                'Builds one self-contained HTML file — these tables, the points split and the rotation scoring, ' +
                'for the season and every match and set. It opens in any browser with no app, no account and no ' +
                'internet, so you can email or message it to another coach.',
        }),
        el('div.trends__actions', {}, [
            el('button.btn.btn--primary', {
                type: 'button',
                text: 'Build report (with names)',
                onClick: () => shareReport(store, team, matches, series, true),
            }),
            el('button.btn.btn--ghost', {
                type: 'button',
                text: 'Build report (numbers only)',
                onClick: () => shareReport(store, team, matches, series, false),
            }),
        ]),
        el('p.trends__note', {
            text:
                'The file is built in this browser and nothing is uploaded. The version with names is for coaches ' +
                'and families — the numbers-only one carries no names at all, so it is safe to post anywhere.',
        }),
    ]);
}

/* ------------------------------------------------------------ the season */

/** Every result in order — the shape of the season in one line. */
function seasonStrip(series) {
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Results' }),
        el(
            'div.strip',
            {},
            series.map((point) =>
                el(
                    'div.strip__cell',
                    { class: `strip__cell--${point.result.kind}`, title: `${point.date} vs ${point.opponent}` },
                    [
                        el('span.strip__op', { text: point.opponent }),
                        el('span.strip__res', { text: point.result.label }),
                        el('span.strip__date', { text: point.label }),
                    ],
                ),
            ),
        ),
    ]);
}

function headline(matches, series) {
    const { breakdown, totals } = seasonBreakdown(matches);
    const tile = (label, value, sub) =>
        el('div.card__tile', {}, [
            el('span.card__val', { text: value }),
            el('span.card__lab', { text: label }),
            el('span.card__sub', { text: sub }),
        ]);

    const record = series.reduce(
        (acc, point) => {
            if (point.result.kind === 'win') acc.w += 1;
            else if (point.result.kind === 'loss') acc.l += 1;
            return acc;
        },
        { w: 0, l: 0 },
    );

    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Season' }),
        el('div.card__grid.card__grid--wide', {}, [
            tile('Record', `${record.w}–${record.l}`, 'matches'),
            tile('Points for', String(totals.us), `${share(totals.usEarnedShare)} earned`),
            tile('Points against', String(totals.them), `${share(totals.themGivenShare)} from our errors`),
            tile('Given away', String(breakdown.them.fromOurErrors), 'our errors'),
        ]),
        errorTable(totals),
    ]);
}

/**
 * A share of a total, as a percentage.
 *
 * Not `formatPct`: that renders the volleyball three-decimal form, which is
 * right for a hitting percentage and reads as nonsense for "what fraction of
 * our points did we earn" — `.023` looks like a batting average where `2%` is
 * the fact being stated.
 */
function share(value) {
    return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

/** What our points came from, and what we gave away — ranked. */
function errorTable(totals) {
    const rows = totals.errorsBy.slice(0, 8);
    if (rows.length === 0) return null;
    const most = rows[0].count;

    return el('div.ranked', {}, [
        el('h3.ranked__title', { text: 'Points we gave away, by cause' }),
        ...rows.map((row) =>
            el('div.ranked__row', {}, [
                el('span.ranked__label', { text: row.name }),
                el('span.ranked__bar', {}, [
                    el('span.ranked__fill', { style: `width:${Math.max(4, (row.count / most) * 100)}%` }),
                ]),
                el('span.ranked__n', { text: String(row.count) }),
            ]),
        ),
    ]);
}

function teamCharts(series) {
    const labels = series.map((point) => point.label);
    const titles = series.map((point) => `${point.date} vs ${point.opponent}`);

    return el(
        'section.panel',
        {},
        [el('h2.panel__title', { text: 'Match by match' })].concat(
            TEAM_METRICS.map((metric) => {
                const format = metric.format ?? ((v) => (v === null ? '—' : String(Math.round(v))));
                const lines = metric.parts
                    ? metric.parts.map((part) => ({
                          key: part.key,
                          label: part.label,
                          values: series.map((point) => (point.played ? part.read(point) : null)),
                      }))
                    : [{ key: metric.key, label: metric.label, values: seriesValues(series, metric) }];

                return el('figure.chartbox', {}, [
                    el('figcaption.chartbox__cap', {}, [
                        el('span.chartbox__name', { text: metric.label }),
                        metric.lowerIsBetter && el('span.chartbox__dir', { text: 'lower is better' }),
                    ]),
                    metric.hint && el('p.chartbox__hint', { text: metric.hint }),
                    chartSlot({ labels, series: lines, format, domain: metric.domain, titles }),
                    lines.length > 1 && legend(lines),
                ]);
            }),
        ),
    );
}

function rotationPanel(matches) {
    const rows = seasonRotations(matches);
    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Rotation differential' }),
        el('p.chartbox__hint', {
            text: 'Points won minus points lost while standing in each rotation, across the whole season.',
        }),
        chartSlot({
            kind: 'bar',
            labels: rows.map((row) => `R${row.rotation}`),
            values: rows.map((row) => row.diff),
            format: (value) => (value > 0 ? `+${Math.round(value)}` : String(Math.round(value))),
        }),
    ]);
}

/* ---------------------------------------------------------------- player */

function playerPanel(store, team, matches, teamSeries) {
    const lines = aggregateSeason(matches);
    const roster = store.roster
        .filter((player) => player.teams.includes(team?.id))
        .filter((player) => lines.has(player.id));
    const extras = [...lines.keys()]
        .filter((id) => !roster.some((player) => player.id === id))
        .map((id) => store.player(id))
        .filter(Boolean);
    const everyone = [...roster, ...extras];

    if (everyone.length === 0) return null;
    const active = everyone.find((player) => player.id === view.playerId) ?? everyone[0];
    const series = seasonSeries(matches, { playerId: active.id });
    const labels = teamSeries.map((point) => point.label);
    const titles = teamSeries.map((point) => `${point.date} vs ${point.opponent}`);

    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Player by match' }),
        el(
            'div.segmented.segmented--wrap',
            {},
            everyone.map((player) =>
                el('button.seg', {
                    type: 'button',
                    class: player.id === active.id ? 'seg--on' : '',
                    text: `#${player.number}`,
                    title: playerLabel(player),
                    onClick: () => {
                        view.playerId = player.id;
                        render();
                    },
                }),
            ),
        ),
        el('p.chartbox__hint', {
            text: `${playerLabel(active)} · a gap means she did not record anything in that match.`,
        }),
        ...PLAYER_METRICS.map((metric) => {
            const values = seriesValues(series, metric);
            const volume = metric.volume ? series.map((point) => (point.played ? metric.volume(point) : null)) : null;
            return el('figure.chartbox', {}, [
                el('figcaption.chartbox__cap', {}, [
                    el('span.chartbox__name', { text: metric.label }),
                    // Say what the rate rests on, the same as the roster card:
                    // a .500 off two swings is noise and the chart cannot show
                    // that on its own.
                    volume &&
                        el('span.chartbox__dir', {
                            text: `${volume.reduce((sum, n) => sum + (n ?? 0), 0)} attempts this season`,
                        }),
                ]),
                chartSlot({
                    labels,
                    series: [{ key: metric.key, label: metric.label, values }],
                    format: metric.format ?? ((v) => (v === null ? '—' : String(v))),
                    domain: metric.domain,
                    titles,
                }),
            ]);
        }),
    ]);
}

/* ----------------------------------------------------------- season table */

const TABLE_COLUMNS = [
    ['#', (player) => player.number, (player) => Number(player.number) || 0],
    ['Pass', (_p, _l, d) => formatAvg(d.passAvg), (_p, _l, d) => d.passAvg ?? -1],
    ['Att', (_p, line) => line.pass.att, (_p, line) => line.pass.att],
    ['Shank', (_p, line) => line.pass.zero, (_p, line) => line.pass.zero],
    ['Hit %', (_p, _l, d) => formatPct(d.hitPct), (_p, _l, d) => d.hitPct ?? -9],
    ['K', (_p, line) => line.attack.kills, (_p, line) => line.attack.kills],
    ['Att err', (_p, line) => line.attack.errors, (_p, line) => line.attack.errors],
    ['Swings', (_p, _l, d) => d.attackAtt, (_p, _l, d) => d.attackAtt],
    ['Aces', (_p, line) => line.serve.aces, (_p, line) => line.serve.aces],
    ['Serve err', (_p, _l, d) => formatPct(d.serveErrPct), (_p, _l, d) => d.serveErrPct ?? -1],
    ['Digs', (_p, line) => line.dig.digs, (_p, line) => line.dig.digs],
    ['Blocks', (_p, _l, d) => d.blockTotal, (_p, _l, d) => d.blockTotal],
    ['Pts', (_p, _l, d) => d.pointsScored, (_p, _l, d) => d.pointsScored],
    ['Err', (_p, _l, d) => d.errorsCommitted, (_p, _l, d) => d.errorsCommitted],
];

let tableSort = { column: 0, desc: false };

function seasonTable(store, team, matches) {
    const lines = aggregateSeason(matches);
    const rows = [...lines.entries()]
        .map(([id, line]) => ({ player: store.player(id), line, derived: derive(line) }))
        .filter((row) => row.player);

    const [, , sortBy] = TABLE_COLUMNS[tableSort.column];
    rows.sort((a, b) => {
        const av = sortBy(a.player, a.line, a.derived);
        const bv = sortBy(b.player, b.line, b.derived);
        return tableSort.desc ? bv - av : av - bv;
    });

    return el('section.panel', {}, [
        el('h2.panel__title', { text: `${team?.name ?? 'Season'} totals` }),
        el('div.tablewrap', {}, [
            el('table.statstable', {}, [
                el('thead', {}, [
                    el(
                        'tr',
                        {},
                        TABLE_COLUMNS.map(([label], index) =>
                            el('th', {}, [
                                el('button.statstable__sort', {
                                    type: 'button',
                                    class: tableSort.column === index ? 'statstable__sort--on' : '',
                                    text: label + (tableSort.column === index ? (tableSort.desc ? ' ▾' : ' ▴') : ''),
                                    onClick: () => {
                                        tableSort =
                                            tableSort.column === index
                                                ? { column: index, desc: !tableSort.desc }
                                                : { column: index, desc: true };
                                        render();
                                    },
                                }),
                            ]),
                        ),
                    ),
                ]),
                el(
                    'tbody',
                    {},
                    rows.map((row) =>
                        el(
                            'tr',
                            {},
                            TABLE_COLUMNS.map(([label, read]) =>
                                el('td', { class: label === '#' ? 'statstable__num' : '' }, [
                                    el('span', { text: String(read(row.player, row.line, row.derived)) }),
                                ]),
                            ),
                        ),
                    ),
                ),
            ]),
        ]),
    ]);
}

render();
