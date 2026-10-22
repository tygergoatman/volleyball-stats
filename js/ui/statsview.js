/** Stat tables: per set, per match, and season totals. */

import {
    CATEGORIES,
    COLUMNS,
    aggregate,
    aggregateMatch,
    aggregateSeason,
    breakdownForSets,
    breakdownTotals,
    derive,
    emptyLine,
    hasData,
    formatAvg,
    formatPct,
    rotationBreakdown,
    toCsv,
    toMatchCsv,
    totalLine,
} from '../stats.js';
import { inPlayedOrder } from '../season.js';
import { el, mount, toast, downloadText } from './dom.js';

/**
 * Which slice of the season is on screen, and which stat family. `teamId` only
 * applies to the season scope — set and match scopes take their team from the
 * open match.
 *
 * `setId` is null while the set scope should **follow the set in play**, which
 * is what you want between points. Tapping an earlier set pins it, so looking
 * back at set 1 during set 3 stays where you put it.
 */
const view = { scope: 'set', setId: null, category: 'pass', teamId: null, sort: null };

/** The player column's heading, which sorts by jersey number rather than a stat. */
const PLAYER_COLUMN = 'Player';

/**
 * Whose season is on screen: the team you picked here, or the one in play.
 * Falls back to the first team so the tab is never blank.
 */
function seasonTeam(store) {
    return (
        store.team(view.teamId) ?? store.activeTeam ?? store.team(store.state.activeTeamId) ?? store.teams[0] ?? null
    );
}

/**
 * The set the set scope is showing: the one you pinned, or the one in play.
 *
 * Falls back to the live set whenever the pin no longer resolves — a different
 * match opened, or that set was deleted — so the tab cannot end up pointing at
 * a set that is not on screen.
 */
function scopedSet(store) {
    const match = store.activeMatch;
    if (!match) return null;
    const pinned = match.sets.find((s) => s.id === view.setId);
    // Drop a pin that no longer resolves rather than carrying it: otherwise
    // reopening the old match weeks later silently lands on set 1.
    if (!pinned && view.setId !== null) view.setId = null;
    return pinned ?? store.activeSet;
}

export function renderStats(root, store) {
    const match = store.activeMatch;
    const { lines, sets, scopeLabel } = collect(store);
    const seasonTeamId = seasonTeam(store)?.id ?? null;

    mount(
        root,
        el('section.panel', {}, [
            // One button per set of the open match, so "how did set 2 go" is a
            // tap rather than a memory. They sit in the same row as Match and
            // Season because they are the same choice — how wide a slice.
            el('div.segmented.segmented--wrap', {}, [
                ...(match && match.sets.length > 0
                    ? match.sets.map((set) => setButton(store, set))
                    : [scopeButton(store, 'set', 'Set', true)]),
                scopeButton(store, 'match', 'Match', !match),
                scopeButton(store, 'season', 'Season', false),
            ]),
            // Season totals need a team of their own: you often want to look at
            // JV's numbers without opening a JV match.
            view.scope === 'season' &&
                store.teams.length > 1 &&
                el(
                    'div.segmented.segmented--wrap',
                    {},
                    store.teams.map((team) =>
                        el('button.seg', {
                            type: 'button',
                            class: team.id === seasonTeamId ? 'seg--on' : '',
                            text: team.name,
                            title: team.fullName,
                            onClick: () => {
                                view.teamId = team.id;
                                store.commit();
                            },
                        }),
                    ),
                ),
            el('p.panel__hint', { text: scopeLabel }),
        ]),

        pointsPanel(store, sets),

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
                            // Columns differ per family, so a sort chosen on one
                            // cannot mean anything on the next. Back to that
                            // family's own default.
                            view.sort = null;
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
                    const scoped = view.scope === 'season' ? seasonTeam(store) : store.activeTeam;
                    const team = scoped?.name?.toLowerCase().replace(/\W+/g, '-') ?? 'team';
                    // Name the set in the filename: three exports from one match
                    // otherwise overwrite each other in the downloads folder.
                    const setNumber = scopedSet(store)?.number;
                    const slice = view.scope === 'set' && setNumber ? `set${setNumber}` : view.scope;
                    downloadText(
                        `stats-${team}-${slice}-${stamp}.csv`,
                        toCsv(playersWithData(store, lines), lines),
                        'text/csv',
                    );
                    toast('CSV downloaded');
                },
            }),
            // The one that can be charted. The summary above answers "how did
            // she do this year"; this one answers "how did she do each week",
            // which is the question a spreadsheet is for.
            el('button.btn.btn--ghost', {
                type: 'button',
                text: 'Export season by match (CSV)',
                onClick: () => {
                    const team = seasonTeam(store);
                    const matches = inPlayedOrder(team ? store.matchesFor(team.id) : store.state.matches);
                    if (matches.length === 0) {
                        toast('No matches to export', 'warn');
                        return;
                    }
                    const stamp = new Date().toISOString().slice(0, 10);
                    const slug = team?.name?.toLowerCase().replace(/\W+/g, '-') ?? 'team';
                    downloadText(
                        `stats-${slug}-by-match-${stamp}.csv`,
                        toMatchCsv(matches, (id) => store.player(id)),
                        'text/csv',
                    );
                    toast(`${matches.length} matches exported`);
                },
            }),
            el('p.panel__hint', {
                text: 'One row per player per match, with the date and opponent in the row — the shape a spreadsheet can chart. The season dashboard reads a full backup instead.',
            }),
            // Where someone goes looking to get stats out of the app, which is
            // where they were going looking for the shareable report.
            el('a.btn.btn--ghost', {
                href: './trends.html',
                text: 'Open the season dashboard →',
            }),
            el('p.panel__hint', {
                text: 'Charts across the season, and Share this season — one HTML file of these stats you can send to another coach.',
            }),
        ]),
    );
    return root;
}

/* ------------------------------------------------ where the points went */

/**
 * Every point split four ways: earned by us, given to us, earned by them, given
 * away by us.
 *
 * The one the coach asked for is **points we gave up in errors** — so that half
 * of the panel names which errors, not just how many. "We lost by six and gave
 * away eleven" is a different conversation from "they outplayed us".
 *
 * Both totals come from the same `pointFor` the scoreboard replays, so the two
 * numbers here always add up to the score on the Court tab.
 */
function pointsPanel(store, sets) {
    const breakdown = breakdownForSets(sets);
    const totals = breakdownTotals(breakdown);

    if (totals.us + totals.them === 0) {
        return el('section.panel', {}, [
            el('h2.panel__title', { text: 'Points' }),
            el('p.panel__hint', { text: 'No points recorded in this scope yet.' }),
        ]);
    }

    const pct = (share) => (share === null ? '—' : `${Math.round(share * 100)}%`);

    return el('section.panel', {}, [
        el('div.panel__head', {}, [
            el('h2.panel__title', { text: 'Points' }),
            el('span.panel__meta', { text: `${totals.us}–${totals.them}` }),
        ]),

        el('div.pointsplit', {}, [
            splitRow({
                label: store.activeTeam?.name ?? 'Us',
                side: 'us',
                earned: breakdown.us.earned,
                given: breakdown.us.fromTheirErrors,
                earnedLabel: 'earned',
                givenLabel: 'their errors',
            }),
            splitRow({
                label: 'Them',
                side: 'them',
                earned: breakdown.them.earned,
                given: breakdown.them.fromOurErrors,
                earnedLabel: 'earned',
                givenLabel: 'our errors',
            }),
        ]),

        el('p.panel__hint', {
            text: `${pct(totals.usEarnedShare)} of our points were earned. ${pct(
                totals.themGivenShare,
            )} of theirs came from our errors.`,
        }),

        countList('We gave away', breakdown.them.fromOurErrors, totals.errorsBy, 'is-bad'),
        countList('We earned', breakdown.us.earned, totals.earnedBy, 'is-good'),
    ]);
}

/** One team's points as a two-segment bar: earned, then handed over. */
function splitRow({ label, side, earned, given, earnedLabel, givenLabel }) {
    const total = earned + given;
    const share = (n) => (total > 0 ? `${(n / total) * 100}%` : '0%');

    return el('div.pointsplit__row', {}, [
        el('span.pointsplit__team', { text: label }),
        // The bar carries proportion only; the counts live in the legend below.
        // A lopsided split (20 earned, 1 given) leaves a segment a few pixels
        // wide, and a digit inside it would be clipped to nonsense.
        el('div.pointsplit__bar', { role: 'img', 'aria-label': `${earned} ${earnedLabel}, ${given} ${givenLabel}` }, [
            earned > 0 && el(`span.pointsplit__seg.pointsplit__seg--${side}`, { style: `width:${share(earned)}` }),
            given > 0 && el('span.pointsplit__seg.pointsplit__seg--given', { style: `width:${share(given)}` }),
        ]),
        el('span.pointsplit__legend', { text: `${earned} ${earnedLabel} · ${given} ${givenLabel}` }),
    ]);
}

/** A short "what made it up" list, commonest first. */
function countList(title, total, rows, tone) {
    if (rows.length === 0) return null;
    return el('div.countlist', {}, [
        el('div.countlist__head', {}, [
            el('span.countlist__title', { text: title }),
            el('span.countlist__total', { class: tone, text: String(total) }),
        ]),
        el(
            'ul.countlist__rows',
            {},
            rows.map((row) =>
                el('li.countlist__row', {}, [
                    el('span.countlist__name', { text: row.name }),
                    el('span.countlist__count', { text: String(row.count) }),
                ]),
            ),
        ),
    ]);
}

/** Gather the stat lines and sets that match the selected scope. */
function collect(store) {
    const match = store.activeMatch;
    const set = scopedSet(store);

    if (view.scope === 'set' && set) {
        const live = set.id === store.state.activeSetId;
        return {
            lines: aggregate(set.events),
            sets: [set],
            scopeLabel: `Set ${set.number} vs ${match.opponent}${live ? ' · in play' : ''}`,
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
    // Season totals stay within one team — a JV kill does not belong in a
    // Varsity line. A player who swings between teams keeps separate totals for
    // each, because each is filtered by the matches that team played.
    const team = seasonTeam(store);
    const teamMatches = team ? store.matchesFor(team.id) : store.state.matches;
    return {
        lines: aggregateSeason(teamMatches),
        sets: teamMatches.flatMap((m) => m.sets),
        scopeLabel: `${team ? `${team.fullName} · ` : ''}${store.state.season.name} · ${
            teamMatches.length
        } match${teamMatches.length === 1 ? '' : 'es'}`,
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

/**
 * One set of the open match. Narrow — "S2" beside "Season" would look absurd
 * given equal widths — hence `seg--num`.
 *
 * Choosing the set already in play clears the pin rather than setting it, so
 * the tab goes back to following along when the next set starts. Choosing any
 * other set pins it.
 */
function setButton(store, set) {
    const live = set.id === store.state.activeSetId;
    const shown = view.scope === 'set' && scopedSet(store)?.id === set.id;

    return el('button.seg.seg--num', {
        type: 'button',
        class: [shown ? 'seg--on' : '', live ? 'seg--live' : ''].filter(Boolean).join(' '),
        text: `S${set.number}`,
        title: `Set ${set.number}${live ? ' · in play' : ''}`,
        onClick: () => {
            view.scope = 'set';
            view.setId = live ? null : set.id;
            store.commit();
        },
    });
}

/* ------------------------------------------------------------------ table */

/**
 * The current roster, plus anyone with recorded stats who has since left it —
 * so a mid-season roster change never silently drops a player's numbers.
 */
function playersWithData(store, lines) {
    // In the season scope the team on screen may not be the one in play, so the
    // roster has to follow the scope rather than the open match.
    const scoped = view.scope === 'season' ? seasonTeam(store) : null;
    const roster = scoped ? store.playersForTeam(scoped.id) : store.roster;
    const onRoster = new Set(roster.map((p) => p.id));
    const departed = [...lines.keys()]
        .filter((id) => !onRoster.has(id))
        .map((id) => store.player(id))
        .filter(Boolean);
    return [...roster, ...departed];
}

function statTable(store, lines) {
    const columns = COLUMNS[view.category];
    const rows = playersWithData(store, lines)
        .map((player) => {
            const line = lines.get(player.id) ?? emptyLine();
            return { player, line, derived: derive(line) };
        })
        .filter((row) => hasData(row.line));

    if (rows.length === 0) {
        return el('p.panel__hint', { text: 'No stats recorded for this selection yet.' });
    }

    const primary = columns.find((column) => column.primary) ?? columns[0];
    const active = columns.find((column) => column.label === view.sort?.label) ?? null;
    const byPlayer = view.sort?.label === PLAYER_COLUMN;
    const dir = view.sort?.dir === 'asc' ? 1 : -1;

    if (byPlayer) {
        // Jersey order, so "who is on this list" is answerable as well as
        // "who leads it". Unnumbered players sort last either way.
        rows.sort((a, b) => dir * (jerseyValue(a.player) - jerseyValue(b.player)));
    } else {
        const column = active ?? primary;
        // Ties keep the default column's order underneath, so a table sorted by
        // a column where half the squad has 0 is still readable.
        rows.sort(
            (a, b) =>
                dir * (sortValue(column, a) - sortValue(column, b)) || sortValue(primary, b) - sortValue(primary, a),
        );
    }

    const team = totalLine(rows.map((row) => row.line));
    const teamDerived = derive(team);

    return el('div.tablewrap', {}, [
        el('table.stattable', {}, [
            el('thead', {}, [
                el('tr', {}, [
                    sortableHeader(store, { label: PLAYER_COLUMN, className: 'stattable__player' }),
                    ...columns.map((column) => sortableHeader(store, { label: column.label })),
                ]),
            ]),
            el(
                'tbody',
                {},
                rows.map(({ player, line, derived }) =>
                    el('tr', {}, [
                        el('th.stattable__player', {}, [
                            el('span.stattable__num', { text: `#${player.number}` }),
                            player.name && el('span.stattable__name', { text: player.name }),
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

/**
 * A tappable column heading.
 *
 * First tap on a column sorts it **descending**, because every question this
 * table answers is "who leads" — most 3-passes, best hitting percentage. Tapping
 * the active column flips it, which is how you find who needs the work.
 *
 * The heading stays a `<th>` with a button inside rather than becoming one: the
 * player column is `position: sticky` so it survives horizontal scrolling, and
 * that only works on the cell.
 */
function sortableHeader(store, { label, className = '' }) {
    const isActive = view.sort?.label === label;
    const dir = isActive ? view.sort.dir : null;

    return el('th', { class: className, 'aria-sort': dir === 'asc' ? 'ascending' : dir ? 'descending' : 'none' }, [
        el(
            'button.sorthead',
            {
                type: 'button',
                class: isActive ? 'sorthead--on' : '',
                onClick: () => {
                    view.sort = isActive && view.sort.dir === 'desc' ? { label, dir: 'asc' } : { label, dir: 'desc' };
                    store.commit();
                },
            },
            [
                el('span.sorthead__label', { text: label }),
                el('span.sorthead__arrow', { text: isActive ? (dir === 'asc' ? '▲' : '▼') : '' }),
            ],
        ),
    ]);
}

/** Jersey number for sorting. Unnumbered players go last, either direction. */
function jerseyValue(player) {
    const number = Number.parseInt(player.number, 10);
    return Number.isNaN(number) ? Number.MAX_SAFE_INTEGER : number;
}

function sortValue(column, row) {
    const raw = column.sort ? column.sort(row.line, row.derived) : column.read(row.line, row.derived);
    const number = typeof raw === 'number' ? raw : Number.parseFloat(raw);
    return Number.isNaN(number) ? -Infinity : number;
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
