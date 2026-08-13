# Teams and the roster

**The roster lives in the app.** Add, edit and delete players on the Roster tab of
your phone. Nothing about players is stored on GitHub.

`roster.json` still exists, but it is now a starter file with one job: give a
freshly installed app the three team labels, so you are not typing "Junior
Varsity" on a phone keyboard. Everything else is local.

## Never put names in `roster.json`

This file is published on the open web at the app's own address. Anyone who
visits `.../roster.json` reads it, no GitHub account needed, and making the
repository private would not change that — the app fetches the file over plain
HTTP, so whatever the app can read, so can anyone else.

Git also keeps everything. A name committed here and deleted next week is still
in the public history, permanently retrievable. There is no clean undo.

Player names are typed into the app instead and stay on that phone.
`tests/privacy.test.js` fails if a name ever appears in this file.

## Managing the roster in the app

Roster tab:

- **+ Player** — number, name, position, and which teams they play for. A player
  can carry more than one team tag.
- **Tap a player** — edit any of that, or **Delete player** to remove them from
  the program. Stats already recorded stay in past matches either way.
- **The filter row** — All, one button per team, and No team if anyone is
  untagged. This is how you answer "who is on JV?".
- **+ Team** and the **⋯** on a team — add, rename or remove teams.

Names are optional. Skip them and the app reads `#7` everywhere, which is what it
leads with courtside anyway.

### Somebody who plays two teams

**Give them one entry per team**, because they almost always wear a different
number on each — and the number is how the app names them. Nothing is lost:
season totals are filtered by the matches each team played, so their JV and
Varsity stats were never going to be added together regardless.

Two tags on one entry is right only in the rarer case where the number is the
same on both.

### Moving a player between teams

Same number, moving up: tick the new team, untick the old one.

Different number: **leave the old entry alone and add a new one.** The old entry
holds the JV stats already recorded; the new one starts clean. Editing the number
on the existing entry would make every stat recorded under it retroactively
appear to belong to the new number.

## Your roster is only on this phone

This is the trade for keeping names off the internet, and it is worth being blunt
about: clearing your browser data deletes the roster **and the season**.

Roster tab → Data → **Save backup to this device** writes a file with everything
in it. Do that after you set the roster up, and periodically during the season.
**Share backup** sends the same file somewhere safer.

`roster.json` will restore the team labels on a new device. It will not restore
players — only your backup does that.

## Editing `roster.json`

Only if you want to change the team labels a _newly installed_ app starts with.
Changing them here does not rename teams on a phone that already has them; the
app remembers its own names once it has them.

1. Open `roster.json` in your repository on GitHub, click the pencil icon.
2. Edit the `teams` list. `id` is permanent — the app files everything against it.
   `name` is the short button label, `fullName` the heading. They appear in the
   app in the order listed here.
3. Change the `updated` date. The Roster tab shows it, which is how you tell the
   file actually landed.
4. **Commit changes.**

```json
{ "id": "c-team", "name": "C", "fullName": "C Team" }
```

Removing a team here only affects apps that have not already downloaded it.
Removing one **in the app** is the real removal, and it is deliberately gentle: it
drops that tag from every player and hides the team on that device. Nobody is
deleted and no matches are lost. The app remembers the removal so this file cannot
put the team back, and offers a Restore button if it was a mistake.

### If the file has a syntax error

The app ignores a file it cannot parse and keeps what is already on the device —
deliberately, so a bad edit can never wipe a roster mid-match. That also means a
broken file fails silently. Check the "Team labels last updated" line on the
Roster tab; if the date has not moved after a minute, it did not parse. A trailing
comma is almost always the culprit.

The app is also fine with no `roster.json` at all. A fresh device then starts with
no teams and says so, and you build them with **+ Team**.

## If you ever do put players in the file

Supported, and the sensible choice if several coaches ever share one program
roster and you would rather type it on a keyboard than a phone. Numbers only:

```json
{ "id": "p-023", "number": "23", "position": "MB", "teams": ["var"] }
```

Two things to know before you do:

- **A player's `id` must be unique and must never change or be reused.** Stats are
  filed against the id. Change one and that player's history is orphaned; reuse an
  old one and two players merge.
- **Deleting a file player in the app does not stick.** The next online load
  re-adds them, because the file is treated as the source of truth for anyone it
  lists. Remove them from the file instead. (Teams do not have this problem — a
  team removal is remembered.)

`position` accepts `OH`, `MB`, `S`, `OPP`, `L` or `DS`. Choosing `S` or `L` is what
marks the setter and libero on the court map — there is no separate flag, so the
roster cannot contradict itself.
