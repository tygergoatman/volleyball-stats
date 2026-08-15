# Volleyball Stats

A courtside scoring and stat-capture app for a single team. Tap a player bubble on the
court map, tap the stat, done — two taps per action, no confirm step.

This is a standalone web app. It has no Salesforce metadata, no `sfdx-project.json`, and
nothing in it is packaged or deployed by this repo's CI.

## Running it

It is a static site — anything that serves files over HTTP will do. It must be served over
HTTP rather than opened as a `file://` URL, because it uses ES modules and a service worker.

```sh
cd volleyball-stats
python3 -m http.server 8099
# then open http://localhost:8099
```

### Installing on your phone

1. Serve the folder somewhere your phone can reach it (any static host works — GitHub Pages,
   Netlify, Cloudflare Pages, or your laptop on the same Wi-Fi).
2. Open the URL in Chrome on Android.
3. Menu → **Add to Home screen**.

It then launches full-screen with no browser chrome, keeps the screen awake while you are
capturing, and buzzes on each stat tap. Everything works with no signal after the first load,
which matters in gyms.

## Teams and the roster

There is **one roster for the whole program**. Teams — MS, JV and Varsity out of the box — are
tags a player carries, and a player can carry more than one.

Somebody who swings between JV and Varsity normally gets **one entry per team**, because they wear
a different number on each and the number is how the app names them. That costs nothing: season
totals are filtered by the matches each team played, so their JV and Varsity stats were never
combined anyway. Two tags on one entry is for the rarer case where the number is the same on both.

When you create a match you pick the team, and the match draws its pool from everyone carrying
that tag. The Stats tab scopes season totals per team, so a swing player's JV and Varsity numbers
stay separate — each is filtered by the matches that team actually played.

**The roster lives on the phone.** Players are added, edited and deleted on the Roster tab, and
nothing about them is stored on GitHub. [`roster.json`](./roster.json), published alongside the
app, is a starter file with one job: give a freshly installed app the team labels so nobody types
"Junior Varsity" on a phone keyboard.

That is the whole split, and it is deliberate. See [ROSTER.md](./ROSTER.md).

The trade is that clearing your browser data deletes the roster along with the season, so
**Save backup to this device** after you set it up. `roster.json` restores the team labels on a new
device; only a backup restores the players.

### Why no names are published

`roster.json` is published on the open web at the app's own address, so anyone who visits
`.../roster.json` can read it — and a private repository would not change that, because the app
fetches the file over plain HTTP. Git also keeps everything: a name committed and deleted later is
still in the public history for good.

So the published file carries **team labels and nothing else**. Names are typed on each coach's own
phone and never leave it, and a coach happy working from numbers can skip them entirely — the app
reads `#7` wherever a name is missing, which is what it leads with courtside anyway.

`tests/privacy.test.js` fails if a name ever finds its way into the file, including in the
supported-but-unused case where somebody lists players there.

### Managing them

The Roster tab lists the teams, then the whole roster with a filter row: **All**, one button per
team, and **No team** if anyone is untagged. Filtering answers "who is on JV?" without duplicating
anybody.

Tapping a player opens their record, including a multi-select of teams. Ticking Varsity on a JV
player makes them available to both. Untagging is how you take someone off a team — they stay on
the program roster, and their recorded stats are untouched. **Delete player** is the separate,
heavier action that removes them from the program entirely.

The **⋯** button on a team opens rename and removal. Removing a team removes a label and nothing
else:

- Every player stays on the roster, minus that one tag. Anyone left with no tags shows a **no
  team** badge and simply cannot be picked for a lineup until they are tagged again.
- Every match that team played is **kept**, with its stats. The team is archived so those matches
  can still show whose they were.
- A team from `roster.json` is hidden on this device and the id remembered — the file is shared and
  cannot be edited from a phone, so without that the next online load would just put it back. A
  **Removed** row offers to restore it, which brings the team and its tags back. To remove a team
  for everyone, delete it from `roster.json`.

Renaming a team from roster.json applies to this device only, the same way player edits do.

## Data

Match data lives in `localStorage` on the device and is **never uploaded** — only the roster is
shared, only in one direction, and only as numbers. Two coaches running the app have two
independent sets of
matches.

That also means **clearing your browser data deletes your season**, so share or save a backup
periodically.

### Getting a match off the phone

**Log tab → Share this match** hands the file to Android's share sheet, so it goes to the shared
Drive folder, a message, or wherever else in a couple of taps. It contains that one match plus
only the players and team it refers to — small enough to message, and it merges exactly like a
full backup because it is one, just a narrower slice. The filename says what it is and sorts by
date: `vbstats-2026-09-02-jv-vs-cornerstone.json`.

Roster → Data has **Share backup** for the whole device, plus **Save backup to this device** when
you want a local copy rather than to send it.

Android decides where a shared file goes — the app cannot preselect Drive or a folder, so the
coach picks the destination. Drive remembers the last folder used, which makes it quick after the
first time. On desktop, or anywhere file sharing is unsupported, Share downloads instead.

To combine devices, use **Merge a file**: it adds the other coach's matches to yours and leaves
your own alone, skipping anything already present. _Replace everything from a file_ is the
destructive option, for restoring a backup onto a clean device.

The workflow this is built around:

1. One person maintains `roster.json`; everyone else just opens the app online once
2. One scorer per match — two people half-scoring the same game produces two incomplete records
3. After the game, that scorer taps **Share this match** into the shared folder
4. Whoever keeps season totals merges the files in and exports the season CSV for reporting

Per-set, per-match and season stats can also be exported as CSV from the Stats tab.

## How capture works

### Formations

The court draws three views of the same six players, switched with the buttons under it. The label
in the net strip says which one you are looking at.

| View          | What it shows                                                                            |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Base**      | Where each position plays once the ball is live. The default, and where stats get tapped |
| **Rotation**  | The legal rotational positions — what the referee sees at the whistle                    |
| **Serve Rcv** | The passing formation. Reference — bubbles overlap here, as on the paper sheet           |

Base comes from your 6-2 rotation sheets: hitters switch sides, and whichever setter is back row
releases to position 1 while the other plays opposite at position 2.

Roles — S1, OH2, MB1 — are worked out from the serving order and shown on each bubble. Nothing extra
to type. A role belongs to the rotation slot rather than the person, so a substitute inherits the
role of the spot they come into.

**Switching view never changes anything legal.** The position number on each bubble and the serve
ring always follow the player's real rotational position, so a formation can't hide an overlap or
mislead you about who is serving. Tapping still records against the player.

**Switching view animates the players between formations.** That is deliberate: your rotation sheets
draw green arrows for the movement after the pass, and on a phone-sized court watching each player
travel reads better than arrows drawn over the top. Motion is skipped if your phone is set to reduce
it.

In rotations 1 and 4 your sheets leave the front row where it receives — outside stays right,
opposite stays outside. Those rotations say so under the court. That arrangement is the **Rotation**
view, so switching there shows where they attack from.

Pick the offense at set setup. Only 6-2 is built; the picker appears once there is more than one.

### The court

Bubbles are laid out in standard volleyball positions, with the net along the top:

```
  4    3    2     front row
  5    6    1     back row (1 serves)
```

The player in position 1 is ringed in amber while your team is serving.

### Scoring is derived, not typed

You never enter the score. It is computed by replaying the events you recorded, which is why
undo and mid-log deletion always leave the score, rotation and lineup exactly right.

| Outcome                                                                  | Result          |
| ------------------------------------------------------------------------ | --------------- |
| Kill, ace, solo block                                                    | Point for us    |
| Attack `0`, service error, set `0`, block error, dig error, pass `0`     | Point for them  |
| Everything else (pass 3/2/1/.5, attack `A`, serve in, block assist, dig) | Rally continues |

Rallies that neither team's tracked stats ended — the opponent hits it out, or the opponent
puts it away — use the **+1 Us / +1 Them** buttons under the court. Without those the score
would drift, since not every point involves an action by one of your players.

Your team rotates automatically on a side-out (winning a rally while the opponent was serving).
The rotation counter runs 1 → 6 and wraps.

At set setup, enter the lineup **in serving order**, then pick the rotation you are starting in:
rotation 4 puts the 4th player of that order into the serving spot. The court map above moves as you
tap, so you can simply tap until it matches the floor rather than worrying about whose numbering
convention is in play.

### Match format

Pick **Best of 3** or **Best of 5** on the first set's lineup screen. It is only offered there,
because changing it later would move the target under sets already played.

Every set is played to 25 except the deciding one — set 3 of 3, or set 5 of 5 — which is played
to 15. The scoreboard shows the target so you can tell at a glance which kind of set you are in.

Between sets the screen shows where the match stands. When a team reaches two sets (or three in a
best of 5) you are asked whether to end the match; you can also end it early from the between-sets
screen, for a time cap or a forfeit. Only sets you have actually ended count toward the match
score — a set sitting at 25–20 that nobody has closed out is still in progress.

An ended match shows a final scoreline and stops asking for more sets. **Reopen this match** undoes
that if play continues.

### Fixing a mistake afterwards

`Undo` on the court removes the last entry. For anything older, go to the **Log** tab and tap the
entry: you can re-credit it to a different player, change the stat, or delete it. This is the case
where you tapped the wrong name and play carried on, so you fix it at the next stoppage.

Corrections are safe because the score is replayed rather than stored — change an entry and every
point, side-out and rotation after it is recalculated. Edited entries are marked so you can spot
them later. Substitutions cannot be edited in place; delete and re-record them from the court.

Whole sets can be deleted from the Log tab, which also renumbers what is left and re-targets the
new deciding set.

### Stats captured

Rows appear in this order, top to bottom, so the most frequent taps sit highest:

| Group  | Options           | Notes                                                                                    |
| ------ | ----------------- | ---------------------------------------------------------------------------------------- |
| Pass   | 3, 2, 1, .5, D, 0 | Averaged per player. `.5` is an overpass to their side (rally continues); `0` is a shank |
| Set    | 3, 2, 1, 0        | Averaged; `0` is a setting error                                                         |
| Attack | K, A, 0           | K = kill, A = attack stays in play, 0 = attack error                                     |
| Block  | Solo, Asst, Err   |                                                                                          |
| Serve  | Ace, In, Err      |                                                                                          |

Every row ends on its one point-conceding button, so all the red sits down the right-hand edge —
a test enforces that, since it is the property that makes the sheet readable at a glance.

`D` records a dig. It sits in the pass row because it is the same first-contact decision, but it
counts as a dig and is deliberately kept out of the passing average.

Hitting percentage is the standard `(K − 0) / attempts` — kills minus attack errors over total
attempts — so it can be negative.

### Substitutions and the libero — the Subs tab

Every replacement happens on the **Subs** tab, which is laid out like the paper libero tracking
sheet a book keeper fills in. Subs only ever happen at a stoppage, so there is nothing to gain from
also doing them mid-rally on the court map — and one place to record them means one record.

Six rows, serving order I to VI. Each shows who started there, everyone who has been on since
(departed players struck through, exactly like the paper), how many terms of service the row has
had, and the court position it is currently standing in. Tap a row to send the libero on or off, or
to substitute.

None of that is stored. Serving order is the starting lineup — the player in position 1 serves
first, and rotation brings position 2 to position 1 next — and because rotation shifts all six
uniformly while a substitution replaces a player in place, the order never scrambles for the whole
set. So the sheet is replayed from the same events as the score.

**The one thing the app has to be told is whether a replacement was a libero swap or a
substitution**, because that cannot be inferred from the rally and it is the distinction the rules
turn on. A team gets 15 substitutions per set; libero replacements are unlimited and count against
nothing. The counter across the top is the `Subs: 1..15` row off the paper sheet.

A libero may replace different players all set, but may serve in **only one** rotation. You never
tell the app which — it is whichever rotation the libero first actually serves from, marked with a
**▲** on that row, exactly like the triangle on the paper sheet. It resets each set.

The mark is a triangle drawn around the numeral, matching the paper. If a libero does end up serving
from a second rotation, that is reported as the violation it is.

Each row also shows where it is standing right now: `P1 RB`, `P4 LF`, and so on. That is what the
front-row libero warning watches, and `P1` is always the row serving.

**Two liberos** can be designated, which current rules allow. They share one serving rotation between
them, only one is ever on court at a time, and rows read `L7` / `L19` instead of a bare `L` so you
can tell which is on.

Other things the sheet does for you:

- A player the libero has replaced is **not** offered as a substitute elsewhere. They are the only
  one who may come back for the libero, so using them in another position would both break that and
  put the same player on court twice.
- It warns when the libero has rotated into the front row. It warns and does not block — a
  courtside tool that refuses to record what actually happened is worse than one that records it
  and says so. The same goes for a 16th substitution.

Sets recorded before this existed read every libero swap as an ordinary substitution, since the
distinction was not captured at the time. The sheet falls back to "was a libero involved", which
gets old data close, but only newly recorded sets are exact.

The court map still shows the bench so you can see who is available; it just does not act on it.

## Layout

```
volleyball-stats/
├── index.html              shell: header, view, tab bar
├── roster.json             shared roster: numbers only, no names — see ROSTER.md
├── manifest.webmanifest    PWA metadata
├── sw.js                   offline precache (roster.json is network-first)
├── css/app.css
├── js/
│   ├── model.js            stat definitions, rotation maths, set replay  (pure)
│   ├── libero.js           libero tracking sheet and sub counting          (pure)
│   ├── stats.js            aggregation and derived metrics               (pure)
│   ├── store.js            state, persistence, actions
│   ├── app.js              tab routing, match lifecycle, wake lock
│   └── ui/
│       ├── dom.js          element helper, bottom sheet, toast
│       ├── court.js        capture view and stat sheet
│       ├── subs.js          libero tracking sheet, substitutions
│       ├── statsview.js    stat tables and rotation breakdown
│       ├── roster.js       roster, team settings, backup
│       └── log.js          point-by-point log
└── tests/                  node:test suites over the pure modules
```

`model.js`, `stats.js` and `store.js` have no DOM dependencies, which is what makes them
directly testable.

## Tests

```sh
node --test "volleyball-stats/tests/*.test.js"
```

These cover the parts that are easy to get subtly wrong and hard to notice courtside: rotation
direction, side-out timing, undo/delete recalculation, hitting percentage, and persistence. They
also guard the one mistake that cannot be undone — a player name reaching the published
`roster.json`.

## Known gaps

- **Opponent tracking** — the paper sheet covers both teams; this covers yours. The opponent is
  just a score.
- **Libero rules are tracked, not enforced** — replacements are counted separately and front-row
  rotation is flagged, but the app does not check that a rally has been completed between
  replacements, or that the libero serves in only one rotation.
- **Set/assist linkage** — set ratings are captured, but a set is not tied to the kill that
  followed it, so there is no assist column.
- **A device with no connection cannot pick up an update**, by design — it keeps the last copy it
  saw so it still works in a gym. Open the app once with signal to move it forward.

## Updating a published copy

Publish the new files and reopen the app with a connection. That is the whole procedure.

The service worker is **network-first with a cache fallback**: online it serves what is currently
published, offline it serves the last copy it saw. That is the opposite of the usual app-shell
advice, and it is deliberate — cache-first meant a change only appeared on the _second_ launch and
every deploy depended on remembering to bump a version constant by hand, which is exactly the kind
of step that gets forgotten and then looks like a broken deploy.

The network attempt is raced against a 3.5 second timeout, so a weak gym connection falls back to
the cache rather than hanging on a blank screen. If a new worker does take over mid-session, the
page reloads itself once so what is on screen matches what is installed.

`APP_VERSION` in `js/version.js` is shown at the bottom of the Roster tab. It exists purely to
answer "is this phone running what I just published?" — bump it when you publish so the answer is
visible, but nothing depends on it.
