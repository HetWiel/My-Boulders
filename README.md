# My Boulders

My bouldering sessions from [TopLogger](https://app.toplogger.nu), turned into charts: a session calendar, grade progression, a grade pyramid, flash rate per wall, and a "fingerprint" of every session drawn in the real hold colours.

There's also **Boulders Wrapped** (`wrapped.html`): a Spotify-Wrapped-style story per year, with a climbing personality and a share card you can save as an image.

The site is plain HTML + [Observable Plot](https://observablehq.com/plot/), live at **https://boulders.hetwiel.dev**. A GitHub Action pulls new sessions from TopLogger every morning and commits them; the deploy of [HetWiel/hetwiel](https://github.com/HetWiel/hetwiel) picks up `site/` right after and puts it on the server.

```
site/              the website: dashboard (index.html, app.js) and Wrapped (wrapped.*), shared code in lib.js
climbers.json      who gets synced (you + friends, each switched on or off)
site/data/         one JSON file per climber + climbers.json index, written by the sync
scripts/sync.mjs   pulls sessions + logs from TopLogger's GraphQL API
.github/workflows/ daily sync
```

## One-time setup

### 1. Refresh token

TopLogger's sign-in needs a reCAPTCHA, so the sync can't log in with a password. It uses a **refresh token** instead. Tokens last 14 days, and every sync swaps the old one for a new one, so after this one-time step it keeps itself logged in.

1. Open a **private/incognito window** in Chrome or Firefox and sign in at [app.toplogger.nu](https://app.toplogger.nu).
2. Open the developer console (`F12` → Console) and run:
   ```js
   copy(JSON.parse(localStorage['tl-auth']).refresh.token)
   ```
   The token is now on your clipboard.
3. Close the private window. **Don't click "Sign out"** — that revokes the token.
4. In this repo: **Settings → Secrets and variables → Actions → New repository secret**
   Name: `TL_REFRESH_TOKEN`, value: paste.

Treat the token like a password: it gives access to your TopLogger account.

### 2. First run

**Actions → Sync TopLogger → Run workflow.** After that it runs daily on its own.

## Adding friends

Friends are synced with **your** TopLogger login, the same way the app shows you their profile. So it works for anyone whose profile is public, or who accepted your follow. They don't have to give you anything.

1. Ask them first: the repo is public, so their sessions become public too.
2. In `climbers.json`, set `"enabled": true` for them (or add a new line). Their user ID is in the URL of their TopLogger profile.
   ```json
   { "slug": "bas", "name": "Bas", "userId": "nfod5qyge8ibwnn0uqgr7", "enabled": true }
   ```
3. Commit. The workflow syncs them right away.

Each climber gets their own dashboard (`?climber=bas`) and Wrapped, and Wrapped gets a crew card ranking everyone. If a friend's profile goes private, the sync skips them and keeps their last data. Set them to `false` and delete `site/data/<slug>.json` to remove them.

The sync only refetches the last three weeks of sessions each day; older sessions are reused, so adding friends doesn't hammer TopLogger.

## When the sync breaks

If the workflow doesn't run for more than 14 days (or the token is revoked), the run fails with *"Set the TL_REFRESH_TOKEN secret again"*. Redo step 1 and re-run the workflow. The site keeps showing the last synced data in the meantime.

## Run locally

```sh
TL_REFRESH_TOKEN=… node scripts/sync.mjs   # refresh site/data/ (Node 20+)
python3 -m http.server -d site 8000        # open http://localhost:8000
```

## Note on privacy

The repo is public, so `site/data/` (dates, gyms, grades and walls of every logged boulder) is public too, and so is the site. Make the repo private if you'd rather not share that; the hetwiel deploy then needs a token with access to this repo to fetch it.
