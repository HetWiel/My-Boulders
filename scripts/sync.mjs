#!/usr/bin/env node
// Pulls your bouldering sessions from TopLogger and writes site/data/climbs.json.
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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://app.toplogger.nu/graphql';
const TOKEN_FILE = join(ROOT, '.tl-auth', 'refresh-token');
const OUT_FILE = join(ROOT, 'site', 'data', 'climbs.json');

const Q_REFRESH = `mutation authSigninRefreshToken($refreshToken: JWT!) {
  tokens: authSigninRefreshToken(refreshToken: $refreshToken) {
    access { token expiresAt }
    refresh { token expiresAt }
  }
}`;

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

async function main() {
  const { access, userId } = await signIn();
  if (!userId) throw new Error('Could not read your user id from the access token.');

  const days = await paginate(Q_DAYS, { userId }, (d) => d.climbDaysPaginated, access, 50);
  console.log(`Found ${days.length} sessions.`);

  const gyms = {};
  const sessions = [];
  const logs = [];
  for (const d of days) {
    gyms[d.gym.id] = {
      name: d.gym.name.trim(),
      slug: d.gym.nameSlug,
      city: d.gym.city?.trim() || null,
      system: d.gym.gradingSystemBoulders,
    };
    sessions.push({
      id: d.id,
      date: d.statsAtDate.slice(0, 10),
      gym: d.gymId,
      title: d.title || null,
      boulderTries: d.bouldersTotalTries,
      routeTries: d.routesTotalTries,
      dayGrade: d.bouldersDayGrade,
      dayGradeMax: d.bouldersDayGradeMax,
      flashPct: d.bouldersDayGradeFlPct,
    });
    const dayLogs = await paginate(
      Q_LOGS,
      { gymId: d.gymId, userId, climbedAtDate: d.statsAtDate },
      (r) => r.climbLogs,
      access,
      100
    );
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
  logs.sort((a, b) => b.date.localeCompare(a.date) || a.try - b.try);

  const next = JSON.stringify({ gyms, sessions, logs });
  const prev = existsSync(OUT_FILE) ? await readFile(OUT_FILE, 'utf8') : '';
  if (prev === next) {
    console.log('No changes.');
    return;
  }
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, next);
  console.log(`Wrote ${sessions.length} sessions and ${logs.length} logs.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
