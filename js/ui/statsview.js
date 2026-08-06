/** Stat tables: per set, per match, and season totals. */

import {
    aggregate,
    aggregateMatch,
    aggregateSeason,
    derive,
    emptyLine,
    formatAvg,
    formatPct,
    rotationBreakdown,
    toCsv,
    totalLine,
} from '../stats.js';
import { el, mount, toast, downloadText } from './dom.js';

/** Which slice of the season is on screen, and which stat family. */
const view = { scope: 'set', category: 'pass' };

const CATEGORIES = [
    { key: 'pass', label: 'Pass' },
    { key: 'attack', label: 'Attack' },
    { key: 'set', label: 'Set' },
    { key: 'serve', label: 'Serve' },
    { key: 'def', label: 'Block / Dig' },
];

/**
 * Column definitions per category. `read` receives the raw line and its derived
 * metrics; `key` marks the column the table sorts by (descending).
 */
const COLUMNS = {
    pass: [
        { label: 'Att', read: (line) => line.pass.att },
        { label: 'Avg', read: (line, d) => formatAvg(d.passAvg), sort: (line, d) => d.passAvg ?? -1, primary: true },
        { label: '3', read: (line) => line.pass.three },
        { label: '2', read: (line) => line.pass.two },
        { label: '1', read: (line) => line.pass.one },
        { label: '.5', read: (line) => line.pass.half },
        { label: '0', read: (line) => line.pass.zero, bad: true },
    ],
    attack: [
        { label: 'K', read: (line) => line.attack.kills, primary: true },
        { label: 'A', read: (line) => line.attack.inPlay },
        { label: '0', read: (line) => line.attack.errors, bad: true },
        { label: 'Att', read: (line) => line.attack.att },
        { label: 'Hit%', read: (line, d) => formatPct(d.hitPct), sort: (line, d) => d.hitPct ?? -9 },
        { label: 'K%', read: (line, d) => formatPct(d.killPct) },
    ],
    set: [
        { label: 'Att', read: (line) => line.set.att },
        { label: 'Avg', read: (line, d) => formatAvg(d.setAvg), sort: (line, d) => d.setAvg ?? -1, primary: true },
        { label: 'Err', read: (line) => line.set.errors, bad: true },
    ],
    serve: [
        { label: 'Att', read: (line) => line.serve.att },
        { label: 'Ace', read: (line) => line.serve.aces, primary: true },
        { label: 'Err', read: (line) => line.serve.errors, bad: true },
        { label: 'Ace%', read: (line, d) => formatPct(d.acePct) },
        { label: 'Err%', read: (line, d) => formatPct(d.serveErrPct), bad: true },
    ],
    def: [
        { label: 'Dig', read: (line) => line.dig.digs, primary: true },
        { label: 'DErr', read: (line) => line.dig.errors, bad: true },
        { label: 'Solo', read: (line) => line.block.solo },
        { label: 'Asst', read: (line) => line.block.assist },
        { label: 'BErr', read: (line) => line.block.errors, bad: true },
    ],
};

export function renderStats(root, store) {
    const match = store.activeMatch;
    const { lines, sets, scopeLabel } = collect(store);

    mount(
        root,
        el('section.panel', {}, [
            el('div.segmented', {}, [
                scopeButton(store, 'set', 'This Set', !store.activeSet),
                scopeButton(store, 'match', 'Match', !match),
                scopeButton(store, 'season', 'Season', false),
            ]),
            el('p.panel__hint', { text: scopeLabel }),
        ]),

        el('section.panel', {}, [
            el(
                'div.segmented.segmented--wrap',
                {},
                CATEGORIES.map((category) =>
                    el('button.seg', {
                        type: 'button',
                        class: view.category === category.key ? 'seg--on' : '',
                        text: category.label,
                        onClick: () => {
                            view.category = category.key;
                            store.commit();
                        },
                    }),
                ),
            ),
            statTable(store, lines),
        ]),

        sets.length > 0 && rotationPanel(sets),

        el('section.panel', {}, [
            el('button.btn.btn--ghost', {
                type: 'button',
                text: 'Export these stats as CSV',
                disabled: lines.size === 0,
                onClick: () => {
                    const stamp = new Date().toISOString().slice(0, 10);
                    downloadText(`stats-${view.scope}-${stamp}.csv`, toCsv(store.roster, lines), 'text/csv');
                    toast('CSV downloaded');
                },
            }),
        ]),
    );
    return root;
}

/** Gather the stat lines and sets that match the selected scope. */
function collect(store) {
    const match = store.activeMatch;
    const set = store.activeSet;

    if (view.scope === 'set' && set) {
        return {
            lines: aggregate(set.events),
            sets: [set],
            scopeLabel: `Set ${set.number} vs ${match.opponent}`,
        };
    }
    if (view.scope === 'match' && match) {
        return {
            lines: aggregateMatch(match),
            sets: match.sets,
            scopeLabel: `${match.date} vs ${match.opponent} · ${match.sets.length} set${
                match.sets.length === 1 ? '' : 's'
            }`,
        };
    }
    const allSets = store.state.matches.flatMap((m) => m.sets);
    return {
        lines: aggregateSeason(store.state.matches),
        sets: allSets,
        scopeLabel: `${store.state.season.name} · ${store.state.matches.length} match${
            store.state.matches.length === 1 ? '' : 'es'
        }`,
    };
}

function scopeButton(store, scope, label, disabled) {
    return el('button.seg', {
        type: 'button',
        class: view.scope === scope ? 'seg--on' : '',
        text: label,
        disabled,
        onClick: () => {
            view.scope = scope;
            store.commit();
        },
    });
}

/* ------------------------------------------------------------------ table */

function statTable(store, lines) {
    const columns = COLUMNS[view.category];
    const rows = store.roster
        .map((player) => {
            const line = lines.get(player.id) ?? emptyLine();
            return { player, line, derived: derive(line) };
        })
        .filter((row) => hasData(row.line));

    if (rows.length === 0) {
        return el('p.panel__hint', { text: 'No stats recorded for this selection yet.' });
    }

    const primary = columns.find((column) => column.primary) ?? columns[0];
    rows.sort((a, b) => sortValue(primary, b) - sortValue(primary, a));

    const team = totalLine(rows.map((row) => row.line));
    const teamDerived = derive(team);

    return el('div.tablewrap', {}, [
        el('table.stattable', {}, [
            el('thead', {}, [
                el('tr', {}, [
                    el('th.stattable__player', { text: 'Player' }),
                    ...columns.map((column) => el('th', { text: column.label })),
                ]),
            ]),
            el(
                'tbody',
                {},
                rows.map(({ player, line, derived }) =>
                    el('tr', {}, [
                        el('th.stattable__player', {}, [
                            el('span.stattable__num', { text: `#${player.number}` }),
                            el('span.stattable__name', { text: player.name }),
                        ]),
                        ...columns.map((column) =>
                            el('td', {
                                class: column.bad ? 'is-bad' : '',
                                text: String(column.read(line, derived)),
                            }),
                        ),
                    ]),
                ),
            ),
            el('tfoot', {}, [
                el('tr', {}, [
                    el('th.stattable__player', { text: 'TEAM' }),
                    ...columns.map((column) => el('td', { text: String(column.read(team, teamDerived)) })),
                ]),
            ]),
        ]),
    ]);
}

function sortValue(column, row) {
    const raw = column.sort ? column.sort(row.line, row.derived) : column.read(row.line, row.derived);
    const number = typeof raw === 'number' ? raw : Number.parseFloat(raw);
    return Number.isNaN(number) ? -Infinity : number;
}

/** True when a player has at least one recorded action in this line. */
function hasData(line) {
    return (
        line.pass.att > 0 ||
        line.attack.att > 0 ||
        line.set.att > 0 ||
        line.serve.att > 0 ||
        line.dig.digs > 0 ||
        line.dig.errors > 0 ||
        line.block.solo > 0 ||
        line.block.assist > 0 ||
        line.block.errors > 0
    );
}

/* --------------------------------------------------------------- rotations */

/** Zero stays invisible; anything above it gets a visible minimum sliver. */
function barWidth(value, max) {
    return value === 0 ? 0 : Math.max(4, (value / max) * 100);
}

function rotationPanel(sets) {
    const rows = rotationBreakdown(sets);
    const max = Math.max(1, ...rows.map((row) => Math.max(row.won, row.lost)));

    return el('section.panel', {}, [
        el('h2.panel__title', { text: 'Rotation scoring' }),
        el('p.panel__hint', { text: 'Points won and lost while in each rotation.' }),
        el(
            'div.rotgrid',
            {},
            rows.map((row) =>
                el('div.rotrow', {}, [
                    el('span.rotrow__label', { text: `R${row.rotation}` }),
                    el('div.rotrow__bars', {}, [
                        el('div.rotbar.rotbar--won', {
                            style: `width:${barWidth(row.won, max)}%`,
                            title: `${row.won} won`,
                        }),
                        el('div.rotbar.rotbar--lost', {
                            style: `width:${barWidth(row.lost, max)}%`,
                            title: `${row.lost} lost`,
                        }),
                    ]),
                    el('span.rotrow__diff', {
                        class: row.diff > 0 ? 'is-good' : row.diff < 0 ? 'is-bad' : '',
                        text: `${row.won}–${row.lost} (${row.diff > 0 ? '+' : ''}${row.diff})`,
                    }),
                ]),
            ),
        ),
    ]);
}
