// Nova Strike – 3D-Darstellung, Steuerung, Waffen und Netzwerk im Browser.
import * as THREE from 'three';
import { BOXES, ARENA } from '../shared/map.js';
import { PLAYER, MOVE, step, accelerate, rayMap, rayPlayer } from '../shared/physics.js';
import { WEAPONS, WEAPON_ORDER } from '../shared/weapons.js';

const $ = (id) => document.getElementById(id);
const INTERP = 120;
const SEND_HZ = 15;
const SUN_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
const SETTINGS_KEY = 'eclipse-arena-settings';

function loadSettings() {
  const def = { sens: 1, fov: 85, vol: 0.6, invert: false, assist: null };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return def; }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Game {
  constructor(canvas, sfx, ui) {
    this.canvas = canvas;
    this.sfx = sfx;
    this.ui = ui;
    this.settings = loadSettings();
    this.mode = 'menu';
    this.keys = new Set();
    this.remotes = new Map();
    this.roster = new Map();
    this.fx = [];
    this.clock = performance.now();
    this.menuT = 0;
    this.fpsT = 0; this.fpsN = 0; this.fps = 0;

    this.coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.coarse, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.coarse ? 1.5 : 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.3;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#160f2a', 0.0115);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.wScene = new THREE.Scene();
    this.wCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);

    this.buildWorld();
    this.buildViewmodels();
    this.buildFx();
    this.resetLocal();
    this.bindInput();
    this.bindTouch();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.buildWeaponHud();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // =====================================================================
  // Welt
  // =====================================================================
  tex(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  panelTex(base, line, accent) {
    return this.tex(256, (x, s) => {
      x.fillStyle = base; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        const v = Math.random() * 22 - 11;
        x.fillStyle = v > 0 ? `rgba(255,255,255,${v / 300})` : `rgba(0,0,0,${-v / 160})`;
        x.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      x.strokeStyle = line; x.lineWidth = 3;
      x.strokeRect(1.5, 1.5, s - 3, s - 3);
      x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, s / 2); x.lineTo(s, s / 2); x.stroke();
      x.fillStyle = line;
      for (const [a, b] of [[12, 12], [s - 12, 12], [12, s - 12], [s - 12, s - 12]]) { x.beginPath(); x.arc(a, b, 3, 0, 7); x.fill(); }
      if (accent) { x.fillStyle = accent; x.fillRect(0, s / 2 - 5, s * 0.3, 3); }
    });
  }

  boxGeo(w, h, d, scale = 0.5) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, uv.getX(k) * dims[f][0] * scale, uv.getY(k) * dims[f][1] * scale);
      }
    }
    return g;
  }

  buildWorld() {
    const s = this.scene;
    // Himmel mit Sonnenfinsternis
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(vec3(0.13,0.08,0.24), vec3(0.012,0.01,0.03), smoothstep(-0.05, 0.55, h));
          col += vec3(0.32,0.14,0.30) * pow(max(0.0, 1.0 - abs(h)), 8.0) * 0.7;
          float a = acos(clamp(dot(d, sunDir), -1.0, 1.0));
          float R = 0.055;
          float corona = a > R ? exp(-(a - R) * 26.0) : 0.0;
          col += vec3(1.0, 0.75, 0.45) * corona * 1.5 + vec3(0.55, 0.4, 0.95) * exp(-a * 3.5) * 0.45;
          col += vec3(1.0, 0.92, 0.8) * smoothstep(0.006, 0.0, abs(a - R)) * 2.5;
          if (a < R) col = vec3(0.004, 0.003, 0.008);
          vec3 cell = floor(d * 320.0);
          float n = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          col += vec3(0.85, 0.85, 1.0) * step(0.9982, n) * smoothstep(0.02, 0.35, h) * (a > 0.3 ? 1.0 : 0.0);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    sky.renderOrder = -1;
    s.add(sky);
    this.sky = sky;

    s.add(new THREE.HemisphereLight('#8f8ad6', '#2a2238', 2.1));
    s.add(new THREE.AmbientLight('#ffffff', 0.35));
    const sun = new THREE.DirectionalLight('#ffd9b5', 2.4);
    sun.position.copy(SUN_DIR).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(this.coarse ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 10; sc.far = 300;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    s.add(sun);
    this.flashLight = new THREE.PointLight('#ffcf8a', 0, 9, 2);
    s.add(this.flashLight);

    // Boden
    const floorTex = this.tex(512, (x, n) => {
      x.fillStyle = '#1b1830'; x.fillRect(0, 0, n, n);
      for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; x.fillRect(Math.random() * n, Math.random() * n, 2, 2); }
      x.strokeStyle = '#2d2850'; x.lineWidth = 4; x.strokeRect(2, 2, n - 4, n - 4);
      x.lineWidth = 2; x.strokeStyle = '#25213f';
      x.beginPath(); x.moveTo(n / 2, 0); x.lineTo(n / 2, n); x.moveTo(0, n / 2); x.lineTo(n, n / 2); x.stroke();
      x.fillStyle = 'rgba(167,139,250,0.35)'; x.fillRect(0, 0, n * 0.18, 3);
    });
    floorTex.repeat.set(70, 70);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.15 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);

    // Mittlerer Leuchtring am Boden
    const ring = new THREE.Mesh(new THREE.RingGeometry(9.5, 9.8, 64), new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.55 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    s.add(ring);

    const mats = {
      outer: new THREE.MeshStandardMaterial({ map: this.panelTex('#24223a', '#1a1830', '#a78bfa'), roughness: 0.8, metalness: 0.2 }),
      wall: new THREE.MeshStandardMaterial({ map: this.panelTex('#45415f', '#35324d'), roughness: 0.85, metalness: 0.1 }),
      plat: new THREE.MeshStandardMaterial({ map: this.panelTex('#343b5c', '#262c47', '#f5b26b'), roughness: 0.55, metalness: 0.45 }),
      step: new THREE.MeshStandardMaterial({ map: this.panelTex('#3a4263', '#2a3150'), roughness: 0.55, metalness: 0.45 }),
      cover: new THREE.MeshStandardMaterial({ map: this.panelTex('#5a5276', '#463f60'), roughness: 0.7, metalness: 0.2 }),
      pillar: new THREE.MeshStandardMaterial({ map: this.panelTex('#2a2740', '#1e1b31'), roughness: 0.6, metalness: 0.4 }),
      crateA: new THREE.MeshStandardMaterial({ map: this.crateTex('#c4762f', '#7a4318'), roughness: 0.7, metalness: 0.1 }),
      crateB: new THREE.MeshStandardMaterial({ map: this.crateTex('#2f8a8f', '#164a4e'), roughness: 0.7, metalness: 0.1 }),
    };
    const edgeMat = new THREE.LineBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.4 });
    const glowMat = new THREE.MeshBasicMaterial({ color: '#b59cff' });
    const amberMat = new THREE.MeshBasicMaterial({ color: '#ffb46b' });
    BOXES.forEach((b, i) => {
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const mat = b.k === 'crate' ? (i % 2 ? mats.crateA : mats.crateB) : mats[b.k] || mats.wall;
      const m = new THREE.Mesh(this.boxGeo(w, h, d, b.k === 'crate' ? 1 / Math.max(w, h, d) : 0.5), mat);
      m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      m.castShadow = b.k !== 'outer';
      m.receiveShadow = true;
      s.add(m);
      if (b.k === 'plat' || b.k === 'cover') {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat);
        e.position.copy(m.position);
        s.add(e);
      }
      if (b.k === 'outer') {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.12, d + 0.04), glowMat);
        strip.position.set(m.position.x, 2.2, m.position.z);
        s.add(strip);
      }
      if (b.k === 'pillar') {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.18, d + 0.06), amberMat);
        band.position.set(m.position.x, b.max[1] - 0.6, m.position.z);
        s.add(band);
      }
    });

    // Kraterrand in der Ferne
    const rockMat = new THREE.MeshStandardMaterial({ color: '#1c1830', roughness: 1, flatShading: true });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.1;
      const rr = 120 + Math.random() * 90;
      const h = 18 + Math.random() * 45;
      const m = new THREE.Mesh(new THREE.ConeGeometry(14 + Math.random() * 22, h, 5 + Math.floor(Math.random() * 3)), rockMat);
      m.position.set(Math.cos(a) * rr, h / 2 - 2, Math.sin(a) * rr);
      m.rotation.y = Math.random() * 3;
      s.add(m);
    }
  }

  crateTex(base, dark) {
    return this.tex(256, (x, n) => {
      x.fillStyle = base; x.fillRect(0, 0, n, n);
      for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; x.fillRect(Math.random() * n, Math.random() * n, 3, 3); }
      x.strokeStyle = dark; x.lineWidth = 22; x.strokeRect(11, 11, n - 22, n - 22);
      x.lineWidth = 12; x.beginPath(); x.moveTo(22, 22); x.lineTo(n - 22, n - 22); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.5)'; x.font = 'bold 26px sans-serif'; x.fillText('NOVA', n - 92, n - 34);
    });
  }

  // =====================================================================
  // Waffenmodelle in der Hand
  // =====================================================================
  buildViewmodels() {
    const ws = this.wScene;
    ws.add(new THREE.HemisphereLight('#c9c2f0', '#3a3050', 2.2));
    const dl = new THREE.DirectionalLight('#ffe2c4', 2.2);
    dl.position.set(1, 2, 1);
    ws.add(dl);
    this.vmLight = new THREE.PointLight('#ffcf8a', 0, 3, 2);
    this.vmLight.position.set(0.2, -0.1, -0.9);
    ws.add(this.vmLight);

    const metal = new THREE.MeshStandardMaterial({ color: '#5a5870', roughness: 0.45, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2c2a38', roughness: 0.55, metalness: 0.2 });
    const glow = new THREE.MeshBasicMaterial({ color: '#b59cff' });
    const amber = new THREE.MeshBasicMaterial({ color: '#ffb46b' });
    this.gloveMat = new THREE.MeshStandardMaterial({ color: '#a78bfa', roughness: 0.6 });
    const B = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
    const C = (r, l, m, x, y, z) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); return o; };

    const rifle = new THREE.Group();
    rifle.add(B(0.09, 0.12, 0.55, metal, 0, 0, -0.25), C(0.022, 0.38, dark, 0, 0.01, -0.7), B(0.06, 0.2, 0.1, dark, 0, -0.14, -0.18),
      B(0.07, 0.1, 0.22, dark, 0, -0.02, 0.12), B(0.094, 0.018, 0.36, glow, 0, 0.035, -0.28), B(0.03, 0.05, 0.08, dark, 0, 0.09, -0.12),
      B(0.08, 0.1, 0.1, this.gloveMat, 0, -0.09, -0.02), B(0.08, 0.08, 0.12, this.gloveMat, 0, -0.06, -0.42));
    rifle.userData = { tip: new THREE.Vector3(0, 0.01, -0.9), ads: new THREE.Vector3(0, -0.105, -0.32) };

    const sniper = new THREE.Group();
    sniper.add(B(0.08, 0.11, 0.75, metal, 0, 0, -0.3), C(0.02, 0.62, dark, 0, 0.01, -0.98), C(0.038, 0.32, dark, 0, 0.1, -0.25),
      B(0.07, 0.12, 0.26, dark, 0, -0.03, 0.18), B(0.082, 0.016, 0.5, amber, 0, 0.03, -0.35), B(0.05, 0.14, 0.08, dark, 0, -0.12, -0.12),
      B(0.08, 0.1, 0.1, this.gloveMat, 0, -0.09, 0.0), B(0.08, 0.08, 0.12, this.gloveMat, 0, -0.06, -0.55));
    sniper.userData = { tip: new THREE.Vector3(0, 0.01, -1.3), ads: new THREE.Vector3(0, -0.2, -0.3) };

    const shotgun = new THREE.Group();
    shotgun.add(B(0.13, 0.14, 0.5, metal, 0, 0, -0.22), C(0.026, 0.42, dark, -0.03, 0.03, -0.66), C(0.026, 0.42, dark, 0.03, 0.03, -0.66),
      B(0.11, 0.08, 0.2, dark, 0, -0.04, -0.6), B(0.08, 0.12, 0.24, dark, 0, -0.03, 0.14), B(0.135, 0.02, 0.3, glow, 0, 0.06, -0.2),
      B(0.09, 0.11, 0.1, this.gloveMat, 0, -0.1, 0.0), B(0.09, 0.09, 0.12, this.gloveMat, 0, -0.08, -0.6));
    shotgun.userData = { tip: new THREE.Vector3(0, 0.03, -0.9), ads: new THREE.Vector3(0, -0.11, -0.34) };

    this.vms = { rifle, sniper, shotgun };
    this.vmRoot = new THREE.Group();
    this.vmRoot.scale.setScalar(0.85);
    ws.add(this.vmRoot);
    for (const g of Object.values(this.vms)) { g.visible = false; this.vmRoot.add(g); }

    const flashTex = this.tex(64, (x, n) => {
      const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.25, 'rgba(255,200,120,0.9)'); g.addColorStop(1, 'rgba(255,120,40,0)');
      x.fillStyle = g; x.fillRect(0, 0, n, n);
    });
    this.flashTex = flashTex;
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.muzzle.scale.set(0.3, 0.3, 1);
    this.muzzle.visible = false;
    this.vmRoot.add(this.muzzle);
  }

  // =====================================================================
  // Effekte: Leuchtspuren, Einschläge
  // =====================================================================
  buildFx() {
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerGeo.translate(0, 0, -0.5);
    this.tracers = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: '#ffd59a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.frustumCulled = false;
      this.scene.add(m);
      this.tracers.push(m);
    }
    this.sparks = [];
    for (let i = 0; i < 60; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.visible = false;
      this.scene.add(sp);
      this.sparks.push(sp);
    }
    this.ti = 0; this.si = 0;
  }

  tracer(from, to, color = '#ffd59a', width = 0.03) {
    const m = this.tracers[this.ti++ % this.tracers.length];
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(width, width, len);
    m.material.color.set(color);
    m.material.opacity = 0.9;
    m.visible = true;
    this.addFx(90, (k) => { m.material.opacity = 0.9 * (1 - k); }, () => { m.visible = false; });
  }

  spark(pos, color = '#ffc07a', size = 0.5, dur = 180) {
    const sp = this.sparks[this.si++ % this.sparks.length];
    sp.position.copy(pos);
    sp.material.color.set(color);
    sp.material.rotation = Math.random() * 6;
    sp.visible = true;
    this.addFx(dur, (k) => { const s = size * (0.6 + k * 0.8); sp.scale.set(s, s, 1); sp.material.opacity = 1 - k; }, () => { sp.visible = false; });
  }

  addFx(dur, update, done) { this.fx.push({ t0: performance.now(), dur, update, done }); }

  // =====================================================================
  // Spielerfiguren
  // =====================================================================
  makeAvatar(info) {
    const g = new THREE.Group();
    const col = new THREE.Color(info.color);
    const suit = new THREE.MeshStandardMaterial({ color: '#2b2938', roughness: 0.65, metalness: 0.3 });
    const paint = new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.2, emissive: col, emissiveIntensity: 0.18 });
    const glow = new THREE.MeshBasicMaterial({ color: col });
    const B = (w, h, d, m, x, y, z, parent = g) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
    };
    const legL = new THREE.Group(); legL.position.set(-0.14, 0.78, 0); g.add(legL);
    const legR = new THREE.Group(); legR.position.set(0.14, 0.78, 0); g.add(legR);
    B(0.2, 0.78, 0.24, suit, 0, -0.39, 0, legL);
    B(0.2, 0.78, 0.24, suit, 0, -0.39, 0, legR);
    B(0.21, 0.2, 0.25, paint, 0, -0.5, 0, legL);
    B(0.21, 0.2, 0.25, paint, 0, -0.5, 0, legR);
    B(0.62, 0.62, 0.36, suit, 0, 1.08, 0);
    B(0.5, 0.34, 0.06, paint, 0, 1.15, -0.19);
    B(0.4, 0.4, 0.14, suit, 0, 1.1, 0.24);
    B(0.06, 0.3, 0.02, glow, 0, 1.12, 0.32);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), suit);
    head.position.y = 1.62; head.castShadow = true; g.add(head);
    B(0.32, 0.09, 0.06, glow, 0, 1.64, -0.2);
    const aim = new THREE.Group(); aim.position.set(0, 1.32, 0); g.add(aim);
    B(0.16, 0.16, 0.5, paint, 0.32, -0.08, -0.2, aim);
    B(0.16, 0.16, 0.45, suit, -0.3, -0.1, -0.22, aim);
    B(0.1, 0.13, 0.75, new THREE.MeshStandardMaterial({ color: '#16151d', metalness: 0.6, roughness: 0.4 }), 0.12, -0.05, -0.5, aim);
    B(0.104, 0.02, 0.5, glow, 0.12, 0.02, -0.5, aim);

    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    shield.position.y = 0.95; shield.visible = false; g.add(shield);

    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.font = '700 52px Rajdhani, Inter, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 9; x.strokeStyle = 'rgba(0,0,0,0.8)'; x.strokeText(info.name, 256, 48);
    x.fillStyle = info.bot ? '#cbd5e1' : info.color; x.fillText(info.name, 256, 48);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    tag.material.map.colorSpace = THREE.SRGBColorSpace;
    tag.scale.set(2.2, 0.41, 1); tag.position.y = 2.2;
    g.add(tag);
    this.scene.add(g);
    return { g, legL, legR, aim, shield, tag, paint };
  }

  addRemote(info) {
    if (info.id === this.myId || this.remotes.has(info.id)) return;
    const av = this.makeAvatar(info);
    av.g.visible = false;
    this.remotes.set(info.id, { id: info.id, av, buf: [], alive: false, prot: false, walk: 0, deadAt: 0, last: null, stepAcc: 0 });
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.av.g);
    r.av.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    this.remotes.delete(id);
  }

  // =====================================================================
  // Lokaler Spieler
  // =====================================================================
  resetLocal() {
    this.body = { p: [0, 0, 20], v: [0, 0, 0], onGround: true };
    this.yaw = 0; this.pitch = 0; this.kick = 0; this.kickYaw = 0;
    this.alive = false; this.hp = 100; this.sq = 0; this.prot = false;
    this.wi = 0; this.lastWi = 1;
    this.ammo = Object.fromEntries(WEAPON_ORDER.map((k) => [k, WEAPONS[k].mag]));
    this.reloadUntil = 0; this.switchUntil = 0; this.nextFire = 0;
    this.firing = false; this.ads = false; this.adsK = 0;
    this.sendAcc = 0; this.stepAcc = 0; this.bob = 0; this.landDip = 0;
    this.vmKick = 0; this.vmSwayX = 0; this.vmSwayY = 0;
    this.deathAt = 0; this.killerId = 0;
    this.eyeY = 0;
  }

  get weapon() { return WEAPONS[WEAPON_ORDER[this.wi]]; }

  // =====================================================================
  // Eingabe
  // =====================================================================
  bindInput() {
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) { this.keys.clear(); this.firing = false; this.ads = false; }
      if (this.mode === 'game' && !this.locked) {
        if (this.chatting) this.closeChat();
        this.ui.onPause();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.mode !== 'game') return;
      const zoom = this.camera.fov / this.settings.fov;
      const k = 0.0022 * this.settings.sens * zoom * (this.assistSlow || 1);
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k * (this.settings.invert ? -1 : 1);
      this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));
      this.vmSwayX += e.movementX * 0.00025;
      this.vmSwayY += e.movementY * 0.00025;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.active()) return;
      if (e.button === 0) { this.firing = true; this.semiReady = true; }
      if (e.button === 2) this.ads = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.ads = false;
    });
    document.addEventListener('contextmenu', (e) => { if (this.mode === 'game') e.preventDefault(); });
    document.addEventListener('wheel', (e) => {
      if (!this.active()) return;
      this.switchWeapon((this.wi + (e.deltaY > 0 ? 1 : -1) + WEAPON_ORDER.length) % WEAPON_ORDER.length);
    }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (this.mode !== 'game') return;
      if (this.chatting) {
        if (e.code === 'Enter' || e.key === 'Enter') { this.sendChat(); e.preventDefault(); }
        return;
      }
      if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').hidden = false; this.renderScoreboard(); return; }
      if (!this.active()) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.reload();
      if (e.code.startsWith('Digit')) { const n = Number(e.code.slice(5)) - 1; if (n >= 0 && n < WEAPON_ORDER.length) this.switchWeapon(n); }
      if (e.code === 'KeyQ') this.switchWeapon(this.lastWi);
      if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); this.openChat(); }
      if (e.code === 'Space') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') $('scoreboard').hidden = true;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.firing = false; });
  }

  // =====================================================================
  // Touch-Steuerung (Handy / Tablet)
  // =====================================================================
  bindTouch() {
    const T = this.touch = { on: false, joyId: null, jx: 0, jy: 0, ox: 0, oy: 0, look: new Map(), jump: false };
    const joy = $('t-joy'), knob = $('t-knob');
    const R = 56;
    const enable = () => {
      if (T.on) return;
      T.on = true;
      document.body.classList.add('touch');
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.resize();
    };
    window.addEventListener('touchstart', enable, { passive: true, capture: true });
    if (this.coarse) enable();

    const disable = () => {
      if (!T.on) return;
      T.reset();
      T.on = false;
      document.body.classList.remove('touch');
    };
    // Echte Maus benutzt (z. B. Laptop mit Touchscreen) → zurück zur Maus-/Tastatursteuerung
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') disable(); }, { capture: true });
    const resetJoy = () => {
      T.joyId = null; T.jx = 0; T.jy = 0;
      joy.classList.remove('on');
      joy.style.left = ''; joy.style.top = '';
      knob.style.transform = 'translate(-50%, -50%)';
    };
    const look = (t) => {
      const prev = T.look.get(t.identifier);
      if (!prev) return;
      const dx = t.clientX - prev.x, dy = t.clientY - prev.y;
      prev.x = t.clientX; prev.y = t.clientY;
      if (!this.alive || this.chatting) return;
      const zoom = this.camera.fov / this.settings.fov;
      const k = 0.0058 * this.settings.sens * zoom * (this.assistSlow || 1);
      this.yaw -= dx * k;
      this.pitch -= dy * k * (this.settings.invert ? -1 : 1);
      this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));
      this.vmSwayX += dx * 0.0004;
      this.vmSwayY += dy * 0.0004;
    };
    // Nur Berührungen im Spielbild auswerten (Menüs und Pause bleiben normal bedienbar)
    const inGame = (e) => this.mode === 'game' && e.target && e.target.closest && (e.target.closest('#hud') || e.target.id === 'view');
    const start = (e) => {
      if (!inGame(e) || e.target.closest('#chatinput')) return;
      enable();
      e.preventDefault();
      this.sfx.init();
      for (const t of e.changedTouches) {
        const btn = t.target.closest && t.target.closest('[data-t]');
        if (btn) {
          btn.classList.add('down');
          T.btn = T.btn || new Map();
          T.btn.set(t.identifier, btn);
          this.touchButton(btn.dataset.t, true);
          // Mit dem Feuerknopf kann man gleichzeitig zielen
          if (btn.dataset.t === 'fire') T.look.set(t.identifier, { x: t.clientX, y: t.clientY });
          continue;
        }
        if (T.joyId === null && t.clientX < window.innerWidth * 0.42) {
          T.joyId = t.identifier; T.ox = t.clientX; T.oy = t.clientY;
          joy.style.left = t.clientX + 'px';
          joy.style.top = t.clientY + 'px';
          joy.classList.add('on');
        } else {
          T.look.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      }
    };
    const move = (e) => {
      if (!inGame(e) || !T.on) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === T.joyId) {
          let dx = t.clientX - T.ox, dy = t.clientY - T.oy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
          T.jx = dx / R; T.jy = dy / R;
          if (Math.hypot(T.jx, T.jy) < 0.12) { T.jx = 0; T.jy = 0; }
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        } else look(t);
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.joyId) resetJoy();
        T.look.delete(t.identifier);
        const btn = T.btn && T.btn.get(t.identifier);
        if (btn) {
          btn.classList.remove('down');
          T.btn.delete(t.identifier);
          this.touchButton(btn.dataset.t, false);
        }
      }
    };
    window.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    T.reset = () => { resetJoy(); T.look.clear(); T.jump = false; this.firing = false; if (T.btn) { for (const b of T.btn.values()) b.classList.remove('down'); T.btn.clear(); } };
    $('chatinput').addEventListener('blur', () => { if (this.chatting && this.touch.on) this.closeChat(); });
  }

  touchButton(act, down) {
    switch (act) {
      case 'fire': this.firing = down; if (down) this.semiReady = true; break;
      case 'jump': this.touch.jump = down; break;
      case 'ads': if (down) this.ads = !this.ads; break;
      case 'reload': if (down) this.reload(); break;
      case 'swap': if (down) this.switchWeapon((this.wi + 1) % WEAPON_ORDER.length); break;
      case 'pause': if (down) { this.touch.reset(); this.ui.onPause(); } break;
      case 'score': if (down) { const sb = $('scoreboard'); sb.hidden = !sb.hidden; if (!sb.hidden) this.renderScoreboard(); } break;
      case 'chat': if (down) { this.touch.reset(); this.openChat(); } break;
      default: break;
    }
  }

  // =====================================================================
  // Zielhilfe (für alle Spieler gleich, im Pausemenü einstellbar)
  // Stufe 0 = aus, 1 = schwach, 2 = mittel, 3 = stark, 4 = automatisch (zielt selbst)
  // =====================================================================
  assistLevel() {
    const a = this.settings.assist;
    return a === null || a === undefined ? 4 : a;
  }

  updateAssist(dt, act) {
    this.assistSlow = 1;
    this.onTarget = false;
    const lvl = this.assistLevel();
    if (!act || !lvl || (this.match && this.match.state !== 'live')) return;
    const auto = lvl >= 4;
    const cone = [0, 0.07, 0.11, 0.16, 0][lvl];    // Fangbereich (Bogenmaß)
    const slow = [0, 0.25, 0.4, 0.55, 0.7][lvl];   // Abbremsen über dem Gegner
    const pull = [0, 1.2, 2.6, 4.5, 0][lvl];       // Zug Richtung Gegner (rad/s)
    const w = this.weapon;
    const maxD = Math.min(w.range, w.key === 'sniper' ? 200 : auto ? 90 : 70);
    // Automatisch: alles im sichtbaren Bildausschnitt (etwas kleiner als das Sichtfeld)
    const autoCone = (this.camera.fov * Math.PI / 180) * 0.5 * 0.9;
    const eye = this.camera.position;
    const o = [eye.x, eye.y, eye.z];
    let best = null;
    for (const r of this.remotes.values()) {
      if (!r.alive || r.prot || !r.av.g.visible) continue;
      const p = r.av.g.position;
      const tx = p.x, ty = p.y + 1.25, tz = p.z;
      const dx = tx - eye.x, dy = ty - eye.y, dz = tz - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > maxD || dist < 0.5) continue;
      const ry = Math.atan2(-dx, -dz), rx = Math.atan2(dy, Math.hypot(dx, dz));
      let ey = ry - this.yaw;
      while (ey > Math.PI) ey -= Math.PI * 2;
      while (ey < -Math.PI) ey += Math.PI * 2;
      const ex = rx - this.pitch;
      // Auf Entfernung wird der Fangbereich etwas kleiner, aus der Nähe größer
      const c = auto ? autoCone : cone * Math.min(1.6, Math.max(0.6, 12 / dist));
      const err = Math.hypot(ey, ex);
      if (err > c) continue;
      if (rayMap(o, [dx / dist, dy / dist, dz / dist], dist, BOXES) < dist - 0.4) continue;
      // Beim aktuellen Ziel bleiben, solange es sichtbar ist (kein Hin- und Herspringen)
      const score = err - (r.id === this.assistTarget ? 0.25 : 0);
      if (!best || score < best.score) best = { err, ey, ex, c, score, id: r.id };
    }
    this.assistTarget = best ? best.id : 0;
    if (!best) return;
    if (auto) {
      this.onTarget = best.err < 0.05;
      this.assistSlow = 1 - slow;
      const k = Math.min(1, dt * 14);
      this.yaw += best.ey * k;
      this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch + best.ex * k));
      return;
    }
    this.onTarget = best.err < best.c * 0.5;
    this.assistSlow = 1 - slow;
    const looking = this.firing || Math.hypot(this.body.v[0], this.body.v[2]) > 1 || (this.touch.on && this.touch.look.size > 0);
    const k = Math.min(1, pull * dt * (looking ? 1 : 0.35) * (this.firing ? 1.4 : 1) / Math.max(best.err, 0.02));
    this.yaw += best.ey * k;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch + best.ex * k));
  }

  active() { return this.mode === 'game' && (this.locked || this.debugActive || this.touch.on); }

  lock() {
    if (this.touch.on && this.coarse) {
      // Auf Handy/Tablet gibt es keine Mausfixierung – stattdessen Vollbild versuchen
      const de = document.documentElement;
      if (!document.fullscreenElement && de.requestFullscreen) de.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      return;
    }
    const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch {} });
  }

  openChat() {
    this.chatting = true;
    this.keys.clear(); this.firing = false;
    const i = $('chatinput');
    i.hidden = false; i.value = '';
    if (this.touch.on) i.focus(); else setTimeout(() => i.focus(), 0);
  }

  closeChat() {
    this.chatting = false;
    const i = $('chatinput');
    i.blur(); i.hidden = true;
  }

  sendChat() {
    const msg = $('chatinput').value.trim();
    if (msg) this.net({ t: 'chat', msg });
    this.closeChat();
  }

  switchWeapon(i) {
    if (i === this.wi || !this.alive) return;
    this.lastWi = this.wi;
    this.wi = i;
    this.reloadUntil = 0;
    this.switchUntil = performance.now() + 380;
    this.sfx.swap();
    this.updateWeaponHud();
  }

  reload() {
    const w = this.weapon, now = performance.now();
    if (!this.alive || this.reloadUntil > now || this.ammo[w.key] >= w.mag) return;
    this.reloadUntil = now + w.reload * 1000;
    this.reloadKey = w.key;
    this.sfx.reload(w.reload);
  }

  // =====================================================================
  // Netzwerk
  // =====================================================================
  join(room) {
    this.leave(true);
    this.resetLocal();
    this.room = room;
    this.mode = 'game';
    this.connected = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = this.ws = new WebSocket(`${proto}://${location.host}/api/ws?room=${encodeURIComponent(room)}`);
    this.lastError = '';
    ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      const why = this.lastError || (this.connected ? 'Verbindung zum Server verloren.' : 'Verbindung fehlgeschlagen. Bist du noch angemeldet?');
      this.leave(true);
      this.ui.onLeave(why, e.code);
    };
    $('hud').hidden = false;
    $('chatlog').innerHTML = '';
    $('killfeed').innerHTML = '';
    $('endscreen').hidden = true;
    $('death').hidden = true;
    this.updateWeaponHud();
  }

  leave(silent = false) {
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(1000); } catch {} }
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.roster.clear();
    this.mode = 'menu';
    this.alive = false;
    this.closeChat();
    if (this.touch) this.touch.reset();
    $('hud').hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    if (!silent) this.ui.onLeave('', 1000);
  }

  net(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  serverNow() { return performance.now() + (this.offset || 0); }

  onMsg(m) {
    switch (m.t) {
      case 'welcome': {
        this.connected = true;
        this.myId = m.you;
        this.offset = m.st - performance.now();
        this.match = m.match;
        this.roster.clear();
        for (const p of m.players) { this.roster.set(p.id, { ...p, ping: 0 }); this.addRemote(p); }
        this.spawnSelf(m.spawn);
        $('sb-room').textContent = 'Raum ' + m.room;
        this.sysChat(this.touch.on
          ? `Willkommen in ${m.room}! Links = Joystick zum Laufen, rechts wischen = Zielen.`
          : `Willkommen in ${m.room}! WASD = Laufen, Maus = Zielen, Enter = Chat, Tab = Punktestand.`);
        if (m.match.state === 'end') this.showEnd({ ranking: [], winner: 0, nextAt: m.match.nextAt });
        this.ui.onJoined();
        break;
      }
      case 'join':
        this.roster.set(m.p.id, { ...m.p, ping: 0 });
        this.addRemote(m.p);
        if (!m.p.bot) this.sysChat(`${m.p.name} ist beigetreten`);
        break;
      case 'leave': {
        const p = this.roster.get(m.id);
        if (p && !p.bot) this.sysChat(`${p.name} hat den Raum verlassen`);
        this.roster.delete(m.id);
        this.removeRemote(m.id);
        break;
      }
      case 's': {
        const sample = m.st - performance.now();
        if (this.offset === undefined) this.offset = sample;
        else this.offset = sample > this.offset ? this.offset * 0.7 + sample * 0.3 : this.offset * 0.98 + sample * 0.02;
        for (const e of m.p) {
          const [id, x, y, z, ry, rx, hp, alive, w, prot] = e;
          if (id === this.myId) {
            if (hp !== this.hp) this.setHp(hp);
            this.prot = !!prot;
            continue;
          }
          const r = this.remotes.get(id);
          if (!r) continue;
          r.buf.push({ t: m.st, p: [x, y, z], ry, rx });
          if (r.buf.length > 30) r.buf.shift();
          if (alive && !r.alive) { r.buf = [{ t: m.st, p: [x, y, z], ry, rx }]; r.av.g.rotation.set(0, ry, 0); r.av.g.position.set(x, y, z); }
          if (!alive && r.alive) r.deadAt = performance.now();
          r.alive = !!alive; r.prot = !!prot; r.w = w;
        }
        break;
      }
      case 'sb':
        for (const [id, k, d, ping] of m.p) { const p = this.roster.get(id); if (p) { p.k = k; p.d = d; p.ping = ping; } }
        this.match = m.match;
        if (!$('scoreboard').hidden) this.renderScoreboard();
        break;
      case 'ping': this.net({ t: 'pong', s: m.s }); break;
      case 'spawn':
        if (m.id === this.myId) this.spawnSelf(m);
        else { const r = this.remotes.get(m.id); if (r) { r.buf = []; } }
        break;
      case 'pos':
        this.body.p = m.p.slice(); this.body.v = [0, 0, 0];
        break;
      case 'shot': this.onRemoteShot(m); break;
      case 'hm': this.onHitMarker(m); break;
      case 'dmg': this.onDamage(m); break;
      case 'kill': this.onKill(m); break;
      case 'chat': {
        const p = this.roster.get(m.id);
        this.chatLine(p ? p.name : '?', p ? p.color : '#fff', m.msg);
        break;
      }
      case 'end': this.showEnd(m); break;
      case 'start':
        this.match = m.match;
        for (const p of this.roster.values()) { p.k = 0; p.d = 0; }
        $('endscreen').hidden = true;
        this.center('Neues Match!', 1800);
        break;
      case 'err': this.lastError = m.msg; break;
      default: break;
    }
  }

  spawnSelf(s) {
    this.body = { p: s.p.slice(), v: [0, 0, 0], onGround: true };
    this.yaw = s.ry; this.pitch = 0; this.kick = 0;
    this.sq = s.sq;
    this.alive = true;
    this.setHp(100);
    this.ammo = Object.fromEntries(WEAPON_ORDER.map((k) => [k, WEAPONS[k].mag]));
    this.reloadUntil = 0;
    this.eyeY = s.p[1] + PLAYER.eye;
    $('death').hidden = true;
    this.sfx.spawn();
    this.updateWeaponHud();
  }

  setHp(hp) {
    this.hp = hp;
    $('hp-num').textContent = Math.max(0, Math.ceil(hp));
    const f = $('hp-fill');
    f.style.width = Math.max(0, hp) + '%';
    f.classList.toggle('low', hp <= 35);
    $('vignette').style.opacity = hp <= 35 && this.alive ? String(0.35 + (35 - hp) / 60) : '0';
  }

  onRemoteShot(m) {
    const o = new THREE.Vector3(...m.o);
    const key = WEAPON_ORDER[m.w] || 'rifle';
    const r = this.remotes.get(m.id);
    for (const e of m.e) {
      const end = new THREE.Vector3(e[0], e[1], e[2]);
      const dir = end.clone().sub(o).normalize();
      const from = o.clone().addScaledVector(dir, 0.7);
      this.tracer(from, end, key === 'sniper' ? '#ffb46b' : '#ffd59a', key === 'sniper' ? 0.05 : 0.03);
      this.spark(end, e[3] ? '#ff6b8a' : '#ffc07a', e[3] ? 0.6 : 0.4);
    }
    if (r) this.spark(o.clone().add(new THREE.Vector3(0, -0.2, 0)), '#ffd59a', 0.5, 70);
    this.sfx.shot(key, o);
  }

  onHitMarker(m) {
    const h = $('hitmarker');
    h.className = m.k ? 'kill' : m.hs ? 'head' : '';
    h.style.transition = 'none';
    h.style.opacity = '1';
    requestAnimationFrame(() => { h.style.transition = 'opacity 0.35s'; h.style.opacity = '0'; });
    this.sfx.hit(!!m.hs);
  }

  onDamage(m) {
    this.setHp(m.hp);
    this.sfx.hurt();
    const dx = m.from[0] - this.body.p[0], dz = m.from[1] - this.body.p[2];
    const ang = Math.atan2(-dx, -dz) - this.yaw;
    const el = document.createElement('div');
    el.className = 'dmgdir';
    el.style.transform = `rotate(${-ang}rad)`;
    $('dmgdirs').appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 1100);
    this.kick += 0.01;
  }

  onKill(m) {
    const k = this.roster.get(m.k), v = this.roster.get(m.v);
    if (k && m.k !== m.v) k.k++;
    if (v) v.d++;
    const wname = WEAPONS[WEAPON_ORDER[m.w]] ? WEAPONS[WEAPON_ORDER[m.w]].name : '';
    const el = document.createElement('div');
    el.className = 'kf' + (m.k === this.myId || m.v === this.myId ? ' me' : '');
    el.innerHTML = `<span style="color:${k ? esc(k.color) : '#fff'}">${esc(k ? k.name : '?')}</span><span class="wpn">${esc(wname)}</span>`
      + `<span style="color:${v ? esc(v.color) : '#fff'}">${esc(v ? v.name : '?')}</span>${m.hs ? '<span class="hs">✦</span>' : ''}`;
    const kf = $('killfeed');
    kf.prepend(el);
    while (kf.children.length > 5) kf.lastChild.remove();
    setTimeout(() => el.remove(), 6000);
    if (m.k === this.myId && m.v !== this.myId) {
      this.sfx.kill();
      this.center(`${m.hs ? 'Kopfschuss! ' : ''}${v ? v.name : ''} ausgeschaltet`, 1400);
    }
    if (m.v === this.myId) {
      this.alive = false;
      this.deathAt = performance.now();
      this.killerId = m.k;
      this.firing = false;
      $('death').hidden = false;
      $('death-by').innerHTML = k && m.k !== m.v ? `von <b style="color:${esc(k.color)}">${esc(k.name)}</b>` : '';
      $('vignette').style.opacity = '0';
    }
  }

  showEnd(m) {
    const me = this.myId;
    const ranking = m.ranking.length ? m.ranking : [...this.roster.values()].sort((a, b) => b.k - a.k);
    const w = ranking.find((r) => r.id === m.winner);
    $('end-winner').textContent = m.winner === me ? 'Du hast gewonnen!' : w ? `${w.name} gewinnt` : (ranking[0] ? `${ranking[0].name} vorne` : '');
    $('end-body').innerHTML = ranking.slice(0, 10).map((r, i) => `<tr class="${r.id === me ? 'me' : ''}"><td>${i + 1}.</td>`
      + `<td><span class="dot" style="background:${esc(r.color)}"></span>${esc(r.name)}${r.bot ? '<span class="tag">BOT</span>' : ''}</td><td>${r.k}</td><td>${r.d}</td></tr>`).join('');
    this.match = { ...(this.match || {}), state: 'end', nextAt: m.nextAt };
    $('endscreen').hidden = false;
    this.firing = false;
  }

  sysChat(text) { this.chatLine(null, null, text); }

  chatLine(name, color, text) {
    const el = document.createElement('div');
    el.className = 'cl' + (name ? '' : ' sys');
    el.innerHTML = name ? `<b style="color:${esc(color)}">${esc(name)}</b>${esc(text)}` : esc(text);
    const log = $('chatlog');
    log.appendChild(el);
    while (log.children.length > 7) log.firstChild.remove();
    setTimeout(() => { el.style.opacity = '0'; }, 9000);
    setTimeout(() => el.remove(), 10000);
  }

  center(text, ms) {
    const c = $('centermsg');
    c.textContent = text;
    c.style.opacity = '1';
    clearTimeout(this.centerT);
    this.centerT = setTimeout(() => { c.style.opacity = '0'; }, ms);
  }

  renderScoreboard() {
    const rows = [...this.roster.values()].sort((a, b) => b.k - a.k || a.d - b.d);
    $('sb-body').innerHTML = rows.map((p) => `<tr class="${p.id === this.myId ? 'me' : ''}"><td><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}`
      + `${p.bot ? '<span class="tag">BOT</span>' : `<span class="tag">LVL ${p.level || 1}</span>`}</td><td>${p.k}</td><td>${p.d}</td><td>${p.bot ? '–' : p.ping}</td></tr>`).join('');
  }

  // =====================================================================
  // Schießen
  // =====================================================================
  tryFire(now) {
    const w = this.weapon;
    if (!this.alive || now < this.nextFire || now < this.switchUntil || (this.match && this.match.state !== 'live')) return;
    if (this.reloadUntil > now) return;
    if (this.ammo[w.key] <= 0) {
      this.sfx.empty();
      this.nextFire = now + 250;
      this.reload();
      return;
    }
    if (!w.auto) {
      if (!this.semiReady) return;
      this.semiReady = false;
    }
    this.ammo[w.key]--;
    this.nextFire = now + w.interval;
    const moving = Math.hypot(this.body.v[0], this.body.v[2]) > 1.5;
    let spread = w.spread + (moving ? w.moveSpread : 0) + (this.body.onGround ? 0 : w.airSpread);
    spread *= 1 - this.adsK * (1 - w.adsMul);

    const eye = this.camera.position.clone();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch + this.kick, this.yaw + this.kickYaw, 0, 'YXZ'));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const dirs = [];
    const muzzle = this.muzzleWorld(eye, fwd, right, up);
    for (let i = 0; i < w.pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const d = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      dirs.push([+d.x.toFixed(4), +d.y.toFixed(4), +d.z.toFixed(4)]);
      // Sofortiges Feedback: Leuchtspur bis zur Wand oder zum sichtbaren Gegner
      const o = [eye.x, eye.y, eye.z], dd = [d.x, d.y, d.z];
      let t = rayMap(o, dd, w.range, BOXES), hitP = false;
      for (const r2 of this.remotes.values()) {
        if (!r2.alive || !r2.av.g.visible) continue;
        const gp = r2.av.g.position;
        const h = rayPlayer(o, dd, [gp.x, gp.y, gp.z]);
        if (h.t < t) { t = h.t; hitP = true; }
      }
      const end = eye.clone().addScaledVector(d, t);
      this.tracer(muzzle, end, w.key === 'sniper' ? '#ffb46b' : '#ffe3b5', w.key === 'sniper' ? 0.04 : 0.022);
      if (t < w.range) this.spark(end, hitP ? '#ff6b8a' : '#ffc07a', hitP ? 0.55 : 0.35);
    }
    this.net({ t: 'f', w: this.wi, o: [+eye.x.toFixed(3), +eye.y.toFixed(3), +eye.z.toFixed(3)], d: dirs });

    const rk = w.recoil * (1 - this.adsK * 0.4);
    this.pitch = Math.min(1.52, this.pitch + rk * 0.35);
    this.kick += rk * 0.65;
    this.kickYaw += (Math.random() - 0.5) * rk * 0.5;
    this.vmKick = Math.min(1, this.vmKick + (w.key === 'rifle' ? 0.35 : 1));
    this.muzzleT = now;
    this.sfx.shot(w.key);
    if (this.ammo[w.key] === 0) setTimeout(() => this.reload(), 200);
  }

  muzzleWorld(eye, fwd, right, up) {
    return eye.clone().addScaledVector(fwd, 0.8).addScaledVector(right, 0.2 * (1 - this.adsK)).addScaledVector(up, -0.15);
  }

  // =====================================================================
  // HUD
  // =====================================================================
  buildWeaponHud() {
    $('weapons').innerHTML = WEAPON_ORDER.map((k, i) => `<div class="wslot" data-i="${i}"><b>${i + 1}</b>${esc(WEAPONS[k].name)}</div>`).join('');
  }

  updateWeaponHud() {
    const wn = $('t-wname');
    if (wn) wn.textContent = this.weapon.name;
    document.querySelectorAll('.wslot').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === this.wi));
    for (const [k, g] of Object.entries(this.vms)) g.visible = k === WEAPON_ORDER[this.wi];
    this.hudAmmo = -1;
  }

  updateHud(now) {
    const w = this.weapon;
    const a = this.ammo[w.key];
    const reloading = this.reloadUntil > now;
    const sig = a * 10 + (reloading ? 1 : 0);
    if (sig !== this.hudAmmo) {
      this.hudAmmo = sig;
      $('ammo-cur').textContent = reloading ? '…' : a;
      $('ammo-max').textContent = w.mag;
      $('ammo').classList.toggle('empty', a === 0);
      $('reloadhint').hidden = !(a <= Math.ceil(w.mag * 0.25) && !reloading);
    }
    $('prot').hidden = !(this.prot && this.alive);
    if (this.touch.on) $('t-ads').classList.toggle('on', this.ads);
    const sniperScope = w.key === 'sniper' && this.adsK > 0.85;
    $('scope').hidden = !sniperScope;
    $('crosshair').style.display = sniperScope ? 'none' : '';
    const moving = Math.hypot(this.body.v[0], this.body.v[2]) > 1.5;
    const spread = (w.spread + (moving ? w.moveSpread : 0) + (this.body.onGround ? 0 : w.airSpread)) * (1 - this.adsK * (1 - w.adsMul));
    $('crosshair').classList.toggle('target', !!this.onTarget);
    $('crosshair').style.setProperty('--gap', `${Math.round(4 + spread * 380 + this.kick * 200)}px`);

    if (!this.hudT || now - this.hudT > 200) {
      this.hudT = now;
      const m = this.match || {};
      const left = m.state === 'live' ? Math.max(0, m.endsAt - this.serverNow()) : 0;
      $('tb-timer').textContent = m.state === 'end' ? 'ENDE' : `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      const me = this.roster.get(this.myId);
      let lead = null;
      for (const p of this.roster.values()) if (p.id !== this.myId && (!lead || p.k > lead.k)) lead = p;
      $('tb-me').textContent = me ? me.k : 0;
      $('tb-lead').textContent = lead ? lead.k : 0;
      $('tb-lead-name').textContent = lead ? lead.name : 'FÜHRUNG';
      $('tb-goal').textContent = `Erster bis ${m.limit || 25}`;
      if (!this.alive && this.mode === 'game') {
        const t = Math.max(0, 3 - (now - this.deathAt) / 1000);
        $('death-timer').textContent = m.state === 'live' ? `Wiederbelebung in ${t.toFixed(1)} s` : 'Warte auf das nächste Match';
      }
      if (!$('endscreen').hidden && m.nextAt) {
        $('end-next').textContent = `Nächstes Match in ${Math.max(0, Math.ceil((m.nextAt - this.serverNow()) / 1000))} s`;
      }
      const me2 = this.roster.get(this.myId);
      $('netinfo').textContent = `${this.fps} FPS · Ping ${me2 ? me2.ping : '–'} ms · ${this.roster.size} Spieler`;
    }
  }

  // =====================================================================
  // Hauptschleife
  // =====================================================================
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wCamera.aspect = w / h;
    this.wCamera.updateProjectionMatrix();
  }

  applySettings(s) {
    this.settings = { ...this.settings, ...s };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch {}
    this.sfx.setVolume(this.settings.vol);
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.clock) / 1000);
    this.clock = now;
    this.fpsN++;
    if (now - this.fpsT > 1000) { this.fps = this.fpsN; this.fpsN = 0; this.fpsT = now; }

    if (this.mode === 'game' && this.connected) this.updateGame(dt, now);
    else this.updateMenuCam(dt);

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      const k = (now - f.t0) / f.dur;
      if (k >= 1) { f.done(); this.fx.splice(i, 1); } else f.update(k);
    }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const showVm = this.mode === 'game' && this.connected && this.alive && !(this.weapon.key === 'sniper' && this.adsK > 0.85);
    if (showVm) {
      this.renderer.clearDepth();
      this.renderer.render(this.wScene, this.wCamera);
    }
  }

  updateMenuCam(dt) {
    this.menuT += dt * 0.05;
    const r = 58;
    this.camera.position.set(Math.cos(this.menuT) * r, 24, Math.sin(this.menuT) * r);
    this.camera.lookAt(0, 2, 0);
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
  }

  updateGame(dt, now) {
    const b = this.body;
    const act = this.active() && this.alive && !this.chatting;
    const w = this.weapon;

    // Bewegung
    let fx = 0, fz = 0;
    if (act) {
      if (this.keys.has('KeyW')) fz -= 1;
      if (this.keys.has('KeyS')) fz += 1;
      if (this.keys.has('KeyA')) fx -= 1;
      if (this.keys.has('KeyD')) fx += 1;
    }
    const T = this.touch;
    if (act && T.joyId !== null) { fx += T.jx; fz += T.jy; }
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin, wz = -fx * sin + fz * cos;
    this.adsK += ((this.ads && act ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    const sprint = act && (this.keys.has('ShiftLeft') || (T.joyId !== null && len > 0.95 && fz < -0.7)) && fz < 0 && this.adsK < 0.3;
    const speed = (sprint ? MOVE.sprint : MOVE.walk) * (1 - this.adsK * 0.45);
    if (this.alive) {
      const wasGround = b.onGround, vy = b.v[1];
      accelerate(b, (fx || fz) ? wx : 0, (fx || fz) ? wz : 0, speed, dt);
      if (act && (this.keys.has('Space') || T.jump) && b.onGround) { b.v[1] = MOVE.jump; b.onGround = false; }
      step(b, dt, BOXES);
      if (!wasGround && b.onGround && vy < -6) { this.landDip = Math.min(0.25, -vy * 0.02); this.sfx.land(); }
      const hs = Math.hypot(b.v[0], b.v[2]);
      if (b.onGround && hs > 1) {
        this.stepAcc += hs * dt;
        this.bob += hs * dt * 1.6;
        if (this.stepAcc > 2.3) { this.stepAcc = 0; this.sfx.step(); }
      }
      b.p[0] = Math.max(-ARENA + 0.4, Math.min(ARENA - 0.4, b.p[0]));
      b.p[2] = Math.max(-ARENA + 0.4, Math.min(ARENA - 0.4, b.p[2]));
    }

    // Waffe
    if (this.reloadUntil && now >= this.reloadUntil) {
      this.reloadUntil = 0;
      if (this.reloadKey === w.key) this.ammo[w.key] = w.mag;
    }
    if (this.firing && act) this.tryFire(now);
    this.kick *= Math.exp(-dt * 9);
    this.kickYaw *= Math.exp(-dt * 9);
    this.updateAssist(dt, act);

    // Senden
    this.sendAcc += dt;
    if (this.alive && this.sendAcc >= 1 / SEND_HZ) {
      this.sendAcc = 0;
      this.net({ t: 'i', p: [+b.p[0].toFixed(3), +b.p[1].toFixed(3), +b.p[2].toFixed(3)], ry: +this.yaw.toFixed(3), rx: +this.pitch.toFixed(3), w: this.wi, sq: this.sq });
    }

    // Kamera
    const targetEye = b.p[1] + PLAYER.eye;
    this.eyeY = Math.abs(targetEye - this.eyeY) > 1 ? targetEye : this.eyeY + (targetEye - this.eyeY) * Math.min(1, dt * 18);
    this.landDip *= Math.exp(-dt * 8);
    const bobY = Math.sin(this.bob * 2) * 0.035 * (1 - this.adsK);
    const cam = this.camera;
    if (this.alive) {
      cam.position.set(b.p[0], this.eyeY + bobY - this.landDip, b.p[2]);
      cam.rotation.set(this.pitch + this.kick, this.yaw + this.kickYaw, 0);
    } else {
      const k = Math.min(1, (now - this.deathAt) / 600);
      cam.position.set(b.p[0], b.p[1] + PLAYER.eye - k * 1.0 + k * 2.2, b.p[2]);
      const killer = this.remotes.get(this.killerId);
      if (killer && killer.av.g.visible) {
        const kp = killer.av.g.position;
        const look = new THREE.Vector3(kp.x, kp.y + 1.2, kp.z);
        const m = new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0));
        const qq = new THREE.Quaternion().setFromRotationMatrix(m);
        cam.quaternion.slerp(qq, Math.min(1, dt * 4));
      } else cam.rotation.set(-0.5 * k, this.yaw, 0.15 * k);
    }
    const zoom = 1 + (w.zoom - 1) * this.adsK;
    const fov = this.settings.fov / zoom;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.sky.position.copy(cam.position);

    // Waffe in der Hand
    const vm = this.vms[w.key];
    const sw = this.switchUntil > now ? (this.switchUntil - now) / 380 : 0;
    const rl = this.reloadUntil > now ? Math.sin(Math.min(1, 1 - (this.reloadUntil - now) / (w.reload * 1000)) * Math.PI) : 0;
    this.vmSwayX *= Math.exp(-dt * 10); this.vmSwayY *= Math.exp(-dt * 10);
    this.vmKick *= Math.exp(-dt * 14);
    const hip = new THREE.Vector3(0.22, -0.22, -0.42);
    const ads = vm.userData.ads;
    const pos = hip.lerp(ads, this.adsK);
    const bobK = (1 - this.adsK * 0.85);
    pos.x += Math.cos(this.bob) * 0.012 * bobK - this.vmSwayX * 0.6;
    pos.y += Math.abs(Math.sin(this.bob)) * 0.014 * bobK + this.vmSwayY * 0.6 - sw * 0.35 - rl * 0.12 - this.landDip * 0.2;
    pos.z += this.vmKick * 0.07;
    this.vmRoot.position.copy(pos);
    this.vmRoot.rotation.set(this.vmKick * 0.12 + rl * 0.6 + sw * 0.6, -this.vmSwayX * 2, rl * 0.3);
    this.gloveMat.color.set(this.myColor || '#a78bfa');
    const fl = now - (this.muzzleT || 0) < 45;
    this.muzzle.visible = fl;
    this.vmLight.intensity = fl ? 6 : 0;
    this.flashLight.intensity = fl ? 10 : 0;
    if (fl) {
      this.muzzle.position.copy(vm.userData.tip);
      this.muzzle.material.rotation = Math.random() * 6;
      const s = w.key === 'rifle' ? 0.28 : 0.45;
      this.muzzle.scale.set(s, s, 1);
      this.flashLight.position.copy(cam.position);
    }

    // Andere Spieler
    const rt = this.serverNow() - INTERP;
    for (const r of this.remotes.values()) this.updateRemote(r, rt, dt, now);

    if (this.sfx.ctx) {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      this.sfx.setListener(cam.position, f);
    }
    this.updateHud(now);
  }

  updateRemote(r, rt, dt, now) {
    const g = r.av.g;
    const buf = r.buf;
    if (!buf.length) { g.visible = false; return; }
    let a = buf[0], c = buf[0];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= rt) { a = buf[i]; c = buf[i + 1] || buf[i]; break; }
    }
    const f = c === a ? 0 : Math.min(1, (rt - a.t) / (c.t - a.t));
    const x = a.p[0] + (c.p[0] - a.p[0]) * f;
    const y = a.p[1] + (c.p[1] - a.p[1]) * f;
    const z = a.p[2] + (c.p[2] - a.p[2]) * f;
    const prev = g.position.clone();
    g.position.set(x, y, z);
    g.visible = true;
    const ry = lerpAngle(a.ry, c.ry, f);
    const rx = a.rx + (c.rx - a.rx) * f;
    if (r.alive) {
      g.rotation.set(0, ry, 0);
      r.av.aim.rotation.x = rx;
      const sp = Math.hypot(x - prev.x, z - prev.z) / Math.max(dt, 0.001);
      if (sp > 0.5 && sp < 20) r.walk += sp * dt * 2.2;
      const sw = Math.sin(r.walk) * Math.min(1, sp / 5) * 0.7;
      r.av.legL.rotation.x = sw;
      r.av.legR.rotation.x = -sw;
      r.av.shield.visible = r.prot;
      if (r.prot) r.av.shield.material.opacity = 0.08 + Math.sin(now / 90) * 0.04;
      r.av.tag.visible = true;
    } else {
      const k = Math.min(1, (now - r.deadAt) / 350);
      g.rotation.set(-k * Math.PI / 2, ry, 0);
      r.av.shield.visible = false;
      r.av.tag.visible = false;
      if (now - r.deadAt > 2200) g.visible = false;
    }
    while (buf.length > 2 && buf[1].t < rt - 500) buf.shift();
  }
}
