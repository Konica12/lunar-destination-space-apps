// 360° horizon panorama: terrain silhouette, Sun and Earth paths, current positions.
import { hzAt } from './data.js';

const W = 1000, H = 380, TOP = 18, BOT = 330;
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

export function skyRange(site, v, a, b) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < v.hz.length; k++) { lo = Math.min(lo, v.hz[k]); hi = Math.max(hi, v.hz[k]); }
  for (let i = Math.max(0, a); i < Math.min(site.n, b); i++) {
    hi = Math.max(hi, site.sun.el[i], site.earth.el[i]);
    lo = Math.min(lo, Math.max(site.sun.el[i], -6), Math.max(site.earth.el[i], -6));
  }
  lo = Math.floor(Math.min(lo, -1) - 0.5);
  hi = Math.ceil(Math.max(hi, lo + 4) + 1);
  return [lo, hi];
}

function pathPieces(site, track, v, a, b, X, Y, isSun) {
  // returns arrays of [points, visible]
  const pieces = [];
  let cur = null, lastAz = null;
  for (let i = Math.max(0, a); i < Math.min(site.n, b); i++) {
    const az = track.az[i], e = track.el[i];
    const visible = e > hzAt(v.hz, az) - (isSun ? 0.2665 : 0);
    const wrap = lastAz != null && Math.abs(az - lastAz) > 180;
    if (!cur || cur.visible !== visible || wrap) {
      if (cur && !wrap) cur.pts.push([X(az), Y(e)]);
      cur = { pts: [], visible };
      pieces.push(cur);
    }
    cur.pts.push([X(az), Y(e)]);
    lastAz = az;
  }
  return pieces;
}

export function renderSky(svg, site, v, a, b, cur) {
  svg.replaceChildren();
  const [lo, hi] = skyRange(site, v, a, b);
  const X = (az) => (az / 360) * W;
  const Y = (e) => BOT - ((e - lo) / (hi - lo)) * (BOT - TOP);
  const pxPerDegY = (BOT - TOP) / (hi - lo);
  const pxPerDegX = W / 360;
  const stretch = pxPerDegY / pxPerDegX;

  const defs = el('defs');
  const g = el('linearGradient', { id: 'skyg', x1: 0, y1: 0, x2: 0, y2: 1 });
  g.append(el('stop', { offset: '0', 'stop-color': '#05070f' }), el('stop', { offset: '1', 'stop-color': '#0d1530' }));
  defs.append(g);
  svg.append(defs, el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#skyg)' }));

  // grid
  const step = hi - lo > 16 ? 5 : hi - lo > 8 ? 2 : 1;
  for (let e = Math.ceil(lo / step) * step; e <= hi; e += step) {
    const y = Y(e);
    svg.append(el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: e === 0 ? '#5a6788' : '#1a2440', 'stroke-dasharray': e === 0 ? '5 5' : '' }));
    svg.append(el('text', { x: 6, y: y - 3, fill: '#7d88a3', 'font-size': 11, 'font-family': 'IBM Plex Mono' }, `${e > 0 ? '+' : ''}${e}°`));
  }
  svg.append(el('text', { x: W - 6, y: Y(0) - 4, fill: '#7d88a3', 'font-size': 11, 'text-anchor': 'end' }, 'flat horizon (0°)'));

  // current bodies, drawn BEFORE the terrain so the terrain hides them when blocked
  const sAz = site.sun.az[cur], sEl = site.sun.el[cur];
  const eAz = site.earth.az[cur], eEl = site.earth.el[cur];
  const sunR = Math.max(5, 0.2665 * pxPerDegY);
  const earthR = Math.max(6, 0.95 * pxPerDegY);
  const glow = el('circle', { cx: X(sAz), cy: Y(sEl), r: sunR * 2.4, fill: '#f5b841', opacity: 0.18 });
  svg.append(glow, el('circle', { cx: X(sAz), cy: Y(sEl), r: sunR, fill: '#f5b841' }));
  svg.append(el('circle', { cx: X(eAz), cy: Y(eEl), r: earthR, fill: '#5ab0ff' }));

  // terrain
  let d = `M0 ${H}`;
  const n = v.hz.length;
  for (let k = 0; k <= n; k++) d += ` L${(k / n) * W} ${Y(v.hz[k % n])}`;
  d += ` L${W} ${H} Z`;
  svg.append(el('path', { d, fill: '#3a4566', stroke: '#56628a', 'stroke-width': 1 }));

  // paths over the period
  for (const [track, color, isSun] of [[site.sun, '#f5b841', true], [site.earth, '#5ab0ff', false]]) {
    for (const p of pathPieces(site, track, v, a, b, X, Y, isSun)) {
      if (p.pts.length < 2) continue;
      svg.append(el('polyline', {
        points: p.pts.map((q) => q.join(',')).join(' '), fill: 'none', stroke: color,
        'stroke-width': p.visible ? 2.2 : 1.4, opacity: p.visible ? 0.9 : 0.45, 'stroke-dasharray': p.visible ? '' : '3 4',
      }));
    }
  }

  // labels for current bodies (after terrain)
  const sunVis = sEl > hzAt(v.hz, sAz) - 0.2665, earthVis = eEl > hzAt(v.hz, eAz);
  const lab = (x, y, t, c) => {
    const tx = Math.min(W - 60, Math.max(60, x));
    svg.append(el('text', { x: tx, y: Math.max(TOP + 12, y), fill: c, 'font-size': 14, 'font-weight': 600, 'text-anchor': 'middle', 'paint-order': 'stroke', stroke: '#05070f', 'stroke-width': 4 }, t));
  };
  if (!sunVis) svg.append(el('circle', { cx: X(sAz), cy: Y(sEl), r: sunR, fill: 'none', stroke: '#f5b841', 'stroke-dasharray': '3 3' }));
  if (!earthVis) svg.append(el('circle', { cx: X(eAz), cy: Y(eEl), r: earthR, fill: 'none', stroke: '#5ab0ff', 'stroke-dasharray': '3 3' }));
  lab(X(sAz), Y(sEl) - sunR - 10, sunVis ? `Sun ${sEl.toFixed(2)}°` : 'Sun (blocked)', '#f5b841');
  lab(X(eAz), Y(eEl) - earthR - 10, earthVis ? `Earth ${eEl.toFixed(2)}°` : 'Earth (blocked)', '#8cc8ff');

  // compass
  const comp = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']];
  for (const [az, t] of comp) {
    svg.append(el('text', { x: Math.min(W - 8, Math.max(8, X(az))), y: H - 26, fill: '#c9d1e3', 'font-size': 13, 'font-weight': 600, 'text-anchor': az === 0 ? 'start' : az === 360 ? 'end' : 'middle' }, t));
  }
  for (let az = 30; az < 360; az += 30) if (az % 90) svg.append(el('text', { x: X(az), y: H - 26, fill: '#56628a', 'font-size': 11, 'text-anchor': 'middle', 'font-family': 'IBM Plex Mono' }, `${az}°`));
  svg.append(el('text', { x: W / 2, y: H - 8, fill: '#7d88a3', 'font-size': 11, 'text-anchor': 'middle' },
    `Looking all the way around the site · heights stretched ×${stretch.toFixed(0)} so low angles are visible · N = toward lunar north`));
  return { lo, hi, stretch };
}
