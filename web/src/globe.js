// The Moon as a globe, oriented in its real body-fixed frame (MOON_ME: x toward
// the mean Earth direction, z toward the north pole), lit by the real Sun
// direction at the chosen time. Earth sits in its real direction (distance not
// to scale). Candidate sites are clickable pins.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const D2R = Math.PI / 180;
const llv = (lat, lon, r = 1) => new THREE.Vector3(
  r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.cos(lat * D2R) * Math.sin(lon * D2R), r * Math.sin(lat * D2R));

function label(text, color = '#e8ecf5') {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '600 44px IBM Plex Sans, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = 64;
  g.font = '600 44px IBM Plex Sans, sans-serif';
  g.lineWidth = 10; g.strokeStyle = 'rgba(5,7,15,0.9)'; g.strokeText(text, 12, 46);
  g.fillStyle = color; g.fillText(text, 12, 46);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(w / 640, 64 / 640, 1);
  s.center.set(0, 0.5);
  s.renderOrder = 5;
  return s;
}

export class Globe {
  constructor(host, onPick) {
    this.host = host; this.onPick = onPick; this.pins = []; this.ready = false;
  }

  init() {
    if (this.ready) return;
    const w = this.host.clientWidth || 400, h = this.host.clientHeight || 400;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio)); r.setSize(w, h);
    this.host.append(r.domElement);
    const sc = (this.scene = new THREE.Scene());
    const cam = (this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100));
    cam.up.set(0, 0, 1);
    cam.position.copy(new THREE.Vector3(1.2, -0.9, -2.6).normalize().multiplyScalar(4.2));
    this.controls = new OrbitControls(cam, r.domElement);
    this.controls.enableDamping = true; this.controls.enablePan = false;
    this.controls.minDistance = 1.6; this.controls.maxDistance = 9;
    this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; clearTimeout(this._resume); });
    this.controls.addEventListener('end', () => { this._resume = setTimeout(() => (this.controls.autoRotate = true), 6000); });

    // Procedural regolith texture (visual only; the terrain maths uses real LOLA data)
    const tc = document.createElement('canvas'); tc.width = 2048; tc.height = 1024;
    const tg = tc.getContext('2d');
    tg.fillStyle = '#9a968e'; tg.fillRect(0, 0, 2048, 1024);
    let sd = 42; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) { const x = rnd() * 2048, y = rnd() * 1024, r = rnd() * rnd() * 28 + 1.5, d = 0.35 + rnd() * 0.5; tg.fillStyle = `rgba(${Math.round(60 * d)},${Math.round(58 * d)},${Math.round(55 * d)},${0.25 + rnd() * 0.35})`; tg.beginPath(); tg.arc(x, y, r, 0, Math.PI * 2); tg.fill(); tg.fillStyle = `rgba(230,225,215,${0.15 + rnd() * 0.25})`; tg.beginPath(); tg.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, Math.PI * 2); tg.fill(); }
    for (let i = 0; i < 14; i++) { const x = rnd() * 2048, y = 300 + rnd() * 400, r = 60 + rnd() * 150; tg.fillStyle = `rgba(55,55,62,${0.25 + rnd() * 0.2})`; tg.beginPath(); tg.ellipse(x, y, r * 1.4, r, rnd(), 0, Math.PI * 2); tg.fill(); }
    const tex = new THREE.CanvasTexture(tc); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat);
    this.moon.rotation.x = Math.PI / 2; // image poles onto the MOON_ME z axis; image centre (0° lon) onto +x
    // Real Moon: NASA SVS CGI Moon Kit (LRO LROC WAC colour mosaic + LOLA normal map), swapped in once loaded
    const base = import.meta.env.BASE_URL + 'textures/';
    const loader = new THREE.TextureLoader();
    loader.load(base + 'moon_color_4k.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.needsUpdate = true; });
    loader.load(base + 'moon_normal_2k.jpg', (t) => { mat.normalMap = t; mat.normalScale.set(1.2, 1.2); mat.needsUpdate = true; });
    sc.add(this.moon);
    // latitude circles near the south pole + prime meridian, to read position
    const lineMat = new THREE.LineBasicMaterial({ color: 0x5a6788, transparent: true, opacity: 0.55 });
    for (const lat of [-60, -70, -80]) {
      const pts = []; for (let k = 0; k <= 180; k++) pts.push(llv(lat, k * 2, 1.002));
      sc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    for (const lon of [0, 90, 180, 270]) {
      const pts = []; for (let k = -90; k <= 90; k += 2) pts.push(llv(k, lon, 1.002));
      sc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    const sp = label('South pole', '#c9d1e3'); sp.position.copy(llv(-90, 0, 1.06)); sc.add(sp);

    this.sun = new THREE.DirectionalLight(0xffffff, 3.2); sc.add(this.sun);
    sc.add(new THREE.AmbientLight(0x8899bb, 0.12));
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(0.367, 48, 32), new THREE.MeshStandardMaterial({ color: 0x3d86d9, roughness: 0.7 }));
    sc.add(this.earth);
    this.earthLabel = label('Earth (not to scale)', '#8cc8ff'); sc.add(this.earthLabel);
    this.sunArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.9, 0xf5b841, 0.12, 0.07);
    sc.add(this.sunArrow);
    this.sunLabel = label('Sunlight', '#f5b841'); sc.add(this.sunLabel);

    const ray = new THREE.Raycaster(); const m = new THREE.Vector2();
    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    r.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const b = r.domElement.getBoundingClientRect();
      m.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(m, cam);
      const hit = ray.intersectObjects(this.pins.map((p) => p.hit))[0];
      if (hit) this.onPick?.(hit.object.userData.id);
    });
    r.domElement.style.cursor = 'grab';
    new ResizeObserver(() => this.resize()).observe(this.host);
    const loop = () => { this.controls.update(); r.render(sc, cam); requestAnimationFrame(loop); };
    loop();
    this.ready = true;
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h || !this.renderer) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setSites(list, selected) {
    this.init();
    for (const p of this.pins) this.scene.remove(p.group);
    this.pins = [];
    for (const s of list) {
      const sel = selected.indexOf(s.id);
      const g = new THREE.Group();
      const color = sel === 0 ? 0xf5b841 : sel > 0 ? 0xffffff : 0x9aa6c4;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(sel >= 0 ? 0.026 : 0.017, 16, 12), new THREE.MeshBasicMaterial({ color }));
      dot.position.copy(llv(s.lat, s.lon, 1.004));
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(dot.position); hit.userData.id = s.id;
      g.add(dot, hit);
      if (sel >= 0 || s.kind === 'mission') {
        const l = label(sel >= 0 ? `${sel + 1}  ${s.name}` : s.name, sel === 0 ? '#f5b841' : '#e8ecf5');
        l.position.copy(llv(s.lat, s.lon, 1.05));
        g.add(l);
      }
      this.scene.add(g);
      this.pins.push({ group: g, hit });
    }
  }

  // sun / earth: Moon-centred vectors in MOON_ME (km)
  update(sunV, earthV) {
    if (!this.ready) return;
    const s = new THREE.Vector3(...sunV).normalize();
    const e = new THREE.Vector3(...earthV).normalize();
    this.sun.position.copy(s.clone().multiplyScalar(10));
    this.earth.position.copy(e.clone().multiplyScalar(5.5));
    this.earthLabel.position.copy(e.clone().multiplyScalar(5.5).add(new THREE.Vector3(0, 0, 0.5)));
    this.sunArrow.position.copy(s.clone().multiplyScalar(1.15));
    this.sunArrow.setDirection(s.clone().negate());
    this.sunArrow.position.copy(s.clone().multiplyScalar(3.1));
    this.sunLabel.position.copy(s.clone().multiplyScalar(3.2));
  }
}
