// Loading pre-computed site data and deriving everything the UI shows.
// All maths here is simple comparisons: is the Sun/Earth above the terrain
// horizon in its direction? (No atmosphere on the Moon, so no refraction.)

const BASE = import.meta.env.BASE_URL + 'data/';
const SUN_R = 0.2665; // Sun angular radius (deg)
const cache = new Map();

export async function loadIndex() {
  const r = await fetch(BASE + 'sites.json');
  return (await r.json()).sites;
}

function i16(b64) {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(buf);
}

const ephCache = new Map();
export async function loadEphem(name) {
  if (ephCache.has(name)) return ephCache.get(name);
  const p = (async () => {
    const meta = await (await fetch(BASE + `ephem-${name}.json`)).json();
    const bin = atob(meta.b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    delete meta.b64;
    return { ...meta, t0: Date.parse(meta.start), v: new Float32Array(u8.buffer) };
  })();
  ephCache.set(name, p);
  return p;
}

const R_MOON = 1737.4;
const D2R = Math.PI / 180;

// Azimuth (clockwise from local north) and elevation of Sun and Earth for any
// surface point, from Moon-centred vectors: topocentric = body - site (exact parallax).
export function tracksFor(eph, lat, lon, heightM = 0) {
  const r = R_MOON + heightM / 1000;
  const cl = Math.cos(lat * D2R), sl = Math.sin(lat * D2R), co = Math.cos(lon * D2R), so = Math.sin(lon * D2R);
  const S = [r * cl * co, r * cl * so, r * sl];
  const U = [cl * co, cl * so, sl];
  const E = [-so, co, 0];
  const N = [-sl * co, -sl * so, cl];
  const n = eph.n, v = eph.v;
  const mk = (off) => {
    const az = new Float32Array(n), el = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i * 6 + off;
      const x = v[k] - S[0], y = v[k + 1] - S[1], z = v[k + 2] - S[2];
      const L = Math.hypot(x, y, z);
      const e = (x * E[0] + y * E[1]) / L;
      const nn = (x * N[0] + y * N[1] + z * N[2]) / L;
      const u = (x * U[0] + y * U[1] + z * U[2]) / L;
      az[i] = ((Math.atan2(e, nn) / D2R) + 360) % 360;
      el[i] = Math.asin(Math.max(-1, Math.min(1, u))) / D2R;
    }
    return { az, el };
  };
  return { sun: mk(0), earth: mk(3) };
}

export function flatHorizon(mast) {
  const r0 = R_MOON * 1000 + mast;
  return new Float32Array(720).fill(-Math.acos((R_MOON * 1000) / r0) / D2R);
}

function assemble(d, eph) {
  const tr = tracksFor(eph, d.lat, d.lon, d.elev_m || 0);
  return {
    ...d,
    n: eph.n,
    t0: eph.t0,
    eph,
    sun: tr.sun,
    earth: tr.earth,
    horizons: Object.fromEntries(Object.entries(d.horizon.by_mast_m).map(([k, v]) => [k, Float32Array.from(v)])),
    _vis: {},
  };
}

export async function loadSite(id) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const d = await (await fetch(BASE + id + '.json')).json();
    const eph = await loadEphem(d.ephem);
    const site = assemble(d, eph);
    if (d.terrain) site.terrain = { n: d.terrain.n, spacing_m: d.terrain.spacing_m, h: i16(d.terrain.b64) };
    return site;
  })();
  cache.set(id, p);
  return p;
}

// A user-entered coordinate. Horizon from the browser terrain grid if loaded, else smooth sphere.
export async function customSite(lat, lon, horizonFn) {
  const eph = await loadEphem('main');
  let by = { 2: flatHorizon(2), 10: flatHorizon(10), 20: flatHorizon(20) };
  let source = 'none (smooth sphere)', elev = 0, terrain = null;
  if (horizonFn) {
    const r = await horizonFn(lat, lon);
    if (r) { by = r.by; source = r.source; elev = r.elev; terrain = r.terrain; }
  }
  const d = {
    id: `custom:${lat.toFixed(3)},${lon.toFixed(3)}`,
    name: `Custom point ${Math.abs(lat).toFixed(2)}°S ${lon.toFixed(2)}°E`,
    kind: 'custom', lat, lon, elev_m: elev, ephem: 'main',
    point_method: 'Entered by user',
    horizon: { n_az: 720, source, by_mast_m: {} },
  };
  const site = assemble(d, eph);
  site.horizons = Object.fromEntries(Object.entries(by).map(([k, v]) => [String(k), Float32Array.from(v)]));
  if (terrain) site.terrain = terrain;
  return site;
}

export function hzAt(hz, az) {
  const n = hz.length;
  const x = ((az % 360) + 360) % 360 / (360 / n);
  const i = Math.floor(x), f = x - i;
  return hz[i % n] * (1 - f) + hz[(i + 1) % n] * f;
}

// Per-hour visibility arrays (cached per mast height)
export function vis(site, mast) {
  const key = String(mast);
  if (site._vis[key]) return site._vis[key];
  const hz = site.horizons[key] || site.horizons['2'];
  const n = site.n;
  const sunF = new Float32Array(n), earthV = new Uint8Array(n), sunClear = new Float32Array(n), earthClear = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sh = hzAt(hz, site.sun.az[i]);
    const c = site.sun.el[i] - sh;
    sunClear[i] = c;
    sunF[i] = Math.min(1, Math.max(0, (c + SUN_R) / (2 * SUN_R)));
    const ec = site.earth.el[i] - hzAt(hz, site.earth.az[i]);
    earthClear[i] = ec;
    earthV[i] = ec > 0 ? 1 : 0;
  }
  return (site._vis[key] = { sunF, earthV, sunClear, earthClear, hz });
}

export const HOUR = 3600000;
export const idxOf = (site, t) => Math.round((t - site.t0) / HOUR);
export const timeOf = (site, i) => site.t0 + i * HOUR;
export const inRange = (site, i) => i >= 0 && i < site.n;

// Contiguous runs of a boolean series within [a, b)
export function runs(pred, a, b) {
  const out = [];
  let s = null;
  for (let i = a; i < b; i++) {
    const on = pred(i);
    if (on && s === null) s = i;
    if (!on && s !== null) { out.push([s, i]); s = null; }
  }
  if (s !== null) out.push([s, b]);
  return out;
}

export function longest(rs) {
  return rs.reduce((m, [a, b]) => Math.max(m, b - a), 0);
}

export function rangeStats(site, mast, a, b) {
  const v = vis(site, mast);
  a = Math.max(0, a); b = Math.min(site.n, b);
  let sun = 0, earth = 0, both = 0, maxEl = -90;
  for (let i = a; i < b; i++) {
    sun += v.sunF[i];
    earth += v.earthV[i];
    if (v.sunF[i] > 0.5 && v.earthV[i]) both++;
    if (site.sun.el[i] > maxEl) maxEl = site.sun.el[i];
  }
  const h = Math.max(1, b - a);
  return {
    hours: b - a,
    sunPct: (100 * sun) / h,
    earthPct: (100 * earth) / h,
    bothPct: (100 * both) / h,
    longestDark: longest(runs((i) => v.sunF[i] === 0, a, b)),
    longestNoContact: longest(runs((i) => !v.earthV[i], a, b)),
    maxSunEl: maxEl,
  };
}

export function classifyDay(sunPct, earthPct) {
  if (sunPct < 30 || earthPct < 10) return 'avoid';
  if (sunPct >= 70 && earthPct >= 50) return 'good';
  return 'caution';
}

export function dayStats(site, mast, a, days) {
  const out = [];
  for (let d = 0; d < days; d++) {
    const s = a + d * 24;
    if (s >= site.n || s + 24 <= 0) { out.push(null); continue; }
    const st = rangeStats(site, mast, s, s + 24);
    out.push({ i: s, ...st, verdict: classifyDay(st.sunPct, st.earthPct) });
  }
  return out;
}

// Next change of state after hour i (sunset/sunrise, earthset/earthrise)
export function nextChange(arr, i, test) {
  const now = test(arr[i]);
  for (let j = i + 1; j < arr.length; j++) if (test(arr[j]) !== now) return { now, at: j };
  return { now, at: null };
}

export function weekly(site, mast) {
  const v = vis(site, mast);
  const out = [];
  for (let s = 0; s + 24 * 7 <= site.n; s += 24 * 7) {
    let sun = 0, earth = 0, both = 0;
    for (let i = s; i < s + 168; i++) {
      sun += v.sunF[i]; earth += v.earthV[i];
      if (v.sunF[i] > 0.5 && v.earthV[i]) both++;
    }
    out.push({ i: s, sun: sun / 168, earth: earth / 168, both: both / 168 });
  }
  return out;
}
