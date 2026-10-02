# My Boulders

My bouldering sessions from [TopLogger](https://app.toplogger.nu), turned into charts: a session calendar, grade progression, a grade pyramid, flash rate per wall, and a "fingerprint" of every session drawn in the real hold colours.

There's also **Boulders Wrapped** (`wrapped.html`): a Spotify-Wrapped-style story per year, with a climbing personality and a share card you can save as an image.

The site is plain HTML + [Observable Plot](https://observablehq.com/plot/), hosted on GitHub Pages. A GitHub Action pulls new sessions from TopLogger every morning and redeploys.

```
site/              the website: dashboard (index.html, app.js) and Wrapped (wrapped.*), shared code in lib.js
site/data/         climbs.json — written by the sync, read by the site
scripts/sync.mjs   pulls sessions + logs from TopLogger's GraphQL API
.github/workflows/ daily sync + Pages deploy
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

### 2. GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

### 3. First run

**Actions → Sync TopLogger & deploy → Run workflow.** After that it runs daily on its own.

## When the sync breaks

If the workflow doesn't run for more than 14 days (or the token is revoked), the run fails with *"Set the TL_REFRESH_TOKEN secret again"*. Redo step 1 and re-run the workflow. The site keeps showing the last synced data in the meantime.

## Run locally

```sh
TL_REFRESH_TOKEN=… node scripts/sync.mjs   # refresh site/data/climbs.json (Node 20+)
python3 -m http.server -d site 8000        # open http://localhost:8000
```

## Note on privacy

The repo is public, so `site/data/climbs.json` (dates, gyms, grades and walls of every logged boulder) is public too. Make the repo private if you'd rather not share that — GitHub Pages on a private repo needs a paid plan.
