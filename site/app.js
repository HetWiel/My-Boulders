import * as Plot from 'https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// ---------- grades ----------
// TopLogger stores grades as numbers: 600 = 6a, 617 = 6a+, 633 = 6b … (Font scale).
const FONT = [
  [200, '2'], [250, '2+'], [300, '3a'], [333, '3b'], [367, '3c'], [400, '4a'], [433, '4b'], [467, '4c'],
  [500, '5a'], [517, '5a+'], [533, '5b'], [550, '5b+'], [567, '5c'], [583, '5c+'],
  [600, '6a'], [617, '6a+'], [633, '6b'], [650, '6b+'], [667, '6c'], [683, '6c+'],
  [700, '7a'], [717, '7a+'], [733, '7b'], [750, '7b+'], [767, '7c'], [783, '7c+'],
  [800, '8a'], [817, '8a+'], [833, '8b'], [850, '8b+'], [867, '8c'], [883, '8c+'], [900, '9a'],
];
const snap = (g) => {
  if (!g) return null;
  let best = FONT[0][0];
  for (const [v] of FONT) if (Math.abs(v - g) < Math.abs(best - g)) best = v;
  return best;
};
const gradeName = (g) => (g ? FONT.find(([v]) => v === snap(g))[1] : '?');

const TICK = { 0: 'attempt', 1: 'redpoint', 2: 'flash', 3: 'onsight' };

// ---------- helpers ----------
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtDate = d3.utcFormat('%a %-d %b %Y');
const fmtShort = d3.utcFormat('%-d %b');
const parse = (s) => new Date(s + 'T00:00:00Z');
const DAY = 864e5;
const tip = document.getElementById('tip');
function showTip(evt, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const { innerWidth: w, innerHeight: h } = window;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > w - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > h - 8) y = evt.clientY - r.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => (tip.hidden = true);

// ---------- data ----------
const raw = await fetch('data/climbs.json', { cache: 'no-cache' }).then((r) => r.json());
const gyms = raw.gyms;
const gymName = (id) => gyms[id]?.name ?? 'Unknown gym';
const allSessions = raw.sessions.map((s) => ({ ...s, d: parse(s.date) }));
const allLogs = raw.logs.filter((l) => l.type === 'boulder').map((l) => ({ ...l, d: parse(l.date), g: snap(l.grade) }));

const lastDate = d3.max(allSessions, (s) => s.d);
const firstDate = d3.min(allSessions, (s) => s.d);
const years = d3.range(lastDate.getUTCFullYear(), firstDate.getUTCFullYear() - 1, -1);

const RANGES = [
  { id: 'all', label: 'All time', from: null, to: null },
  { id: '12m', label: 'Last 12 months', from: new Date(Date.now() - 365 * DAY), to: null },
  ...years.map((y) => ({ id: String(y), label: String(y), from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)) })),
];

document.getElementById('meta').textContent =
  `${allSessions.length} sessions since ${d3.utcFormat('%B %Y')(firstDate)} · last session ${fmtShort(lastDate)}`;

// Turn raw logs into one record per boulder per session (what you did on it that day),
// and one record per boulder overall (did you ever send it, how).
function summarize(logs) {
  const perSession = d3.rollups(
    logs,
    (v) => {
      v.sort((a, b) => a.try - b.try);
      const sent = v.find((l) => l.ticked);
      const first = v[0];
      return {
        climb: first.climb, date: first.date, d: first.d, gym: first.gym, grade: first.grade, g: first.g,
        color: first.color, wall: first.wall,
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
      return { ...any, ...(firstSend || {}), sent: !!firstSend, how: firstSend ? firstSend.how : 'attempt', tries: v.length };
    },
    (x) => x.climb
  ).map(([, v]) => v);

  return { perSession, perClimb };
}

// ---------- state ----------
let range = RANGES[0];
let stripLimit = 12;
const inRange = (d) => (!range.from || d >= range.from) && (!range.to || d < range.to);

// ---------- filters ----------
const filtersEl = document.getElementById('filters');
for (const r of RANGES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = r.label;
  b.dataset.id = r.id;
  b.addEventListener('click', () => {
    range = r;
    stripLimit = 12;
    render();
  });
  filtersEl.append(b);
}

// ---------- legends ----------
function renderLegends() {
  for (const el of document.querySelectorAll('[data-legend]')) {
    const items = [['Flash', 'var(--flash)'], ['Redpoint', 'var(--redpoint)']];
    if (el.dataset.legend === 'pyramid') items.push(['Not topped yet', 'var(--unsent)']);
    el.innerHTML = items.map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  }
}

// ---------- stats ----------
function renderStats(sessions, perSession, perClimb) {
  const sends = perClimb.filter((c) => c.sent);
  const flashes = sends.filter((c) => c.how === 'flash');
  const hardest = d3.greatest(sends, (c) => c.grade);
  const hardestFlash = d3.greatest(flashes, (c) => c.grade);
  const weeks = sessions.length > 1 ? Math.max(1, (d3.max(sessions, (s) => s.d) - d3.min(sessions, (s) => s.d)) / (7 * DAY)) : 1;
  const sinceLast = Math.round((Date.now() - lastDate) / DAY);
  const tiles = [
    { label: 'Hardest send', value: hardest ? gradeName(hardest.grade) : '–', note: hardest ? `${hardest.how} · ${fmtShort(hardest.d)}` : '', hero: true },
    { label: 'Sessions', value: sessions.length, note: sessions.length > 1 ? `${(sessions.length / weeks).toFixed(1)} per week` : '' },
    { label: 'Boulders sent', value: sends.length, note: `${perClimb.length - sends.length} still open` },
    { label: 'Flash rate', value: sends.length ? `${Math.round((flashes.length / sends.length) * 100)}%` : '–', note: `${flashes.length} flashes` },
    { label: 'Hardest flash', value: hardestFlash ? gradeName(hardestFlash.grade) : '–', note: hardestFlash ? fmtShort(hardestFlash.d) : '' },
    { label: 'Last session', value: sinceLast === 0 ? 'Today' : `${sinceLast}d`, note: sinceLast === 0 ? fmtShort(lastDate) : `ago · ${fmtShort(lastDate)}` },
  ];
  document.getElementById('stats').innerHTML = tiles
    .map((t) => `<div class="stat${t.hero ? ' hero' : ''}"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="note">${t.note}</div></div>`)
    .join('');
}

// ---------- calendar ----------
function renderCalendar(sessions, perSession) {
  const el = document.getElementById('calendar');
  el.innerHTML = '';
  const byDate = d3.rollup(perSession, (v) => ({ sends: v.filter((x) => x.sent).length, tried: v.length }), (x) => x.date);
  const sessByDate = new Map(sessions.map((s) => [s.date, s]));

  const end = range.to ? new Date(Math.min(range.to - DAY, Date.now())) : new Date();
  const start = range.from ? new Date(Math.max(range.from, firstDate - 0)) : firstDate;
  const s0 = d3.utcMonday.floor(start);
  const e0 = d3.utcDay.floor(end);
  const days = d3.utcDays(s0, d3.utcDay.offset(e0, 1));
  const gap = 3, top = 18, left = 26;
  const weeks = d3.utcMonday.count(s0, e0) + 1;
  // shrink cells to fit when possible; past that the strip scrolls and opens on the most recent weeks
  const avail = (el.parentElement.clientWidth || 900) - left - 2;
  const cell = Math.max(10, Math.min(14, Math.floor(avail / weeks) - gap));
  const W = left + weeks * (cell + gap) + 14, H = top + 7 * (cell + gap);

  const levels = [css('--surface-2'), css('--seq-1'), css('--seq-2'), css('--seq-3'), css('--seq-4'), css('--seq-5')];
  const level = (n) => (n <= 0 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : n <= 10 ? 4 : 5);

  const svg = d3.create('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
    .attr('aria-label', `Calendar of ${sessions.length} sessions`);
  svg.append('g').selectAll('text').data([0, 2, 4]).join('text')
    .attr('x', 0).attr('y', (i) => top + i * (cell + gap) + cell - 2).attr('font-size', 11).text((i) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]);
  svg.append('g').selectAll('text').data(d3.utcMonths(d3.utcMonth.ceil(s0), e0)).join('text')
    .attr('x', (m) => left + d3.utcMonday.count(s0, m) * (cell + gap)).attr('y', 11).attr('font-size', 11)
    .text((m) => (m.getUTCMonth() === 0 ? d3.utcFormat("%b '%y")(m) : d3.utcFormat('%b')(m)));

  svg.append('g').selectAll('rect').data(days).join('rect')
    .attr('class', (d) => 'day' + (sessByDate.has(d3.utcFormat('%Y-%m-%d')(d)) ? ' on' : ''))
    .attr('x', (d) => left + d3.utcMonday.count(s0, d) * (cell + gap))
    .attr('y', (d) => top + ((d.getUTCDay() + 6) % 7) * (cell + gap))
    .attr('width', cell).attr('height', cell).attr('rx', 2.5)
    .attr('fill', (d) => {
      const k = d3.utcFormat('%Y-%m-%d')(d);
      if (!sessByDate.has(k)) return levels[0];
      return levels[level(byDate.get(k)?.sends ?? 0)];
    })
    .on('pointerenter pointermove', (evt, d) => {
      const k = d3.utcFormat('%Y-%m-%d')(d);
      const s = sessByDate.get(k);
      if (!s) return showTip(evt, `${fmtDate(d)}<br>No session`);
      const b = byDate.get(k) || { sends: 0, tried: 0 };
      showTip(evt, `<b>${fmtDate(d)}</b><br>${gymName(s.gym)}<br>${b.sends} sent of ${b.tried} boulders${s.dayGradeMax ? `<br>Hardest: ${gradeName(s.dayGradeMax)}` : ''}`);
    })
    .on('pointerleave', hideTip);

  el.append(svg.node());
  el.parentElement.scrollLeft = el.parentElement.scrollWidth;
  const key = document.getElementById('cal-key');
  key.innerHTML = `Fewer sends ${levels.slice(1).map((c) => `<i style="background:${c}"></i>`).join('')} More`;
}

// ---------- progression ----------
function renderProgression(sessions, perClimb) {
  const el = document.getElementById('progression');
  el.innerHTML = '';
  const sends = perClimb.filter((c) => c.sent && c.grade > 0);
  if (!sends.length) return (el.innerHTML = '<p class="empty">No sends in this period.</p>');

  const maxPerSession = d3.rollups(sends, (v) => d3.max(v, (c) => c.g), (c) => c.date)
    .map(([date, g]) => ({ d: parse(date), g }))
    .sort((a, b) => a.d - b.d);

  const [gMin, gMax] = d3.extent(sends, (c) => c.g);
  const ticks = FONT.map(([v]) => v).filter((v) => v >= gMin - 20 && v <= gMax + 20 && (v % 100 === 0 || v % 100 === 33 || v % 100 === 67 || v === 250));
  const width = el.clientWidth || 900;

  const chart = Plot.plot({
    width,
    height: 340,
    marginLeft: 40,
    marginRight: 16,
    style: { fontFamily: 'Archivo, sans-serif', fontSize: '12px', color: css('--text-muted'), background: 'transparent' },
    x: { type: 'utc', label: null, grid: false },
    y: { domain: [gMin - 25, gMax + 25], ticks, tickFormat: gradeName, label: null, grid: true },
    marks: [
      Plot.gridY(ticks, { stroke: css('--line'), strokeOpacity: 1 }),
      // small deterministic vertical jitter so same-grade sends on one day don't hide each other
      Plot.dot(sends, {
        x: 'd', y: (c) => c.g + (((c.climb.charCodeAt(0) + c.climb.charCodeAt(5)) % 9) - 4) * 2.2,
        r: 4.5,
        fill: (c) => (c.how === 'flash' ? css('--flash') : css('--redpoint')),
        fillOpacity: 0.9,
        stroke: css('--surface-1'), strokeWidth: 1.5,
      }),
      maxPerSession.length > 2
        ? Plot.lineY(maxPerSession, Plot.windowY({ k: 5, anchor: 'end', strict: false }, { x: 'd', y: 'g', stroke: css('--text-primary'), strokeWidth: 2, curve: 'monotone-x' }))
        : null,
      Plot.tip(sends, Plot.pointer({
        x: 'd', y: 'g',
        title: (c) => `${gradeName(c.grade)} · ${c.how}\n${fmtDate(c.d)}\n${gymName(c.gym)}${c.wall ? ` · ${c.wall}` : ''}`,
        fill: css('--text-primary'), stroke: css('--text-primary'), textPadding: 8,
      })),
    ],
  });
  chart.querySelectorAll('[aria-label="tip"] text').forEach((t) => t.setAttribute('fill', css('--surface-1')));
  el.append(chart);
}

// ---------- pyramid ----------
function renderPyramid(perClimb) {
  const el = document.getElementById('pyramid');
  el.innerHTML = '';
  const graded = perClimb.filter((c) => c.g);
  if (!graded.length) return (el.innerHTML = '<p class="empty">Nothing logged in this period.</p>');
  const order = ['flash', 'redpoint', 'attempt'];
  const rows = d3.rollups(graded, (v) => v.length, (c) => c.g, (c) => (c.sent ? c.how : 'attempt'))
    .flatMap(([g, kinds]) => kinds.map(([how, n]) => ({ g, grade: gradeName(g), how, n })));
  const grades = [...new Set(graded.map((c) => c.g))].sort((a, b) => b - a).map(gradeName);
  const color = { flash: css('--flash'), redpoint: css('--redpoint'), attempt: css('--unsent') };
  const width = el.clientWidth || 480;

  el.append(Plot.plot({
    width,
    height: Math.max(180, grades.length * 26 + 40),
    marginLeft: 40,
    marginRight: 30,
    style: { fontFamily: 'Archivo, sans-serif', fontSize: '12px', color: css('--text-muted'), background: 'transparent' },
    x: { label: null, grid: true, axis: 'top', tickFormat: 'd' },
    y: { domain: grades, label: null, tickSize: 0, padding: 0.25 },
    marks: [
      Plot.gridX({ stroke: css('--line'), strokeOpacity: 1 }),
      Plot.barX(rows, Plot.stackX({
        x: 'n', y: 'grade', fill: (r) => color[r.how],
        order: (r) => order.indexOf(r.how),
        inset: 0, insetRight: 1, insetLeft: 1, rx: 3,
        stroke: css('--surface-1'), strokeWidth: 1,
      })),
      Plot.text(
        d3.rollups(rows, (v) => d3.sum(v, (r) => r.n), (r) => r.grade).map(([grade, n]) => ({ grade, n })),
        { x: 'n', y: 'grade', text: 'n', dx: 8, textAnchor: 'start', fill: css('--text-secondary') }
      ),
      Plot.tip(rows, Plot.pointer(Plot.stackX({
        x: 'n', y: 'grade', order: (r) => order.indexOf(r.how),
        title: (r) => `${r.grade} · ${r.how === 'attempt' ? 'not topped yet' : r.how}: ${r.n}`,
        fill: css('--text-primary'), stroke: css('--text-primary'),
      }))),
    ],
  }));
  el.querySelectorAll('[aria-label="tip"] text').forEach((t) => t.setAttribute('fill', css('--surface-1')));
}

// ---------- walls ----------
function renderWalls(perClimb) {
  const el = document.getElementById('walls');
  el.innerHTML = '';
  // Use the gym you climbed at most in this range; wall names only mean something within one gym.
  const home = d3.greatest(d3.rollups(perClimb, (v) => v.length, (c) => c.gym), ([, n]) => n);
  if (!home) return (el.innerHTML = '<p class="empty">Nothing logged in this period.</p>');
  document.getElementById('walls-sub').textContent = `Share of boulders sent per wall at ${gymName(home[0])}, best flash rate first.`;
  const walls = d3.rollups(perClimb.filter((c) => c.gym === home[0] && c.wall), (v) => ({
    total: v.length,
    flash: v.filter((c) => c.how === 'flash').length,
    redpoint: v.filter((c) => c.sent && c.how !== 'flash').length,
  }), (c) => c.wall)
    .map(([wall, s]) => ({ wall, ...s }))
    .filter((w) => w.total >= 5)
    .sort((a, b) => b.flash / b.total - a.flash / a.total || b.total - a.total);
  if (!walls.length) return (el.innerHTML = '<p class="empty">Not enough boulders per wall in this period.</p>');

  const rows = walls.flatMap((w) => [
    { wall: w.wall, how: 'flash', p: w.flash / w.total, n: w.flash, total: w.total },
    { wall: w.wall, how: 'redpoint', p: w.redpoint / w.total, n: w.redpoint, total: w.total },
  ]);
  const color = { flash: css('--flash'), redpoint: css('--redpoint') };
  const width = el.clientWidth || 480;

  el.append(Plot.plot({
    width,
    height: walls.length * 28 + 40,
    marginLeft: Math.min(150, 8 + 7 * d3.max(walls, (w) => w.wall.length)),
    marginRight: 44,
    style: { fontFamily: 'Archivo, sans-serif', fontSize: '12px', color: css('--text-muted'), background: 'transparent' },
    x: { domain: [0, 1], tickFormat: '.0%', label: null, grid: true, axis: 'top', ticks: width < 520 ? 2 : 4 },
    y: { domain: walls.map((w) => w.wall), label: null, tickSize: 0, padding: 0.3 },
    marks: [
      Plot.barX(walls, { x: 1, y: 'wall', fill: css('--surface-2'), rx: 3 }),
      Plot.gridX({ stroke: css('--line'), strokeOpacity: 1, ticks: width < 520 ? 2 : 4 }),
      Plot.barX(rows, Plot.stackX({ x: 'p', y: 'wall', fill: (r) => color[r.how], order: ['flash', 'redpoint'], z: 'how', insetLeft: 1, insetRight: 1, rx: 3, stroke: css('--surface-1'), strokeWidth: 1 })),
      Plot.text(walls, { x: 1, y: 'wall', text: (w) => `${w.total}`, dx: 8, textAnchor: 'start', fill: css('--text-muted') }),
      Plot.tip(rows, Plot.pointer(Plot.stackX({
        x: 'p', y: 'wall', z: 'how', order: ['flash', 'redpoint'],
        title: (r) => `${r.wall}\n${r.how}: ${r.n} of ${r.total} (${Math.round(r.p * 100)}%)`,
        fill: css('--text-primary'), stroke: css('--text-primary'),
      }))),
    ],
  }));
  el.querySelectorAll('[aria-label="tip"] text').forEach((t) => t.setAttribute('fill', css('--surface-1')));
}

// ---------- session fingerprints ----------
function renderStrips(sessions, perSession) {
  const el = document.getElementById('strips');
  el.innerHTML = '';
  const bySession = d3.group(perSession, (x) => x.date);
  const list = [...sessions].sort((a, b) => b.d - a.d);
  if (!list.length) return (el.innerHTML = '<p class="empty">No sessions in this period.</p>');

  const key = document.createElement('div');
  key.className = 'strips-key';
  key.innerHTML = `<span><span class="hold flash" style="--c:#888;background:#888"></span>Flash (ringed)</span><span><span class="hold" style="--c:#888;background:#888"></span>Sent after tries</span><span><span class="hold open" style="--c:#888"></span>Not topped</span>`;
  el.append(key);

  for (const s of list.slice(0, stripLimit)) {
    const climbs = (bySession.get(s.date) || []).slice().sort((a, b) => (a.grade || 0) - (b.grade || 0));
    const row = document.createElement('div');
    row.className = 'strip';
    const sent = climbs.filter((c) => c.sent).length;
    row.innerHTML = `<div class="when"><b>${fmtShort(s.d)} ${s.d.getUTCFullYear()}</b><span>${gymName(s.gym)}</span></div>
      <div class="holds"></div>
      <div class="count">${sent}/${climbs.length}</div>`;
    const holds = row.querySelector('.holds');
    for (const c of climbs) {
      const h = document.createElement('span');
      h.className = 'hold' + (c.sent ? (c.how === 'flash' ? ' flash' : '') : ' open');
      const col = c.color || '#888888';
      h.style.setProperty('--c', col);
      h.style.background = col;
      h.setAttribute('aria-label', `${gradeName(c.grade)} ${c.sent ? c.how : 'not topped'}`);
      h.addEventListener('pointerenter', (evt) =>
        showTip(evt, `<b>${gradeName(c.grade)}</b> · ${c.sent ? c.how : 'not topped'}${c.wall ? `<br>${c.wall}` : ''}`));
      h.addEventListener('pointermove', (evt) => showTip(evt, tip.innerHTML));
      h.addEventListener('pointerleave', hideTip);
      holds.append(h);
    }
    el.append(row);
  }
  if (list.length > stripLimit) {
    const more = document.createElement('button');
    more.className = 'strip-more';
    more.type = 'button';
    more.textContent = `Show ${Math.min(12, list.length - stripLimit)} more`;
    more.addEventListener('click', () => {
      stripLimit += 12;
      renderStrips(sessions, perSession);
    });
    el.append(more);
  }
}

// ---------- weekdays & gyms ----------
function smallBars(elId, data, x, y, { horizontal = false, domain } = {}) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  if (!data.length) return (el.innerHTML = '<p class="empty">No sessions in this period.</p>');
  const width = el.clientWidth || 480;
  const base = {
    width,
    style: { fontFamily: 'Archivo, sans-serif', fontSize: '12px', color: css('--text-muted'), background: 'transparent' },
  };
  const fill = css('--accent');
  el.append(horizontal
    ? Plot.plot({
        ...base,
        height: data.length * 30 + 20,
        marginLeft: Math.min(180, 8 + 7 * d3.max(data, (d) => d[y].length)),
        marginRight: 36,
        x: { axis: null },
        y: { label: null, tickSize: 0, padding: 0.35, domain: data.map((d) => d[y]) },
        marks: [
          Plot.barX(data, { x, y, fill, rx: 3 }),
          Plot.text(data, { x, y, text: x, dx: 8, textAnchor: 'start', fill: css('--text-secondary') }),
        ],
      })
    : Plot.plot({
        ...base,
        height: 200,
        marginTop: 20,
        x: { label: null, tickSize: 0, padding: 0.35, domain },
        y: { axis: null },
        marks: [
          Plot.barY(data, { x: y, y: x, fill, rx: 3 }),
          Plot.text(data, { x: y, y: x, text: (d) => (d[x] ? d[x] : ''), dy: -8, fill: css('--text-secondary') }),
          Plot.ruleY([0], { stroke: css('--line') }),
        ],
      }));
}

// ---------- table ----------
function renderTable(sessions, perSession) {
  const bySession = d3.group(perSession, (x) => x.date);
  const list = [...sessions].sort((a, b) => b.d - a.d);
  document.getElementById('table-count').textContent = `${list.length} sessions`;
  document.getElementById('table').innerHTML =
    `<thead><tr><th>Date</th><th>Gym</th><th class="num">Boulders</th><th class="num">Sent</th><th class="num">Flashed</th><th>Hardest send</th></tr></thead><tbody>` +
    list.map((s) => {
      const c = bySession.get(s.date) || [];
      const sent = c.filter((x) => x.sent);
      const top = d3.greatest(sent, (x) => x.grade);
      return `<tr><td>${fmtDate(s.d)}</td><td>${gymName(s.gym)}</td><td class="num">${c.length}</td><td class="num">${sent.length}</td><td class="num">${sent.filter((x) => x.how === 'flash').length}</td><td>${top ? gradeName(top.grade) : '–'}</td></tr>`;
    }).join('') + '</tbody>';
}

// ---------- render ----------
function render() {
  for (const b of filtersEl.children) b.setAttribute('aria-pressed', String(b.dataset.id === range.id));
  const sessions = allSessions.filter((s) => inRange(s.d));
  const logs = allLogs.filter((l) => inRange(l.d));
  const { perSession, perClimb } = summarize(logs);

  renderStats(sessions, perSession, perClimb);
  renderCalendar(sessions, perSession);
  renderProgression(sessions, perClimb);
  renderPyramid(perClimb);
  renderWalls(perClimb);
  renderStrips(sessions, perSession);

  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const counts = d3.rollup(sessions, (v) => v.length, (s) => wd[(s.d.getUTCDay() + 6) % 7]);
  smallBars('weekdays', wd.map((day) => ({ day, n: counts.get(day) || 0 })), 'n', 'day', { domain: wd });
  smallBars('gyms', d3.rollups(sessions, (v) => v.length, (s) => gymName(s.gym)).map(([gym, n]) => ({ gym, n })).sort((a, b) => b.n - a.n), 'n', 'gym', { horizontal: true });

  renderTable(sessions, perSession);
}

renderLegends();
render();

// Re-render on resize and theme change so widths and colors stay right.
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
