// "Stand here": first-person view from the landing site, 2 m above the ground.
// Local frame: x = east, y = up, z = south (so north is -z).
// The skyline ring is drawn from the computed terrain horizon (720 directions,
// out to 150 km), so what you see on the horizon is exactly what the numbers use.
// The Sun and Earth are at their true angular sizes (0.53° and 1.9°); Earth is
// lit by the same sunlight, so its phase is real.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const dir = (az, el) => new THREE.Vector3(Math.cos(el * D2R) * Math.sin(az * D2R), Math.sin(el * D2R), -Math.cos(el * D2R) * Math.cos(az * D2R));
const SKY_D = 1000; // km, distance at which Sun/Earth are drawn
const RING_D = 60; // km, distance of the skyline ring

function textSprite(text, color, size = 1) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '700 56px IBM Plex Sans, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 20;
  c.width = w; c.height = 72;
  g.font = '700 56px IBM Plex Sans, sans-serif';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(text, 10, 54);
  g.fillStyle = color; g.fillText(text, 10, 54);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.userData.aspect = w / 72; s.userData.size = size;
  s.renderOrder = 10;
  return s;
}

export class StandView {
  constructor(host) { this.host = host; this.ready = false; this.yaw = 0; this.pitch = 3; this.fov = 70; }

  init() {
    if (this.ready) return;
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 450;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio)); r.setSize(w, h);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.host.prepend(r.domElement);
    const sc = (this.scene = new THREE.Scene());
    sc.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(this.fov, w / h, 0.0005, 5000);
    this.camera.position.set(0, 0.002, 0);

    // stars
    const pts = []; let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4000; i++) { const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, q = Math.sqrt(1 - u * u); pts.push(3000 * q * Math.cos(t), 3000 * u, 3000 * q * Math.sin(t)); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xc8d0e8, size: 1.3, sizeAttenuation: false }));
    sc.add(this.stars);

    // sunlight (with shadows on the nearby terrain) and faint earthshine
    this.light = new THREE.DirectionalLight(0xfff6e8, 3.4);
    this.light.castShadow = true; this.light.shadow.mapSize.set(4096, 4096);
    const c = this.light.shadow.camera; c.left = -16; c.right = 16; c.top = 16; c.bottom = -16; c.near = 1; c.far = 400;
    this.light.shadow.bias = -0.0003; this.light.shadow.normalBias = 0.03;
    sc.add(this.light, this.light.target);
    this.earthshine = new THREE.HemisphereLight(0x6f8fbf, 0x000000, 0.05); sc.add(this.earthshine);

    // Sun: true-size disk + glow
    this.sunDisk = new THREE.Mesh(new THREE.SphereGeometry(SKY_D * Math.tan(0.2665 * D2R), 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff3d6 }));
    const gc = document.createElement('canvas'); gc.width = gc.height = 256;
    const gg = gc.getContext('2d'); const gr = gg.createRadialGradient(128, 128, 6, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,245,220,1)'); gr.addColorStop(0.08, 'rgba(255,225,150,0.9)'); gr.addColorStop(0.3, 'rgba(255,190,90,0.25)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
    gg.fillStyle = gr; gg.fillRect(0, 0, 256, 256);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.sunGlow.scale.set(520, 520, 1);
    sc.add(this.sunDisk, this.sunGlow);

    // Earth: true angular size, phase from the same sunlight
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(SKY_D * Math.tan(0.95 * D2R), 48, 32), new THREE.MeshStandardMaterial({ color: 0x4d95e8, roughness: 0.55, emissive: 0x0a1424 }));
    sc.add(this.earth);

    this.sunTag = textSprite('Sun', '#f5b841'); this.earthTag = textSprite('Earth', '#8cc8ff');
    sc.add(this.sunTag, this.earthTag);

    // compass labels on the horizon
    this.compass = new THREE.Group();
    for (const [az, t, big] of [[0, 'N', 1], [45, 'NE', 0], [90, 'E', 1], [135, 'SE', 0], [180, 'S', 1], [225, 'SW', 0], [270, 'W', 1], [315, 'NW', 0]]) {
      const s = textSprite(t, big ? '#e8ecf5' : '#7d88a3', big ? 1 : 0.7);
      s.userData.az = az; this.compass.add(s);
    }
    sc.add(this.compass);

    // dragging to look around
    const el = r.domElement; el.style.cursor = 'grab'; el.style.touchAction = 'none';
    let last = null;
    el.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
    el.addEventListener('pointermove', (e) => {
      if (!last) return;
      const k = this.fov / el.clientHeight;
      this.yaw = (this.yaw - (e.clientX - last[0]) * k + 360) % 360;
      this.pitch = Math.max(-30, Math.min(80, this.pitch + (e.clientY - last[1]) * k));
      last = [e.clientX, e.clientY]; this.aim();
    });
    el.addEventListener('pointerup', () => { last = null; el.style.cursor = 'grab'; });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.setFov(this.fov * (e.deltaY > 0 ? 1.1 : 0.9)); }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(this.host);
    const loop = () => { this.placeLabels(); r.render(sc, this.camera); requestAnimationFrame(loop); };
    loop();
    this.ready = true;
    this.aim();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h || !this.renderer) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setFov(f) { this.fov = Math.max(3, Math.min(90, f)); this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); this.onView?.(); }

  aim() {
    const t = dir(this.yaw, this.pitch).add(this.camera.position);
    this.camera.lookAt(t);
    this.onView?.();
  }

  lookAt(az, el, fov) { this.yaw = az; this.pitch = Math.max(-30, Math.min(80, el)); if (fov) this.setFov(fov); this.aim(); }

  // keep labels a constant size on screen, sitting just above their objects
  placeLabels() {
    const k = Math.tan((this.fov * D2R) / 2) * 0.11;
    const put = (s, v, dist, lift) => {
      const p = v.clone().multiplyScalar(dist);
      s.position.copy(p).add(new THREE.Vector3(0, dist * (k * lift), 0));
      const h = dist * k * 0.9 * s.userData.size;
      s.scale.set(h * s.userData.aspect, h, 1);
    };
    if (this.sunV) put(this.sunTag, this.sunV, SKY_D * 0.9, 1.6);
    if (this.earthV) put(this.earthTag, this.earthV, SKY_D * 0.9, 1.6);
    for (const s of this.compass.children) {
      const az = s.userData.az;
      const hz = this.hz ? this.hz[Math.round(az * 2) % this.hz.length] : 0;
      put(s, dir(az, Math.max(hz, 0) + 0.2), 900, 0.4);
    }
  }

  setSite(site, hz) {
    this.init();
    this.hz = hz;
    for (const o of [this.ground, this.ring]) if (o) { this.scene.remove(o); o.geometry.dispose(); }
    // nearby terrain (real LOLA patch) if available, else the bare curved surface
    let geo;
    if (site.terrain) {
      const { n, spacing_m: sp, h } = site.terrain;
      const half = ((n - 1) * sp) / 2000;
      geo = new THREE.PlaneGeometry(half * 2, half * 2, n - 1, n - 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) { const ix = k % n, iy = Math.floor(k / n); pos.setY(k, h[(n - 1 - iy) * n + ix] / 1000); }
    } else {
      geo = new THREE.CircleGeometry(40, 160, 0, Math.PI * 2);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) { const x = pos.getX(k), z = pos.getZ(k); pos.setY(k, -(x * x + z * z) / (2 * 1737.4)); }
    }
    geo.computeVertexNormals();
    if (!this.regolith) {
      // Generated regolith detail (visual only). The ground's shape and every shadow come from real LOLA terrain.
      const c = document.createElement('canvas'); c.width = c.height = 1024;
      const g = c.getContext('2d'); g.fillStyle = '#8d8a84'; g.fillRect(0, 0, 1024, 1024);
      let sd = 9; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 26000; i++) { const x = rnd() * 1024, y = rnd() * 1024, r = rnd() * rnd() * 9 + 0.6, k = 0.55 + rnd() * 0.6; g.fillStyle = `rgba(${Math.round(120 * k)},${Math.round(117 * k)},${Math.round(112 * k)},${0.3 + rnd() * 0.5})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      for (let i = 0; i < 350; i++) { const x = rnd() * 1024, y = rnd() * 1024, r = 6 + rnd() * rnd() * 40; g.fillStyle = `rgba(40,38,36,${0.18 + rnd() * 0.25})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.fillStyle = `rgba(210,205,195,${0.15 + rnd() * 0.2})`; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, Math.PI * 2); g.fill(); }
      const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
      this.regolith = { tex, bump };
    }
    const reps = site.terrain ? Math.round(((site.terrain.n - 1) * site.terrain.spacing_m) / 1000 / 0.5) : 80;
    const gm = new THREE.MeshStandardMaterial({ map: this.regolith.tex, bumpMap: this.regolith.bump, bumpScale: 0.004, roughness: 1, metalness: 0 });
    gm.map.repeat.set(reps, reps); gm.bumpMap.repeat.set(reps, reps);
    this.ground = new THREE.Mesh(geo, gm);
    this.ground.receiveShadow = true; this.ground.castShadow = !!site.terrain;
    this.scene.add(this.ground);
    // distant skyline from the computed horizon
    const n = hz.length, verts = [], idx = [];
    for (let k = 0; k <= n; k++) {
      const az = (k / n) * 360, e = hz[k % n];
      const top = dir(az, e).multiplyScalar(RING_D / Math.cos(e * D2R));
      const bot = dir(az, -8).multiplyScalar(RING_D / Math.cos(8 * D2R));
      verts.push(top.x, top.y + 0.002, top.z, bot.x, bot.y, bot.z);
      if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); rg.setIndex(idx); rg.computeVertexNormals();
    this.ring = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: this.regolith.tex, color: 0x9a968e, roughness: 1, side: THREE.DoubleSide }));
    this.scene.add(this.ring);
  }

  update(sunAz, sunEl, earthAz, earthEl, sunFrac = 1) {
    if (!this.ready) return;
    this.sunV = dir(sunAz, sunEl); this.earthV = dir(earthAz, earthEl);
    this.light.position.copy(this.sunV.clone().multiplyScalar(200));
    this.light.target.position.set(0, 0, 0);
    this.sunDisk.position.copy(this.sunV.clone().multiplyScalar(SKY_D));
    this.sunGlow.position.copy(this.sunV.clone().multiplyScalar(SKY_D * 0.99));
    // no atmosphere: no glow or twilight once the Sun is behind the terrain
    this.sunGlow.visible = sunFrac > 0;
    this.sunGlow.material.opacity = 0.35 + 0.65 * sunFrac;
    this.earth.position.copy(this.earthV.clone().multiplyScalar(SKY_D));
    // the ring is lit like terrain facing the observer: brighten it when the Sun is up
    this.ring.material.color.setHex(sunEl > -0.5 ? 0x77736d : 0x2a2a2e);
  }
}
