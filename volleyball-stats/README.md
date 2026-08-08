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

## Teams

The app carries several teams — MS, JV and Varsity out of the box — each with its own roster and
its own season totals. You pick the team when you create a match, and from then on that match
uses that roster; the Stats tab scopes season totals to it, so a JV kill never lands in a Varsity
line.

Rosters come from [`roster.json`](./roster.json), published alongside the app. That file is the
shared source of truth: edit it once on GitHub and every coach's phone picks it up the next time
it loads with a connection. See [ROSTER.md](./ROSTER.md) for how to edit it — the rule that
matters is that a player's `id` must never change or be reused.

Players can also be added on a single device from the Roster tab. They are tagged **this device**
and survive roster-file refreshes, but nobody else sees them.

## Data

Match data lives in `localStorage` on the device and is **never uploaded** — only the roster is
shared, and only in one direction. Two coaches running the app have two independent sets of
matches.

That also means **clearing your browser data deletes your season**, so use Roster → Data →
_Export backup_ periodically.

To combine devices after a game, use **Merge a file**: it adds the other coach's matches to yours
and leaves your own alone, skipping anything already present. _Replace everything from a file_ is
the destructive option, for restoring a backup onto a clean device.

The workflow this is built around:

1. One person maintains `roster.json`; everyone else just opens the app online once
2. One scorer per match — two people half-scoring the same game produces two incomplete records
3. After the game, that scorer exports and sends the file on
4. Whoever keeps season totals merges it in

Per-set, per-match and season stats can also be exported as CSV from the Stats tab.

## How capture works

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
The rotation counter runs 1 → 6 and wraps, starting from whichever rotation you pick at set setup.

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

### Substitutions

Tap a bench chip to arm it (it outlines green), then tap the player coming off. The incoming
player takes that court position and rotates from there. Tap the chip again to cancel.

## Layout

```
volleyball-stats/
├── index.html              shell: header, view, tab bar
├── roster.json             shared rosters for every team — see ROSTER.md
├── manifest.webmanifest    PWA metadata
├── sw.js                   offline precache (roster.json is network-first)
├── css/app.css
├── js/
│   ├── model.js            stat definitions, rotation maths, set replay  (pure)
│   ├── stats.js            aggregation and derived metrics               (pure)
│   ├── store.js            state, persistence, actions
│   ├── app.js              tab routing, match lifecycle, wake lock
│   └── ui/
│       ├── dom.js          element helper, bottom sheet, toast
│       ├── court.js        capture view and stat sheet
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
direction, side-out timing, undo/delete recalculation, hitting percentage, and persistence.

## Known gaps

- **Libero tracking** — a player can be flagged as libero on the roster, but the app does not
  model libero replacements separately from ordinary substitutions or enforce back-row rules.
- **Set/assist linkage** — set ratings are captured, but a set is not tied to the kill that
  followed it, so there is no assist column.
- **Opponent stats** — only your own team's players are tracked; the opponent is just a score.
- **Bumping `CACHE_NAME` in `sw.js`** is manual. Change it whenever you edit a shell file, or
  installed copies will keep serving the old version.
