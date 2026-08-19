# Project notes — Volleyball Stats

Working memory for this project: the decisions that took a conversation to reach and would be
expensive to rediscover, plus what is still open. Written for whoever picks this up next, human or
otherwise. [README.md](./README.md) is the user-facing description; this is the reasoning behind it.

Current version: **2026.08.19b** (`js/version.js`).

## What this is

An offline-capable PWA for capturing volleyball stats courtside on an Android phone. Vanilla JS ES
modules, no build step, no dependencies, `localStorage` for persistence. Deployed to GitHub Pages at
`tygergoatman/volleyball-stats` (the owner's personal repo) by uploading the folder's **contents**.

Single user in practice — one coach, one phone. Multi-coach sharing exists but is unused so far.

## How to work on it

```sh
cd volleyball-stats && python3 -m http.server 8099     # must be HTTP, not file://
node --test "tests/*.test.js"                          # 218 tests, all pure modules
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

**Pure modules have no DOM:** `model.js`, `stats.js`, `libero.js`, `formations.js`, `plan.js`, `store.js`. That is what makes
them testable. Keep it that way.

**Add every new module to `SHELL` in `sw.js` in the same change that creates it.** `libero.js`,
`formations.js` and `ui/subs.js` were each shipped without it and nothing caught them: the fetch
handler caches what it serves, so one online visit papers over the omission completely. The failure
only bites an install that never ran online — and since `store.js` imports `formations.js`, that
failure is the whole app, not the one tab. `tests/sw.test.js` now compares the list against the files
on disk in both directions.

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
- Setter and libero come from `positions` (`S` / `L`) only. There were once separate boolean flags;
  two fields saying the same thing could disagree, so they were collapsed.

## Positions are a list (schema v4)

`player.positions` is an array, because players go all the way around — setter in the back, outside
in the front — and a single string could not say so. It is stored **sorted by
`POSITION_PRECEDENCE`** (`L, S, DS, OPP, MB, OH`), so `['S','OH']` and `['OH','S']` are the same
record and tap order never leaks into storage.

`positions[0]` is the primary where there is no court to consult — the roster list, the bench — and
the ordering is what makes that meaningful: the **distinctive** role leads.

**On court, the row decides instead.** `primaryPosition(player, row)` answers for where she is
standing right now, because this team's 6-2 has **setters setting from the back row only**: an S/OH
who has rotated to the front is hitting outside and should read as an OH, not a setter. So the same
player is setter-orange in the back and hitter-blue in the front, and the `S` badge appears only in
the back. `FRONT_ROW_POSITIONS` / `BACK_ROW_POSITIONS` hold the split, and a test asserts every
roster position sits in exactly one of them so none can silently drop out of the rule.

A player with nothing playable from the row she is in **keeps her own position** rather than being
blanked — a pure setter in the front row really is a setter, she just cannot set from there, and a
front-row libero is still the libero. Saying less than the truth would not help; the 6-2 and
front-row-libero checks are what flag an odd lineup.

Where several positions do and do not get shown:

- **Roster list** — one tag per position, each in its own colour. There is room.
- **Court bubble** — one, and only the highlighted `S`/`L`. A bubble has room for a fact, not a list.
- **Bench chip, picker row, stat sheet subtitle** — the joined list via `positionsLabel()`.

**`L` is exclusive, enforced in the picker.** Within a set you either are the designated libero or
you are not — a libero may not play front row or attack above the net, so "L and OH" describes no
legal player. Tapping `L` clears the rest and vice versa. It also keeps `isSpecialist` unambiguous.

**`isSpecialist` is "specialist and nothing else", not "specialist somewhere in the list."** A pure
L or DS never carries a 6-2 role, so their own tag wins. A player tagged OH **and** DS is a hitter
who also covers back row: she does rotate through the six roles, and labelling her "DS" while she
stands in an outside slot would hide what the court exists to show.

**This removed a class of false warning.** The 6-2 check now asks whether the slot's position is
_among_ the player's, so a swing player in an outside slot stops tripping it every single rotation.
A test walks all six rotations to pin that. The message names the whole list — "is S/OH, expected
MB" — because a warning you cannot act on is noise.

Two migration traps, both live-tested:

- The v1/v2 booleans are read **only when there is no `position`**. Promoting them to a second entry
  would turn `position: 'OH', isSetter: true` — a record with a stale flag — into a claim that she
  plays both, inventing a fact from an old bug.
- `playerOverrides` are raw change objects replayed over players after **every** roster refresh, so a
  v3 override carrying `position` would keep re-attaching the old key long after the players
  themselves migrated. `migrate()` converts the overrides too.

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

## Formations (Court tab)

Three views of the same six players: **Rotation** (legal rotational positions),
**Base** (where they play once the ball is live), and **Serve Rcv** (the passing formation). Base is the
default because that is where play happens and therefore where stats get tapped; the owner uses
Rotation to check the lineup against the referee.

`js/formations.js` holds the tables, transcribed from the owner's 6-2 rotation sheets. The Rotation
view needed no data — it was verified against the sheets position for position and is the lineup the
app already had. Label positions were pulled out of the PDF with `pdftotext -bbox` rather than read
off a picture, which is the only reason the transcription can be trusted.

**Roles belong to the rotation slot, not the person.** Substitute for the second middle and the
substitute _is_ MB2 while they are on. So `assignRoles` reads the _current_ lineup, never
`startingLineup` — an earlier version used the starting lineup and left roles attached to players
who had been subbed off. Court position `p` holds canonical slot `(p - 1 + rotation - 1) mod 6`,
which works because rotation N means the Nth player of the team's order is serving.

**Nothing legal moves when the view does.** The bubble's position number and the serve indicator are
always the player's _rotational_ position, so a formation view can never hide an overlap or mislead
about who is serving. Tapping a bubble records against the player, so capture is unaffected.

The base tables are guarded structurally rather than by re-reading the sheets: every rotation places
all six roles exactly once, a setter is always at position 1 with the other setter at position 2, and
front row always holds one middle, one outside and one setter. A fat-fingered cell breaks one of
those.

Where players carry a roster position, a lineup that contradicts the 6-2 order is reported on the
court rather than silently drawn.

**Serve-receive is not a permutation** — it is a spatial formation with passers spread across the
court, so it needs coordinates per role, not position slots. The owner has confirmed overlapping and
off-grid bubbles are fine there, and that it is reference-only. Deliberately deferred.

### Serve-receive, and the animation

Serve-receive is **not** a permutation of the six positions — it is a spatial formation, so
`SERVE_RECEIVE` holds normalised court coordinates per role (`x` 0 left to 1 right, `y` 0 net to 1
end line). Pulled from the PDF with `pdftotext -bbox` and normalised per panel, not estimated by eye.

The sheets draw everyone between the attack line and the end line, with the whole front court empty.
Reproduced literally that left the app's court half empty and stacked players on top of each other,
so `spreadDepth` stretches the drawn band over the playable height. Relative depth is exact; only the
scale changes. Overlap is expected and fine here — the owner confirmed it — so receive bubbles are
smaller and z-ordered by depth, leaving each an edge to tap.

**The transition arrows on the sheets are not drawn.** Switching view animates the bubbles between
formations instead, which carries the same information without covering a phone-sized court in
arrows.

That animation is **FLIP, not a CSS transition on `left`/`top`.** The app re-renders wholesale —
`mount` clears and rebuilds — so every bubble is a fresh node with no previous position for a plain
transition to animate from. `setFormation` measures the old centres, `runFlip` offsets each new
bubble back there and lets it travel. A `.bubble--flip` class carries the longer easing and is
removed on `transitionend` so press feedback stays snappy. Skipped under `prefers-reduced-motion`.

Watch for: `.bubble` declared `transition` twice at one point and the later one silently won. If
motion stops working, check for a second declaration before anything else.

**Rotations 1 and 4 do not switch the front row after receiving** — the sheets' note, and what their
arrows show. No extra table was needed: not switching _is_ the rotational arrangement, so the
destination is an arrangement the app already draws.

That is now a **Receive / After pass** toggle inside the serve-receive view rather than a note telling
the coach to go and look at another view. `afterReceiveFormation(rotation)` resolves to `base` for
rotations 2, 3, 5 and 6 and to `rotation` for 1 and 4; `formationPoints` recurses into it. Resolving
rather than storing a fourth table keeps it honest — correct Base and this follows automatically, and
a test asserts it matches Base everywhere except 1 and 4.

It is a sub-toggle, not a fourth button on the main bar, for two reasons: four buttons crowd a 412px
court, and "after the pass" is a stage of serve-receive rather than a peer of it. Serve Rcv stays lit
on the main bar for both stages.

**The other alternate is out of scope, not pending.** The sheets carry a second note — "have the OH1
stay back for SR with S1 releasing from backrow" (OH2/S2 in rotation 4) — which is a genuinely
different _receive_ formation rather than a different destination. **This team does not play it: they
do not release the setter from the back on serve receive.** So it is declined, not deferred. Do not
build it, and do not raise it again as a gap; the note on the sheet is an option their programme does
not use.

It was also prose only — the sheets never draw it — so the coordinates would have had to be invented
rather than transcribed, unlike every other entry in `SERVE_RECEIVE`.

## Starting rotation

Entered lineup = serving order. Picking **starting rotation N** rotates it so the Nth player in that
order is the one serving, and the setup court map re-renders as you tap.

This was broken until 2026.08.14b: `startingRotation` was stored and fed into the rotation counter,
but never applied to `startingLineup`, so the lineup went in exactly as placed and merely got
labelled. The control looked inert because it was. `rotateLineupBy` in `model.js` does the work, and
the button applies the delta from the current rotation so tapping around composes correctly.

Because the map moves, the numbering convention does not have to be argued about — tap until the
court matches the floor. Sets recorded before the fix hold whatever lineup was placed, which was
being taken literally, so they are still self-consistent.

## Court colours by position

Bubbles are filled by the player's roster position so the setter, libero and DS are identifiable at a
glance while capturing. `POSITION_COLORS` in `model.js` holds the defaults; `state.positionColors`
holds anything the coach overrides from Roster → Court colours.

**Hitters share one colour by default.** The useful signal is "hitter / setter / libero / DS", not six
hues competing on one court. Every position is still individually overridable.

**Untagged players keep the original blue**, so a roster with no positions tagged looks exactly as it
did before. The feature is effectively opt-in by tagging.

**Hue is position, lightness is row.** Back-row bubbles use `darkenHex`, so colouring by position does
not cost the front/back read the shading used to carry.

**The palette is contrast-checked and a test enforces it.** Every default is at least 3.0:1 against
the white bold text on a bubble, at full strength and darkened. Amber (`#f59e0b`, 2.15) and light teal
(`#14b8a6`, 2.49) were the obvious picks and both failed — do not swap one in without re-running
`tests/model.test.js`. The editor offers a fixed swatch set for the same reason; a free colour picker
would let an illegible fill through.

The colour comes from the player's **primary** position — `positions[0]`, which the canonical sort
makes the most distinctive one they play. See "Positions are a list" above.

**A bug worth remembering:** the first cut computed the fill _before_ `isFront` was declared in
`bubble()`. Temporal dead zone, the whole court render threw, and all 167 unit tests still passed.
Declaration order inside `bubble()` matters, and this is another entry in the "run it in a browser"
column.

## Court tab screen order

`renderCourt` stacks `scoreboard, courtMap, benchStrip, actionBar, recentStrip`. **Frequency decides
vertical order** — the action bar sits above the history because that is the rule, not because of
where it happened to land.

After game one the owner reported reaching for **+1 Us / +1 Them** constantly when play outran the
stat detail, and having to scroll past the history to get to them. The history is only read when
undoing an entry or two. So the most-tapped controls moved up and the least-read panel moved down.
Anything added to this screen later gets placed by the same test: how often is it tapped, not how
important it feels.

One consequence to keep in mind when adding anything here: **the stat sheet's buttons overlay this
strip**, so whatever sits at the bottom of the court screen is what a stray second tap would hit as a
sheet closes. With Undo now in that band, that mattered — see the double-tap entry in the review
findings for how `closeSheet` handles it.

## The game plan (Subs tab, prompted on Court)

Planned substitutions, written the way the coach writes them on paper —
`L > 19, 8 > 4, 4 > 8`, read as **in > out**. The screen uses that order on purpose.

Two shapes, deliberately not one list, because the coach's two examples are two different things:

- **One standing libero pairing** (`{liberoId, replacesId}`). Not keyed to a rotation: what triggers
  it is the player crossing between rows. One line of input covers all six rotations and both
  directions — libero on when the player she replaces is in the back row, off when the slot reaches
  the front.
- **A rotation-keyed list** of `{rotation, inId, outId}`. Prompted as the rotation counter reaches
  that number, which is exactly when the ball is dead and a sub is legal.

**Returns are ordinary rows, never inferred.** `8 > 4` and `4 > 8` are two entries. Inferring the
return means guessing _when_ the player should come back, and a wrong guess prompts at the wrong
moment — worse than not prompting.

### The rule that holds it together: nothing records that a sub happened

Whether to prompt is derived — the player going out is on court, the player coming in is not. That
one check buys all of:

- rotating past the same rotation twice in a set does not re-offer a sub already made
- a new set re-arms everything with no reset step
- undoing a sub brings its prompt back, correctly

`tests/plan.test.js` pins each of those. **Do not add an `applied` flag**; it would have to be kept
in step with the event list by hand, and that is the class of bug event sourcing exists to avoid.

The one piece of state is which prompts have been _waved away_, and it is session-only, in
`court.js` beside the chosen formation. A dismissal lasts while the team stands in that rotation of
that set: rotate away and back and the offer returns, because that is a fresh chance — but it will
not re-ask every rally in between.

### Other decisions

- **Stored per team** (`state.plans[teamId]`), reused all season. It is _input_, like the roster, so
  storing it does not break "everything is derived", which is about score, rotation and lineup.
- **Never auto-applies.** Deviating from the plan is normal coaching, and a sub recorded that did not
  happen is worse than one missed.
- **The live sheet beats the plan for who comes back.** If the libero went in for somebody other than
  the planned player, the return prompt names whoever she _actually_ replaced — sending the planned
  one back would put two players in one slot.
- **Stale rows are shown greyed, not dropped.** A plan outlives roster changes; whether a row should
  go is the coach's call.
- **The panel opens on the team in context**, which is the one picked on the Roster tab (see below).
  It keeps a picker of its own for the weeks somebody runs two teams, shown only while no match is
  open — once one is running the team is settled by the match, and offering a different one here
  would just be a way to edit the wrong plan.
- Libero replacements are unlimited, so the "costs N of 15" note counts scheduled subs only — the
  same rule the tracking sheet enforces.

## The team in context

`state.activeTeamId` is the app's answer to "whose roster, whose plan, whose next match", and it is
set by **picking a team on the Roster tab**. One coach, one team for most of a season: choosing JV
there _is_ the act of saying "JV is the team I am working with", so it carries to the new-match sheet
and the plan panel rather than each screen guessing.

Before this it was only ever set by creating or opening a match, so until the first match of a season
it fell back to the first team in `roster.json` — for this program, MS. The visible symptom was the
plan panel opening on MS with an empty roster and a greyed-out Libero button, which is how it was
found; the new-match sheet had the same wrong default more quietly.

Two deliberate limits:

- **Showing everyone, or "No team", leaves the default alone.** Neither is a team, and clearing a
  filter to look at the whole program is not a decision about who you coach.
- **A running match still wins.** `activeTeam` returns the match's team while one is open, so picking
  another team on the Roster tab cannot redirect a match in progress.

The Roster tab opens filtered to that team, once per session, so it comes back where it was left.
After that, clearing the filter sticks for as long as the tab is in use.

## Pre-season review findings (2026.08.15c)

A full end-to-end pass before the first week of play. What it confirmed, and the two real bugs it
turned up — both invisible to unit tests, both found by driving a browser.

**Fixed: a double-tap on a stat button recorded it twice.** `closeSheet` left the sheet in the DOM
for its 180ms fade, and the button stayed live the whole time. One excited double-tap courtside meant
two kills.

The first fix was to put `pointer-events: none` on the whole scrim the instant it starts closing, and
that was half right — it stopped the double record and opened a worse hole. An inert scrim does not
swallow the second tap, it lets it **fall through** to whatever sits underneath, and the sheet's stat
buttons sit exactly where the action bar is. After the history moved (2026.08.16c) that meant the
second tap landed on **Undo** and silently deleted the kill the first tap had just recorded: the score
did not move, no toast, nothing in the history. It only surfaced because `e2e-ops.mjs` asserts a delta
of exactly 1.

The shape that is actually correct, and now in `closeSheet`: **the panel goes inert, the scrim stays
live.** The scrim is `position: fixed; inset: 0`, so for the length of the fade it absorbs the second
tap and does nothing with it — its own handler is `closeSheet`, which no-ops once `activeSheet` is
null. Neither the button just tapped nor the page beneath can be reached. Do not "simplify" this back
to a single `pointer-events` toggle on the scrim; each half is there for a different bug.

**Fixed: under `prefers-reduced-motion`, pressing a bubble made it jump.** A leftover rule set
`transform: none` on `.bubble:active`, which since the coordinate-layout change is also what centres
the bubble — so it shunted half a bubble down and right on every press. Keep the translate, drop only
the scale. Anything setting `transform` on `.bubble` must preserve `translate(-50%, -50%)`.

**Fixed in 15d: the libero was labelled with the role of the slot she took over, and warned about.**
Roles belong to the rotation slot, which is right for hitters and wrong for the positions that exist
to _replace_ someone. The libero came on for a back-row outside, inherited "OH1", and then tripped
the 6-2 check — "L, expected OH" — every rally she was on. `SPECIALIST_POSITIONS` (`L`, `DS`) are now
shown as themselves and never raise a mismatch. They still hold the slot, so the formation tables
place them correctly; only the badge and the check changed. The mis-ordered-lineup warning it was
built for still fires.

Verified good, so do not re-litigate these without new evidence:

- Win-by-two: no win at 25-24, banner at 26-24. Deciding set targets 15.
- Libero replacements stay off the substitution count.
- Log corrections re-attribute correctly and the score replays.
- Deleting a set renumbers the rest from 1.
- **Reload mid-set loses nothing** — the tab being evicted or the phone sleeping is survivable.
- **Offline reload works and capture continues** — the gym case.
- Backup wipe-and-restore round-trips exactly.
- Share produces a real file; CSV export is correct and is _correctly disabled_ when there are no
  player stats to export.
- Storage: **9.3 KB per three-set match**. A 40-match season is ~0.93 MB with 14,400 events, against
  a ~5 MB budget. Cold load 1.3s, tab switches ~200ms, season aggregation 438ms. No headroom concern.

Known and accepted: double-tapping **+1 Us / +1 Them** does record two points, because two taps there
are plausibly two points. Undo is the remedy.

## Deploying

1. Zip the folder **contents** (not the folder) and upload to the repo, committing directly to `main`.
2. Bump `APP_VERSION` so the Roster tab can confirm the phone got it.
3. Open the app once with a connection. That is the whole update procedure.

**Drag-and-drop upload adds and overwrites but never deletes.** If a change removes or renames a
file, the old one stays in the repo and keeps being served. Flag which files to delete by hand.

## Open work

### 1. Capture flow: stat-first as well as player-first (from game one)

Today is tap player → tap stat. In serve-receive the owner knows it is a **pass** before they know
who touched it, so the first tap is the one they cannot make yet. Same two taps, wrong order.

The shape that probably fits: a persistent pass row on the court — `3 2 1 .5 D 0` — where tapping a
rating _arms_ it and the next player tap records it. The win is not fewer taps, it is that the first
tap can happen **while the serve is in the air**, and there is no sheet to open and close. Keep the
existing player-first flow untouched; this is a second route in, not a replacement.

Design cautions, learned from the substitution arming that used to live on this screen:

- An armed stat must be loud and must auto-disarm — a forgotten armed rating silently mis-records the
  next tap, which is worse than a slow tap.
- Do not arm on the stat _sheet_; that is the flow this exists to skip.
- Serve-receive is the concrete case. Resist generalising to all five stat groups until it is proven,
  or the court fills with buttons and the fast path gets slower.

### 2. Floor captain — the `c` (spec known, deliberately not built)

`L: 19c` — the `c` marks the **floor captain**, who must be on the floor at all times or have
another player designated when substituted out. Owner's call: the official book captures this, so
the app does not need to. Do not build it without being asked.

### 3. Multi-device merge (planned, deliberately not built)

Match files merge at match level: `mergeJson` adds matches the device does not have and skips ones it
does. Event-level auto-merge is a trap — there is no shared event identity, so it double-counts or
silently loses entries. The agreed sequence, if it is ever needed: duplicate detection with a
comparison view first, then per-set merge, and an upload endpoint only if the shared-folder workflow
proves annoying in practice. Currently on hold — the owner is not sure other coaches will use the app.

Note `mergeJson` does **not** update names for players the receiving device already has, so a shared
file is not a way to distribute names.

### 4. Known asymmetry

If players are ever put back into `roster.json`, deleting one in the app does not stick — the next
online load re-adds them. Teams do not have this problem (`hiddenTeamIds` remembers a removal).
Currently moot because the file lists no players, but it is a live trap if that changes.

## Not gaps, just scope

Opponent stats are not tracked (the paper sheet does both teams; this does ours, by choice). Sets are
captured but not linked to the kills that followed, so there is no assist column.
