// Spielwelt: Gelände, Himmel mit Sonnenfinsternis, Wasser, Wälder, Felsen, Beerensträucher, Eclipse-Splitter.
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
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: SUN_DIR }, top: { value: new THREE.Color(0.03, 0.02, 0.09) }, mid: { value: new THREE.Color(0.17, 0.10, 0.30) }, hor: { value: new THREE.Color(0.55, 0.27, 0.42) }, glow: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 sun; uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform float glow;
      void main(){
        float h = vDir.y;
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, top, smoothstep(0.25, 0.85, h));
        col = mix(col, hor * 0.25, smoothstep(0.0, -0.2, h));
        float s = max(dot(normalize(vDir), sun), 0.0);
        col += (vec3(0.65,0.45,0.95) * pow(s, 24.0) * 0.55 + vec3(0.9,0.5,0.55) * pow(s, 4.0) * 0.12) * glow;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), mat));
  const r = rng(42), pos = [];
  for (let i = 0; i < 1600; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, rr = Math.sqrt(1 - y * y);
    pos.push(Math.cos(th) * rr * 2400, y * 2400, Math.sin(th) * rr * 2400);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xd9d0ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false }));
  group.add(stars);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,240,255,0.95)'], [0.27, 'rgba(196,170,255,0.7)'], [0.45, 'rgba(124,58,237,0.25)'], [1, 'rgba(124,58,237,0)']]),
    fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  }));
  corona.position.copy(SUN_DIR).multiplyScalar(2000); corona.scale.setScalar(760);
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(4,3,8,1)'], [0.46, 'rgba(4,3,8,1)'], [0.5, 'rgba(4,3,8,0)'], [1, 'rgba(4,3,8,0)']]),
    fog: false, depthWrite: false, transparent: true,
  }));
  disc.position.copy(SUN_DIR).multiplyScalar(1980); disc.scale.setScalar(214);
  group.add(corona, disc);
  group.userData = { mat, stars, corona, disc };
  return group;
}

const _c = new THREE.Color();
function terrainColor(h, slope, x, z, out) {
  const n = noise(x * 0.06, z * 0.06) * 0.5 + 0.5;
  const sand = [0.78, 0.68, 0.5], grassA = [0.27, 0.45, 0.24], grassB = [0.36, 0.52, 0.27], rock = [0.42, 0.39, 0.45], snow = [0.9, 0.89, 0.95], dirt = [0.4, 0.33, 0.25];
  let c;
  if (h < 1.6) c = sand;
  else if (slope > 0.8 || h > 30) c = rock;
  else c = grassA.map((v, i) => v + (grassB[i] - v) * n);
  if (h > 1.6 && h < 3 && slope < 0.8) c = c.map((v, i) => v + (sand[i] - v) * (3 - h) / 1.4);
  if (slope > 0.5 && slope <= 0.8) c = c.map((v, i) => v + (dirt[i] - v) * (slope - 0.5) * 3.3);
  if (h > 36) c = snow;
  _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  out.push(_c.r, _c.g, _c.b);
}

/** Einfaches Raster für schnelle Nachbarschaftssuche (Bäume, Felsen, Sträucher). */
function makeIndex(items, cell = 24) {
  const map = new Map();
  for (const it of items) {
    const k = Math.floor(it.x / cell) + ',' + Math.floor(it.z / cell);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return (x, z, r) => {
    const out = [];
    const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell), z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const l = map.get(i + ',' + j); if (l) for (const it of l) if (Math.hypot(it.x - x, it.z - z) <= r) out.push(it); }
    return out;
  };
}

export function createWorld(scene, RAPIER, physics) {
  const grid = buildGrid();
  const heightAt = makeSampler(grid);
  const n = SEG + 1, cell = SIZE / SEG;
  const slopeAt = (x, z) => Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;

  scene.background = FOG.clone();
  scene.fog = new THREE.FogExp2(FOG, 0.0042);
  const sky = makeSky();
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xa898f0, 0x3a3048, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd4e6, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 340;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // Gelände
  const pos = new Float32Array(n * n * 3), col = [], idx = new Uint32Array(SEG * SEG * 6);
  let k = 0;
  for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) {
    const x = -SIZE / 2 + ix * cell, z = -SIZE / 2 + iz * cell, h = grid[ix * n + iz];
    pos[k++] = x; pos[k++] = h; pos[k++] = z;
    terrainColor(h, slopeAt(x, z), x, z, col);
  }
  k = 0;
  for (let ix = 0; ix < SEG; ix++) for (let iz = 0; iz < SEG; iz++) {
    const a = ix * n + iz, b = (ix + 1) * n + iz, c = ix * n + iz + 1, d = (ix + 1) * n + iz + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  const terrainCollider = physics.createCollider(RAPIER.ColliderDesc.heightfield(SEG, SEG, grid, { x: SIZE, y: 1, z: SIZE }).setFriction(0.9));

  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 5, SIZE * 5, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x241f52, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.86 }));
  water.receiveShadow = true;
  scene.add(water);

  // Platzierung (deterministisch, für alle Spieler gleich)
  const r = rng(7);
  const spots = (count, ok) => {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 30; tries++) {
      const x = (r() - 0.5) * SIZE * 0.94, z = (r() - 0.5) * SIZE * 0.94;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 34) continue;
      const h = heightAt(x, z), s = slopeAt(x, z);
      if (ok(h, s, x, z)) out.push({ x, z, h, s });
    }
    return out;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3();

  // Wälder
  const trees = spots(2600, (h, s, x, z) => h > 2.6 && h < 30 && s < 0.55 && noise(x * 0.012 + 50, z * 0.012) > -0.12);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 6); trunkGeo.translate(0, 1.1, 0);
  const crownGeo = new THREE.ConeGeometry(1.35, 3.6, 7); crownGeo.translate(0, 3.6, 0);
  const crown2 = new THREE.ConeGeometry(1.0, 2.6, 7); crown2.translate(0, 5.0, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2c5232, roughness: 0.9, flatShading: true }), trees.length);
  const crownsTop = new THREE.InstancedMesh(crown2, crowns.material, trees.length);
  trees.forEach((t, i) => {
    const s = 0.8 + r() * 0.75;
    t.s = s; t.kind = 'baum'; t.i = i;
    q.setFromAxisAngle(v.set(0, 1, 0), r() * Math.PI * 2);
    m4.compose(sv.set(t.x, t.h - 0.15, t.z), q, new THREE.Vector3(s, s * (0.9 + r() * 0.3), s));
    trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4); crownsTop.setMatrixAt(i, m4);
    crowns.setColorAt(i, new THREE.Color().setHSL(0.36 + r() * 0.06, 0.38, 0.22 + r() * 0.08));
    // Nur der Stamm ist fest – Kronen blockieren weder Spieler noch Fahrzeuge.
    physics.createCollider(RAPIER.ColliderDesc.cylinder(1.3 * s, 0.28 * s).setTranslation(t.x, t.h + 1.1 * s, t.z).setFriction(0.2));
  });
  crownsTop.instanceColor = crowns.instanceColor;
  for (const m of [trunks, crowns, crownsTop]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // Felsen
  const rocks = spots(620, (h, s) => h > 0.5 && s < 0.9);
  const rockMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x5d5868, roughness: 0.95, flatShading: true }), rocks.length);
  rocks.forEach((t, i) => {
    const s = 0.5 + Math.pow(r(), 2) * 2.4;
    t.s = s; t.kind = 'fels'; t.i = i;
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    m4.compose(sv.set(t.x, t.h + s * 0.25, t.z), q, new THREE.Vector3(s * 1.2, s * 0.75, s));
    rockMesh.setMatrixAt(i, m4);
    if (s > 0.9) physics.createCollider(RAPIER.ColliderDesc.ball(s * 0.72).setTranslation(t.x, t.h + s * 0.15, t.z));
  });
  rockMesh.castShadow = true; rockMesh.receiveShadow = true; scene.add(rockMesh);

  // Beerensträucher
  const bushes = spots(700, (h, s, x, z) => h > 2 && h < 26 && s < 0.5 && noise(x * 0.02 - 30, z * 0.02 + 9) > 0);
  const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.8, 0), new THREE.MeshStandardMaterial({ color: 0x3e6b3a, roughness: 0.9, flatShading: true }), bushes.length);
  const berryMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshStandardMaterial({ color: 0xc2185b, emissive: 0x5a0a2a, emissiveIntensity: 0.6 }), bushes.length * 5);
  let bi = 0;
  bushes.forEach((t, i) => {
    const s = 0.8 + r() * 0.5; t.s = s; t.kind = 'strauch'; t.i = i;
    m4.compose(sv.set(t.x, t.h + 0.45 * s, t.z), q.identity(), new THREE.Vector3(s * 1.2, s * 0.8, s * 1.2));
    bushMesh.setMatrixAt(i, m4);
    for (let j = 0; j < 5; j++) { const a = r() * 6.28; m4.compose(sv.set(t.x + Math.cos(a) * 0.8 * s, t.h + (0.4 + r() * 0.5) * s, t.z + Math.sin(a) * 0.8 * s), q.identity(), new THREE.Vector3(1, 1, 1)); berryMesh.setMatrixAt(bi++, m4); }
  });
  bushMesh.castShadow = true; bushMesh.receiveShadow = true; scene.add(bushMesh, berryMesh);

  // Eclipse-Splitter
  const shardSpots = spots(60, (h, s) => h > 2 && s < 0.7);
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

  const nearTrees = makeIndex(trees), nearRocks = makeIndex(rocks), nearBushes = makeIndex(bushes);

  return {
    heightAt, slopeAt, sky, sun, hemi, shards, trees, rocks, bushes, terrainCollider,
    nearTrees, nearRocks, nearBushes,
    /** Prüft, ob die Linie von a nach b durch eine Baumkrone führt; liefert die freie Länge. */
    crownClear(a, dir, dist) {
      let free = dist;
      for (const t of nearTrees(a.x + dir.x * dist / 2, a.z + dir.z * dist / 2, dist / 2 + 3)) {
        const cy = t.h + 3.8 * t.s, rad = 1.5 * t.s;
        // Abstand Strahl ↔ Kronenmitte
        const ox = t.x - a.x, oy = cy - a.y, oz = t.z - a.z;
        const proj = ox * dir.x + oy * dir.y + oz * dir.z;
        if (proj < 0 || proj > free) continue;
        const px = a.x + dir.x * proj - t.x, py = a.y + dir.y * proj - cy, pz = a.z + dir.z * proj - t.z;
        if (px * px + py * py * 0.4 + pz * pz < rad * rad) free = Math.max(1.2, proj - rad);
      }
      return free;
    },
    update(t, focus) {
      sky.position.copy(focus);
      sun.position.copy(focus).addScaledVector(SUN_DIR, 140);
      sun.target.position.copy(focus);
      for (const s of shards) {
        if (s.taken) continue;
        if (Math.abs(s.base - focus.y) > 400) continue;
        s.mesh.rotation.y = t * 1.2 + s.id;
        s.group.position.y = s.base + Math.sin(t * 1.6 + s.id) * 0.25;
      }
    },
  };
}
