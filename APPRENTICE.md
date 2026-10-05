# The Apprentice: My Boulders

The machine built this work. This file is the other half: one card per material, so the
maker can learn what was built. The levels live in `apprentice.yml`; the rules of the loop
are in `CLAUDE.md` and the skill `.claude/skills/apprentice/`.

How a card is used in a teach-back:
1. The maker reads *What it is* and *Where it lives*, and opens the files.
2. The maker explains the material in his own words, without looking.
3. The machine asks the *Questions* and judges the answers: understood, half, or not yet.
4. Understood → level `understood`. Later, doing the *By hand* task → `by-hand`.

Ledger opened: 5 October 2026 (retroactive: everything below was built before the loop existed).

---

## graphql · A GraphQL API

**What it is.** TopLogger's app talks to one address (`app.toplogger.nu/graphql`). Instead of
fixed URLs per kind of data, every request is a small query that names exactly which fields it
wants back: sessions, logs, grades, walls.

**Where it lives.** `scripts/sync.mjs` (`Q_DAYS`, `Q_LOGS`, function `gql`).

**Why this way.** There's no official TopLogger API; the sync asks the same questions the app does.

**Questions.**
- In `Q_LOGS`, which part says *what* you want and which part says *for whom*?
- What is the difference between a GraphQL `query` and a `mutation`? Which one is `Q_REFRESH`?
- TopLogger changes its app tomorrow. What breaks, and how would you notice?

**By hand.** Add one extra field to `Q_DAYS` (look in your browser's network tab for what the app asks), run the sync locally and find the field in the JSON.

---

## tokens · Access and refresh tokens

**What it is.** Two tokens. A short-lived *access* token goes with every request. A
*refresh* token (about 14 days) is only used to get a new pair. Every run swaps the old
refresh token for a new one, so the login never expires as long as the job keeps running.

**Where it lives.** `scripts/sync.mjs` (comment at the top, `Q_REFRESH`, `jwtClaims`), `README.md` (Refresh token).

**Why this way.** TopLogger's sign-in needs a reCAPTCHA, so a script can't log in with a password.

**Questions.**
- Why are there two tokens instead of one?
- What does `jwtClaims` read out of a token, without asking TopLogger?
- The workflow didn't run for three weeks. What happens, and what do you do?

**By hand.** Decode your own refresh token on jwt.io and find its expiry date.

---

## scheduled-job · A scheduled job

**What it is.** `.github/workflows/sync.yml` runs every morning at 05:17 UTC (`cron`), on
pushes, and by hand. It runs the sync and commits new data as `github-actions[bot]`.

**Where it lives.** `.github/workflows/sync.yml`.

**Why this way.** Free, no server needed, and every change in the data is visible in Git.

**Questions.**
- Read `'17 5 * * *'` out loud. Why 05:17 and not 05:00?
- Why does the hetwiel deploy run at 05:47?
- What does `permissions: contents: write` allow, and why is it needed?

**By hand.** Change the schedule to run twice a day, push, and check the Actions tab the next day.

---

## state-between-runs · Memory between runs

**What it is.** Every GitHub Actions run starts on a fresh, empty machine. The newest refresh
token is saved in the Actions cache at the end of a run and restored at the start of the next.

**Where it lives.** `.github/workflows/sync.yml` (steps *Restore* and *Save TopLogger session*).

**Why this way.** A secret can't be updated by the workflow itself; the cache can, and it's private to the repo.

**Questions.**
- Why would the sync break after 14 days without the cache?
- Why does the cache key contain `run_id`, and what does `restore-keys` do?
- Why is `.tl-auth/` in `.gitignore`?

**By hand.** Find the cache entries under the repo's Actions → Caches and explain why there are several.

---

## incremental-sync · Incremental sync

**What it is.** Sessions older than three weeks (`REFETCH_DAYS = 21`) are taken from the last
run's JSON instead of being fetched again, unless the number of tries changed.

**Where it lives.** `scripts/sync.mjs` (`REFETCH_DAYS`, the `cutoff`).

**Why this way.** Less load on TopLogger, a faster run, and room to add friends without hammering anyone.

**Questions.**
- Why 21 days and not 1?
- What would go wrong if you edited a log from two months ago in the app?
- How would you force a full refetch once?

**By hand.** Run the sync locally with `REFETCH_DAYS` set to 0 and compare the run time.

---

## json-data · Data as files

**What it is.** No database. The sync writes `site/data/<climber>.json` and
`site/data/climbers.json`; the site reads them with `fetch`.

**Where it lives.** `site/data/`, `climbers.json`, `site/lib.js` (`loadClimbers`, `loadData`).

**Why this way.** A static site can be hosted anywhere, and Git keeps the full history of every climb.

**Questions.**
- What is the difference between `climbers.json` at the root and `site/data/climbers.json`?
- When would this approach stop working, and what would you use then?
- Why `cache: 'no-cache'` in `loadData`?

**By hand.** Open your own JSON file and find your hardest send by hand.

---

## es-modules · JavaScript modules

**What it is.** `app.js` and `wrapped.js` import shared code from `lib.js`, and import Observable
Plot and d3 straight from a CDN (`cdn.jsdelivr.net/.../+esm`). No build step.

**Where it lives.** The first lines of `site/app.js`, `site/lib.js`, `site/wrapped.js`; `<script type="module">` in the HTML.

**Why this way.** No `npm`, no bundler: the files on GitHub are exactly the files that run.

**Questions.**
- What does `export` in `lib.js` do, and what happens if you remove one?
- What is the risk of loading libraries from someone else's CDN?
- Why does this site get a looser security policy than hetwiel.dev?

**By hand.** Move one small helper from `app.js` to `lib.js` and import it back.

---

## data-viz · Charts from data

**What it is.** Observable Plot describes a chart as *marks* (dots, bars, lines) on *scales*
(time, grade, colour). You hand it the data and say what goes where; it draws an SVG.

**Where it lives.** `site/app.js` (each chart is one `Plot.plot({...})`).

**Why this way.** A grammar of graphics: a new chart is a few lines, not a drawing program.

**Questions.**
- Pick one chart on the site. Which mark does it use, and what is on x and y?
- What is a scale, in your own words?
- Why are the session fingerprints drawn in the real hold colours?

**By hand.** Add a simple new chart yourself: sessions per month as bars.

---

## data-shaping · Shaping data

**What it is.** Raw logs (one row per try) are grouped into one record per boulder per session
and one per boulder overall: sent or not, flashed or not, how many tries. Grades are numbers
(600 = 6a) snapped to the Font scale.

**Where it lives.** `site/lib.js` (`FONT`, `snap`, `summarize`).

**Why this way.** Every chart starts from the same cleaned-up data, so they never disagree.

**Questions.**
- What does `snap` do, and why is it needed?
- What is the difference between a *try*, a *tick* and a *flash* in this data?
- What does `d3.rollups` do in `summarize`?

**By hand.** Write a small function that returns your flash rate per gym, and log it in the console.

---

## url-state · State in the address

**What it is.** `?climber=bas` and `?year=2025` decide what the page shows. The same files serve every climber.

**Where it lives.** `site/lib.js` (`loadClimbers`, `pageUrl`).

**Why this way.** Links can be shared and bookmarked, and there's nothing to remember on a server.

**Questions.**
- What happens with `?climber=nobody`?
- How does a link from the dashboard to Wrapped keep the climber?
- Why is the first climber in the list "the owner"?

**By hand.** Add a `?gym=` filter that only shows sessions from one gym.

---

## share-image · Sharing an image

**What it is.** Wrapped turns its share card (a piece of HTML) into a PNG with `html-to-image`,
and offers it to the phone's share menu with `navigator.share`, with a download as fallback.

**Where it lives.** `site/wrapped.js` (the end of the file).

**Why this way.** People share pictures, not links.

**Questions.**
- Why is `html-to-image` imported only when someone clicks, and not at the top?
- What happens on a desktop browser without `navigator.share`?
- Why does the card look the same on every phone?

**By hand.** Change the text on the share card and test sharing it to yourself.

---

## public-data · Public data, on purpose

**What it is.** The repo is public, so every logged boulder (date, gym, grade, wall) of every
enabled climber is public. Friends are switched off by default and only enabled after they agree.

**Where it lives.** `README.md` (Adding friends, Note on privacy), `climbers.json` (`enabled`).

**Why this way.** A conscious choice: hosting is free and simple, at the price of public data.

**Questions.**
- What exactly can a stranger learn about you from `site/data/jasper.json`?
- What would you have to change to make the repo private, and what breaks?
- A friend wants out. What are the two steps?

**By hand.** Write down in two sentences what you would tell a friend before enabling them.

---

## Teach-back log

Each session: date, materials covered, result. Newest at the top.

<!-- 2026-10-05 · ledger opened; all materials at `seen` -->
