import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import { CLIMBER, DAY, gradeName, loadData, summarize } from './lib.js';

// ---------- data ----------
const { gymName, sessions: allSessions, logs: allLogs } = await loadData();
const today = new Date();
const lastYear = d3.max(allSessions, (s) => s.d).getUTCFullYear();
const firstYear = d3.min(allSessions, (s) => s.d).getUTCFullYear();
const YEARS = d3.range(lastYear, firstYear - 1, -1);

const params = new URLSearchParams(location.search);
let year = params.get('year') || defaultYear();
function defaultYear() {
  const thisYear = allSessions.filter((s) => s.d.getUTCFullYear() === lastYear).length;
  return String(thisYear >= 10 || YEARS.length === 1 ? lastYear : lastYear - 1);
}

// ---------- small helpers ----------
const fmtDay = d3.utcFormat('%-d %B');
const fmtDayShort = d3.utcFormat('%-d %b');
const weekdayName = d3.utcFormat('%A');
const nf = new Intl.NumberFormat('en-GB');
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plural = (n, one, many = one + 's') => `${nf.format(n)} ${n === 1 ? one : many}`;

// TopLogger hold colours → names people would say out loud at the gym.
const NAMED = [
  ['#F5FF00', 'yellow'], ['#FF8E00', 'orange'], ['#074F1A', 'green'], ['#58EEAA', 'mint'], ['#E60F77', 'pink'],
  ['#6C482B', 'brown'], ['#AA00FF', 'purple'], ['#FFFFFF', 'white'], ['#000000', 'black'], ['#E10000', 'red'],
  ['#D00000', 'red'], ['#0066FF', 'blue'], ['#1E90FF', 'blue'], ['#808080', 'grey'],
];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function colorName(hex) {
  if (!hex) return 'mystery';
  const c = rgb(hex.toUpperCase());
  let best = NAMED[0], bestD = Infinity;
  for (const n of NAMED) {
    const d = d3.sum(rgb(n[0]).map((v, i) => (v - c[i]) ** 2));
    if (d < bestD) (bestD = d), (best = n);
  }
  return best[1];
}
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const inkFor = (hex) => (luminance(hex) > 0.28 ? '#141414' : '#f4f3ef');

// ---------- stats ----------
function computeStats(y) {
  const inYear = (d) => y === 'all' || d.getUTCFullYear() === Number(y);
  const sessions = allSessions.filter((s) => inYear(s.d)).sort((a, b) => a.d - b.d);
  const logs = allLogs.filter((l) => inYear(l.d));
  const { perSession, perClimb } = summarize(logs);
  const sends = perClimb.filter((c) => c.sent);
  const flashes = sends.filter((c) => c.how === 'flash');

  const span = sessions.length > 1 ? (sessions.at(-1).d - sessions[0].d) / DAY + 7 : 7;
  const perWeek = sessions.length / (span / 7);

  const wdOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const wdCounts = wdOrder.map((day) => ({ day, n: sessions.filter((s) => weekdayName(s.d) === day).length }));
  const topDay = d3.greatest(wdCounts, (d) => d.n);

  const multiGym = new Set(perClimb.map((c) => c.gym)).size > 1;
  const wallKey = (c) => (multiGym ? `${c.wall}|${c.gym}` : c.wall);
  const walls = d3.rollups(perClimb.filter((c) => c.wall), (v) => v.length, wallKey)
    .map(([k, n]) => ({ wall: k.split('|')[0].trim(), gym: k.split('|')[1], n }))
    .sort((a, b) => b.n - a.n);

  const colors = d3.rollups(perClimb.filter((c) => c.color), (v) => ({ n: v.length, grades: v.map((c) => c.g).filter(Boolean) }), (c) => c.color.toUpperCase())
    .map(([hex, v]) => ({ hex, name: colorName(hex), n: v.n, median: d3.median(v.grades) }))
    .sort((a, b) => b.n - a.n);

  const gradeCounts = d3.rollups(sends.filter((c) => c.g), (v) => v.length, (c) => c.g)
    .map(([g, n]) => ({ g, n })).sort((a, b) => a.g - b.g);
  const topGrade = d3.greatest(gradeCounts, (d) => d.n);
  const hardest = d3.greatest(sends.filter((c) => c.g), (a, b) => a.g - b.g || a.d - b.d);

  const nemesis = d3.greatest(sends.filter((c) => c.tries >= 2 || c.logs >= 3), (a, b) => a.tries - b.tries || a.logs - b.logs || a.g - b.g);
  const ghosted = perClimb.filter((c) => !c.sent && c.outAt && new Date(c.outAt) < today);
  const gotAway = d3.greatest(ghosted, (a, b) => a.g - b.g);

  const sendsByDate = d3.rollup(sends, (v) => v.length, (c) => c.date);
  const bySession = sessions.map((s) => ({ ...s, tops: sendsByDate.get(s.date) || 0 }));
  const best = d3.greatest(bySession, (a, b) => a.tops - b.tops);
  const tiny = bySession.filter((s) => s.tops <= 1);

  let gap = null;
  for (let i = 1; i < sessions.length; i++) {
    const days = Math.round((sessions[i].d - sessions[i - 1].d) / DAY);
    if (!gap || days > gap.days) gap = { days, from: sessions[i - 1].d, to: sessions[i].d };
  }

  const gyms = d3.rollups(sessions, (v) => v.length, (s) => s.gym).map(([id, n]) => ({ name: gymName(id), n })).sort((a, b) => b.n - a.n);
  const months = d3.range(12).map((m) => ({ m, n: sessions.filter((s) => s.d.getUTCMonth() === m).length }));
  const points = d3.sum(logs, (l) => l.points || 0);
  const repeats = perSession.filter((x) => x.how === 'repeat').length;

  return {
    y, sessions, perSession, perClimb, sends, flashes, perWeek, wdCounts, topDay, walls, colors,
    gradeCounts, topGrade, hardest, nemesis, ghosted, gotAway, best, tiny, gap, gyms, months, points, repeats,
    flashRate: sends.length ? flashes.length / sends.length : 0,
    perSessionTops: sessions.length ? sends.length / sessions.length : 0,
  };
}

function personality(s) {
  const dayShare = s.sessions.length ? s.topDay.n / s.sessions.length : 0;
  const adj = dayShare >= 0.5 ? s.topDay.day : s.gyms.length >= 3 ? 'Nomadic' : s.perWeek >= 1.5 ? 'Daily' : 'Free-Range';
  const projectShare = s.sends.length ? s.sends.filter((c) => c.tries >= 2).length / s.sends.length : 0;
  let noun, about;
  if (s.flashRate >= 0.7) [noun, about] = ['Flasher', 'Reads it, sends it, walks off. Second goes are for other people.'];
  else if (projectShare >= 0.08) [noun, about] = ['Projector', 'Will be back next week. And the week after. Until it goes.'];
  else if (s.perSessionTops >= 9) [noun, about] = ['Volume Goblin', 'Quantity is a quality. Skin is a renewable resource.'];
  else if (s.hardest && s.topGrade && s.hardest.g - s.topGrade.g >= 50) [noun, about] = ['Limit Pusher', 'Mostly warm-ups, then one thing way too hard.'];
  else [noun, about] = ['Social Climber', 'Here for the chalk, the chat and the occasional top.'];
  const traits = [
    `${pct(s.flashRate)} flash rate`,
    dayShare >= 0.5 ? `${pct(dayShare)} on ${s.topDay.day}s` : `${s.perWeek.toFixed(1)} sessions a week`,
    s.topGrade ? `lives at ${gradeName(s.topGrade.g)}` : `${plural(s.sends.length, 'top')}`,
  ];
  return { name: `The ${adj} ${noun}`, about, traits };
}

// ---------- slides ----------
// Each slide: { bg, html, tilt? }. Returning null skips the card when the data has nothing to say.
const BG = ['#F5FF00', '#FF8E00', '#58EEAA', '#E60F77', '#AA00FF', '#074F1A', '#141414'];

function holdSVG(color, size, x, y, rot, shape) {
  const shapes = [
    'M50 6c22 0 40 12 42 33 2 22-14 41-37 45-26 4-49-9-49-33C6 27 26 6 50 6Z',
    'M20 30C30 8 70 2 86 22c14 18 4 46-20 56-22 10-52 6-60-14-4-12 6-22 14-34Z',
    'M48 10c18-6 42 6 44 26 2 14-8 22-6 34 2 14-14 24-32 22C30 90 8 76 10 54 12 36 30 16 48 10Z',
    'M12 60C6 40 22 14 46 12c28-2 46 18 44 40-2 20-20 36-44 36-18 0-30-12-34-28Z',
  ];
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="left:${x}%;top:${y}%;transform:rotate(${rot}deg)">
    <path d="${shapes[shape % 4]}" fill="${color}"/><circle cx="50" cy="48" r="7" fill="rgb(0 0 0 / .45)"/><circle cx="50" cy="48" r="3.5" fill="rgb(255 255 255 / .35)"/></svg>`;
}
const deco = (colors, spots) =>
  `<div class="holds-deco">${spots.map(([x, y, size, rot], i) => holdSVG(colors[i % colors.length], size, x, y, rot, i)).join('')}</div>`;
const tape = (text) => `<p class="tape">${text}</p>`;

function buildSlides(s) {
  const label = s.y === 'all' ? 'all time' : s.y;
  const holdColors = s.colors.slice(0, 5).map((c) => c.hex);
  const palette = holdColors.length >= 3 ? holdColors : BG;
  const slides = [];
  const add = (x) => x && slides.push(x);
  const otherDays = s.wdCounts.filter((d) => d.n === 0).length;

  // 1. Intro + year picker
  add({
    bg: '#141414',
    html: `${deco(palette, [[58, 8, 150, 20], [-10, 22, 110, -30], [64, 36, 90, 60], [8, 44, 70, 10]])}
      <p class="kicker">${esc(CLIMBER)}'s</p>
      <h1 class="big mid fit">Boulders<br>Wrapped</h1>
      <p class="line">${s.y === 'all' ? 'Every session, ever.' : `${s.y}${Number(s.y) === lastYear && today.getUTCFullYear() === lastYear ? ', so far' : ''}.`} ${plural(s.sessions.length, 'session')}, ${plural(s.sends.length, 'top')}.</p>
      <div class="years">${[...YEARS.map(String), 'all'].map((y) => `<button type="button" data-year="${y}" aria-pressed="${y === s.y}">${y === 'all' ? 'All time' : y}</button>`).join('')}</div>
      <p class="hint">Tap the right side to continue</p>`,
  });

  if (!s.sessions.length) {
    add({ bg: '#F5FF00', html: `<h1 class="big small">Nothing here.</h1><p class="line">No sessions logged in ${label}. Pick another year on the first card.</p>` });
    return slides;
  }

  // 2. Sessions
  const maxM = d3.max(s.months, (m) => m.n) || 1;
  add({
    html: `<p class="kicker">In ${label} you showed up</p>
      <div class="big" data-count="${s.sessions.length}">${s.sessions.length}</div>
      <p class="line">times. That's ${s.perWeek >= 1 ? `${s.perWeek.toFixed(1)} sessions a week` : `once every ${Math.round(7 / s.perWeek)} days`}.</p>
      ${s.y !== 'all' ? `<div class="bars">${s.months.map((m, i) => `<div class="${m.n ? '' : 'dim'}" style="--i:${i}"><em>${m.n || ''}</em><b style="--h:${(m.n / maxM) * 100}%"></b><span>${'JFMAMJJASOND'[i]}</span></div>`).join('')}</div>` : ''}
      ${tape(s.perWeek >= 1 ? 'Every week. Your skin has not fully healed since January.' : s.perWeek >= 0.5 ? 'Every other week-ish. Consistently inconsistent.' : 'Quality over quantity. Mostly quantity of excuses.')}`,
  });

  // 3. Weekday
  const dayShare = s.topDay.n / s.sessions.length;
  if (dayShare >= 0.35) {
    const maxD = d3.max(s.wdCounts, (d) => d.n);
    add({
      html: `<p class="kicker">Your favourite day to climb</p>
        <h1 class="big small fit">${s.topDay.day}.</h1>
        <p class="line">${s.topDay.n} of your ${s.sessions.length} sessions. That's ${pct(dayShare)}.</p>
        <div class="bars">${s.wdCounts.map((d, i) => `<div class="${d.day === s.topDay.day ? '' : 'dim'}" style="--i:${i}"><em>${d.n || ''}</em><b style="--h:${(d.n / maxD) * 100}%"></b><span>${d.day.slice(0, 2)}</span></div>`).join('')}</div>
        ${tape(dayShare >= 0.8 ? `${s.topDay.day} isn't a day anymore. It's a personality.` : otherDays >= 2 ? `${otherDays} days of the week never saw you once. They've noticed.` : `${s.topDay.day}s are sacred. Don't book meetings.`)}`,
    });
  }

  // 4. Tops + points
  const metres = s.sends.length * 4;
  add({
    html: `<p class="kicker">You topped</p>
      <div class="big" data-count="${s.sends.length}">${s.sends.length}</div>
      <p class="line">boulders. Stacked up that's about ${nf.format(metres)} metres of wall, or ${(metres / 185).toFixed(1)} Euromasts.</p>
      <p class="fine">Plus ${nf.format(s.points)} TopLogger points. Current exchange rate: €0.00.</p>
      ${tape(s.perSessionTops >= 8 ? `${s.perSessionTops.toFixed(0)} tops a session. The skin on your fingertips is a rumour.` : `${s.perSessionTops.toFixed(1)} tops a session. Rest between attempts is also training.`)}`,
  });

  // 5. Colour of the year — the card is painted in it
  const top = s.colors[0];
  if (top) {
    const colourJokes = {
      yellow: 'Like a highlighter: bright, everywhere, and always on the same line.',
      orange: 'Orange is the new comfort zone.',
      pink: 'Pink holds, big moves. Very on brand.',
      purple: 'Purple: royalty, and pain.',
      mint: 'Mint. Fresh. Like your skin before the session.',
      green: 'Green means go. You went.',
      black: 'Black holds. Black clothes. Black humour about your forearms.',
      white: 'White holds: impossible to see on chalk, still you found them.',
      brown: 'Brown. No notes.',
    };
    add({
      bg: top.hex,
      html: `<p class="kicker">Your colour of the year</p>
        <h1 class="big small fit">${top.name[0].toUpperCase() + top.name.slice(1)}.</h1>
        <p class="line">${plural(top.n, 'boulder')}: ${pct(top.n / s.perClimb.length)} of everything you touched${top.median ? `, mostly around ${gradeName(top.median)}` : ''}.</p>
        <div class="strip">${s.colors.map((c) => `<i style="--c:${c.hex};--n:${c.n}" title="${c.name}: ${c.n}"></i>`).join('')}</div>
        ${tape(colourJokes[top.name] || `You and ${top.name}: it's serious.`)}`,
      tilt: '1.5deg',
    });
  }

  // 6. Top walls
  if (s.walls.length >= 3) {
    const w = s.walls[0];
    const mixed = new Set(s.walls.slice(0, 5).map((x) => x.gym)).size > 1;
    add({
      html: `<p class="kicker">Your top walls</p>
        <ol class="rank">${s.walls.slice(0, 5).map((x, i) => `<li><span class="n">${i + 1}</span><span>${esc(x.wall)}${mixed ? ` <span class="c">${esc(gymName(x.gym))}</span>` : ''}</span><span class="c">${x.n}</span></li>`).join('')}</ol>
        ${tape(`${esc(w.wall)}: ${w.n} boulders. That's not a wall, that's a relationship.`)}`,
    });
  }

  // 7. Most-sent grade
  if (s.topGrade) {
    const maxG = d3.max(s.gradeCounts, (d) => d.n);
    const shown = s.gradeCounts.filter((d) => d.g >= 400);
    add({
      html: `<p class="kicker">The grade you sent most</p>
        <div class="big">${gradeName(s.topGrade.g)}</div>
        <p class="line">${plural(s.topGrade.n, 'time')}. More than any other grade.</p>
        <div class="bars">${shown.map((d, i) => `<div class="${d.g === s.topGrade.g ? '' : 'dim'}" style="--i:${i}"><em>${d.g === s.topGrade.g ? d.n : ''}</em><b style="--h:${(d.n / maxG) * 100}%"></b><span>${gradeName(d.g)}</span></div>`).join('')}</div>
        ${tape(s.hardest && s.hardest.g - s.topGrade.g <= 34 ? 'Comfort zone? You moved in and repainted.' : `You and ${gradeName(s.topGrade.g)}: the longest relationship of your ${s.y === 'all' ? 'climbing life' : 'year'}.`)}`,
    });
  }

  // 8. Flash rate
  if (s.sends.length >= 5) {
    add({
      html: `<p class="kicker">First-go tops</p>
        <div class="big" data-count="${Math.round(s.flashRate * 100)}" data-suffix="%">${pct(s.flashRate)}</div>
        <p class="line">of your tops were flashes. ${plural(s.flashes.length, 'flash', 'flashes')} in total.</p>
        ${tape(s.flashRate >= 0.7 ? "Flash it or walk away. Commitment issues, but make it efficient. (Try harder ones?)" : s.flashRate >= 0.5 ? "Half first go. The other half: 'just one more try'." : 'You enjoy suffering. Projecting is a lifestyle.')}`,
    });
  }

  // 9. Hardest top
  if (s.hardest) {
    const h = s.hardest;
    const joke = h.d.getUTCMonth() === 11 && s.y !== 'all' ? 'Saved the best for last. Very dramatic.'
      : h.how === 'flash' ? 'Flashed it. Of course you did.'
      : h.tries >= 2 ? `${h.tries} sessions of beef before it went.`
      : `A ${weekdayName(h.d)} to remember. Nobody else will.`;
    add({
      html: `<p class="kicker">Hardest top of ${label}</p>
        <div class="big">${gradeName(h.grade)}</div>
        <p class="line">${h.how === 'flash' ? 'Flashed' : 'Sent'} on ${weekdayName(h.d)} ${fmtDay(h.d)}${h.wall ? `, on ${esc(h.wall)}` : ''}.</p>
        ${tape(joke)}`,
    });
  }

  // 10. Nemesis, or the ones that got away
  if (s.nemesis) {
    const n = s.nemesis;
    add({
      html: `<p class="kicker">Your nemesis</p>
        <h1 class="big small fit">${gradeName(n.grade)} on ${esc(n.wall || 'some wall')}</h1>
        <p class="line">${n.tries >= 2 ? `${n.tries} different sessions` : `${n.logs} goes in one evening`} before it finally went${n.dates.length > 1 ? `, between ${fmtDayShort(new Date(n.dates[0]))} and ${fmtDayShort(new Date(n.dates.at(-1)))}` : ''}.</p>
        ${tape('It was personal. It still is.')}`,
      tilt: '2deg',
    });
  }
  if (s.gotAway) {
    const g = s.gotAway;
    add({
      html: `<p class="kicker">The one that got away</p>
        <h1 class="big small fit">${gradeName(g.grade)} on ${esc(g.wall || 'some wall')}</h1>
        <p class="line">Tried on ${fmtDay(g.d)}. Reset on ${fmtDay(new Date(g.outAt))} before you came back.${s.ghosted.length > 1 ? ` ${s.ghosted.length - 1} more went the same way.` : ''}</p>
        ${tape("They've moved on. So should you. (You won't.)")}`,
    });
  }

  // 11. Best session (and the not-so-best)
  if (s.best && s.best.tops >= 3) {
    add({
      html: `<p class="kicker">Your biggest session</p>
        <div class="big" data-count="${s.best.tops}">${s.best.tops}</div>
        <p class="line">tops on ${weekdayName(s.best.d)} ${fmtDay(s.best.d)} at ${esc(gymName(s.best.gym))}.</p>
        ${s.tiny.length ? `<p class="fine">Meanwhile: ${plural(s.tiny.length, 'session')} with one top or less.</p>` : ''}
        ${tape(s.tiny.length ? 'Your forearms still talk about the first one. Nobody talks about the others.' : 'Your forearms still talk about it.')}`,
      tilt: '-1deg',
    });
  }

  // 12. Longest break
  if (s.gap && s.gap.days >= 10) {
    add({
      html: `<p class="kicker">Longest time off the wall</p>
        <div class="big" data-count="${s.gap.days}">${s.gap.days}</div>
        <p class="line">days, from ${fmtDay(s.gap.from)} to ${fmtDay(s.gap.to)}.</p>
        ${tape(s.gap.days >= 60 ? "We don't talk about that period." : s.gap.days >= 28 ? "We hope it was a holiday. We suspect it wasn't." : 'Two weeks off. Your calluses filed for divorce.')}`,
    });
  }

  // 13. Gyms
  if (s.gyms.length >= 2) {
    const home = s.gyms[0];
    add({
      html: `<p class="kicker">Where you climbed</p>
        <div class="big">${s.gyms.length}</div>
        <p class="line">gyms. ${esc(home.name)} got ${home.n} of your ${s.sessions.length} visits.</p>
        <ol class="rank">${s.gyms.slice(0, 5).map((g, i) => `<li><span class="n">${i + 1}</span><span>${esc(g.name)}</span><span class="c">${g.n}</span></li>`).join('')}</ol>
        ${tape(`The others were flings. ${esc(home.name)} knows.`)}`,
    });
  } else {
    add({
      html: `<p class="kicker">Where you climbed</p>
        <h1 class="big small fit">${esc(s.gyms[0].name)}</h1>
        <p class="line">Every single session. All ${s.sessions.length} of them.</p>
        ${tape('Loyal like a labrador.')}`,
    });
  }

  // 14. Personality
  const p = personality(s);
  add({
    bg: '#141414',
    html: `${deco(palette, [[60, 6, 130, 30], [-12, 18, 100, -20]])}
      <p class="kicker">Your climbing personality</p>
      <h1 class="big small fit">${p.name}</h1>
      <p class="line">${p.about}</p>
      <div class="chips">${p.traits.map((t) => `<span>${t}</span>`).join('')}</div>`,
  });

  // 15. Share card
  add({
    bg: palette[0],
    html: `<h1 class="big small fit share-title">${s.y === 'all' ? 'That was everything.' : `That was ${s.y}.`}</h1>
      <div class="card" id="share-card">
        <div class="who"><span>${esc(CLIMBER)}'s Boulders Wrapped</span><span>${s.y === 'all' ? 'All time' : s.y}</span></div>
        <div class="persona">${p.name}</div>
        <div class="cols">
          <div><h3>Top walls</h3><ol>${s.walls.slice(0, 3).map((w) => `<li>${esc(w.wall)}</li>`).join('') || '<li>–</li>'}</ol></div>
          <div><h3>Top colours</h3><ol>${s.colors.slice(0, 3).map((c) => `<li><span class="swatch" style="background:${c.hex}"></span>${c.name}</li>`).join('')}</ol></div>
        </div>
        <div class="nums">
          <div><b>${s.sessions.length}</b><span>sessions</span></div>
          <div><b>${s.sends.length}</b><span>tops</span></div>
          <div><b>${s.hardest ? gradeName(s.hardest.grade) : '–'}</b><span>hardest</span></div>
          <div><b>${pct(s.flashRate)}</b><span>flashed</span></div>
        </div>
        <div class="url">${esc(location.host + location.pathname.replace(/wrapped\.html$/, ''))}</div>
      </div>
      <div class="actions">
        <button type="button" class="primary" data-act="save">Save image</button>
        <button type="button" data-act="share">Share link</button>
        <button type="button" data-act="replay">Replay</button>
      </div>`,
  });

  // Paint the cards that didn't choose a colour, avoiding the same colour twice in a row.
  let k = 0;
  for (const sl of slides) {
    if (!sl.bg) {
      let c = BG[k++ % (BG.length - 1)];
      if (c.toUpperCase() === top?.hex) c = BG[k++ % (BG.length - 1)];
      sl.bg = c;
    }
  }
  // Every wall needs holds: bolt one or two onto cards that don't have their own.
  const SPOTS = [[[62, 7, 120, 25]], [[-8, 12, 96, -15], [70, 26, 64, 40]], [[56, 14, 84, 70]], [[6, 6, 110, -40]], [[66, 4, 104, 10], [20, 22, 54, 80]]];
  slides.forEach((sl, i) => {
    if (sl.html.includes('holds-deco')) return;
    const cols = palette.filter((c) => c.toUpperCase() !== sl.bg.toUpperCase());
    sl.html = deco(cols.slice(i % 2), SPOTS[i % SPOTS.length]) + sl.html;
  });
  return slides;
}

// ---------- player ----------
const slidesEl = document.getElementById('slides');
const progressEl = document.getElementById('progress');
let slides = [];
let idx = 0;

function render(resetTo = 0) {
  const stats = computeStats(year);
  slides = buildSlides(stats);
  slidesEl.innerHTML = slides
    .map((s, i) => `<section class="slide" style="--bg:${s.bg};--ink:${inkFor(s.bg)};--tilt:${s.tilt || (i % 2 ? '1.5deg' : '-2deg')}" aria-label="Card ${i + 1} of ${slides.length}">${s.html}</section>`)
    .join('');
  progressEl.innerHTML = slides.map(() => '<i></i>').join('');
  show(resetTo);
}

function fit(el) {
  // Shrink a headline until it fits on its lines without breaking words.
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth + 1 && size > 28) {
    size -= 2;
    el.style.fontSize = `${size}px`;
  }
}

function countUp(el) {
  const to = Number(el.dataset.count);
  const suffix = el.dataset.suffix || '';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || to < 2) return (el.textContent = nf.format(to) + suffix);
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = nf.format(Math.round(to * (1 - (1 - p) ** 3))) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function show(i) {
  idx = Math.max(0, Math.min(slides.length - 1, i));
  const nodes = slidesEl.children;
  [...nodes].forEach((n, j) => n.classList.toggle('on', j === idx));
  [...progressEl.children].forEach((b, j) => (b.className = j < idx ? 'done' : j === idx ? 'now' : ''));
  const cur = nodes[idx];
  const ink = inkFor(slides[idx].bg);
  document.documentElement.style.setProperty('--bar', ink);
  document.querySelector('meta[name="theme-color"]').content = slides[idx].bg;
  cur.querySelectorAll('.fit, .big').forEach(fit);
  cur.querySelectorAll('[data-count]').forEach(countUp);
  // On the share card the whole surface is buttons; don't let the tap zones steal clicks.
  const last = idx === slides.length - 1;
  document.getElementById('next').hidden = last;
  document.getElementById('prev').style.width = last ? '0' : '';
}

document.getElementById('next').addEventListener('click', () => show(idx + 1));
document.getElementById('prev').addEventListener('click', () => show(idx - 1));
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') (e.preventDefault(), show(idx + 1));
  if (e.key === 'ArrowLeft') show(idx - 1);
  if (e.key === 'Escape') location.href = './';
});
window.addEventListener('resize', () => slidesEl.children[idx]?.querySelectorAll('.fit, .big').forEach(fit));

slidesEl.addEventListener('click', async (e) => {
  const yBtn = e.target.closest('[data-year]');
  if (yBtn) {
    year = yBtn.dataset.year;
    history.replaceState(null, '', `?year=${year}`);
    return render(0);
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'replay') return show(0);
  if (act === 'share') return shareLink();
  if (act === 'save') return saveImage(e.target.closest('button'));
});

async function shareLink() {
  const url = `${location.origin}${location.pathname}?year=${year}`;
  const text = `My bouldering ${year === 'all' ? 'all-time' : year} wrapped 🧗`;
  if (navigator.share) return navigator.share({ title: 'Boulders Wrapped', text, url }).catch(() => {});
  await navigator.clipboard.writeText(url);
  toast('Link copied');
}

async function saveImage(btn) {
  const card = document.getElementById('share-card').closest('.slide');
  const old = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const { toBlob } = await import('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm');
    const blob = await toBlob(card, {
      pixelRatio: 3,
      backgroundColor: getComputedStyle(card).backgroundColor,
      filter: (node) => !node.classList?.contains('actions'),
    });
    const file = new File([blob], `boulders-wrapped-${year}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Boulders Wrapped' }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  } catch (err) {
    toast("Couldn't make the image. Take a screenshot instead.");
    console.error(err);
  } finally {
    btn.textContent = old;
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, { position: 'absolute', left: '50%', bottom: '18px', transform: 'translateX(-50%)', zIndex: 10, background: '#141414', color: '#f4f3ef', padding: '8px 14px', borderRadius: '999px', fontWeight: 700, fontSize: '14px' });
  document.getElementById('stage').append(t);
  setTimeout(() => t.remove(), 2200);
}

render(0);
