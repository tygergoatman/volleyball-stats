# Project notes — Volleyball Stats

Working memory for this project: the decisions that took a conversation to reach and would be
expensive to rediscover, plus what is still open. Written for whoever picks this up next, human or
otherwise. [README.md](./README.md) is the user-facing description; this is the reasoning behind it.

Current version: **2026.09.16a** (`js/version.js`).

## What this is

An offline-capable PWA for capturing volleyball stats courtside on an Android phone. Vanilla JS ES
modules, no build step, no dependencies, `localStorage` for persistence. Deployed to GitHub Pages at
`tygergoatman/volleyball-stats` (the owner's personal repo) by uploading the folder's **contents**.

Single user in practice — one coach, one phone. Multi-coach sharing exists but is unused so far.

## How to work on it

```sh
cd volleyball-stats && python3 -m http.server 8099     # must be HTTP, not file://
node --test "tests/*.test.js"                          # 51 tests — see the warning below
```

**The unit tests were lost and are not coming back on their own.** The remote working copy was
wiped when its container was recycled, and the release zips — the only other copy — had `tests/`
excluded from them, so 270 tests over the pure modules are gone. The app source survived because
the owner still had the zip. Two consequences:

- **`tests/` now ships in the zip.** That is the fix; do not exclude it again to keep the archive
  tidy. The zip is the backup, and a backup that omits the tests is how this happened.
- Rebuilding is happening **as code is touched**, not as one sitting: `privacy.test.js` first because
  it guards a hard constraint, then `model`, `store` and `stats` covering what 2026.09.12a and
  2026.09.13a added. 51 tests, against 270 before — treat a green run as "the recent work is covered", not "the
  app is covered". Anything older than that is unguarded until someone writes it. The modules are
  intact and well commented, but some of the lost tests encoded decisions made in conversation, and
  those reasons live in this file rather than in the code.

**Three bugs in a row now have reproduced only in the installed app**, never in Chromium or device
emulation: the drifting tab bar, then the tab bar covering content. A standalone PWA can have a layout
viewport taller than the visible one, and nothing local models that. So: fix the diagnosed cause, do
not bundle in unverifiable "while we're here" hardening, and say plainly which parts are confirmed.

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
- **`D` (dig) sits in the Pass row**, between `.5` and `0`. It is the same first-contact decision,
  but it counts as a dig and is deliberately excluded from the passing average.
- **Every stat row ends on its one point-conceding button**, so all the red sits down the right-hand
  edge. A test enforces this — it is what makes the sheet readable at a glance mid-rally.
- Hitting percentage is standard `(K − 0) / attempts` and can be negative.
- Setter and libero come from `positions` (`S` / `L`) only. There were once separate boolean flags;
  two fields saying the same thing could disagree, so they were collapsed.

## The substitution limit lives in one place (2026.09.14a)

`SUB_LIMIT` in `libero.js`, now **18** — what this team's association allows.
Associations differ (NFHS 18, USAV and NCAA 12), and the number reaches the
screen in five separate messages, so every one of them interpolates the constant
rather than spelling a digit. It was hardcoded in all five before, which is
exactly how a rule change becomes a hunt.

The counter row wraps, so a longer limit costs no layout work.

Note the other `15` in this codebase is unrelated: the **deciding set is played
to 15**. Do not fold the two together.

## The stat taxonomy

Six rows on the stat sheet: **Pass** (`3 2 1 .5 D 0`), Set, Attack, Block, Serve,
**Fault**. 486px of a 727px screen, no scrolling.

### Passing was split in two for two days, and put back

2026.09.13a made Serve Rcv and In rally separate rows, on the reasoning that
receiving serve and playing up a free ball are different jobs. That reasoning is
still sound and the owner had corrected an earlier, worse proposal to get there.
**They used it and did not like it**, and one line came back in 2026.09.15a.

Worth recording because it is the kind of thing that gets re-proposed: the
argument for splitting is good on paper and lost in practice. A row the coach has
to *classify* into before tapping is slower than one they just tap, and mid-rally
the classification is not obvious — which is why the split cost more than the
granularity returned. Do not re-split without the owner asking.

**The `rally*` codes still aggregate.** Matches captured in those two days hold
them, and `APPLY` folds them into the same passing line rather than dropping
them, so nothing silently zeroes and no migration was needed. A test pins it.
Do not delete those four handlers to tidy up.

### Every row is tinted by its own accent

Neutral buttons carry a 20% wash of their group's accent, so the block you are
aiming at is identifiable before you read a label. One `--accent` variable per
group and a single shared rule, so a new row only has to name its colour.

**Kept deliberately low-saturation.** `--attack` is the same green as `--good`
and `--serve` the same amber as `--warn`, so at any real strength a neutral
button starts reading as a scoring one — and "the bright fill means this ended
the rally" is the more load-bearing signal. Those two rows are the weakest of
the six for exactly that reason; Pass, Set and Block separate cleanly. If the
attack row ever needs more separation, give it a tint hue distinct from
`--good` rather than turning the percentage up.

### Faults

`faultNet`, `faultUnder`, `faultDouble` — chosen by the owner from a longer list,
because six rarely-tapped buttons cost more than they return. The whole row
concedes, so it is entirely red: the "red on the right" convention taken to its
limit rather than broken.

**Out of rotation is deliberately not in that row.** It is a lineup fault, not one
player's, so it is a `TEAM_EVENT` with `fault: true` and lives at the bottom of
the Court tab beside End Set. It happens a handful of times a season and does not
earn space in the dock.

That `fault` flag fixes a real misattribution: **every team event scoring for them
used to count as them _earning_ it**, so our own lineup fault flattered the
opponent in the earned-vs-given-away panel — the one number the coach actually
coaches from.

### Dead wiring removed

`digErr` had an `APPLY` handler and a **Dig Err** CSV column, and no button
anywhere could produce the code. The column could only ever read zero. Gone; a
misplayed first contact is `pass0`.

### Stored codes, and what that costs

Stat codes are **persisted**, so the taxonomy is expensive to change once a season
is recorded. The split and its reversal both avoided a migration — the first by
adding codes rather than moving any, the second by folding the added ones back in
— but that was deliberate design each time, not luck. Mock up and agree a
taxonomy change before building it.

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
event**, because it cannot be inferred from the rally and it is what the substitution limit turns
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

## The front-row setter is the opposite

`ROLE_POSITION` maps `S1`/`S2` to `S`, and that is only half true. **A 6-2 is six attackers and two
setters**: only the back-row setter sets, and the front-row one plays opposite. So a setter slot
standing in the front row is the right-side attack, not a setting position.

`roleExpectations(role, isFrontRow)` in `formations.js` says what a slot means for the row it is in —
the label to show, and every roster position that legitimately fills it:

| slot         | label | allowed    |
| ------------ | ----- | ---------- |
| S1/S2 back   | S1/S2 | S          |
| S1/S2 front  | OPP   | OPP _or_ S |
| OH/MB either | as-is | as-is      |

Both are allowed in the front because both happen: a true opposite subbed in for the setter who has
rotated front is the textbook 6-2 move, and a setter who rotates front and hits is equally ordinary.

**Reported from a real match**: an OPP came in for the front-row setter, and the court labelled her
`S1` and warned "#8 Ella is OPP, expected S at S1". Both wrong, and wrong in the same way the libero
once was — the app misreading its own system rather than the lineup being wrong. This is the third
time row-blindness has produced a false warning (libero, multi-position players, now the opposite),
which is why `FRONT_ROW` now reaches into `assignRoles` as well as into the colours.

**The check keeps its teeth in the back row.** An opposite standing in the _back-row_ setter slot is
still flagged, because she cannot run the offence from there — and that warning is useful: it says
swap her out before she rotates round. A test walks all six rotations and asserts three quiet ones
and three flagged.

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

## Who serves first, and why their serve means rotation 6

**The lineup is always entered as _our_ serving order** — first server in position 1. That is how the
coach thinks about it, and the lineup screen no longer asks anything else.

If the opponent serves first, we do not reach that order until our first side-out. So the set has to
**start one rotation behind**: rotation 1 becomes rotation 6, with the six on court shifted to match.
One side-out then rotates back to exactly the order that was typed, with the intended server on the
line. The rule generalises — whatever rotation we would have served from, their serve puts us one
earlier — and a test covers a non-1 starting rotation.

That shift is why `setStartingServer` is a store action and not a field. Setting the flag alone would
leave the wrong six on court, which is the same bug the starting-rotation picker once had.

**It was moved off the lineup screen because nobody knows the answer there.** The ref says at the
whistle, by which point the lineup is entered — and guessing wrong left the whole set a rotation out
with no way back. It now lives in a thin strip under the scoreboard on the Court tab, defaulting to us
serving, one tap to change, with the court redrawing as confirmation.

**It stays available for the whole set, not just before the first rally.** The score counts point
events and does not depend on who served, so a late correction moves the rotation and lineup and
nothing else — exactly what a coach who notices at 5-3 wants. A test asserts the score is untouched.

**A property worth knowing before someone reports it as a bug:** if we side out on the very first
rally, the two settings produce an identical court. Serving first and winning leaves our first server
on the line; receiving first and siding out rotates us into that same place. The rotation-6 shift is
what makes them agree, so the control genuinely "did nothing" in that one case. A test pins it.

**The mistake this actually produces, reported from a match:** the coach set the starting rotation to
**6** by hand *because* the other team was serving, then also tapped First serve → Them, which shifted
it back again to 5. The two controls each apply the shift, and applying both is double-counting. The
setup screen now says so outright — "set this as if you are serving… do not subtract it here as well"
— and reads back `#7 Emma serves first · rotation 3` under the picker, so a wrong tap is visible at
setup rather than at the first whistle. The model was right; the instructions were not.

Removed with this change: sets used to alternate the default first serve automatically. That was a
guess made before the information existed, and a wrong guess was invisible — the strip is now the
place to say it.

## Matching the floor mid-set (2026.09.12a)

The escape hatch for when the app and the gym have drifted apart — a rally that
never got recorded, a mis-tap noticed three points later. Tap **Rot N** on the
scoreboard.

`{type: 'correct', rotation, serving}`, replayed like everything else, so it
undoes, deletes from the log, and disappears with the set without a line of code
for any of them. Three decisions worth keeping:

- **It states a target, not a delta.** "At this point we were in rotation 4" is
  an observation about the floor, so it still means the same thing if an earlier
  event is edited afterwards, and two corrections in a row land on the second
  number rather than compounding.
- **The lineup moves with the number.** Setting the counter alone would leave the
  court showing the wrong six — the exact bug the starting-rotation picker once
  had, and the reason `rotateLineupBy` is called here too.
- **Serving is corrected alongside, not separately.** Whether a point rotates us
  depends on who was serving, so fixing the rotation while the serve flag stays
  wrong goes straight back out on the next rally. One sheet, both facts.

**The score is deliberately not editable here.** A rotation that is out and a
score that is out are two different mistakes, and the honest fix for a missed
rally is to record the rally — which puts score, serve and rotation right
together. The sheet says so, and points at +1 Us / +1 Them.

The sheet shows a **live court preview** rather than just a number, because
"rotation 4" cannot be checked against anything, and six jerseys in six spots can
be read straight off the floor. It draws rotational positions, like the setup
screen — not the Base formation the Court tab shows — because rotational is what
a coach is looking at during a stoppage. A malformed rotation falls back rather
than throwing: a set that will not compute is worse than a correction that
quietly does nothing.

## Carrying a lineup into a new match (2026.09.12a)

`store.lastLineupForTeam(teamId, excludeMatchId)`. The button used to read only
`match.sets.at(-1)`, so it never appeared on **set 1 of a new match** — precisely
where six players otherwise get retyped. It now falls back to the last set this
team actually played, whenever that was, labelled with the opponent so it is
obvious what is being copied.

Two rules: most recent **by date** (creation order only breaks a tie, since a
forgotten match gets back-filled with an earlier date), and **all six must still
be on the team or nothing is offered** — a partly filled court with silent gaps
is worse than an empty one on a phone, and a set started five-a-side cannot be
undone afterwards.

### The rotation travels with the court (fixed 2026.09.15b)

The first version dropped the six in and reset the picker to **rotation 1**, on
the reasoning that the stored lineup is already a court so rotating it would move
it off the arrangement being copied. Half right: the court was correct and the
*label* was wrong — and correcting the label then rotated all six off the
arrangement that had just been copied. Reported after a match where set 1 opened
on rotation 4 and set 2 had to be re-entered by hand.

`lineupAsEntered(set)` in `model.js` returns both, and **undoes the their-serve
shift** on the way out. That part is not decoration: choosing "they serve" moves
the stored rotation and lineup back one, while the setup picker means *"the
rotation as if we are serving"* and says so on screen. Feeding it the stored
number would shift a second time the moment the opponent serves again — the same
double-shift the setup warning exists to prevent, arriving through the back door.
A browser check plays four sets to pin exactly that.

**So: `set.startingRotation` is not what the coach typed** whenever the opponent
opened the set. Anything replaying a set's setup into a new one wants
`lineupAsEntered`, not the raw fields.

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

## Editing a match after the fact (2026.09.11a)

Opponent, date and venue are editable from the Log tab (**Edit**, beside Switch). The reported case
was a misspelled opponent with no way back — and the name is on the scoreboard all match and in the
share filename afterwards, so it is not cosmetic.

**Only those three fields, deliberately.** The team decides which roster every recorded stat belongs
to, and the format decides which set is played to 15 — changing either after sets exist moves the
ground under results already captured. Both stay set-once, as they are on the create screen. A blank
opponent is refused rather than saved, the same floor `createMatch` already had.

Nothing derived reads these fields, so a rename cannot move a score. That is what makes it safe on a
finished match, and a browser check asserts the recorded stats are untouched by one.

## The dock, and the Court tab's screen order (2026.08.25a)

**Frequency decides vertical order.** That rule moved `+1 Us` / `+1 Them` above the history after
game one, and it was still not enough: the owner reported *still* scrolling to reach them. The
measurements say why — on a Pixel-sized screen the view is 610px and the court content is 788px, and
the court map alone is 344px of that. Reordering moves the problem around; it cannot create 178px.

So the scoring controls left the scroll entirely. **`#dock` is a fourth grid row of the body**,
between `#view` and `#tabs`, holding `+1 Us`, `+1 Them` and `↶ Undo`. `app.js` empties it on every
render and only `renderCourt` fills it, so `.dock:empty` collapses the row to nothing everywhere
else.

**It is a grid row, not `position: sticky`, and that is the whole point.** Sticky is the obvious
reach for "stays put while the view scrolls" — it was tried on the tab bar for a weaker reason and,
installed to the home screen, lifted the bar out of its row and parked it over the page content. A
grid row cannot do that. `tests/layout.test.js` guards it, and each guard was checked by breaking
the rule and watching it fail.

What is left in the scroll, in order: `scoreboard, courtMap, planStrip, benchStrip, serveStrip,
recentStrip, endSetPanel`. The bench is a glance; the first-serve control and End Set are once a set.

**The history is at the bottom, and it got there twice.** It was moved below the action bar after
game one, then all the way down here when the owner said plainly that they do not read it during a
match. That is the correct read of the frequency rule now that Undo is docked: the quick correction
never needs the strip, and an older one gets fixed on the Log tab. Do not move it back up without
being asked. **End Set came out of the docked row on purpose** — every pixel
there is taken off the court map, and it is not a button to have permanently under the thumb beside
`+1`.

The result on a Pixel 5: the scoreboard and the whole court map sit above the fold with the dock
under them, and the +1 buttons are tappable at every scroll position. `court-dock.mjs` asserts
exactly that, by hit-testing `elementFromPoint` at the top and bottom of the scroll.

One consequence to keep in mind when adding anything here: **the stat sheet's buttons overlay the
docked row**, so a stray second tap as a sheet closes lands on `+1` or Undo. That is handled — the
closing sheet's panel goes inert while the scrim stays live (see the double-tap entry in the review
findings) — and `court-dock.mjs` re-checks it. Do not "simplify" `closeSheet` without re-reading that.

## Timeouts (2026.08.25a)

`{type: 'timeout', team}`, replayed like everything else, so undo, deleting one from the log, and
starting a new set all reset the count with no code of their own. `computeSetState` returns
`timeouts: {us, them}` and touches nothing else — no score, no rotation, no rally count. Tests pin
each of those, because a timeout that quietly advanced the rotation would be very hard to spot from
the scoreboard.

Shown as a pip per allowance under each score, filled while unused. **Tapping the pips calls one**,
because an indicator you cannot set is an indicator that stops being true by the second set.

`TIMEOUTS_PER_SET = 2` is the high-school rule, and it is a **display allowance, not a limit**.
Associations differ, so a third is recorded like any other and flagged `+1` in red — the same
warn-never-block treatment as a 16th substitution. `pointFor` says `null` for a timeout outright
rather than letting it fall through the code lookups, so a new event type cannot quietly start
counting as a point.

Not in the stats or the CSV. It is a scoreboard indicator and a line in the point log; nobody has
asked what the season timeout total was.

## Subs tab screen order (2026.08.24a)

Same rule, applied late. `renderSubs` used to stack `countPanel, planPanel, rowsPanel` — the tracking
sheet, the thing you read every rotation, was **last**, under two panels read once a match. Mid-game
that cost real seconds finding a player to sub. It is now `rowsPanel, planPanel, countPanel`: sheet,
then plan, then the counter.

The type on the sheet was sized for a spreadsheet, not a gym. The current occupant of each serving
slot — the one number that actually gets read at a glance — went 15px → **22px/800**, with the order
number, position and name stepped up under it. Everything else on that row is context; it stays
small on purpose so the live number wins.

Where the plan sits was the coach's call: under the sheet, above the counter. It is mostly pre-match,
but it is also what gets edited when the plan changes mid-set, so it beats the "15 subs left" note.

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

### The plan follows the slot, not the person (2026.08.24a)

The coach's case: the plan says _#2 in for #6_, but mid-set they subbed **#8** in for #6 ad hoc. By
the planned rotation #6 is on the bench, so the old check — "is the player going out on court?" —
went quiet and the plan silently stopped firing. What they still want is _#2 in for **#8**_, because
**#8 now holds the slot #6 started in**.

`slotHolder(rows, playerId)` in `plan.js` resolves it, and it is three lines because the derivation
already existed: `liberoSheet(set).rows` carries, per serving-order row, `entries[]` — everyone who
has occupied that slot this set — and `currentPlayerId`. Find the row the planned player has been in,
read who is standing there now. Arbitrary chains (6 → 8 → 12 → …) fall out for free, nothing is
stored, and the existing guards still apply unchanged: quiet if the incoming player is already on,
inert if nobody in that slot is on court.

This is the model the app uses everywhere else — **a role belongs to the rotation slot, not the
player** — and the plan was the last place still thinking in people.

Two things that go with it, and should not be removed:

- **The prompt says why.** `plannedOutId` is set only when the resolution moved, and `planStrip`
  renders it as "#2 in for #8 _(planned for #6)_". A prompt naming somebody the coach never planned
  for, with no reason given, is worse than no prompt.
- **Legality stays the coach's business.** Associations differ on who may enter a slot once a starter
  has been replaced. Consistent with **warn, never block**, this offers the swap and lets them
  decide. Do not build a rules engine here.

### Other decisions

- **Plan rows are editable in place** (`store.updatePlanSub`), and the edit **keeps the row's id** —
  which matters because the id is what a waved-away prompt is keyed on. Delete-and-recreate worked,
  but it cost every field to fix one and silently un-dismissed the prompt. The kind toggle is
  disabled while editing: changing a rotation row into the libero pairing is a different record, not
  an edit of this one.
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
- Libero replacements are unlimited, so the "costs N of 18" note counts scheduled subs only — the
  same rule the tracking sheet enforces.

## Points earned vs given away (Stats tab)

Every point splits four ways, and the split is the whole feature:

| bucket               | what it is                                    | source            |
| -------------------- | --------------------------------------------- | ----------------- |
| `us.earned`          | kill, ace, solo block — we finished the rally | our stats, `us`   |
| `us.fromTheirErrors` | they put it away themselves                   | `oppError`        |
| `them.earned`        | they finished it and we recorded no error     | `oppPoint`        |
| `them.fromOurErrors` | serve into the net, attack out, shank         | our stats, `them` |

**`them.fromOurErrors` is the number the coach asked for**, which is why that half of the panel names
_which_ errors rather than only counting them. "We gave away eleven" is a fact; "six of them serves"
is a practice plan. Both lists are sorted commonest-first for the same reason.

**The winner of each point comes from `pointFor`** — the same function `computeSetState` replays for
the scoreboard. That is deliberate and load-bearing: it means the panel and the Court tab can never
tell the coach two different stories. A test asserts the totals equal the replayed score, and it
would fail immediately if someone re-implemented the mapping here.

Nothing is stored. `breakdownForSets` folds set / match / season through one accumulator, so the three
scopes cannot disagree either.

Display notes:

- **The bar carries proportion only; the counts live in the legend.** Counts were inside the segments
  first — a lopsided split (20 earned, 1 given) leaves a segment a few pixels wide and clips the digit
  to nonsense.
- Points that changed hands without being earned use the same grey on both bars, so "given away"
  reads as one idea whichever side received them.
- Shares are `null` rather than `0` with no points yet, so the UI shows "—" instead of a confident 0%.

Still not tracked, and out of scope by choice: opponent stats beyond these two team events. `oppPoint`
means "they won the rally and we did not record why", not a claim about how.

## Sortable stat columns

Tap any column heading to rank by it. First tap sorts **descending**, because every question this
table answers is "who leads" — most 3-passes, best hitting percentage. Tapping the active column
flips it, which is how you find who needs the work.

Details that matter:

- **The heading is a `<button>` inside the `<th>`, not the `th` itself.** The player column is
  `position: sticky` so it survives the table's horizontal scroll, and sticky only works on the cell.
  A browser test asserts it is still sticky after the change.
- **Ties fall back to the category's default column**, so a table sorted by a stat where half the
  squad has 0 still reads sensibly underneath.
- **The Player heading sorts by jersey number**, which answers "who is on this list" rather than "who
  leads it". Unnumbered players sort last in both directions.
- **Changing stat family clears the sort.** Columns differ per family, so a choice made on one cannot
  mean anything on the next; you get that family's own default back.
- Rates already sort by their raw value rather than the formatted string (`sort:` on the column), so
  "—" for no attempts lands last instead of parsing as something.
- `aria-sort` is set on the active `th`.

**Not done:** the CSV export ignores the on-screen sort — it always writes roster order. Worth doing
if the owner asks, but sorting a spreadsheet is trivial, so it did not seem worth the coupling.

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

## Layering and scrolling — the installed-app bugs (fixed in 2026.08.20a)

Reported as "the bottom bar disappears when I scroll" plus "the bubble overlaps the stat pop-up and
the court scrolls behind it". All three turned out to be real, and all three are worth keeping,
because none of them shows up in a desktop browser unless you go looking.

**Bubbles painted through the open stat sheet, and stayed tappable.** Each bubble carries an inline
`z-index` derived from how deep it stands, so an overlapped bubble keeps its own edge to tap — and
those values reached 100 against a scrim at 50. `.court__grid` had `position: relative` with no
`z-index`, so it was **not** a stacking context and court coordinates competed directly with app
chrome. Back-row players sat on top of the sheet and `elementFromPoint` returned the bubble, meaning
a tap aimed at a stat could reopen a different player instead — a silent mis-record mid-game.

Fixed with `isolation: isolate` on `.court__grid`, which scopes bubble depth to itself without
touching layout, plus a named layer scale in `:root` (`--z-tabs: 10`, `--z-scrim: 100`,
`--z-toast: 200`) so the next person does not have to reverse-engineer the order. Verified the FLIP
animation still tweens afterwards — a new stacking context was the obvious thing to have broken.

**`body.sheet-open { overflow: hidden }` was locking the wrong element.** `#view` is the scroller,
not the body, so the court kept scrolling behind an open sheet. Now `body.sheet-open .view` is locked
too. Two things a test has to check here, because getting either wrong is worse than the bug: the
scroll position must survive both opening **and** closing, or every stat tap would jerk the court.

A trap when testing this: setting `view.scrollTop` from script bypasses `overflow: hidden` by design,
so it proves nothing. Scroll with a real wheel or touch gesture over the background.

**The tab bar was overscroll chaining, and `overscroll-behavior: contain` on `#view` fixed it** —
confirmed by the owner on the installed app in 2026.08.20a.

Worth keeping, because the diagnosis was not reachable from a desktop browser. It could not be
reproduced there or under device emulation: the bar stayed pinned on all five tabs, scrolled to the
bottom, with zero body overflow. Two facts narrowed it. It happened **only** installed to the home
screen, which ruled out the URL bar. And `overscroll-behavior: none` was already set on `html`/`body`,
which looks like it covers this but does not — **chaining is governed by the scroller's own value**,
and `#view`, the element that actually scrolls, had none. So over-dragging the court chained up to the
viewport. In a browser tab nothing visibly moves because the body already fits; installed, there is no
browser chrome to absorb it and the whole app pans, tab bar included.

Two lessons: `overscroll-behavior` belongs on the element that scrolls, not on its ancestors; and a
standalone PWA is a genuinely different environment, not just a browser tab without a URL bar. Device
emulation does not model it, so a report that only reproduces installed should be believed rather than
chased in Chromium.

**The `position: sticky` "insurance" was a regression, and is gone (2026.08.21a).** It was added to
`.tabs` alongside the real fix, with a comment saying it changed nothing today. It did: installed to
the home screen it lifted the bar out of its grid row and parked it over the bottom of the page, so
the last of the content could not be reached. The mechanism is the same viewport split as above — the
layout viewport is taller than the visible one, so sticking to the _scrollport's_ bottom means sitting
above the grid row's bottom, on top of `.view`.

Two lessons, and the second is the general one:

- The grid row is what places the tab bar. Nothing else should — `tests/layout.test.js` now fails if
  `position` comes back on `.tabs`.
- **Do not ship speculative CSS hardening into an environment you cannot test.** "This is a no-op
  today" is a claim about a renderer, and it was checked in Chromium, where it was true. Fix the
  diagnosed cause and stop; if a guard cannot be verified where the bug lives, it is not a guard.

Hardening kept, because each was verified rather than assumed:

- `.view` states `min-height: 0`. It is only correct today because `overflow-y: auto` happens to zero
  out a grid item's automatic minimum size; saying it outright means a later change cannot quietly
  reintroduce a page-level scroll.
- `.view` has `overscroll-behavior: contain`, which is the change that actually fixed the drifting bar.
- `--safe-b` is `max(env(safe-area-inset-bottom, 0px), 6px)`. Android frequently reports no inset
  where iOS reports a real one, and installed there is no browser chrome under the bar.

**Not done: pushing the court up above the sheet.** The stat sheet is up to `88dvh`, so there is no
room to show the court beside it, and the sheet title already names the player being recorded. If
seeing the court during capture matters, the lever is the sheet's `max-height`, not scrolling.

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

### Always hand over release notes with the zip

The owner asked for this as a standing habit, so every package comes with a short bulleted list —
in the reply, not a file. What it is for: deciding whether to install now or after the next match,
and knowing what to look at once it is on the phone.

- **Lead with what changed on screen**, in the owner's words, not the code's. "The front-row setter
  now reads OPP" beats "row-aware `roleExpectations`".
- **Say which are fixes and which are new.** A fix means "something you reported is gone"; a feature
  means "there is something new to try".
- **Flag anything needing action** — a new file to upload, a file to delete, a behaviour to confirm on
  the phone, or a decision left open. This is the part that is genuinely costly to omit.
- **Keep the reasoning out of it.** Design rationale belongs here and in the reply's prose; the list
  is the scannable summary, so a handful of lines is right.
- **Name the version and say what it replaces**, since two zips a day happen and installing the older
  one silently undoes work.

## The whiteboard (2026.09.16a)

A landscape scratch surface for a timeout, reached from **☰ → Whiteboard** — both
mid-match and with nothing running. Not a tab: the bar is five wide and every one
of those is tapped every rally.

**What makes it worth more than the board in the bag:** it opens on the real six,
in the real rotation, with real numbers and position colours. A whiteboard starts
blank every single time.

### Nothing is stored, and that is the whole design

The owner asked for a scratchpad, and taking that literally is what keeps this
feature cheap. `js/ui/whiteboard.js` holds one module-level `board` object for as
long as the app is open — the same trick the Court tab uses for its chosen
formation. **No store changes, no schema version, no migration, nothing to back
up**, and no chance of a drawing outliving the reason for it.

**Ink clears when the rotation changes.** Also the owner's call. It clears on a
*view* change too, which was mine: Base and Serve Rcv put the same six in very
different places, so ink drawn against one points at nothing in the other, and
stale ink is worse than lost ink.

### Decisions worth keeping

- **Move is a tool.** Chips and ink both want the same pointer, so exactly one
  owns it at a time — `.wb__court--drawing` flips `pointer-events` between the
  two layers. Without a mode you cannot draw *across* a player, which is most of
  what a coach draws.
- **Tap the bank to add, then drag to place.** A drag out of a narrow rail is a
  fiddly gesture on a phone and easy to start by accident while scrolling it. Two
  deliberate actions beat one delicate one. An opponent chip lands on *their* side
  of the net; everything else on ours.
- **Erase is a mode, not a rubber.** Tap the mark you want gone. A rubber that
  follows a finger deletes whatever it brushes past.
- **Undo / Erase / Clear sit three-across.** Stacked, they pushed Clear off the
  bottom of a 353px rail — reachable only by scrolling a narrow strip to find the
  button you want when you have five seconds. Caught in a browser, not by a test.
- **Ink is stored in a fixed 1000×1000 space** and drawn with
  `preserveAspectRatio="none"`, so strokes stay put when the court resizes.
- **The LIVE badge doubles as the way back.** The stepper is easy to wander off on
  and, without it, hard to find the way home from.
- Sub-plan badges come from `planPrompts`, not from re-reading the plan — so the
  board says exactly what the Court tab would prompt, including a sub that has
  moved to follow an ad-hoc swap.

### Not built, deliberately

Saved plays, a scouted opponent roster, and sharing a board as an image. All were
raised and set aside: the owner wanted a scratchpad for their own eyes. Each would
need storage, which is the thing this feature currently gets to skip.

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

## Set aside by the owner (not dead, just not now)

Both were designed in some detail and then explicitly parked. Kept short here so picking either back
up starts from the conclusions rather than from scratch — but **do not build either without asking**.

**Stat-first capture, as a second route in.** Today is tap player → tap stat. In serve-receive the
coach knows it is a _pass_ before they know who touched it, so the first tap is the one they cannot
make yet. The shape that fits: a persistent pass row on the court — `3 2 1 .5 D 0` — where tapping a
rating _arms_ it and the next player tap records it. The win is not fewer taps; it is that the first
tap can happen **while the serve is in the air**. Cautions from the substitution arming that used to
live on this screen: an armed stat must be loud and must auto-disarm, do not arm on the stat _sheet_
(that is the flow this exists to skip), and do not generalise past serve-receive until it is proven.

**A calendar of games.** The payoff is at New Match: tap tonight's fixture instead of typing an
opponent into a phone in a loud gym. A schedule is **input**, like the roster and the plan, so
storing it does not break "everything is derived". Keep a fixture and a match **separate** — a match
started from a fixture carries its id, it does not become one, because games get postponed,
cancelled, or played when they were never scheduled. Entry has a shortcut the roster could not use:
opponents, dates and venues are public information, no minors' names, so a `schedule.json` in the
repo is viable where a published roster was not. No reminders or notifications — this is an offline
app with no push, and a calendar that promises to nag is one that fails silently.
