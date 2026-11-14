import {
  loadIndex, loadSite, customSite, vis, hzAt, idxOf, timeOf, HOUR, runs, rangeStats, dayStats, nextChange, classifyDay,
} from './data.js';
import { renderSky } from './sky.js';
import { renderMap } from './map.js';
import { printHorizon } from './print.js';
import { Globe } from './globe.js';
import { StandView } from './standview.js';
import { renderContrast, renderSensitivity } from './insights.js';

const $ = (s) => document.querySelector(s);
const DAY = 24 * HOUR;
const F = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o });
const fmt = F({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtD = F({ weekday: 'short', day: 'numeric', month: 'short' });
const fmtDay = F({ day: 'numeric', month: 'short' });
const fmtMonth = F({ month: 'short' });
const fmtY = F({ day: 'numeric', month: 'short', year: 'numeric' });
const tstr = (ms) => fmt.format(ms).replace(',', '') + ' UTC';
const dur = (h) => (h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`);
const pct = (x) => `${Math.round(x)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const compass = (az) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];

const DEFAULT_START = Date.UTC(2027, 2, 1);
const state = { sites: ['malapert-massif'], start: DEFAULT_START, days: 14, mast: 2, h: 12, tab: 'stand', live: false, pins: [] };
let index = [];
const custom = new Map();
let loaded = [];
let playing = null, liveTimer = null;
const globe = new Globe($('#globe'), (id) => pickFromGlobe(id));
const stand = new StandView($('#stand'));
let standSiteKey = '';

// ---------- URL ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('s')) state.sites = p.get('s').split(',').slice(0, 3);
  if (p.get('d')) { const t = Date.parse(p.get('d') + 'T00:00Z'); if (!isNaN(t)) state.start = t; }
  if ([7, 14, 30].includes(+p.get('p'))) state.days = +p.get('p');
  if ([2, 10, 20].includes(+p.get('m'))) state.mast = +p.get('m');
  if (p.get('h')) state.h = Math.max(0, +p.get('h') || 0);
  if (['stand', 'sky', 'map'].includes(p.get('v'))) state.tab = p.get('v');
}
function writeHash() {
  const p = new URLSearchParams({ s: state.sites.join(','), d: new Date(state.start).toISOString().slice(0, 10), p: state.days, m: state.mast, h: state.h, v: state.tab });
  try { history.replaceState(null, '', '#' + p.toString()); } catch { /* preview frames may refuse */ }
}

// ---------- sites ----------
const siteCache = new Map();
async function getSite(id) {
  const s0 = await getSiteRaw(id); siteCache.set(id, s0); return s0;
}
async function getSiteRaw(id) {
  if (id.startsWith('custom:')) {
    if (!custom.has(id)) { const [la, lo] = id.slice(7).split(',').map(Number); custom.set(id, await customSite(la, lo)); }
    return custom.get(id);
  }
  return loadSite(id);
}
const rangeFor = (site) => { const a = idxOf(site, state.start); return [a, a + state.days * 24]; };
const allSites = () => [...index, ...[...custom.values()].map((s) => ({ id: s.id, name: s.name, kind: 'custom', lat: s.lat, lon: s.lon }))];

function renderChips() {
  const box = $('#site-chips');
  box.replaceChildren();
  for (const s of allSites()) {
    const b = document.createElement('button');
    b.type = 'button';
    const k = state.sites.indexOf(s.id);
    b.className = 'chip' + (s.kind === 'mission' ? ' mission' : '') + (k === 0 ? ' first' : '');
    b.setAttribute('aria-pressed', k >= 0);
    b.innerHTML = (k >= 0 ? `<span class="rank">${k + 1}</span>` : '') + esc(s.name) + (s.kind === 'mission' ? ' · replay' : '');
    b.onclick = () => toggleSite(s.id, s.kind);
    box.append(b);
  }
}

async function toggleSite(id, kind) {
  setLive(false);
  const k = state.sites.indexOf(id);
  if (k === 0 && state.sites.length === 1) return;
  if (k >= 0) state.sites.splice(k, 1);
  else if (kind === 'mission') {
    state.sites = [id];
    const s = await getSite(id);
    state.start = Math.floor((s.t0 + 8 * DAY) / DAY) * DAY; state.days = 30; state.h = 12;
  } else {
    const cur = await getSite(state.sites[0]);
    if (cur.kind === 'mission') { state.sites = []; state.start = DEFAULT_START; state.days = 14; }
    state.sites.push(id);
    if (state.sites.length > 3) state.sites.shift();
  }
  await refresh();
}
function pickFromGlobe(id) {
  const s = allSites().find((x) => x.id === id);
  if (!s) return;
  if (state.sites[0] === id) return;
  // make the tapped site the main one
  state.sites = [id, ...state.sites.filter((x) => x !== id)].slice(0, 3);
  if (s.kind === 'mission') return toggleSite(id, 'mission');
  refresh();
}

// ---------- daily quality, ribbon and suggestions ----------
const dailyCache = new Map();
function daily(site) {
  const key = site.id + '|' + state.mast;
  if (dailyCache.has(key)) return dailyCache.get(key);
  const nd = Math.floor(site.n / 24);
  const out = dayStats(site, state.mast, 0, nd).map((d) => d && { sun: d.sunPct, earth: d.earthPct, v: d.verdict });
  dailyCache.set(key, out);
  return out;
}
const dayIndex = (site, t) => Math.round((t - site.t0) / DAY);

function suggestions(site) {
  const d = daily(site), L = state.days, nd = d.length;
  const good = d.map((x) => (x && x.v === 'good' ? 1 : 0));
  const score = new Array(Math.max(0, nd - L + 1)).fill(0);
  let acc = 0;
  for (let i = 0; i < nd; i++) { acc += good[i]; if (i >= L) acc -= good[i - L]; if (i >= L - 1) score[i - L + 1] = acc; }
  const s0 = dayIndex(site, state.start);
  const max = Math.max(...score);
  const cur = s0 >= 0 && s0 < score.length ? score[s0] : -1;
  let near = null;
  for (let r = 1; r < score.length && !near; r++) {
    for (const c of [s0 + r, s0 - r]) if (c >= 0 && c < score.length && score[c] >= Math.max(cur + 2, Math.ceil(0.8 * max))) { near = c; break; }
  }
  const best = score.indexOf(max);
  return { cur, max, near, nearScore: near != null ? score[near] : 0, best, L, inRange: s0 >= 0 && s0 + L <= nd };
}

function renderRibbon(site) {
  const cv = $('#ribbon');
  const d = daily(site);
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 900, h = 56;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = '#0a0f1e'; g.fillRect(0, 0, w, h);
  const cw = w / d.length;
  d.forEach((x, k) => {
    if (!x) return;
    const X = k * cw, W = Math.max(1, cw - (cw > 3 ? 0.6 : 0));
    g.fillStyle = x.v === 'good' ? '#7fd1ae' : x.v === 'caution' ? '#3d4a6e' : '#4a2618';
    g.fillRect(X, 0, W, 30);
    g.fillStyle = `rgba(245,184,65,${0.1 + 0.9 * (x.sun / 100)})`; g.fillRect(X, 33, W, 10);
    g.fillStyle = `rgba(90,176,255,${0.1 + 0.9 * (x.earth / 100)})`; g.fillRect(X, 45, W, 10);
  });
  const s0 = dayIndex(site, state.start);
  if (s0 + state.days > 0 && s0 < d.length) {
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.strokeRect(Math.max(1, s0 * cw), 1, Math.max(4, state.days * cw), h - 2);
  }
  // months
  let html = '', last = -1;
  for (let k = 0; k < d.length; k++) {
    const t = site.t0 + k * DAY, m = new Date(t).getUTCMonth();
    if (m !== last && new Date(t).getUTCDate() <= 1 + (k === 0 ? 31 : 0)) {
      const label = (m === 0 || k === 0) ? `${fmtMonth.format(t)} ${new Date(t).getUTCFullYear()}` : fmtMonth.format(t);
      if (d.length < 120 || m % 2 === 0 || k === 0) html += `<span style="left:${((k + 0.5) / d.length) * 100}%">${label}</span>`;
    }
    last = m;
  }
  $('#ribbon-months').innerHTML = html;
  cv.onclick = (e) => {
    const k = Math.floor((e.offsetX / cv.clientWidth) * d.length);
    const start = Math.max(0, Math.min(d.length - state.days, k - Math.floor(state.days / 2)));
    jumpTo(site.t0 + start * DAY);
  };
  $('#ribbon-sub').textContent = `${site.name}: each column is one day, ${fmtY.format(site.t0)} – ${fmtY.format(site.t0 + (d.length - 1) * DAY)}. Top: green = good day. Then sunlight (gold) and Earth contact (blue).`;

  const sg = suggestions(site);
  const box = $('#suggest');
  const dl = (i) => fmtD.format(site.t0 + i * DAY);
  let html2 = '';
  if (!sg.inRange) html2 += `<span class="warn">No data for these dates.</span> <span class="note">LunarDestination covers ${fmtY.format(site.t0)} – ${fmtY.format(site.t0 + d.length * DAY)} for this site.</span>`;
  else if (sg.cur >= Math.ceil(0.8 * sg.max) && sg.max > 0) html2 += `<span class="note">These are among the best ${sg.L} days for this site (${sg.cur} good days).</span>`;
  else html2 += `<span class="note">${sg.cur} good day${sg.cur === 1 ? '' : 's'} in this period.</span>`;
  if (sg.near != null && sg.near !== dayIndex(site, state.start)) html2 += `<button type="button" class="sbtn" data-i="${sg.near}">Nearest better: from ${dl(sg.near)} · ${sg.nearScore}/${sg.L} good</button>`;
  if (sg.max > 0 && sg.best !== sg.near && sg.best !== dayIndex(site, state.start)) html2 += `<button type="button" class="sbtn" data-i="${sg.best}">Best of all: from ${fmtY.format(site.t0 + sg.best * DAY)} · ${sg.max}/${sg.L} good</button>`;
  if (sg.max === 0) html2 += `<span class="note">This site has no fully good ${sg.L}-day stretch with this panel height. Try a 10 m mast or another site.</span>`;
  box.innerHTML = html2;
  for (const b of box.querySelectorAll('.sbtn')) b.onclick = () => jumpTo(site.t0 + +b.dataset.i * DAY);
}

function jumpTo(t) { setLive(false); state.start = Math.floor(t / DAY) * DAY; state.h = 12; refresh(); }

// ---------- status tiles ----------
function ringSvg(p, color) {
  const r = 26, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, p / 100));
  return `<svg class="ring" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="${r}" fill="none" stroke="#222d48" stroke-width="8"/><circle cx="34" cy="34" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 34 34)" stroke-linecap="round"/><text x="34" y="39" text-anchor="middle" font-size="15" font-weight="700" fill="#e8ecf5" font-family="IBM Plex Mono">${Math.round(p)}%</text></svg>`;
}

function headline(days) {
  const ok = days.filter(Boolean);
  if (!ok.length) return { h: 'No data for these dates', badge: 'avoid' };
  const good = ok.filter((d) => d.verdict === 'good').length;
  const avoid = ok.filter((d) => d.verdict === 'avoid').length;
  const badge = good / ok.length >= 0.7 ? 'good' : avoid / ok.length >= 0.5 ? 'avoid' : 'caution';
  const first = days.findIndex((d) => d && d.verdict === 'avoid');
  let last = first; while (last + 1 < days.length && days[last + 1] && days[last + 1].verdict === 'avoid') last++;
  const span = first < 0 ? '' : first === last ? fmtD.format(state.start + first * DAY) : `${fmtD.format(state.start + first * DAY)} – ${fmtD.format(state.start + last * DAY)}`;
  const h = good === ok.length ? `Good on all ${ok.length} days` : good === 0 ? (span ? `Hard period · worst ${span}` : 'Usable with limits') : `Good on ${good} of ${ok.length} days${span ? ` · avoid ${span}` : ''}`;
  return { h, badge };
}

function renderStatus(site, a, b, cur) {
  const v = vis(site, state.mast);
  const st = rangeStats(site, state.mast, a, b);
  const days = dayStats(site, state.mast, a, state.days);
  const sunC = nextChange(v.sunF, cur, (x) => x > 0), earthC = nextChange(v.earthV, cur, (x) => x > 0);
  const cnt = (c, up, down) => c.at == null
    ? { k: c.now ? `${up[0]} all period` : `${down[0]} all period`, v: '—', w: 'beyond the data', u: false }
    : { k: c.now ? down[1] : up[1], v: dur(c.at - cur), w: tstr(timeOf(site, c.at)), u: c.now && c.at - cur < 24 };
  const sc = cnt(sunC, ['Sun up', 'Sunrise in'], ['Dark', 'Sunset in']);
  const ec = cnt(earthC, ['Earth in view', 'Earthrise in'], ['No contact', 'Earthset in']);
  const sEl = site.sun.el[cur], clear = sEl - hzAt(v.hz, site.sun.az[cur]);
  const hd = headline(days);
  $('#status').innerHTML = `
    <div class="tile ${sc.u ? 'urgent' : ''}">${ringSvg(st.sunPct, '#f5b841')}<div><div class="lbl">Power · sunlit share of period</div><div class="big">${sc.v}</div><div class="sub">${sc.k}${sc.w ? ` · ${sc.w}` : ''}</div><div class="sub">Sun ${sEl >= 0 ? '+' : ''}${sEl.toFixed(2)}° · ${clear > 0.27 ? `clears terrain by ${clear.toFixed(2)}°` : clear > -0.27 ? 'grazing the terrain' : `${(-clear).toFixed(2)}° behind terrain`}</div></div></div>
    <div class="tile ${ec.u ? 'urgent' : ''}">${ringSvg(st.earthPct, '#5ab0ff')}<div><div class="lbl">Direct-to-Earth contact · share of period</div><div class="big">${ec.v}</div><div class="sub">${ec.k}${ec.w ? ` · ${ec.w}` : ''}</div><div class="sub">Earth ${site.earth.el[cur] >= 0 ? '+' : ''}${site.earth.el[cur].toFixed(2)}° · longest gap ${dur(st.longestNoContact)}</div></div></div>
    <div class="tile verdict-tile"><div><span class="badge ${hd.badge}">${hd.badge === 'good' ? 'GOOD' : hd.badge === 'avoid' ? 'POOR' : 'MIXED'}</span><h3>${esc(hd.h)}</h3><div class="sub">Both at once ${pct(st.bothPct)} · longest dark ${dur(st.longestDark)}</div></div></div>
    ${site.events ? `<div class="events"><b>Mission timeline</b>${site.events.map((e) => { const t = Date.parse(e.t + 'Z'), i = idxOf(site, t); return `<button type="button" data-t="${t}"><b>${fmtDay.format(t)}</b> ${esc(e.label)} · Sun ${v.sunF[i] > 0 ? 'up' : 'down'}, Earth ${v.earthV[i] ? 'in view' : 'hidden'}</button>`; }).join('')}</div>` : ''}
    <p class="explain explain-strip">The gold ring is how much of the period has sunlight for solar power, the blue ring how much has Earth above the terrain for direct radio contact. The big numbers count down to the next sunset or Earthset (or sunrise / Earthrise) at the moment on the time bar. Red means less than a day left.</p>`;
  for (const btn of $('#status').querySelectorAll('.events button')) btn.onclick = () => setHour(Math.round((+btn.dataset.t - state.start) / HOUR));
}

// ---------- countdown overlay ----------
function windowAround(arr, cur, test) {
  const now = test(arr[cur]); let a = cur, b = cur;
  while (a > 0 && test(arr[a - 1]) === now) a--;
  while (b < arr.length - 1 && test(arr[b + 1]) === now) b++;
  return { now, a, b: b + 1, open: b === arr.length - 1 };
}
function renderCountdown(site, cur, v) {
  const chip = (w, cls, up, down, label) => {
    const left = w.b - cur, total = Math.max(1, w.b - w.a), urgent = w.now && left < 24;
    const txt = w.open ? `${w.now ? down : up}: beyond data` : `${w.now ? down : up} in ${dur(left)}`;
    return `<div class="cd ${cls} ${urgent ? 'urgent' : ''}"><div class="k"><span class="ico ${cls}"></span>${label} ${w.now ? 'now' : 'not visible'}</div><div class="v">${txt}</div><div class="bar"><i style="width:${(100 * left / total).toFixed(1)}%;background:${urgent ? '#ff8a5b' : cls === 'sun' ? '#f5b841' : '#5ab0ff'}"></i></div></div>`;
  };
  $('#hud-count').innerHTML = chip(windowAround(v.sunF, cur, (x) => x > 0), 'sun', 'Sunrise', 'Sunset', 'Sunlight') + chip(windowAround(v.earthV, cur, (x) => x > 0), 'earth', 'Earthrise', 'Earthset', 'Earth contact');
}

// ---------- solar elevation ----------
const SOLAR = 1361; // W/m², sunlight at the Moon's distance from the Sun (varies about ±3% over the year)
function renderElev(site, a, cur) {
  const v = vis(site, state.mast);
  const sEl = site.sun.el[cur], sAz = site.sun.az[cur], hz = hzAt(v.hz, sAz), clear = sEl - hz, f = v.sunF[cur];
  const vert = SOLAR * f * Math.cos(sEl * Math.PI / 180), flat = SOLAR * f * Math.max(0, Math.sin(sEl * Math.PI / 180));
  $('#elev-now').innerHTML = `<div class="lbl">Solar elevation now</div>
    <div class="huge ${f > 0 ? '' : 'down'}">${sEl >= 0 ? '+' : '−'}${Math.abs(sEl).toFixed(2)}°</div>
    <div class="sub">Terrain toward the Sun: ${hz >= 0 ? '+' : '−'}${Math.abs(hz).toFixed(2)}°</div>
    <div class="sub">${f >= 1 ? `<b class="t-sun">Sun clear by ${clear.toFixed(2)}°</b>` : f > 0 ? `<b class="t-sun">${Math.round(f * 100)}% of the Sun's disk visible</b>` : `<b>Sun blocked by ${Math.max(0, -clear).toFixed(2)}°</b>`}</div>
    <div class="pw"><div><b>${Math.round(vert)} W/m²</b><span>on a vertical panel facing the Sun</span></div><div><b>${Math.round(flat)} W/m²</b><span>on a panel lying flat</span></div></div>`;
  const cv = $('#elev');
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 800, h = 170;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = '#0a0f1e'; g.fillRect(0, 0, w, h);
  const n = state.days * 24, L = 44, R = 8, T = 10, B = 22;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < n; k++) { const i = a + k; if (i < 0 || i >= site.n) continue; const e = site.sun.el[i], t = hzAt(v.hz, site.sun.az[i]); lo = Math.min(lo, e, t); hi = Math.max(hi, e, t); }
  if (!isFinite(lo)) return;
  lo = Math.floor(lo - 0.3); hi = Math.ceil(hi + 0.3);
  const X = (k) => L + (k / (n - 1)) * (w - L - R), Y = (e) => T + (1 - (e - lo) / (hi - lo)) * (h - T - B);
  g.font = '11px IBM Plex Mono'; g.textAlign = 'right';
  const step = hi - lo > 12 ? 5 : hi - lo > 5 ? 2 : 1;
  for (let e = Math.ceil(lo / step) * step; e <= hi; e += step) {
    g.fillStyle = e === 0 ? '#5a6788' : '#1a2440'; g.fillRect(L, Y(e), w - L - R, 1);
    g.fillStyle = '#7d88a3'; g.fillText(`${e > 0 ? '+' : ''}${e}°`, L - 6, Y(e) + 4);
  }
  g.textAlign = 'left'; g.font = '11px IBM Plex Sans'; g.fillStyle = '#7d88a3';
  for (let d = 0; d < state.days; d += state.days > 14 ? 3 : 1) g.fillText(fmtDay.format(state.start + d * DAY), X(d * 24) + 2, h - 6);
  // shade where the Sun clears the terrain
  for (let k = 0; k < n; k++) { const i = a + k; if (i < 0 || i >= site.n || v.sunF[i] <= 0) continue; g.fillStyle = `rgba(245,184,65,${0.08 + 0.17 * v.sunF[i]})`; g.fillRect(X(k), T, (w - L - R) / n + 0.5, h - T - B); }
  const line = (fn, color, width) => { g.strokeStyle = color; g.lineWidth = width; g.beginPath(); let on = false; for (let k = 0; k < n; k++) { const i = a + k; if (i < 0 || i >= site.n) { on = false; continue; } const y = Y(fn(i)); if (on) g.lineTo(X(k), y); else { g.moveTo(X(k), y); on = true; } } g.stroke(); };
  line((i) => hzAt(v.hz, site.sun.az[i]), '#56628a', 2);
  line((i) => site.sun.el[i], '#f5b841', 2.2);
  const ck = cur - a;
  g.fillStyle = '#fff'; g.fillRect(X(ck) - 1, T, 2, h - T - B);
  g.beginPath(); g.arc(X(ck), Y(sEl), 5, 0, Math.PI * 2); g.fillStyle = '#f5b841'; g.fill();
  cv.onclick = (e) => setHour(Math.round(((e.offsetX - L) / (w - L - R)) * (n - 1)));
}

// ---------- time bar ----------
function renderTimebar(site, a) {
  const cv = $('#tbar');
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 800, h = 38;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = '#0a0f1e'; g.fillRect(0, 0, w, h);
  const v = vis(site, state.mast), n = state.days * 24;
  for (let k = 0; k < n; k++) {
    const i = a + k, x = (k / n) * w, ww = Math.ceil(w / n) + 0.5;
    if (i < 0 || i >= site.n) { g.fillStyle = '#20263a'; g.fillRect(x, 0, ww, h); continue; }
    if (v.sunF[i] > 0) { g.fillStyle = `rgba(245,184,65,${0.25 + 0.75 * v.sunF[i]})`; g.fillRect(x, 4, ww, 13); }
    if (v.earthV[i]) { g.fillStyle = '#5ab0ff'; g.fillRect(x, 21, ww, 13); }
  }
  const tri = (x, y, down, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.lineTo(x, down ? y + 7 : y - 7); g.closePath(); g.fill(); };
  for (let k = 1; k < n; k++) {
    const i = a + k; if (i <= 0 || i >= site.n) continue;
    const x = (k / n) * w;
    if (v.sunF[i - 1] > 0 && v.sunF[i] === 0) tri(x, 0, true, '#ff8a5b');
    if (v.earthV[i - 1] && !v.earthV[i]) tri(x, h, false, '#ff8a5b');
  }
  g.font = '11px IBM Plex Sans'; g.fillStyle = 'rgba(232,236,245,0.75)';
  const step = state.days > 14 ? 3 : 1;
  for (let d = 0; d < state.days; d++) {
    const x = (d / state.days) * w;
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, 0, 1, h);
    if (d % step === 0) { g.fillStyle = 'rgba(232,236,245,0.85)'; g.fillText(fmtDay.format(state.start + d * DAY), x + 3, 15); }
  }
}

// ---------- compare & windows ----------
function drawStrip(cv, site, a, b, cur) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 600, h = 34;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  g.fillStyle = '#0a0f1e'; g.fillRect(0, 0, w, h);
  const v = vis(site, state.mast), n = b - a;
  for (let i = a; i < b; i++) {
    const x = ((i - a) / n) * w, ww = Math.ceil(w / n) + 0.5;
    if (i < 0 || i >= site.n) { g.fillStyle = '#20263a'; g.fillRect(x, 0, ww, h); continue; }
    if (v.sunF[i] > 0) { g.fillStyle = `rgba(245,184,65,${0.25 + 0.75 * v.sunF[i]})`; g.fillRect(x, 2, ww, 14); }
    if (v.earthV[i]) { g.fillStyle = '#5ab0ff'; g.fillRect(x, 19, ww, 13); }
  }
  g.fillStyle = '#fff'; g.fillRect(((cur - a) / n) * w - 1, 0, 2, h);
}
const rangeAt = (site, start, days) => { const a = idxOf(site, start); return [a, a + days * 24]; };
function scenarios() {
  const rows = loaded.map((s) => ({ s, start: state.start, days: state.days, cur: true }));
  for (const p of state.pins) {
    const s = siteCache.get(p.id);
    if (s && !rows.some((r) => r.s.id === p.id && r.start === p.start && r.days === p.days)) rows.push({ s, start: p.start, days: p.days, pin: p });
  }
  return rows;
}
function renderCompare() {
  const rows = scenarios().map((r) => { const [a, b] = rangeAt(r.s, r.start, r.days); return { ...r, a, b, st: rangeStats(r.s, state.mast, a, b) }; });
  const ranked = [...rows].sort((x, y) => y.st.bothPct - x.st.bothPct);
  $('#compare-sub').textContent = rows.length > 1 ? 'ranked by hours with both sunlight and Earth contact' : 'pin scenarios or pick more sites to compare';
  $('#compare-body').innerHTML = `<div class="tablewrap"><table class="cmp"><thead><tr><th>Scenario</th><th style="width:36%">Hour by hour (gold = Sun, blue = Earth)</th><th class="num">Sunlight</th><th class="num">Earth</th><th class="num">Both</th><th class="num">Longest dark</th><th class="num">Longest no contact</th><th></th></tr></thead><tbody>
    ${ranked.map((r, k) => `<tr><td class="name">${rows.length > 1 ? `<span class="rank">${k + 1}</span> ` : ''}${esc(r.s.name)}<div class="muted">${fmtD.format(r.start)} · ${r.days} days${r.cur ? ' · on screen' : ''}</div></td><td><canvas data-k="${rows.indexOf(r)}"></canvas></td>
      <td class="num t-sun">${pct(r.st.sunPct)}</td><td class="num t-earth">${pct(r.st.earthPct)}</td><td class="num">${pct(r.st.bothPct)}</td><td class="num">${dur(r.st.longestDark)}</td><td class="num">${dur(r.st.longestNoContact)}</td>
      <td>${r.pin ? `<button type="button" class="btn small ghost" data-open="${state.pins.indexOf(r.pin)}">Open</button><button type="button" class="pin-x" aria-label="Remove" data-rm="${state.pins.indexOf(r.pin)}">×</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  compareRows = rows;
  for (const btn of $('#compare-body').querySelectorAll('[data-rm]')) btn.onclick = () => { state.pins.splice(+btn.dataset.rm, 1); renderCompare(); };
  for (const btn of $('#compare-body').querySelectorAll('[data-open]')) btn.onclick = () => { const p = state.pins[+btn.dataset.open]; state.sites = [p.id, ...state.sites.filter((x) => x !== p.id)].slice(0, 3); state.start = p.start; state.days = p.days; state.h = 12; refresh(); };
  updateStrips();
}
let compareRows = [];
function updateStrips() {
  for (const cv of $('#compare-body').querySelectorAll('canvas')) {
    const r = compareRows[+cv.dataset.k]; if (!r) continue;
    const [a, b] = rangeAt(r.s, r.start, r.days);
    drawStrip(cv, r.s, a, b, a + Math.min(state.h, r.days * 24 - 1));
    cv.onclick = (ev) => { if (!r.cur) return; setHour(Math.round((ev.offsetX / cv.clientWidth) * state.days * 24)); };
  }
}

// ---------- every site, every month ----------
function renderMatrix() {
  const sites = allSites().filter((x) => x.kind !== 'mission').map((x) => siteCache.get(x.id)).filter(Boolean);
  if (!sites.length) return;
  const ref = sites[0];
  const nd = Math.floor(ref.n / 24);
  const months = [];
  for (let d = 0; d < nd; d++) { const t = ref.t0 + d * DAY, k = new Date(t).toISOString().slice(0, 7); if (!months.length || months[months.length - 1].k !== k) months.push({ k, t, d0: d, d1: d }); months[months.length - 1].d1 = d; }
  const cur = new Date(state.start).toISOString().slice(0, 7);
  let html = `<table class="mx"><thead><tr><th></th>${months.map((m) => `<th>${fmtMonth.format(m.t)}${m.k.endsWith('-01') || m === months[0] ? `<br>${m.k.slice(0, 4)}` : ''}</th>`).join('')}</tr></thead><tbody>`;
  for (const s of sites) {
    const d = daily(s);
    html += `<tr><th class="site">${esc(s.name)}</th>${months.map((m, mi) => {
      let g = 0, c = 0;
      for (let k = m.d0; k <= m.d1; k++) if (d[k]) { c++; if (d[k].v === 'good') g++; }
      const f = c ? g / c : 0;
      const col = `rgb(${Math.round(26 + 101 * f)},${Math.round(34 + 175 * f)},${Math.round(52 + 122 * f)})`;
      return `<td><button type="button" data-s="${esc(s.id)}" data-m="${mi}" class="${s.id === state.sites[0] && m.k === cur ? 'cur' : ''}" style="background:${col};color:${f > 0.45 ? '#0a0f1e' : '#c9d1e3'}" title="${esc(s.name)} · ${m.k}: ${g} of ${c} days good">${Math.round(f * 100)}</button></td>`;
    }).join('')}</tr>`;
  }
  $('#matrix-body').innerHTML = html + '</tbody></table>';
  for (const btn of $('#matrix-body').querySelectorAll('button')) btn.onclick = () => {
    const s = siteCache.get(btn.dataset.s), m = months[+btn.dataset.m], d = daily(s), L = state.days;
    let best = m.d0, bs = -1;
    for (let st = m.d0; st <= m.d1 && st + L <= d.length; st++) { let g = 0; for (let k = st; k < st + L; k++) if (d[k] && d[k].v === 'good') g++; if (g > bs) { bs = g; best = st; } }
    state.sites = [s.id, ...state.sites.filter((x) => x !== s.id)].slice(0, 3);
    state.start = s.t0 + best * DAY; state.h = 12; setLive(false); refresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

function renderWindows(site, a, b) {
  const v = vis(site, state.mast), A = Math.max(0, a), B = Math.min(site.n, b);
  const list = (rs) => !rs.length ? '<p class="empty">None in this period.</p>'
    : `<table>${rs.slice(0, 14).map(([s, e]) => `<tr><td>${s === A && A === a ? '… ' : ''}${tstr(timeOf(site, s)).replace(' UTC', '')}</td><td>→ ${tstr(timeOf(site, e)).replace(' UTC', '')}${e === B && B === b ? ' …' : ''}</td><td>${dur(e - s)}</td></tr>`).join('')}</table>${rs.length > 14 ? `<p class="empty">+ ${rs.length - 14} more</p>` : ''}`;
  $('#windows-body').innerHTML = `<p class="muted" style="margin:0 0 10px">${esc(site.name)} · UTC · "…" = continues beyond the period</p><div class="win-cols">
    <div class="win"><h3 class="t-sun">Sunlight (power)</h3>${list(runs((i) => v.sunF[i] > 0, A, B))}</div>
    <div class="win"><h3 class="t-earth">Earth in view (direct contact)</h3>${list(runs((i) => v.earthV[i] > 0, A, B))}</div>
    <div class="win"><h3>Both at once</h3>${list(runs((i) => v.sunF[i] > 0.5 && v.earthV[i] > 0, A, B))}</div></div>
    <p class="explain">Start and end times when the Sun (any part of its disk) or Earth (its centre) is above the local terrain horizon, checked every hour. The Moon has no atmosphere, so there is no refraction: the horizon is the terrain, or the curve of the Moon itself.</p>`;
}

// ---------- time-dependent ----------
function setHour(h) {
  state.h = Math.max(0, Math.min(state.days * 24 - 1, h));
  $('#time').value = state.h;
  renderTime();
  writeHash();
}

function renderTime() {
  const site = loaded[0]; if (!site) return;
  const [a, b] = rangeFor(site);
  const cur = Math.max(0, Math.min(site.n - 1, a + state.h));
  const v = vis(site, state.mast);
  const t = timeOf(site, cur);
  $('#time-label').textContent = tstr(t);
  $('#globe-time').textContent = tstr(t);
  const k = cur * 6, ev = site.eph.v;
  globe.update([ev[k], ev[k + 1], ev[k + 2]], [ev[k + 3], ev[k + 4], ev[k + 5]]);
  renderStatus(site, a, b, cur);
  renderElev(site, a, cur);
  renderContrast($('#contrast'), site, state.mast, cur);
  renderCountdown(site, cur, v);
  const sAz = site.sun.az[cur], sEl = site.sun.el[cur], eAz = site.earth.az[cur], eEl = site.earth.el[cur];
  if (state.tab === 'stand') {
    stand.update(sAz, sEl, eAz, eEl, v.sunF[cur]);
    stand._cur = { sAz, sEl, eAz, eEl, v };
    updateHeading();
  } else if (state.tab === 'sky') {
    renderSky($('#sky'), site, v, a, b, cur);
  } else if (state.tab === 'map') {
    const mode = $('#map-mode')?.value || (site.illum ? 'sun' : 'elev');
    const r = renderMap($('#map'), site, sAz, sEl, eAz, mode);
    $('#map-legend').innerHTML = r ? `<span>${r.km.toFixed(0)} × ${r.km.toFixed(0)} km · ${r.lo} to +${r.hi} m relative to the site</span>
      <label>Show <select id="map-mode"><option value="elev">elevation, lit by the Sun now</option><option value="slope" ${mode === 'slope' ? 'selected' : ''}>slopes over 15°</option>${site.illum ? `<option value="sun" ${mode === 'sun' ? 'selected' : ''}>sunlight map, 2027</option>` : ''}</select></label>
      ${mode === 'sun' ? '<span><i style="background:linear-gradient(90deg,#141828,#f5b841)"></i>share of 2027 with the Sun up (0–100%), central 10 km</span>' : ''}
      ${mode === 'slope' ? `<span><i style="background:#ff7846"></i>too steep to land (${r.steepPct.toFixed(0)}%)</span>` : ''}` : '';
    const sel = $('#map-mode'); if (sel) sel.onchange = () => renderTime();
  }
  updateStrips();
}

function updateHeading() {
  const c = stand._cur; if (!c) return;
  const sunVis = c.sEl > hzAt(c.v.hz, c.sAz) - 0.27, earthVis = c.eEl > hzAt(c.v.hz, c.eAz);
  $('#heading').innerHTML = `Facing ${compass(stand.yaw)} ${Math.round(stand.yaw)}° · <span class="t-sun">Sun ${c.sEl >= 0 ? '+' : ''}${c.sEl.toFixed(1)}° ${sunVis ? '' : '(behind terrain)'}</span> · <span class="t-earth">Earth ${c.eEl >= 0 ? '+' : ''}${c.eEl.toFixed(1)}° ${earthVis ? '' : '(hidden)'}</span>`;
}
stand.onView = updateHeading;

function setTab(tab) {
  state.tab = tab;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', t.dataset.tab === tab);
  for (const p of ['stand', 'sky', 'map']) $('#panel-' + p).hidden = tab !== p;
  const site = loaded[0];
  $('#panel-map').querySelector('.notice')?.remove();
  if (site && !site.terrain && tab === 'map') {
    const n = document.createElement('div'); n.className = 'notice';
    n.textContent = `No LOLA terrain model is loaded for ${site.name} yet, so there is no real map to show. It appears once elevation data has been processed for this site.`;
    $('#panel-map').append(n);
  }
  if (tab === 'stand' && site) syncStand(site);
  writeHash();
  renderTime();
}
function syncStand(site) {
  const key = site.id + '|' + state.mast + '|' + !!site.terrain;
  if (key === standSiteKey) return;
  standSiteKey = key;
  stand.setSite(site, vis(site, state.mast).hz);
  const [a] = rangeFor(site), cur = Math.max(0, a + state.h);
  stand.lookAt(site.sun.az[cur], 2, 70);
}

// ---------- refresh ----------
async function refresh() {
  stopPlay();
  loaded = await Promise.all(state.sites.map(getSite));
  const site = loaded[0];
  state.h = Math.min(state.h, state.days * 24 - 1);
  $('#date').value = new Date(state.start).toISOString().slice(0, 10);
  $('#days').value = String(state.days);
  $('#mast').value = String(state.mast);
  $('#time').max = state.days * 24 - 1; $('#time').value = state.h;
  $('#tab-info').textContent = `Terrain: ${site.horizon.source}`;
  renderChips();
  globe.setSites(allSites(), state.sites);
  renderRibbon(site);
  const [a, b] = rangeFor(site);
  renderTimebar(site, a);
  renderCompare();
  renderMatrix();
  { const [a0, b0] = rangeFor(site); renderSensitivity($('#sens'), site, state.mast, a0, b0, state.days, [2, 10, 20].map((m) => ({ mast: m, sun: rangeStats(site, m, a0, b0).sunPct })), [['1 week earlier', -168], ['Chosen dates', 0], ['1 week later', 168], ['2 weeks later', 336]].map(([label, o]) => ({ label, both: rangeStats(site, state.mast, a0 + o, b0 + o).bothPct }))); }
  renderWindows(site, a, b);
  $('#sources').innerHTML = `<b>How the numbers are made.</b> Sun and Earth: JPL DE421 ephemeris with NAIF's lunar orientation model (MOON_ME frame), hourly, light-time corrected, computed for the exact point. Horizon: highest terrain angle in each of 720 directions out to 150 km on a spherical Moon (R = 1737.4 km) from NASA LRO LOLA elevation where loaded; otherwise the curve of the Moon alone. No atmosphere, so no refraction. Site points: ${loaded.map((s) => `${esc(s.name)} (${esc(s.point_method)}${s.anchor?.url ? `, <a href="${s.anchor.url}" target="_blank" rel="noopener">IAU feature</a>` : ''})`).join('; ')}. NASA has not published exact coordinates for its candidate regions.`;
  standSiteKey = '';
  setTab(state.tab);
  writeHash();
}

// ---------- play / live ----------
function stopPlay() { if (playing) { clearInterval(playing); playing = null; $('#play').textContent = '▶'; $('#play').setAttribute('aria-label', 'Play'); } }
function togglePlay() {
  if (playing) return stopPlay();
  setLive(false);
  $('#play').textContent = '❚❚'; $('#play').setAttribute('aria-label', 'Pause');
  playing = setInterval(() => setHour(state.h + 1 >= state.days * 24 ? 0 : state.h + 1), 70);
}
function setLive(on) {
  state.live = on;
  $('#live').setAttribute('aria-pressed', on);
  clearInterval(liveTimer);
  if (!on) return;
  const tick = async () => {
    const now = Date.now();
    const site = loaded[0];
    if (site && site.kind === 'mission') { state.sites = ['malapert-massif']; }
    const day0 = Math.floor(now / DAY) * DAY;
    if (now < state.start || now >= state.start + state.days * DAY) { state.start = day0; await refresh(); }
    setHour(Math.floor((now - state.start) / HOUR));
  };
  tick();
  liveTimer = setInterval(tick, 60000);
}

function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2000); }

function csv() {
  const site = loaded[0]; const [a, b] = rangeFor(site); const v = vis(site, state.mast);
  const lines = ['utc,sun_az_deg,sun_el_deg,terrain_at_sun_az_deg,sun_visible_fraction,earth_az_deg,earth_el_deg,terrain_at_earth_az_deg,earth_visible'];
  for (let i = Math.max(0, a); i < Math.min(site.n, b); i++) lines.push([new Date(timeOf(site, i)).toISOString(), site.sun.az[i].toFixed(3), site.sun.el[i].toFixed(3), hzAt(v.hz, site.sun.az[i]).toFixed(3), v.sunF[i].toFixed(3), site.earth.az[i].toFixed(3), site.earth.el[i].toFixed(3), hzAt(v.hz, site.earth.az[i]).toFixed(3), v.earthV[i]].join(','));
  const u = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const l = document.createElement('a');
  l.href = u; l.download = `${site.id.replace(/[^a-z0-9-]/gi, '_')}_${new Date(state.start).toISOString().slice(0, 10)}_${state.days}d.csv`;
  l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}

// ---------- star field background ----------
function starfield() {
  const cv = $('#stars'); if (!cv) return;
  const g = cv.getContext('2d');
  let stars = [], w = 0, h = 0;
  const seed = () => { w = cv.width = innerWidth; h = cv.height = innerHeight; stars = Array.from({ length: Math.round((w * h) / 2600) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.4 + 0.3, p: Math.random() * Math.PI * 2, s: 0.2 + Math.random() * 0.8 })); };
  seed(); addEventListener('resize', seed);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (t) => {
    g.clearRect(0, 0, w, h);
    for (const st of stars) { const a = reduce ? 0.7 : 0.45 + 0.45 * Math.sin(t / 1400 * st.s + st.p); g.fillStyle = `rgba(220,228,255,${a})`; g.beginPath(); g.arc(st.x, st.y, st.r, 0, Math.PI * 2); g.fill(); }
    if (!reduce) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
starfield();

// ---------- boot ----------
async function boot() {
  readHash();
  index = await loadIndex();
  for (const id of state.sites) if (id.startsWith('custom:')) await getSite(id);
  state.sites = state.sites.filter((id) => id.startsWith('custom:') || index.some((s) => s.id === id));
  if (!state.sites.length) state.sites = ['malapert-massif'];
  if (!location.hash.includes('d=')) {
    const s0 = await getSite(state.sites[0]);
    if (s0.kind !== 'mission') { const sg = suggestions(s0); if (sg.max > 0) state.start = s0.t0 + sg.best * DAY; }
  }
  $('#date').onchange = (e) => { const t = Date.parse(e.target.value + 'T00:00Z'); if (!isNaN(t)) jumpTo(t); };
  $('#prev').onclick = () => jumpTo(state.start - 7 * DAY);
  $('#next').onclick = () => jumpTo(state.start + 7 * DAY);
  $('#days').onchange = (e) => { state.days = +e.target.value; refresh(); };
  $('#mast').onchange = (e) => { state.mast = +e.target.value; refresh(); };
  $('#time').oninput = (e) => { setLive(false); setHour(+e.target.value); };
  $('#play').onclick = togglePlay;
  $('#live').onclick = () => setLive(!state.live);
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => setTab(t.dataset.tab);
  $('#explain').onchange = (e) => document.body.classList.toggle('explain-on', e.target.checked);
  $('#share').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast('Copy the address bar to share this view'); } };
  $('#csv').onclick = csv;
  $('#pin').onclick = () => { const p = { id: state.sites[0], start: state.start, days: state.days }; if (!state.pins.some((x) => x.id === p.id && x.start === p.start && x.days === p.days)) state.pins.push(p); if (state.pins.length > 6) state.pins.shift(); renderCompare(); toast('Pinned. Change site or dates to compare against it.'); };
  await Promise.all(index.map((x) => getSite(x.id)));
  $('#print').onclick = () => { const s = loaded[0]; const [a, b] = rangeFor(s); printHorizon(s, vis(s, state.mast), a, b, (i) => fmtDay.format(timeOf(s, i)), `${fmtY.format(state.start)}, ${state.days} days`); };
  $('#look-sun').onclick = () => { const c = stand._cur; if (c) stand.lookAt(c.sAz, c.sEl, stand.fov); };
  $('#look-earth').onclick = () => { const c = stand._cur; if (c) stand.lookAt(c.eAz, c.eEl, stand.fov); };
  $('#zoom').onclick = (e) => { const on = stand.fov > 20; stand.setFov(on ? 8 : 70); e.currentTarget.setAttribute('aria-pressed', on); };
  $('#custom-form').onsubmit = async (e) => {
    e.preventDefault();
    const la = +$('#c-lat').value, lo = +$('#c-lon').value;
    if (!(la <= -60 && la >= -90)) return toast('Enter a latitude between −60 and −90');
    const id = `custom:${la.toFixed(3)},${lo.toFixed(3)}`;
    await getSite(id);
    const cur = await getSite(state.sites[0]);
    if (cur.kind === 'mission') { state.sites = []; state.start = DEFAULT_START; state.days = 14; }
    state.sites = [id, ...state.sites.filter((x) => x !== id)].slice(0, 3);
    refresh();
  };
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const s = loaded[0]; if (!s) return; renderRibbon(s); renderTimebar(s, rangeFor(s)[0]); updateStrips(); }, 150); });
  await refresh();
}
boot();
