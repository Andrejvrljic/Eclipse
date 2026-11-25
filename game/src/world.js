// Spielwelt: Gelände, Himmel mit Sonnenfinsternis, Wasser, Vegetation, Felsen und Eclipse-Splitter.
import * as THREE from 'three';
import { SIZE, SEG, SPAWN, rng, buildGrid, makeSampler, noise } from './terrain.js';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.32, -0.83).normalize();
const FOG = new THREE.Color(0x2b1d42);

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSky() {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 sun;
      void main(){
        float h = vDir.y;
        vec3 top = vec3(0.03,0.02,0.09); vec3 mid = vec3(0.17,0.10,0.30); vec3 hor = vec3(0.55,0.27,0.42);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, top, smoothstep(0.25, 0.85, h));
        col = mix(col, vec3(0.10,0.07,0.16), smoothstep(0.0, -0.2, h));
        float s = max(dot(normalize(vDir), sun), 0.0);
        col += vec3(0.65,0.45,0.95) * pow(s, 24.0) * 0.55 + vec3(0.9,0.5,0.55) * pow(s, 4.0) * 0.12;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  group.add(new THREE.Mesh(geo, mat));

  // Sterne
  const r = rng(42), pos = [];
  for (let i = 0; i < 1400; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, rr = Math.sqrt(1 - y * y);
    pos.push(Math.cos(th) * rr * 1300, y * 1300, Math.sin(th) * rr * 1300);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xd9d0ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false })));

  // Die Finsternis: dunkle Scheibe mit leuchtender Korona
  const at = SUN_DIR.clone().multiplyScalar(1100);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,240,255,0.95)'], [0.27, 'rgba(196,170,255,0.7)'], [0.45, 'rgba(124,58,237,0.25)'], [1, 'rgba(124,58,237,0)']]),
    fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  }));
  corona.position.copy(at); corona.scale.setScalar(420);
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(4,3,8,1)'], [0.46, 'rgba(4,3,8,1)'], [0.5, 'rgba(4,3,8,0)'], [1, 'rgba(4,3,8,0)']]),
    fog: false, depthWrite: false, transparent: true,
  }));
  disc.position.copy(SUN_DIR.clone().multiplyScalar(1090)); disc.scale.setScalar(118);
  group.add(corona, disc);
  group.renderOrder = -1;
  return group;
}

const _c = new THREE.Color();
function terrainColor(h, slope, x, z, out) {
  const n = noise(x * 0.08, z * 0.08) * 0.5 + 0.5;
  const sand = [0.78, 0.68, 0.5], grassA = [0.27, 0.45, 0.24], grassB = [0.36, 0.52, 0.27], rock = [0.42, 0.39, 0.45], snow = [0.9, 0.89, 0.95], dirt = [0.4, 0.33, 0.25];
  let c;
  if (h < 1.6) c = sand;
  else if (slope > 0.75 || h > 21) c = rock;
  else c = grassA.map((v, i) => v + (grassB[i] - v) * n);
  if (h > 1.6 && h < 3 && slope < 0.75) c = c.map((v, i) => v + (sand[i] - v) * (3 - h) / 1.4);
  if (slope > 0.5 && slope <= 0.75) c = c.map((v, i) => v + (dirt[i] - v) * (slope - 0.5) * 2);
  if (h > 24.5) c = snow;
  // Farben sind als sRGB gewählt; die Szene rechnet linear.
  _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  out.push(_c.r, _c.g, _c.b);
}

export function createWorld(scene, RAPIER, physics) {
  const grid = buildGrid();
  const heightAt = makeSampler(grid);
  const n = SEG + 1, cell = SIZE / SEG;
  const slopeAt = (x, z) => {
    const dx = heightAt(x + 1, z) - heightAt(x - 1, z), dz = heightAt(x, z + 1) - heightAt(x, z - 1);
    return Math.hypot(dx, dz) / 2;
  };

  scene.background = FOG.clone();
  scene.fog = new THREE.FogExp2(FOG, 0.0062);
  const sky = makeSky();
  scene.add(sky);

  // Licht: kühles Dämmerlicht + warmes Restlicht aus Richtung der Finsternis
  scene.add(new THREE.HemisphereLight(0xa898f0, 0x3a3048, 1.5));
  const sun = new THREE.DirectionalLight(0xffd4e6, 2.1);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 320;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // Gelände (Mesh + Physik aus demselben Raster)
  const pos = [], col = [], idx = [];
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const x = -SIZE / 2 + ix * cell, z = -SIZE / 2 + iz * cell, h = grid[ix * n + iz];
      pos.push(x, h, z);
      terrainColor(h, slopeAt(x, z), x, z, col);
    }
  }
  for (let ix = 0; ix < SEG; ix++) {
    for (let iz = 0; iz < SEG; iz++) {
      const a = ix * n + iz, b = (ix + 1) * n + iz, c = ix * n + iz + 1, d = (ix + 1) * n + iz + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tg.setIndex(idx); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  physics.createCollider(RAPIER.ColliderDesc.heightfield(SEG, SEG, grid, { x: SIZE, y: 1, z: SIZE }).setFriction(0.9));

  // Wasser
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 6, SIZE * 6, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x241f52, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.86 }));
  water.position.y = 0; water.receiveShadow = true;
  scene.add(water);

  // Platzierung: zufällig, aber deterministisch, mit Abstand zum Startplatz
  const r = rng(7);
  const spots = (count, ok) => {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const x = (r() - 0.5) * SIZE * 0.94, z = (r() - 0.5) * SIZE * 0.94;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 22) continue;
      const h = heightAt(x, z), s = slopeAt(x, z);
      if (ok(h, s, x, z)) out.push({ x, z, h, s });
    }
    return out;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3();

  // Bäume
  const trees = spots(720, (h, s, x, z) => h > 2.6 && h < 21 && s < 0.55 && noise(x * 0.02 + 50, z * 0.02) > -0.15);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 6); trunkGeo.translate(0, 1.1, 0);
  const crownGeo = new THREE.ConeGeometry(1.35, 3.6, 7); crownGeo.translate(0, 3.6, 0);
  const crown2 = new THREE.ConeGeometry(1.0, 2.6, 7); crown2.translate(0, 5.0, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2c5232, roughness: 0.9, flatShading: true }), trees.length);
  const crownsTop = new THREE.InstancedMesh(crown2, crowns.material, trees.length);
  trees.forEach((t, i) => {
    const s = 0.8 + r() * 0.75;
    q.setFromAxisAngle(v.set(0, 1, 0), r() * Math.PI * 2);
    m4.compose(sv.set(t.x, t.h - 0.15, t.z), q, new THREE.Vector3(s, s * (0.9 + r() * 0.3), s));
    trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4); crownsTop.setMatrixAt(i, m4);
    crowns.setColorAt(i, new THREE.Color().setHSL(0.36 + r() * 0.06, 0.38, 0.22 + r() * 0.08));
    physics.createCollider(RAPIER.ColliderDesc.cylinder(1.6 * s, 0.3 * s).setTranslation(t.x, t.h + 1.4 * s, t.z));
    // Unsichtbare Hülle der Krone: hält nur die Kamera auf (Sensor, keine Kollision mit Spieler oder Auto)
    physics.createCollider(RAPIER.ColliderDesc.ball(1.25 * s).setTranslation(t.x, t.h + 3.9 * s, t.z).setSensor(true));
  });
  crownsTop.instanceColor = crowns.instanceColor;
  for (const m of [trunks, crowns, crownsTop]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // Felsen
  const rocks = spots(190, (h, s) => h > 0.5 && s < 0.9);
  const rockMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x5d5868, roughness: 0.95, flatShading: true }), rocks.length);
  rocks.forEach((t, i) => {
    const s = 0.5 + Math.pow(r(), 2) * 2.4;
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    m4.compose(sv.set(t.x, t.h + s * 0.25, t.z), q, new THREE.Vector3(s * 1.2, s * 0.75, s));
    rockMesh.setMatrixAt(i, m4);
    if (s > 0.7) physics.createCollider(RAPIER.ColliderDesc.ball(s * 0.75).setTranslation(t.x, t.h + s * 0.2, t.z));
  });
  rockMesh.castShadow = true; rockMesh.receiveShadow = true; scene.add(rockMesh);

  // Eclipse-Splitter (sammelbar)
  const shardSpots = spots(25, (h, s) => h > 2 && s < 0.7);
  const shardMat = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, emissive: 0x8b5cf6, emissiveIntensity: 2.4, roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.95 });
  const glowTex = radialTexture([[0, 'rgba(196,181,253,0.9)'], [0.4, 'rgba(124,58,237,0.35)'], [1, 'rgba(124,58,237,0)']], 128);
  const shards = shardSpots.map((p, i) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), shardMat);
    m.scale.y = 1.7; m.castShadow = true;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(4.5);
    g.add(m, glow);
    g.position.set(p.x, p.h + 1.6, p.z);
    scene.add(g);
    return { id: i, group: g, mesh: m, base: p.h + 1.6, taken: false };
  });

  return {
    heightAt, slopeAt, sky, sun, shards,
    update(t, focus) {
      sky.position.copy(focus);
      sun.position.copy(focus).addScaledVector(SUN_DIR, 120);
      sun.target.position.copy(focus);
      for (const s of shards) {
        if (s.taken) continue;
        s.mesh.rotation.y = t * 1.2 + s.id;
        s.group.position.y = s.base + Math.sin(t * 1.6 + s.id) * 0.25;
      }
    },
  };
}
