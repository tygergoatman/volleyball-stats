# Editing the shared roster

`roster.json` holds the rosters for every team in the program. It is the one
place player names live, and every coach's app reads from it — edit it once on
GitHub and each phone picks up the change the next time it opens with a
connection.

You do not need to install anything. Edit it in the browser.

## The one rule

**A player's `id` must be unique and must never change or be reused.**

Stats are stored against the id, not the name. Change an id and that player's
recorded stats are orphaned; reuse an old id for a different player and the two
get merged. Names, numbers and positions are safe to change at any time — only
the id is permanent.

The ids in the file follow `team-number` (`jv-4`). That is only a convention to
keep them readable. If a player changes jersey number mid-season, **leave the id
alone** and change just the `number` field:

```json
{ "id": "jv-4", "number": "12", "name": "Tess" }
```

Her id still says 4, which looks odd, and that is fine — it keeps her season
intact.

## Editing it

1. Open `roster.json` in your repository on GitHub.
2. Click the pencil icon.
3. Make your change.
4. Change the `updated` date at the top — the app shows it on the Roster tab, so
   coaches can tell whether their phone has the latest list.
5. Click **Commit changes**.

Give GitHub Pages a minute to publish, then reopen the app on a phone that has a
connection. The Roster tab will show the new `updated` date.

## Adding a player

Add an object to that team's `players` list. Only `id`, `number` and `name` are
required:

```json
{ "id": "var-23", "number": "23", "name": "Riley", "position": "MB" }
```

Watch the commas — every entry needs a comma after it **except the last one in
the list**. A stray comma is the most common way to break the file.

`position` accepts `OH`, `MB`, `S`, `OPP`, `L` or `DS`. You can also set
`"isSetter": true` (marks the player on the court map) and `"isLibero": true`.

## Removing a player

Delete their object from the list. Their past stats are not lost — the app keeps
a copy of anyone dropped from the file so old matches still show their name. They
simply stop appearing on the current roster.

## Adding a team

Add another entry to `teams`. `id` is permanent for the same reason player ids
are; `name` is the short label on the buttons, `fullName` is shown as a heading.

```json
{ "id": "c-team", "name": "C", "fullName": "C Team", "players": [] }
```

## A player on two teams

Someone who swings between JV and Varsity should appear on **both** rosters, with
**the same id** in each:

```json
{ "id": "jv-7", "number": "7", "name": "Sam" }
```

Their stats then split correctly by team, because season totals are filtered by
the matches each team actually played. Give them two different ids and they will
look like two different people.

## If the file has a syntax error

The app ignores a file it cannot parse and quietly keeps the rosters already on
the device — deliberately, so a bad edit can never wipe out a roster mid-match.

That also means a broken file fails silently. To check a change landed, open the
Roster tab and look at the "Shared roster last updated" line. If it still shows
the old date after a minute, the file did not parse. GitHub highlights JSON
syntax errors in the editor, and a trailing comma is almost always the culprit.

## What stays on the device

`roster.json` covers players. It does not carry match data — stats live only on
the phone that recorded them and are never uploaded.

Players added through the app's Roster tab are tagged **this device** and are
kept when the file refreshes. Edits made in the app to a player who came from the
file also stick on that device, which means that phone stops tracking the file
for that field. For anything the whole program should see, edit `roster.json`
rather than the app.
