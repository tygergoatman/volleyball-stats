# Getting this on your phone — start here

You have never done this before? Good, this page assumes that. It uses no command line
and nothing gets installed on your computer.

**What this app actually is:** a website that behaves like an app. There is no App Store or
Play Store step. You put the files on the internet once, open the link on your phone, and add
it to your home screen. After that it has its own icon, runs full-screen with no browser bars,
and works with no signal.

**Roughly 15 minutes.** You need a free GitHub account and a computer.

---

## Step 1 — Get the files onto your computer

Download `volleyball-stats.zip` and unzip it. You should end up with a folder called
`volleyball-stats` containing `index.html`, a `js` folder, a `css` folder, and some others.

Keep this folder somewhere you can find it again, like your Desktop.

## Step 2 — Look at it before publishing anything (optional but reassuring)

Double-clicking `index.html` **will not work properly** — the browser blocks parts of the app
when opened that way. That is expected and is not a sign anything is broken. Skip to Step 3 if
you would rather just publish it; it will work correctly there.

## Step 3 — Make a home for it on GitHub

1. Go to <https://github.com/new> (sign in first if it asks).
2. **Repository name:** `volleyball-stats`
3. **Public** or **Private**: choose **Public**. Free GitHub accounts can only publish a
   website from a _public_ repository. Public means anyone who finds the link can read the
   code — there is nothing private in it, and none of your match data is ever stored here
   (that stays on your phone).
4. Leave every other option alone. Click **Create repository**.

## Step 4 — Upload the files

On the page that appears after creating the repo:

1. Click the link **uploading an existing file** (it is in the small text near the top). If you
   do not see it, go to `https://github.com/YOUR-USERNAME/volleyball-stats/upload/main`.
2. Open your `volleyball-stats` folder on your computer.
3. Select **everything inside it** — the individual files and folders, _not_ the folder itself.
   (Ctrl+A on Windows, Cmd+A on Mac, with the folder open.)
4. Drag them onto the GitHub upload area and wait for the file list to finish appearing.
5. Scroll down and click **Commit changes**.

> **The one mistake to avoid:** if you drag the `volleyball-stats` folder itself, everything
> ends up one level too deep and the site will show a "404". You want `index.html` sitting at
> the top level of the repository, not inside another folder.

## Step 5 — Turn on the website

1. In your repository, click the **Settings** tab (top right, gear icon).
2. In the left sidebar, click **Pages**.
3. Under "Build and deployment" → **Source**, leave it on _Deploy from a branch_.
4. Under **Branch**, change `None` to `main`, leave the folder as `/ (root)`, click **Save**.
5. Wait 1–2 minutes, then refresh the page. A green box appears with your link:

    `https://YOUR-USERNAME.github.io/volleyball-stats/`

That link is your app. It works on any device, forever, for free.

## Step 6 — Put it on your home screen

On your Android phone:

1. Open that link in **Chrome**.
2. Tap the **⋮** menu (top right).
3. Tap **Add to Home screen**, then **Install**.

Done. Launch it from the new icon like any other app.

---

## Step 7 — Put your real players in

The app ships with placeholder rosters ("Player One", "Player Two"…) for MS, JV and Varsity. Swap
in your actual players by editing **`roster.json`** in your repository — see
[ROSTER.md](./ROSTER.md) for the details.

That file is shared: edit it once and every coach's phone picks it up. You do not have to do this
on each device.

## Using it courtside

Before each match: **Court** tab → **New Match** → pick the team (MS / JV / Var) → tap each spot
on the court to place your starting six → **Start Set**.

During play: **tap a player, tap the stat.** Two taps, no confirm button.

Read the [README](./README.md) for what each stat button does and how the scoring works.

## Things worth knowing

**Your match data lives on your phone, not on GitHub.** Uploading the code does not upload any
stats. Nobody else can see your team's numbers.

**Because it lives on your phone, back it up.** Roster tab → Data → **Export backup** saves a
file you can restore later. Do this after a tournament. If you clear your browser data or lose
the phone without a backup, the season is gone.

**Airplane mode is fine.** After the first load the app is cached on the device. Gyms with no
signal are the normal case, not the exception.

**Test it before a real match.** Add your roster, run through a few fake rallies, and check the
score moves the way you expect. Better to find a surprise in your living room.

## Changing it later

To edit a file: open it in your GitHub repository, click the pencil icon, make the change, click
**Commit changes**. The live site updates in about a minute.

Once Pages has finished publishing, open the app on your phone **with a connection** and it picks
the change up on that launch. There is nothing to bump and nothing to reinstall.

To confirm which build a phone is on, look at the bottom of the Roster tab — it shows the app
version and the date of the roster it has. **Check for update** next to it forces a fresh look.

If a phone seems stuck on an old version, it is almost always because it had no connection when
you opened it. Open it somewhere with signal and tap **Check for update**.

## If something goes wrong

**The link shows a 404.** Either Pages has not finished building (wait 2 minutes and refresh),
or the files went in one level too deep. Look at your repository's main page — you should see
`index.html` listed there directly. If instead you see a single `volleyball-stats` folder, see
the next entry.

**You uploaded the folder instead of its contents.** Nothing is broken and nothing needs
deleting. Two ways out:

- _Do nothing._ Add the folder name to the end of your link and it just works:
  `https://YOUR-USERNAME.github.io/volleyball-stats/volleyball-stats/`. Every path inside the
  app is relative, so it runs correctly at any depth — offline mode and home-screen install
  included. The only downside is a longer link.
- _Get the short link back._ Go to
  `https://github.com/YOUR-USERNAME/volleyball-stats/upload/main` and upload again, this time
  selecting the files _inside_ the folder. The stray nested copy is then unused; leave it or
  delete the files one at a time. Afterwards `index.html` should be listed on your
  repository's main page.

If you already added the app to your home screen from the long link, delete that icon and
re-add it from the new one — otherwise you will keep launching the old copy.

**The page loads but is unstyled or blank.** Usually a partial upload. Check that `css/app.css`
and `js/app.js` both exist in the repository.

**"Add to Home screen" is missing.** Make sure you are in Chrome and the address starts with
`https://`. It will not offer to install from an `http://` address.
