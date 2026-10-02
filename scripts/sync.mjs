#!/usr/bin/env node
// Pulls bouldering sessions from TopLogger and writes one JSON file per climber
// into site/data/, plus site/data/climbers.json listing who's on the site.
//
// Who gets synced is set in climbers.json at the repo root:
//   { "slug": "jasper", "userId": "me" }                          ← you (the token's owner)
//   { "slug": "bas", "userId": "nfod5…", "enabled": false }       ← a friend, switched off
// Friends are read with YOUR login, the same way the TopLogger app shows you their
// profile, so it only works for people whose profile is public or who accepted your follow.
// The repo is public: only enable a friend after they've said yes.
//
// Auth: TopLogger's sign-in needs a reCAPTCHA, so this script never logs in with a
// password. It uses a refresh token instead (valid ~14 days). Every run swaps it for
// a fresh one and saves that to .tl-auth/refresh-token, which the GitHub workflow
// carries over to the next run. As long as it runs at least every two weeks, it
// keeps itself logged in.
//
// Token sources, freshest wins:
//   1. .tl-auth/refresh-token   (written by the previous run)
//   2. TL_REFRESH_TOKEN env var (the GitHub secret you set once)

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://app.toplogger.nu/graphql';
const TOKEN_FILE = join(ROOT, '.tl-auth', 'refresh-token');
const CONFIG_FILE = join(ROOT, 'climbers.json');
const DATA_DIR = join(ROOT, 'site', 'data');
// Sessions older than this are reused from the last run instead of refetched,
// unless TopLogger reports a different number of tries for them.
const REFETCH_DAYS = 21;

const Q_REFRESH = `mutation authSigninRefreshToken($refreshToken: JWT!) {
  tokens: authSigninRefreshToken(refreshToken: $refreshToken) {
    access { token expiresAt }
    refresh { token expiresAt }
  }
}`;

const Q_USER = `query userForNameFollow($userId: ID!) { user(id: $userId) { id fullName } }`;

const Q_DAYS = `query climbDaysSessionsList($userId: ID!, $pagination: PaginationInputClimbDays) {
  climbDaysPaginated(userId: $userId, totalTriesMin: 1, pagination: $pagination) {
    pagination { total page perPage }
    data {
      id statsAtDate gymId title
      bouldersTotalTries bouldersDayGrade bouldersDayGradeMax bouldersDayGradeFlPct
      routesTotalTries
      gym { id name nameSlug city gradingSystemBoulders }
    }
  }
}`;

const Q_LOGS = `query climbLogsSession($gymId: ID, $userId: ID!, $climbedAtDate: DateTime, $pagination: PaginationInputClimbLogs) {
  climbLogs(gymId: $gymId, userId: $userId, climbedAtDate: $climbedAtDate, pagination: $pagination) {
    pagination { total page perPage }
    data {
      id climbId climbType climbedAtDate tryIndex tickIndex ticked tickType topped zones points
      climb { id name grade climbType outAt holdColor { color } wall { id nameLoc } }
    }
  }
}`;

const jwtClaims = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

async function gql(query, variables, bearer) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-locale': 'en-us',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.errors) {
    const msg = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body.data;
}

async function candidateTokens() {
  const list = [];
  if (existsSync(TOKEN_FILE)) list.push({ source: 'saved from last run', token: (await readFile(TOKEN_FILE, 'utf8')).trim() });
  if (process.env.TL_REFRESH_TOKEN) list.push({ source: 'TL_REFRESH_TOKEN secret', token: process.env.TL_REFRESH_TOKEN.trim() });
  const now = Date.now() / 1000;
  return list
    .map((c) => ({ ...c, exp: jwtClaims(c.token)?.exp ?? 0 }))
    .filter((c) => c.token && c.exp > now)
    .sort((a, b) => b.exp - a.exp);
}

async function signIn() {
  const candidates = await candidateTokens();
  if (!candidates.length) {
    throw new Error(
      'No valid TopLogger refresh token. Set the TL_REFRESH_TOKEN secret again (see README → "Refresh token").'
    );
  }
  for (const c of candidates) {
    try {
      const { tokens } = await gql(Q_REFRESH, { refreshToken: c.token }, c.token);
      await mkdir(dirname(TOKEN_FILE), { recursive: true });
      await writeFile(TOKEN_FILE, tokens.refresh.token, { mode: 0o600 });
      const userId = jwtClaims(tokens.access.token)?.sub;
      console.log(`Signed in using ${c.source}. New refresh token valid until ${tokens.refresh.expiresAt}.`);
      return { access: tokens.access.token, userId };
    } catch (err) {
      console.warn(`Refresh with ${c.source} failed: ${err.message}`);
    }
  }
  throw new Error('All refresh tokens were rejected. Set the TL_REFRESH_TOKEN secret again (see README).');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function paginate(query, variables, pick, bearer, perPage) {
  const all = [];
  for (let page = 1; ; page++) {
    const conn = pick(await gql(query, { ...variables, pagination: { page, perPage } }, bearer));
    all.push(...conn.data);
    if (!conn.data.length || all.length >= conn.pagination.total) return all;
    await sleep(150);
  }
}

const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);

async function syncClimber(access, userId, prev) {
  const days = await paginate(Q_DAYS, { userId }, (d) => d.climbDaysPaginated, access, 50);

  const prevSessions = new Map((prev?.sessions || []).map((s) => [s.id, s]));
  const prevLogs = new Map();
  for (const l of prev?.logs || []) {
    const k = `${l.date}|${l.gym}`;
    if (!prevLogs.has(k)) prevLogs.set(k, []);
    prevLogs.get(k).push(l);
  }
  const cutoff = new Date(Date.now() - REFETCH_DAYS * 864e5).toISOString().slice(0, 10);

  const gyms = {};
  const sessions = [];
  const logs = [];
  let fetched = 0;
  for (const d of days) {
    const date = d.statsAtDate.slice(0, 10);
    gyms[d.gym.id] = {
      name: d.gym.name.trim(),
      slug: d.gym.nameSlug,
      city: d.gym.city?.trim() || null,
      system: d.gym.gradingSystemBoulders,
    };
    const session = {
      id: d.id,
      date,
      gym: d.gymId,
      title: d.title || null,
      boulderTries: d.bouldersTotalTries,
      routeTries: d.routesTotalTries,
      dayGrade: d.bouldersDayGrade,
      dayGradeMax: d.bouldersDayGradeMax,
      flashPct: d.bouldersDayGradeFlPct,
    };
    sessions.push(session);

    const old = prevSessions.get(d.id);
    const reuse = old && date < cutoff && old.boulderTries === session.boulderTries && old.routeTries === session.routeTries && prevLogs.has(`${date}|${d.gymId}`);
    if (reuse) {
      logs.push(...prevLogs.get(`${date}|${d.gymId}`));
      continue;
    }

    const dayLogs = await paginate(Q_LOGS, { gymId: d.gymId, userId, climbedAtDate: d.statsAtDate }, (r) => r.climbLogs, access, 100);
    fetched++;
    for (const l of dayLogs) {
      logs.push({
        date: l.climbedAtDate.slice(0, 10),
        gym: d.gymId,
        climb: l.climbId,
        type: l.climbType,
        grade: l.climb?.grade ?? null,
        name: l.climb?.name ?? null,
        try: l.tryIndex,
        tick: l.tickIndex,
        ticked: l.ticked,
        tickType: l.tickType, // 0 = attempt, 1 = redpoint, 2 = flash
        topped: l.topped,
        zones: l.zones,
        points: l.points,
        color: l.climb?.holdColor?.color ?? null,
        wall: l.climb?.wall?.nameLoc ?? null,
        wallId: l.climb?.wall?.id ?? null,
        outAt: l.climb?.outAt ? l.climb.outAt.slice(0, 10) : null,
      });
    }
    await sleep(150);
  }

  sessions.sort((a, b) => a.date.localeCompare(b.date));
  logs.sort((a, b) => b.date.localeCompare(a.date) || a.gym.localeCompare(b.gym) || a.try - b.try || a.climb.localeCompare(b.climb));
  return { data: { gyms, sessions, logs }, fetched };
}

async function main() {
  const { access, userId: myId } = await signIn();
  if (!myId) throw new Error('Could not read your user id from the access token.');

  const config = (await readJson(CONFIG_FILE, [{ slug: 'me', userId: 'me' }])).filter((c) => c.enabled !== false);
  await mkdir(DATA_DIR, { recursive: true });

  // One-time move: the single-climber site stored everything in climbs.json.
  const legacy = join(DATA_DIR, 'climbs.json');
  const mine = config.find((c) => c.userId === 'me');
  if (mine && existsSync(legacy) && !existsSync(join(DATA_DIR, `${mine.slug}.json`))) {
    await rename(legacy, join(DATA_DIR, `${mine.slug}.json`));
  }

  const index = [];
  let failures = 0;
  for (const c of config) {
    const userId = c.userId === 'me' ? myId : c.userId;
    const file = join(DATA_DIR, `${c.slug}.json`);
    try {
      const prev = await readJson(file, null);
      const { user } = await gql(Q_USER, { userId }, access);
      const { data, fetched } = await syncClimber(access, userId, prev);
      const next = JSON.stringify(data);
      if (!prev || JSON.stringify(prev) !== next) await writeFile(file, next);
      console.log(`${c.slug}: ${data.sessions.length} sessions, ${data.logs.length} logs (${fetched} sessions refetched).`);
      index.push({
        slug: c.slug,
        name: c.name || user.fullName.trim().split(/\s+/)[0],
        sessions: data.sessions.length,
        lastSession: data.sessions.at(-1)?.date ?? null,
      });
    } catch (err) {
      failures++;
      // Keep showing the last good data for this climber.
      console.warn(`${c.slug}: sync failed (${err.message}). Their profile may be private, or you no longer follow them.`);
      const prev = await readJson(file, null);
      if (prev) index.push({ slug: c.slug, name: c.name || c.slug, sessions: prev.sessions.length, lastSession: prev.sessions.at(-1)?.date ?? null });
    }
  }

  const indexFile = join(DATA_DIR, 'climbers.json');
  const nextIndex = JSON.stringify(index, null, 2) + '\n';
  if (!existsSync(indexFile) || (await readFile(indexFile, 'utf8')) !== nextIndex) await writeFile(indexFile, nextIndex);
  if (failures === config.length) throw new Error('Every climber failed to sync.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
