# Editing the shared roster

`roster.json` holds one roster for the whole program, plus the list of teams.
Every coach's app reads from it — edit it once on GitHub and each phone picks up
the change the next time it opens with a connection.

You do not need to install anything. Edit it in the browser.

## How it is put together

Two lists. `teams` are just labels; `players` is everyone, and each player says
which teams they play for:

```json
{
    "version": 2,
    "updated": "2026-08-06",
    "teams": [
        { "id": "jv", "name": "JV", "fullName": "Junior Varsity" },
        { "id": "var", "name": "Var", "fullName": "Varsity" }
    ],
    "players": [{ "id": "p-014", "number": "7", "name": "Sam", "position": "OH", "teams": ["jv", "var"] }]
}
```

Sam is one person on two teams. Her JV and Varsity stats stay separate anyway,
because season totals are filtered by the matches each team played.

## The one rule

**A player's `id` must be unique and must never change or be reused.**

Stats are stored against the id, not the name. Change an id and that player's
recorded stats are orphaned; reuse an old id for a different player and the two
get merged. Names, numbers, positions and team tags are all safe to change at any
time — only the id is permanent.

Ids do not have to mean anything. `p-014` is fine. Deliberately **not** tying them
to jersey numbers avoids the temptation to change one when a number changes:

```json
{ "id": "p-014", "number": "12", "name": "Sam" }
```

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

Add an object to `players`. Only `id`, `number`, `name` and `teams` matter:

```json
{ "id": "p-023", "number": "23", "name": "Riley", "position": "MB", "teams": ["var"] }
```

Watch the commas — every entry needs one after it **except the last in the list**.
A stray comma is the most common way to break the file.

`position` accepts `OH`, `MB`, `S`, `OPP`, `L` or `DS`. You can also set
`"isSetter": true` (marks the player on the court map) and `"isLibero": true`.

## Moving a player between teams

Change their `teams` list. Moving up from JV to Varsity mid-season:

```json
{ "id": "p-014", "teams": ["var"] }
```

Playing both:

```json
{ "id": "p-014", "teams": ["jv", "var"] }
```

Stats already recorded stay where they were — a kill in a JV match stays in the
JV column no matter what tags the player carries afterwards.

## Removing a player

Delete their object from `players`. Their past stats are not lost — the app keeps
a copy of anyone dropped from the file so old matches still show their name. They
simply stop appearing on the roster.

To take somebody off one team but keep them in the program, remove that team from
their `teams` list rather than deleting the whole entry.

## Adding a team

Add an entry to `teams`. `id` is permanent for the same reason player ids are;
`name` is the short label on the buttons, `fullName` is shown as a heading.
Teams appear in the app in the order they are listed here.

```json
{ "id": "c-team", "name": "C", "fullName": "C Team" }
```

Then add `"c-team"` to the `teams` list of whoever plays for it.

## Removing a team

Deleting a team from this file removes it for anyone whose app has not already
downloaded it. It does **not** reach onto devices that already have it.

Removing a team **in the app** is a separate thing, and it is deliberately gentle:
it drops that tag from every player and hides the team on that one device. Nobody
is deleted and no matches are lost. The app remembers the removal so this file
cannot put the team back, and offers a Restore button if it was a mistake.

So: edit this file to change the program; use the app to tidy up a single phone.
To retire a team everywhere, do both.

## If the file has a syntax error

The app ignores a file it cannot parse and quietly keeps the roster already on the
device — deliberately, so a bad edit can never wipe out a roster mid-match.

That also means a broken file fails silently. To check a change landed, open the
Roster tab and look at the "Shared roster last updated" line. If it still shows
the old date after a minute, the file did not parse. GitHub highlights JSON syntax
errors in the editor, and a trailing comma is almost always the culprit.

## An older file still works

If your `roster.json` still nests a `players` list inside each team — the shape
this app used first — it will keep loading, and anyone appearing under two teams
is folded into one player with both tags. Moving to the layout above is worth
doing anyway, because it is the one place a swing player is written once.

## What stays on the device

`roster.json` covers teams and players. It does not carry match data — stats live
only on the phone that recorded them and are never uploaded.

Players added through the app's Roster tab are marked **added on this device** and
are kept when the file refreshes. Edits made in the app to a player from the file
also stick on that device, which means that phone stops tracking the file for that
field. For anything the whole program should see, edit `roster.json` rather than
the app.
