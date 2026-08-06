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

## Data

All data lives in `localStorage` on the device. Nothing is uploaded anywhere, and there is no
account or server. That also means **clearing your browser data deletes your season**, so use
Roster → Data → _Export backup_ periodically. The exported JSON restores through _Import backup_
on any device.

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

### Stats captured

| Group  | Options         | Notes                                                                                    |
| ------ | --------------- | ---------------------------------------------------------------------------------------- |
| Pass   | 3, 2, 1, .5, 0  | Averaged per player. `.5` is an overpass to their side (rally continues); `0` is a shank |
| Attack | K, A, 0         | K = kill, A = attack stays in play, 0 = attack error                                     |
| Set    | 3, 2, 1, 0      | Averaged; `0` is a setting error                                                         |
| Serve  | Ace, In, Err    |                                                                                          |
| Block  | Solo, Asst, Err |                                                                                          |
| Dig    | Dig, Err        |                                                                                          |

Hitting percentage is the standard `(K − 0) / attempts` — kills minus attack errors over total
attempts — so it can be negative.

### Substitutions

Tap a bench chip to arm it (it outlines green), then tap the player coming off. The incoming
player takes that court position and rotates from there. Tap the chip again to cancel.

## Layout

```
volleyball-stats/
├── index.html              shell: header, view, tab bar
├── manifest.webmanifest    PWA metadata
├── sw.js                   offline precache
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
