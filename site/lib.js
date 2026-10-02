// Shared by the dashboard (app.js) and the year-in-review (wrapped.js).
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// Shown on the Wrapped cards. Change to your own name if you fork this.
export const CLIMBER = 'Jasper';

// TopLogger stores grades as numbers: 600 = 6a, 617 = 6a+, 633 = 6b … (Font scale).
export const FONT = [
  [200, '2'], [250, '2+'], [300, '3a'], [333, '3b'], [367, '3c'], [400, '4a'], [433, '4b'], [467, '4c'],
  [500, '5a'], [517, '5a+'], [533, '5b'], [550, '5b+'], [567, '5c'], [583, '5c+'],
  [600, '6a'], [617, '6a+'], [633, '6b'], [650, '6b+'], [667, '6c'], [683, '6c+'],
  [700, '7a'], [717, '7a+'], [733, '7b'], [750, '7b+'], [767, '7c'], [783, '7c+'],
  [800, '8a'], [817, '8a+'], [833, '8b'], [850, '8b+'], [867, '8c'], [883, '8c+'], [900, '9a'],
];
export const snap = (g) => {
  if (!g) return null;
  let best = FONT[0][0];
  for (const [v] of FONT) if (Math.abs(v - g) < Math.abs(best - g)) best = v;
  return best;
};
export const gradeName = (g) => (g ? FONT.find(([v]) => v === snap(g))[1] : '?');

export const DAY = 864e5;
export const parse = (s) => new Date(s + 'T00:00:00Z');

export async function loadData(url = 'data/climbs.json') {
  const raw = await fetch(url, { cache: 'no-cache' }).then((r) => r.json());
  const gyms = raw.gyms;
  return {
    gyms,
    gymName: (id) => gyms[id]?.name ?? 'Unknown gym',
    sessions: raw.sessions.map((s) => ({ ...s, d: parse(s.date) })),
    logs: raw.logs.filter((l) => l.type === 'boulder').map((l) => ({ ...l, d: parse(l.date), g: snap(l.grade) })),
  };
}

// Turn raw logs into one record per boulder per session (what you did on it that day),
// and one record per boulder overall (did you ever send it, how, over how many sessions).
export function summarize(logs) {
  const perSession = d3.rollups(
    logs,
    (v) => {
      v.sort((a, b) => a.try - b.try);
      const sent = v.find((l) => l.ticked);
      const first = v[0];
      return {
        climb: first.climb, date: first.date, d: first.d, gym: first.gym, grade: first.grade, g: first.g,
        color: first.color, wall: first.wall, outAt: first.outAt,
        logs: v.length,
        sent: !!sent,
        // flash only counts when the first ever log on the climb was the tick
        how: sent ? (sent.try === 0 && sent.tickType === 2 ? 'flash' : sent.tick > 0 ? 'repeat' : 'redpoint') : 'attempt',
      };
    },
    (l) => l.date,
    (l) => l.climb
  ).flatMap(([, climbs]) => climbs.map(([, v]) => v));

  const perClimb = d3.rollups(
    perSession,
    (v) => {
      const firstSend = v.filter((x) => x.sent && x.how !== 'repeat').sort((a, b) => a.d - b.d)[0];
      const any = v[0];
      return {
        ...any, ...(firstSend || {}),
        sent: !!firstSend,
        how: firstSend ? firstSend.how : 'attempt',
        tries: v.length,
        logs: d3.sum(v, (x) => x.logs),
        dates: v.map((x) => x.date).sort(),
      };
    },
    (x) => x.climb
  ).map(([, v]) => v);

  return { perSession, perClimb };
}
