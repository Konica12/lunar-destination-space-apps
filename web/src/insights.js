// "Moon vs Earth" contrast and "why small changes matter" panels.
import { vis, hzAt, rangeStats } from './data.js';

const D2R = Math.PI / 180;
const HOUR = 3600000;

// Sun elevation on Earth (NOAA-style low-precision solar position; good to ~0.1°)
export function earthSunElev(t, lat, lon) {
  const d = t / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon) * D2R - ra;
  return Math.asin(Math.sin(lat * D2R) * Math.sin(dec) + Math.cos(lat * D2R) * Math.cos(dec) * Math.cos(H)) / D2R;
}

const CITY = { name: 'Bengaluru', lat: 12.97, lon: 77.59 };
const fmtH = (h) => (h >= 48 ? `${Math.floor(h / 24)} days ${Math.round(h % 24)} h` : h >= 1 ? `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min` : `${Math.round(h * 60)} min`);

function runLength(arr, i, test) {
  if (!test(arr[i])) return null;
  let a = i, b = i;
  while (a > 0 && test(arr[a - 1])) a--;
  while (b < arr.length - 1 && test(arr[b + 1])) b++;
  return { a, b: b + 1, open: a === 0 || b === arr.length - 1 };
}

export function renderContrast(host, site, mast, cur) {
  const v = vis(site, mast);
  const t0 = site.t0 + cur * HOUR;
  const day0 = Math.floor(t0 / 86400000) * 86400000;
  // Earth: sun elevation through the UTC day, every 10 minutes
  const earth = [];
  for (let m = 0; m <= 1440; m += 10) earth.push(earthSunElev(day0 + m * 60000, CITY.lat, CITY.lon));
  const eMax = Math.max(...earth);
  const eDay = (earth.filter((x) => x > -0.833).length * 10) / 60;
  // Moon site: same 24 hours
  const i0 = Math.max(0, Math.round((day0 - site.t0) / HOUR));
  const moon = [];
  for (let k = 0; k <= 24; k++) moon.push(site.sun.el[Math.min(site.n - 1, i0 + k)]);
  const mMax = Math.max(...moon);
  const run = runLength(v.sunF, cur, (x) => x > 0);
  const moonDay = run ? `${run.open ? 'over ' : ''}${fmtH(run.b - run.a)}` : 'dark now';
  let ea = [];
  for (let k = 0; k <= 24; k++) ea.push(site.earth.az[Math.min(site.n - 1, i0 + k)]);
  const spread = (() => { const s = ea.map((a) => ((a - ea[0] + 540) % 360) - 180); return Math.max(...s) - Math.min(...s); })();

  // chart: both Sun paths on the same axes
  const W = 520, H = 200, L = 34, B = 24, T = 10;
  const Y = (e) => T + (1 - (e + 10) / 100) * (H - T - B);
  const X = (h) => L + (h / 24) * (W - L - 8);
  const path = (pts, step) => pts.map((e, k) => `${k ? 'L' : 'M'}${X(k * step).toFixed(1)} ${Y(e).toFixed(1)}`).join(' ');
  let grid = '';
  for (const e of [0, 30, 60, 90]) grid += `<line x1="${L}" x2="${W - 8}" y1="${Y(e)}" y2="${Y(e)}" stroke="${e === 0 ? '#5a6788' : '#1a2440'}"/><text x="${L - 6}" y="${Y(e) + 4}" fill="#7d88a3" font-size="11" text-anchor="end" font-family="IBM Plex Mono">${e}°</text>`;
  for (const h of [0, 6, 12, 18, 24]) grid += `<text x="${X(h)}" y="${H - 6}" fill="#7d88a3" font-size="11" text-anchor="middle" font-family="IBM Plex Mono">${String(h).padStart(2, '0')}:00</text>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sun height through one day on Earth and on the Moon">
    <rect x="${L}" y="${T}" width="${W - L - 8}" height="${Y(0) - T}" fill="#0e1a33"/>${grid}
    <path d="${path(earth, 1 / 6)}" fill="none" stroke="#8cc8ff" stroke-width="2.5"/>
    <path d="${path(moon, 1)}" fill="none" stroke="#f5b841" stroke-width="3"/>
    <text x="${X(earth.indexOf(eMax) / 6)}" y="${Y(eMax) - 8}" fill="#8cc8ff" font-size="13" font-weight="600" text-anchor="middle">${CITY.name}, Earth</text>
    <text x="${X(12)}" y="${Y(Math.max(...moon)) - 8}" fill="#f5b841" font-size="13" font-weight="600" text-anchor="middle">${site.name.split(' (')[0]}, Moon</text></svg>`;
  host.innerHTML = `
    <div class="card-head"><h2>Moon vs Earth, same day</h2><span class="muted">Sun's height through ${new Date(day0).toUTCString().slice(5, 16)} (UTC)</span></div>
    <div class="vs">
      <div class="vs-chart">${svg}</div>
      <div class="vs-facts">
        <div class="fact"><span>Highest Sun today</span><b class="t-earth">${eMax.toFixed(0)}°</b><b class="t-sun">${mMax.toFixed(1)}°</b></div>
        <div class="fact"><span>Length of this daylight</span><b class="t-earth">${fmtH(eDay)}</b><b class="t-sun">${moonDay}</b></div>
        <div class="fact"><span>Sky colour at noon</span><b><i class="sw" style="background:#5d9be0"></i>blue</b><b><i class="sw" style="background:#000;border:1px solid #3a4566"></i>black</b></div>
        <div class="fact"><span>Home planet in the sky</span><b class="t-earth">Moon rises and sets</b><b class="t-sun">Earth drifts ${spread.toFixed(1)}° all day</b></div>
        <div class="fact-key"><span></span><span class="t-earth">${CITY.name}</span><span class="t-sun">Moon site</span></div>
      </div>
    </div>
    <p class="explain">The same 24 hours, side by side. In ${CITY.name} the Sun climbs high and sets each evening. At the lunar south pole it slides along the horizon for days, and one "day" lasts about two Earth weeks. With no air there is no blue sky, no twilight and no refraction: the Sun is either up, partly hidden by a ridge, or gone.</p>`;
}

export function renderSensitivity(host, site, mast, a, b, days, otherMasts, shiftStats) {
  const v = vis(site, mast);
  let loc = '<p class="muted">No terrain map for this point.</p>';
  if (site.illum) {
    const { n, spacing_m: sp, sun } = site.illum;
    const c = (n - 1) / 2, rad = 1000 / sp;
    let lo = 101, hi = -1;
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
      const val = sun[r * n + q]; if (val === 255) continue;
      if (Math.hypot(r - c, q - c) <= rad + 0.01) { lo = Math.min(lo, val); hi = Math.max(hi, val); }
    }
    loc = `<div class="thumb"><canvas class="illum-thumb" width="${n}" height="${n}"></canvas><i class="ring1"></i><i class="dot"></i></div>
      <div><b class="big-fact">${lo}% → ${hi}%</b><div class="muted">sunlight in 2027 within 1 km of the site (${sun[(n * n - 1) / 2]}% at the site)</div></div>`;
  }
  const bars = (rows) => rows.map((r) => `<div class="bar-row"><span>${r.label}</span><div class="bar"><i style="width:${Math.max(1, r.v)}%;background:${r.color}"></i></div><b>${Math.round(r.v)}%</b></div>`).join('');
  host.innerHTML = `
    <div class="card-head"><h2>Small change, big effect</h2><span class="muted">why a few hundred metres or a few days matter</span></div>
    <div class="sens">
      <div class="sens-col"><h3>Move the landing point</h3><div class="loc">${loc}</div></div>
      <div class="sens-col"><h3>Shift the dates</h3>${bars(shiftStats.map((s) => ({ label: s.label, v: s.both, color: '#7fd1ae' })))}<div class="muted">hours with both sunlight and Earth contact, ${days}-day period</div></div>
      <div class="sens-col"><h3>Raise the solar panel</h3>${bars(otherMasts.map((m) => ({ label: `${m.mast} m`, v: m.sun, color: '#f5b841' })))}<div class="muted">sunlit share of this period</div></div>
    </div>
    <p class="explain">The Sun skims the horizon at only a degree or two, so tiny differences in height decide whether a ridge hides it. A point 1 km away can sit in a ridge's shadow; a week later the Sun can be behind a different mountain; a 10 m mast can see over a ridge that a 2 m lander cannot.</p>`;
  const cv = host.querySelector('.illum-thumb');
  if (cv && site.illum) {
    const { n, sun } = site.illum;
    const g = cv.getContext('2d'); const img = g.createImageData(n, n);
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
      const val = sun[r * n + q], o = ((n - 1 - r) * n + q) * 4, t = val === 255 ? 0 : val / 100;
      img.data[o] = 20 + 225 * t; img.data[o + 1] = 24 + 160 * t; img.data[o + 2] = 40 + 25 * t; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
}
