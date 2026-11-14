// Terrain map around the site: elevation shading, steep slopes, and the
// directions of the Sun and Earth at the selected time.

const D2R = Math.PI / 180;

export function renderMap(canvas, site, sunAz, sunEl, earthAz, mode = 'elev') {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);
  if (!site.terrain) return null;
  const { n, spacing_m: sp, h } = site.terrain;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < h.length; k++) { if (h[k] < lo) lo = h[k]; if (h[k] > hi) hi = h[k]; }
  const img = ctx.createImageData(n, n);
  // light direction for hillshade: the real Sun if up, else a fixed NW light
  const la = sunEl > 0 ? sunAz : 315, le = sunEl > 0 ? Math.max(sunEl, 0.5) : 30;
  const L = [Math.cos(le * D2R) * Math.sin(la * D2R), Math.cos(le * D2R) * Math.cos(la * D2R), Math.sin(le * D2R)];
  let steep = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      const zl = h[r * n + Math.max(0, c - 1)], zr = h[r * n + Math.min(n - 1, c + 1)];
      const zd = h[Math.max(0, r - 1) * n + c], zu = h[Math.min(n - 1, r + 1) * n + c];
      const dzdx = (zr - zl) / (2 * sp), dzdy = (zu - zd) / (2 * sp);
      const slope = Math.atan(Math.hypot(dzdx, dzdy)) / D2R;
      const nx = -dzdx, ny = -dzdy, nz = 1, nl = Math.hypot(nx, ny, nz);
      const shade = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      const t = (h[k] - lo) / Math.max(1, hi - lo);
      let R = 40 + 150 * t, G = 46 + 140 * t, B = 70 + 120 * t;
      const s = 0.35 + 0.65 * shade;
      R *= s; G *= s; B *= s;
      if (mode === 'slope' && slope > 15) { R = 255 * s; G = 120 * s; B = 70 * s; steep++; }
      // image rows go top (north) -> bottom (south); terrain rows are south->north
      const o = ((n - 1 - r) * n + c) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  const off = document.createElement('canvas');
  off.width = off.height = n;
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  if (mode === 'sun' && site.illum) {
    const m = site.illum, kmP = ((n - 1) * sp) / 1000, kmI = (m.n * m.spacing_m) / 1000;
    const cell = (W * (kmI / kmP)) / m.n, x0 = cx - (cell * m.n) / 2, y0 = cy - (cell * m.n) / 2;
    for (let r = 0; r < m.n; r++) for (let q = 0; q < m.n; q++) {
      const v = m.sun[r * m.n + q]; if (v === 255) continue;
      const t = v / 100;
      ctx.fillStyle = `rgba(${Math.round(20 + 225 * t)},${Math.round(24 + 160 * t)},${Math.round(40 + 25 * t)},0.82)`;
      ctx.fillRect(x0 + q * cell, y0 + (m.n - 1 - r) * cell, cell + 0.5, cell + 0.5);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([4, 4]); ctx.strokeRect(x0, y0, cell * m.n, cell * m.n); ctx.setLineDash([]);
  }
  const arrow = (az, color, label) => {
    const len = W * 0.42;
    const x = cx + Math.sin(az * D2R) * len, y = cy - Math.cos(az * D2R) * len;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 15px IBM Plex Sans'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#05070f';
    ctx.strokeText(label, x, y - 16); ctx.fillText(label, x, y - 16);
  };
  arrow(sunAz, '#f5b841', 'Sun');
  arrow(earthAz, '#5ab0ff', 'Earth');
  // site
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#05070f'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
  // north arrow + scale bar
  ctx.fillStyle = '#e8ecf5'; ctx.font = '600 14px IBM Plex Sans'; ctx.textAlign = 'center';
  ctx.fillText('N', 28, 26); ctx.beginPath(); ctx.moveTo(28, 32); ctx.lineTo(22, 50); ctx.lineTo(34, 50); ctx.fill();
  const km = ((n - 1) * sp) / 1000;
  const barKm = km > 20 ? 10 : 5, barPx = (barKm / km) * W;
  ctx.fillRect(20, H - 28, barPx, 5);
  ctx.textAlign = 'left'; ctx.font = '13px IBM Plex Sans';
  ctx.fillText(`${barKm} km`, 20, H - 36);
  return { lo, hi, km, steepPct: (100 * steep) / (n * n) };
}
