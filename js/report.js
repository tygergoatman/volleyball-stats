/**
 * The shareable season report: one self-contained HTML file, for coaches who do
 * not have the app.
 *
 * **Why a file and not a page.** The people this is for are outside the club's
 * accounts — another school's coach, a parent helping with film. A URL would
 * mean hosting minors' names somewhere; an attachment means the owner decides
 * who gets it, and can hand over a copy with names stripped instead. The file
 * opens from a phone, a laptop, email, or a thumb drive, with no network, no
 * install and no sign-in.
 *
 * **The app does the arithmetic; the report only draws it.** Every number here
 * is computed by `stats.js` at export time and baked in as text. The viewer
 * embedded in the output cannot recompute anything, which is the point: a
 * report cannot drift from the Stats tab that produced it, however long it sits
 * in somebody's inbox. It is a photograph of a season, not a second
 * implementation of one.
 *
 * Both functions here are pure and DOM-free, so the whole thing is testable
 * under `node --test` without a browser.
 */

import { matchResult, playerLabel } from './model.js';
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
    rotationBreakdown,
    totalLine,
} from './stats.js';
import { inPlayedOrder, shortDate } from './season.js';

/** Bumped when the embedded viewer's data shape changes. */
export const REPORT_FORMAT = 1;

/* -------------------------------------------------------------- the data */

/**
 * Everything the report shows, already computed.
 *
 * @param {object} store a loaded Store
 * @param {object} team the team whose season to report on
 * @param {object} [options]
 * @param {boolean} [options.includeNames] false writes jersey numbers only, for
 *   a copy that is safe to hand to anyone at all
 * @param {Object<string,string>} [options.charts] pre-rendered chart SVG, keyed
 *   by metric — supplied by the browser, since a chart has to be drawn at the
 *   width it will occupy (see `ui/chart.js`)
 * @param {Date} [options.generatedAt]
 */
export function reportData(store, team, { includeNames = true, charts = {}, generatedAt = new Date() } = {}) {
    const matches = inPlayedOrder(store.matchesFor(team.id));
    const roster = rosterFor(store, team, matches);
    const label = (player) => (includeNames ? playerLabel(player) : `#${player.number || '—'}`);

    const scopes = [scope('season', 'season', store.state.season?.name ?? 'Season', seasonSub(matches), null, matches.flatMap((m) => m.sets ?? []), aggregateSeason(matches), roster, label)];

    for (const match of matches) {
        const id = `m:${match.id}`;
        const sets = match.sets ?? [];
        scopes.push(
            scope(id, 'match', matchLabel(match), matchResult(match).label, null, sets, aggregateMatch(match), roster, label),
        );
        for (const set of sets) {
            scopes.push(
                scope(
                    `${id}:s:${set.id}`,
                    'set',
                    `Set ${set.number}`,
                    setScore(set),
                    id,
                    [set],
                    aggregate(set.events ?? []),
                    roster,
                    label,
                ),
            );
        }
    }

    return {
        format: REPORT_FORMAT,
        generated: generatedAt.toISOString(),
        includesNames: includeNames,
        season: store.state.season?.name ?? 'Season',
        team: { name: team.name, fullName: team.fullName ?? team.name },
        record: seasonRecord(matches),
        categories: CATEGORIES.map(({ key, label: text }) => ({ key, label: text })),
        scopes,
        charts,
    };
}

/** One slice — the season, a match, or a set — with its three panels. */
function scope(id, kind, label, sub, parent, sets, lines, roster, nameOf) {
    return {
        id,
        kind,
        label,
        sub,
        parent,
        points: pointsFor(sets),
        rotations: rotationBreakdown(sets),
        tables: tablesFor(lines, roster, nameOf),
    };
}

function pointsFor(sets) {
    const breakdown = breakdownForSets(sets);
    const totals = breakdownTotals(breakdown);
    return {
        us: totals.us,
        them: totals.them,
        usEarned: breakdown.us.earned,
        usGiven: breakdown.us.fromTheirErrors,
        themEarned: breakdown.them.earned,
        themGiven: breakdown.them.fromOurErrors,
        usEarnedShare: totals.usEarnedShare,
        themGivenShare: totals.themGivenShare,
        earnedBy: totals.earnedBy.map(({ name, count }) => ({ name, count })),
        errorsBy: totals.errorsBy.map(({ name, count }) => ({ name, count })),
    };
}

/**
 * The six stat tables for one slice, rendered down to strings.
 *
 * Each cell is produced by the same `COLUMNS[].read` the Stats tab calls, and
 * each `sorts` entry by the same `sort` fallback — so the report's tables are
 * the app's tables, not a reimplementation that happens to agree today.
 */
function tablesFor(lines, roster, nameOf) {
    const rows = roster
        .map((player) => {
            const line = lines.get(player.id) ?? emptyLine();
            return { player, line, derived: derive(line) };
        })
        .filter((row) => hasData(row.line));

    const tables = {};
    for (const category of CATEGORIES) {
        const columns = COLUMNS[category.key];
        const team = totalLine(rows.map((row) => row.line));
        const teamDerived = derive(team);

        tables[category.key] = {
            head: columns.map((column) => ({ label: column.label, bad: Boolean(column.bad) })),
            primary: Math.max(0, columns.findIndex((column) => column.primary)),
            rows: rows.map(({ player, line, derived }) => ({
                name: nameOf(player),
                jersey: jerseyValue(player),
                cells: columns.map((column) => String(column.read(line, derived))),
                sorts: columns.map((column) => sortValue(column, line, derived)),
            })),
            total: columns.map((column) => String(column.read(team, teamDerived))),
        };
    }
    return tables;
}

function sortValue(column, line, derived) {
    const raw = column.sort ? column.sort(line, derived) : column.read(line, derived);
    const number = typeof raw === 'number' ? raw : Number.parseFloat(raw);
    // JSON has no -Infinity, and the viewer only ever compares these, so the
    // sentinel just has to sort below every real value.
    return Number.isNaN(number) ? -1e9 : number;
}

function jerseyValue(player) {
    const number = Number.parseInt(player.number, 10);
    return Number.isNaN(number) ? Number.MAX_SAFE_INTEGER : number;
}

/** The team's players, plus anyone who recorded a stat and has since left it. */
function rosterFor(store, team, matches) {
    const roster = store.playersForTeam(team.id);
    const onRoster = new Set(roster.map((player) => player.id));
    const departed = [];
    const seen = new Set();
    for (const match of matches) {
        for (const set of match.sets ?? []) {
            for (const event of set.events ?? []) {
                const id = event.playerId;
                if (!id || onRoster.has(id) || seen.has(id)) continue;
                seen.add(id);
                const player = store.player(id);
                if (player) departed.push(player);
            }
        }
    }
    return [...roster, ...departed];
}

/**
 * `9/10 Eagles` rather than the full ISO date: a fifteen-match season puts
 * fifteen of these in one row, and the year is already in the title.
 */
function matchLabel(match) {
    const date = shortDate(match.date);
    return `${date || 'Undated'} ${match.opponent || 'Opponent'}`;
}

function setScore(set) {
    const points = breakdownTotals(breakdownForSets([set]));
    return `${points.us}–${points.them}`;
}

function seasonSub(matches) {
    return `${matches.length} match${matches.length === 1 ? '' : 'es'}`;
}

function seasonRecord(matches) {
    let won = 0;
    let lost = 0;
    for (const match of matches) {
        const kind = matchResult(match).kind;
        if (kind === 'win') won += 1;
        else if (kind === 'loss') lost += 1;
    }
    return { won, lost, label: `${won}–${lost}` };
}

/* -------------------------------------------------------------- the file */

/** Escape for HTML text and double-quoted attributes alike. */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Embed the data as JSON inside a script tag.
 *
 * `<` is escaped because a player called `<script>` would otherwise close the
 * tag and the rest of the season would render as markup. U+2028/9 are escaped
 * because they are literal newlines to a JavaScript parser but not to JSON.
 */
function embedJson(data) {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * The complete standalone document.
 *
 * No `<script src>`, no `<link rel=stylesheet>`, no fetch: everything the file
 * needs is between its own two tags, because the recipient may well open it
 * from a Downloads folder with the wifi off.
 */
export function reportHtml(data, appVersion = '') {
    const title = `${data.team.name} — ${data.season}`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div id="report"></div>
<script id="report-data" type="application/json">${embedJson(data)}</script>
<script>${REPORT_JS}</script>
<p class="foot">Generated from the Volleyball Stats app${appVersion ? ` v${escapeHtml(appVersion)}` : ''}. Every figure is a snapshot taken when this file was made.</p>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ skin */

/**
 * A deliberately small stylesheet rather than a copy of `app.css`.
 *
 * The app's sheet is 2,500 lines of phone-capture chrome — a dock, a tab bar,
 * a court — none of which exists here. This is the part that makes the report
 * recognisable: the same dark ground, the same blue, the same red for the
 * numbers that cost you something.
 */
const REPORT_CSS = `
:root {
  --bg: #0d1117; --surface: #161b22; --surface-2: #1c2128; --border: #30363d;
  --text: #e6edf3; --muted: #8b949e; --us: #2f81f7; --them: #8b949e;
  --bad: #f85149; --good: #3fb950;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding: 16px; display: flex; flex-direction: column; align-items: center;
}
#report { width: 100%; max-width: 880px; min-width: 0; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 15px; margin: 0; letter-spacing: 0.02em; }
.head { margin-bottom: 14px; }
.head__sub { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
.panel {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 14px; margin-bottom: 12px; min-width: 0;
}
.panel__head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.panel__meta { color: var(--muted); font-weight: 700; }
.hint { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
.segmented { display: flex; flex-wrap: wrap; gap: 6px; }
.seg {
  flex: 1 1 auto; min-height: 38px; padding: 8px 12px; border-radius: 10px;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
  font: inherit; font-weight: 700; font-size: 13px; cursor: pointer;
}
.seg--num { flex: 0 0 auto; }
.seg--on { background: var(--us); border-color: var(--us); color: #fff; }
.scopebar { margin-bottom: 12px; }
/* Sized to their text: a lone match on a wrapped row should not stretch to
   the full width and read as something more important than its neighbours. */
.scopebar .seg { flex: 0 1 auto; }
.scopebar + .scopebar { margin-top: -4px; }

.pointsplit__row { display: grid; grid-template-columns: 70px 1fr; gap: 8px; align-items: center; margin-bottom: 8px; }
.pointsplit__team { font-weight: 700; font-size: 13px; }
.pointsplit__bar { display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: var(--surface-2); }
.pointsplit__seg--us { background: var(--us); }
.pointsplit__seg--them { background: var(--them); }
.pointsplit__seg--given { background: var(--bad); }
.pointsplit__legend { grid-column: 2; color: var(--muted); font-size: 12px; }

.countlist { margin-top: 12px; }
.countlist__head { display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 4px; }
.countlist__rows { list-style: none; margin: 0; padding: 0; }
.countlist__row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; border-top: 1px solid var(--border); }
.countlist__name { color: var(--muted); }
.is-bad { color: var(--bad); }
.is-good { color: var(--good); }

.tablewrap { overflow-x: auto; min-width: 0; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: 6px 8px; text-align: right; white-space: nowrap; font-size: 13px; }
thead th { color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; }
thead th[aria-sort] { color: var(--text); }
tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
.player { text-align: left; position: sticky; left: 0; background: var(--surface); }
tbody tr:nth-child(even) .player { background: #191f27; }
.num { font-weight: 700; }
.name { color: var(--muted); margin-left: 6px; font-weight: 400; }
tfoot th, tfoot td { border-top: 1px solid var(--border); font-weight: 700; }

.rot { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; border-top: 1px solid var(--border); }
.rot:first-child { border-top: 0; }
.rot__id { font-weight: 700; }

.chart { margin-top: 10px; overflow-x: auto; }
.chart svg { max-width: 100%; height: auto; }
.chart__title { font-size: 13px; font-weight: 700; margin: 14px 0 2px; }

.privacy {
  border: 1px solid var(--border); border-left: 3px solid var(--us);
  background: var(--surface-2); border-radius: 8px; padding: 10px 12px;
  color: var(--muted); font-size: 12px; margin-bottom: 12px;
}
.foot { color: var(--muted); font-size: 11px; max-width: 880px; width: 100%; margin: 14px 0 0; }
@media print {
  body { background: #fff; color: #000; }
  .scopebar, .seg { display: none; }
  .panel { break-inside: avoid; border-color: #ccc; background: #fff; }
}
`;

/**
 * The viewer. Renders the baked-in tables and switches between slices.
 *
 * It does no arithmetic beyond sorting rows by numbers it was handed, and it
 * builds every node with `createElement`/`textContent` rather than `innerHTML`,
 * so a player's name is text no matter what it contains.
 */
const REPORT_JS = `
(function () {
  var data = JSON.parse(document.getElementById('report-data').textContent);
  var root = document.getElementById('report');
  var state = {
    scope: data.scopes[0] ? data.scopes[0].id : null,
    category: data.categories[0] ? data.categories[0].key : 'pass',
    sort: null
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function find(id) {
    for (var i = 0; i < data.scopes.length; i++) if (data.scopes[i].id === id) return data.scopes[i];
    return data.scopes[0];
  }
  function pct(share) { return share === null || share === undefined ? '—' : Math.round(share * 100) + '%'; }

  function button(label, on, extra, onClick) {
    var b = el('button', 'seg' + (extra ? ' ' + extra : '') + (on ? ' seg--on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function scopeBar() {
    var current = find(state.scope);
    var match = current.kind === 'set' ? current.parent : (current.kind === 'match' ? current.id : null);

    var top = el('div', 'segmented scopebar');
    top.appendChild(button('Season', current.id === 'season', null, function () { pick('season'); }));
    data.scopes.filter(function (s) { return s.kind === 'match'; }).forEach(function (s) {
      top.appendChild(button(s.label + '  ' + s.sub, s.id === match, null, function () { pick(s.id); }));
    });

    var sets = data.scopes.filter(function (s) { return s.kind === 'set' && s.parent === match; });
    if (!sets.length) return [top];

    var row = el('div', 'segmented scopebar');
    sets.forEach(function (s) {
      row.appendChild(button('S' + s.label.replace(/\\D/g, ''), s.id === current.id, 'seg--num', function () { pick(s.id); }));
    });
    row.appendChild(button('Whole match', current.id === match, null, function () { pick(match); }));
    return [top, row];
  }

  function pick(id) { state.scope = id; state.sort = null; render(); }

  function pointsPanel(scope) {
    var p = scope.points;
    var panel = el('section', 'panel');
    var head = el('div', 'panel__head');
    head.appendChild(el('h2', null, 'Points'));
    head.appendChild(el('span', 'panel__meta', p.us + '–' + p.them));
    panel.appendChild(head);

    if (p.us + p.them === 0) {
      panel.appendChild(el('p', 'hint', 'No points recorded in this scope.'));
      return panel;
    }

    panel.appendChild(splitRow(data.team.name, 'us', p.usEarned, p.usGiven, 'earned', 'their errors'));
    panel.appendChild(splitRow('Them', 'them', p.themEarned, p.themGiven, 'earned', 'our errors'));
    panel.appendChild(el('p', 'hint',
      pct(p.usEarnedShare) + ' of our points were earned. ' + pct(p.themGivenShare) + ' of theirs came from our errors.'));
    panel.appendChild(countList('We gave away', p.themGiven, p.errorsBy, 'is-bad'));
    panel.appendChild(countList('We earned', p.usEarned, p.earnedBy, 'is-good'));
    return panel;
  }

  function splitRow(label, side, earned, given, earnedLabel, givenLabel) {
    var total = earned + given;
    var row = el('div', 'pointsplit__row');
    row.appendChild(el('span', 'pointsplit__team', label));
    var bar = el('div', 'pointsplit__bar');
    [[earned, side], [given, 'given']].forEach(function (pair) {
      if (pair[0] <= 0) return;
      var seg = el('span', 'pointsplit__seg pointsplit__seg--' + pair[1]);
      seg.style.width = (total > 0 ? (pair[0] / total) * 100 : 0) + '%';
      bar.appendChild(seg);
    });
    row.appendChild(bar);
    row.appendChild(el('span', 'pointsplit__legend', earned + ' ' + earnedLabel + ' · ' + given + ' ' + givenLabel));
    return row;
  }

  function countList(title, total, rows, tone) {
    var wrap = el('div', 'countlist');
    if (!rows.length) { wrap.style.display = 'none'; return wrap; }
    var head = el('div', 'countlist__head');
    head.appendChild(el('span', null, title));
    head.appendChild(el('span', tone, String(total)));
    wrap.appendChild(head);
    var list = el('ul', 'countlist__rows');
    rows.forEach(function (r) {
      var li = el('li', 'countlist__row');
      li.appendChild(el('span', 'countlist__name', r.name));
      li.appendChild(el('span', null, String(r.count)));
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function tablePanel(scope) {
    var panel = el('section', 'panel');
    var tabs = el('div', 'segmented');
    data.categories.forEach(function (c) {
      tabs.appendChild(button(c.label, c.key === state.category, null, function () {
        state.category = c.key; state.sort = null; render();
      }));
    });
    panel.appendChild(tabs);

    var table = scope.tables[state.category];
    if (!table || !table.rows.length) {
      panel.appendChild(el('p', 'hint', 'No stats recorded for this selection.'));
      return panel;
    }

    var rows = table.rows.slice();
    var sort = state.sort;
    var dir = sort && sort.dir === 'asc' ? 1 : -1;
    if (sort && sort.index === -1) {
      rows.sort(function (a, b) { return dir * (a.jersey - b.jersey); });
    } else {
      var i = sort ? sort.index : table.primary;
      rows.sort(function (a, b) {
        return dir * (a.sorts[i] - b.sorts[i]) || (b.sorts[table.primary] - a.sorts[table.primary]);
      });
    }

    var t = el('table');
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(header('Player', -1, 'player'));
    table.head.forEach(function (h, index) { hr.appendChild(header(h.label, index, null)); });
    thead.appendChild(hr);
    t.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('th', 'player', r.name));
      r.cells.forEach(function (cell, index) {
        tr.appendChild(el('td', table.head[index].bad ? 'is-bad' : null, cell));
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);

    var tfoot = el('tfoot');
    var fr = el('tr');
    fr.appendChild(el('th', 'player', 'TEAM'));
    table.total.forEach(function (cell) { fr.appendChild(el('td', null, cell)); });
    tfoot.appendChild(fr);
    t.appendChild(tfoot);

    var wrap = el('div', 'tablewrap');
    wrap.appendChild(t);
    panel.appendChild(wrap);
    panel.appendChild(el('p', 'hint', 'Tap a column heading to sort by it.'));
    return panel;
  }

  function header(label, index, cls) {
    var th = el('th', cls, label);
    var active = state.sort ? state.sort.index === index : index === -2;
    if (active) th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    th.addEventListener('click', function () {
      var flip = state.sort && state.sort.index === index && state.sort.dir === 'desc';
      state.sort = { index: index, dir: flip ? 'asc' : 'desc' };
      render();
    });
    return th;
  }

  function rotationPanel(scope) {
    var panel = el('section', 'panel');
    panel.appendChild(el('h2', null, 'Rotation scoring'));
    panel.appendChild(el('p', 'hint', 'Points won and lost while in each rotation.'));
    scope.rotations.forEach(function (r) {
      var row = el('div', 'rot');
      row.appendChild(el('span', 'rot__id', 'R' + r.rotation));
      row.appendChild(el('span', r.diff > 0 ? 'is-good' : (r.diff < 0 ? 'is-bad' : null),
        r.won + '–' + r.lost + ' (' + (r.diff > 0 ? '+' : '') + r.diff + ')'));
      panel.appendChild(row);
    });
    return panel;
  }

  function chartsPanel() {
    var keys = Object.keys(data.charts || {});
    if (!keys.length) return null;
    var panel = el('section', 'panel');
    panel.appendChild(el('h2', null, 'Across the season'));
    keys.forEach(function (key) {
      panel.appendChild(el('p', 'chart__title', key));
      var box = el('div', 'chart');
      // Chart markup is generated by the app's own chart module at export
      // time, never by anything a user typed.
      box.innerHTML = data.charts[key];
      panel.appendChild(box);
    });
    return panel;
  }

  function render() {
    var scope = find(state.scope);
    root.textContent = '';

    var head = el('header', 'head');
    head.appendChild(el('h1', null, data.team.fullName + ' — ' + data.season));
    head.appendChild(el('p', 'head__sub',
      data.record.label + ' on matches · ' + scope.label + (scope.sub ? ' · ' + scope.sub : '')));
    root.appendChild(head);

    if (data.includesNames) {
      root.appendChild(el('p', 'privacy',
        'This file lists players by name. Share it with coaches and families; do not post it publicly.'));
    }

    scopeBar().forEach(function (bar) { root.appendChild(bar); });
    root.appendChild(pointsPanel(scope));
    root.appendChild(tablePanel(scope));
    root.appendChild(rotationPanel(scope));
    if (scope.id === 'season') {
      var charts = chartsPanel();
      if (charts) root.appendChild(charts);
    }
  }

  render();
})();
`;
