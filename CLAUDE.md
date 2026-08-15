# Project notes — Volleyball Stats

Working memory for this project: the decisions that took a conversation to reach and would be
expensive to rediscover, plus what is still open. Written for whoever picks this up next, human or
otherwise. [README.md](./README.md) is the user-facing description; this is the reasoning behind it.

Current version: **2026.08.14a** (`js/version.js`).

## What this is

An offline-capable PWA for capturing volleyball stats courtside on an Android phone. Vanilla JS ES
modules, no build step, no dependencies, `localStorage` for persistence. Deployed to GitHub Pages at
`tygergoatman/volleyball-stats` (the owner's personal repo) by uploading the folder's **contents**.

Single user in practice — one coach, one phone. Multi-coach sharing exists but is unused so far.

## How to work on it

```sh
cd volleyball-stats && python3 -m http.server 8099     # must be HTTP, not file://
node --test "tests/*.test.js"                          # 142 tests, all pure modules
```

**Run it in a browser before claiming anything works.** Every bug that reached the user was invisible
to the unit tests: an `el()` parsing bug that silently broke every toast, a five-tab bar wrapping onto
two rows, a player ending up on court twice. The pure modules are well covered; the DOM is not, and
that is where the failures live.

## Architecture, and why

**Everything is derived from an event list.** Score, rotation, lineup, and the libero sheet are all
replayed by `computeSetState` / `liberoSheet` and never stored. This is the single most load-bearing
decision in the project: undo, deleting an entry mid-set, correcting who a kill was credited to, and
deleting a whole set are all correct _by construction_ rather than by special-casing. Do not add
derived state to storage.

**The service worker is network-first with a 3.5s timeout, not cache-first.** Cache-first meant a
change only appeared on the second launch and every deploy depended on remembering to bump a cache
constant by hand — which got forgotten, and then looked like a broken deploy. Online it serves what
is published; offline it serves the last copy it saw, which is what matters in a gym. On
`controllerchange` the page reloads itself once. `APP_VERSION` is shown on the Roster tab purely so
"is this phone running what I just published?" has a visible answer; nothing depends on it.

**Pure modules have no DOM:** `model.js`, `stats.js`, `libero.js`, `store.js`. That is what makes
them testable. Keep it that way.

## Privacy — the constraint that shapes the roster

**No player names in `roster.json`, ever.** There is a test (`tests/privacy.test.js`) that fails if
one appears. The reasoning, because it is not obvious:

- The file is published on the open web at the app's own URL. Anyone can fetch it.
- **A private repo would not help** — the app fetches it over plain HTTP, so whatever the app can
  read, anyone can. Free GitHub Pages requires a public repo anyway.
- Git history is permanent. A name committed and deleted later stays publicly retrievable. There is
  no clean undo, so the rule has to hold on the _first_ commit.

These are minors' names, which is why this got treated as a hard constraint rather than a preference.

**The roster lives on the phone.** `roster.json` is now only a seed for the three team labels
(`"players": []`). Players are added, edited and deleted in the app. Names are typed per device and
stored as local overrides that survive every refresh of the file.

Consequence: **clearing browser data deletes the roster and the season.** Roster → Data → Save backup
is the only copy. An installed home-screen PWA shares storage with the browser — it is the same
origin, not a separate copy — so a data clear takes both.

`playerLabel()` in `model.js` is the single place names are rendered: `#7 Emma` when a name exists,
`#7` when it does not. Name elements are skipped rather than rendered empty. A nameless roster is the
normal case, not a degraded one.

## Domain rules that were corrected the hard way

Getting these wrong silently produced wrong statistics, which is worse than a crash.

- **Attack: `K` = kill, `A` = attack stays in play, `0` = attack error.** These were originally wired
  as K/0/A, which computed hitting percentage wrong for every rally logged as `A`.
- **Pass `.5`** is an overpass to their side, rally continues. **Pass `0`** is a shank — point to them.
- **`D` (dig) sits inside the Pass row**, between `.5` and `0`. It is the same first-contact decision,
  but it counts as a dig and is deliberately excluded from the passing average.
- **Every stat row ends on its one point-conceding button**, so all the red sits down the right-hand
  edge. A test enforces this — it is what makes the sheet readable at a glance mid-rally.
- Hitting percentage is standard `(K − 0) / attempts` and can be negative.
- Setter and libero come from `position` (`S` / `L`) only. There were once separate boolean flags;
  two fields saying the same thing could disagree, so they were collapsed.

## The libero tracking sheet (Subs tab)

Mirrors the paper sheet a book keeper fills in. `js/libero.js` derives it; `js/ui/subs.js` renders it.

Serving order I–VI **is the starting lineup in array order** — the player in position 1 serves first,
and rotation brings position 2 to position 1 next. Rotation shifts all six uniformly and a
substitution replaces a player in place, so the order never scrambles for the whole set. Row `k` is
standing in court position `((k - rotations) mod 6) + 1`.

**The only thing that must be recorded rather than derived is `kind: 'sub' | 'libero'` on the
event**, because it cannot be inferred from the rally and it is what the 15-substitution limit turns
on. Libero replacements are unlimited and count against nothing.

Two rules the sheet enforces or flags:

- A player the libero replaced is **reserved**, not benched (`awaitingLiberoReturn`). They are the
  only one who may come back for the libero. Offering them as a substitute elsewhere put the same
  player on court twice — a real bug caught in the browser, now pinned by a test.
- **Warn, never block.** Front-row libero and a 16th substitution are flagged and still recorded. A
  courtside tool that refuses to record what actually happened is worse than one that records it and
  says so.

Substitutions are **only** on this tab. The court map shows the bench but does not act on it — subs
only happen at stoppages, so there is nothing to gain from a second way to record them.

**The serving row — the triangle on the paper sheet.** A libero may replace different players all
set, but may serve in only **one** rotational row. That row is never declared: it is whichever row a
libero first actually serves from, captured during replay (`liberoServeRow`). It is per set, which is
why the paper sheet's triangle moves between sets.

It is marked the way the paper marks it: an SVG triangle drawn **around** the serving-order numeral,
with the numeral seated in its base. Borders and clip-path cannot give an outline with the text
inside it, hence the background image; the stroke colour is baked into the data URI because custom
properties do not resolve inside one, so keep it in step with `--set`.

**There is deliberately no "about to serve from the wrong row" warning**, and it should not be added
back. A libero only ever stands in positions 1, 5 and 6 — they _enter_ at position 1 to serve rather
than rotating into it, and come off before the row reaches the front. So the only way to be one
rotation from serving is to be in position 2, which is front row, which the front-row check already
reports. An earlier build warned on both and double-reported one impossible state. A test pins that
a libero adrift in the rotation produces exactly one warning.

Serving from a second row after the fact is still reported — that one is real, and reachable.

**Two liberos may be designated** — current rules allow it, and the app supports it even though the
owner runs one. They share a single serving row between them; a second libero does not get a second
row. Only one may be on court at a time, which the UI enforces by offering neither while one is on,
and the sheet warns if data ever shows both. With two designated, entries read `L7` / `L19` rather
than a bare `L`, since `L` alone would be ambiguous.

Sets recorded before `kind` existed fall back to "was a libero involved", which gets old data close
but not exact.

## Deploying

1. Zip the folder **contents** (not the folder) and upload to the repo, committing directly to `main`.
2. Bump `APP_VERSION` so the Roster tab can confirm the phone got it.
3. Open the app once with a connection. That is the whole update procedure.

**Drag-and-drop upload adds and overwrites but never deletes.** If a change removes or renames a
file, the old one stays in the repo and keeps being served. Flag which files to delete by hand.

## Open work

### 1. Floor captain — the `c` (spec known, deliberately not built)

`L: 19c` — the `c` marks the **floor captain**, who must be on the floor at all times or have
another player designated when substituted out. Owner's call: the official book captures this, so
the app does not need to. Do not build it without being asked.

### 2. Multi-device merge (planned, deliberately not built)

Match files merge at match level: `mergeJson` adds matches the device does not have and skips ones it
does. Event-level auto-merge is a trap — there is no shared event identity, so it double-counts or
silently loses entries. The agreed sequence, if it is ever needed: duplicate detection with a
comparison view first, then per-set merge, and an upload endpoint only if the shared-folder workflow
proves annoying in practice. Currently on hold — the owner is not sure other coaches will use the app.

Note `mergeJson` does **not** update names for players the receiving device already has, so a shared
file is not a way to distribute names.

### 3. Known asymmetry

If players are ever put back into `roster.json`, deleting one in the app does not stick — the next
online load re-adds them. Teams do not have this problem (`hiddenTeamIds` remembers a removal).
Currently moot because the file lists no players, but it is a live trap if that changes.

## Not gaps, just scope

Opponent stats are not tracked (the paper sheet does both teams; this does ours, by choice). Sets are
captured but not linked to the kills that followed, so there is no assist column.
