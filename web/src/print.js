// Printable cut-and-roll horizon: two strips (0–180°, 180–360°) on A4 landscape.
// Tape them end to end into a ring, picture facing inward, and look out from
// the centre: that is the skyline from the landing site.
import { hzAt } from './data.js';

const NS = 'http://www.w3.org/2000/svg';

function strip(site, v, a, b, az0, lo, hi, fmtDay) {
  const W = 1800, H = 520, top = 30, bot = 440;
  const X = (az) => ((az - az0) / 180) * W;
  const Y = (e) => bot - ((e - lo) / (hi - lo)) * (bot - top);
  let s = `<svg xmlns="${NS}" viewBox="0 0 ${W + 120} ${H}">`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#000" stroke-width="2" stroke-dasharray="10 6"/>`;
  s += `<rect x="${W}" y="0" width="120" height="${H}" fill="#eee" stroke="#000" stroke-width="2" stroke-dasharray="10 6"/>`;
  s += `<text x="${W + 60}" y="${H / 2}" font-size="22" text-anchor="middle" transform="rotate(90 ${W + 60} ${H / 2})">glue here</text>`;
  for (let e = Math.ceil(lo); e <= hi; e++) {
    s += `<line x1="0" x2="${W}" y1="${Y(e)}" y2="${Y(e)}" stroke="${e === 0 ? '#555' : '#ddd'}" stroke-width="${e === 0 ? 2 : 1}"/>`;
    s += `<text x="8" y="${Y(e) - 4}" font-size="16" fill="#555">${e}°</text>`;
  }
  // terrain
  let d = `M0 ${bot + 60}`;
  for (let k = 0; k <= 360; k++) { const az = az0 + k / 2; d += ` L${X(az)} ${Y(hzAt(v.hz, az))}`; }
  d += ` L${W} ${bot + 60} Z`;
  s += `<path d="${d}" fill="#bbb" stroke="#000" stroke-width="2"/>`;
  // paths with daily dots
  for (const [tr, col, name] of [[site.sun, '#c77d00', 'Sun'], [site.earth, '#1f6fd1', 'Earth']]) {
    let pts = [];
    const flush = () => { if (pts.length > 1) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="4"/>`; pts = []; };
    for (let i = Math.max(0, a); i < Math.min(site.n, b); i++) {
      const az = tr.az[i];
      if (az < az0 || az >= az0 + 180) { flush(); continue; }
      pts.push(`${X(az).toFixed(1)},${Y(tr.el[i]).toFixed(1)}`);
      if ((i - a) % 24 === 12) {
        s += `<circle cx="${X(az)}" cy="${Y(tr.el[i])}" r="6" fill="${col}"/>`;
        s += `<text x="${X(az)}" y="${Y(tr.el[i]) - 12}" font-size="15" text-anchor="middle" fill="${col}">${name} ${fmtDay(i)}</text>`;
      }
    }
    flush();
  }
  for (let az = az0; az <= az0 + 180; az += 30) {
    const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' }[az] || `${az}°`;
    s += `<text x="${Math.min(W - 20, Math.max(20, X(az)))}" y="${H - 14}" font-size="20" font-weight="700" text-anchor="middle">${lbl}</text>`;
  }
  return s + '</svg>';
}

export function printHorizon(site, v, a, b, fmtDay, rangeLabel) {
  let lo = -2, hi = 2;
  for (const x of v.hz) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  for (let i = Math.max(0, a); i < Math.min(site.n, b); i++) hi = Math.max(hi, site.sun.el[i], site.earth.el[i]);
  lo = Math.floor(lo - 0.5); hi = Math.ceil(hi + 0.5);
  const sheet = document.getElementById('print-sheet');
  sheet.innerHTML = `
    <h1>The horizon from ${site.name} · ${rangeLabel}</h1>
    <p>Cut out both strips along the dashed lines. Glue strip 1's tab behind the start of strip 2, then strip 2's tab behind the start of strip 1, so it forms a ring with the picture facing <b>inward</b>. Stand a small figure in the middle and look out: this is the Moon's skyline at ${Math.abs(site.lat).toFixed(2)}°S, ${site.lon.toFixed(2)}°E. Grey is real terrain (${site.horizon.source}); heights are stretched so low angles are visible. The <b style="color:#c77d00">Sun</b> and <b style="color:#1f6fd1">Earth</b> lines show their paths, with a dot at noon UTC each day.</p>
    <p><b>Strip 1</b> (north → east → south)</p>
    ${strip(site, v, a, b, 0, lo, hi, fmtDay)}
    <p><b>Strip 2</b> (south → west → north)</p>
    ${strip(site, v, a, b, 180, lo, hi, fmtDay)}
    <p style="font-size:8pt">LunarDestination · Team Khagolshastra · Positions: JPL DE421 ephemeris, NAIF lunar orientation. Terrain: NASA LRO LOLA.</p>`;
  window.print();
}
