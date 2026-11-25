// Stilisierte Modelle aus Grundformen (keine externen Assets nötig).
import * as THREE from 'three';

const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1824, roughness: 0.6, metalness: 0.3 });
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts }));
  return matCache.get(key);
}
const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

/* ---------------- Spielfigur ---------------- */
/** Spielfigur mit Armen; Füße bei y = 0, Blick in -z. */
export function makeFigure(color) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), emissiveIntensity: 1.6 });
  const root = new THREE.Group(); // wird beim Abrollen gedreht
  g.add(root);
  const body = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 6, 14), suit)); body.position.y = 0.95;
  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), darkMat)); head.position.y = 1.58;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.12), glow); visor.position.set(0, 1.6, -0.21);
  const pack = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), darkMat)); pack.position.set(0, 1.05, 0.33);
  const legGeo = new THREE.CapsuleGeometry(0.11, 0.42, 4, 8); legGeo.translate(0, -0.3, 0);
  const legL = shadow(new THREE.Mesh(legGeo, suit)), legR = shadow(new THREE.Mesh(legGeo, suit));
  legL.position.set(-0.14, 0.62, 0); legR.position.set(0.14, 0.62, 0);
  const armGeo = new THREE.CapsuleGeometry(0.09, 0.42, 4, 8); armGeo.translate(0, -0.28, 0);
  const armL = shadow(new THREE.Mesh(armGeo, suit)), armR = new THREE.Group();
  armL.position.set(-0.45, 1.3, 0);
  const armRMesh = shadow(new THREE.Mesh(armGeo, suit)); armR.add(armRMesh); armR.position.set(0.45, 1.3, 0);
  const hand = new THREE.Group(); hand.position.set(0, -0.58, -0.05); armR.add(hand);
  root.add(body, head, visor, pack, legL, legR, armL, armR);
  g.userData = { root, legL, legR, armL, armR, hand, body, phase: 0, swing: 0, held: '' };
  return g;
}

/** Laufen, Schwingen (Angriff), Arme hängen lassen. */
export function animateFigure(fig, speed, dt, flying = false) {
  const u = fig.userData;
  u.phase += dt * (4 + speed * 1.6);
  const swing = flying ? 0.1 : Math.min(1, speed / 5) * 0.6;
  u.legL.rotation.x = Math.sin(u.phase) * swing;
  u.legR.rotation.x = -Math.sin(u.phase) * swing;
  u.armL.rotation.x = -Math.sin(u.phase) * swing * 0.8;
  u.body.position.y = 0.95 + Math.abs(Math.sin(u.phase)) * 0.04 * Math.min(1, speed / 3);
  if (u.swing > 0) {
    u.swing = Math.max(0, u.swing - dt * 3.2);
    const p = 1 - u.swing; // 0..1
    u.armR.rotation.x = p < 0.35 ? -2.4 * (p / 0.35) : -2.4 + 3.2 * ((p - 0.35) / 0.65);
  } else {
    u.armR.rotation.x = Math.sin(u.phase) * swing * 0.8 + (u.held ? -0.35 : 0);
  }
}
export function swingFigure(fig) { fig.userData.swing = 1; }

/** Gegenstand in die Hand legen (einfache Formen je Typ). */
export function setHeld(fig, itemId, def) {
  const u = fig.userData;
  if (u.held === (itemId || '')) return;
  u.held = itemId || '';
  u.hand.clear();
  if (!itemId || !def) return;
  const c = def.color || '#cccccc';
  const wood = mat('#6B4A2B');
  let m;
  if (itemId === 'steinaxt' || itemId === 'spitzhacke') {
    m = new THREE.Group();
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6), wood); h.rotation.x = Math.PI / 2; h.position.z = -0.25;
    const head = new THREE.Mesh(itemId === 'steinaxt' ? new THREE.BoxGeometry(0.06, 0.22, 0.16) : new THREE.BoxGeometry(0.05, 0.08, 0.42), mat(c));
    head.position.set(0, 0.05, -0.58);
    m.add(h, head);
  } else if (itemId === 'speer') {
    m = new THREE.Group();
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), wood); h.rotation.x = Math.PI / 2; h.position.z = -0.45;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 6), mat('#9CA3AF')); tip.rotation.x = -Math.PI / 2; tip.position.z = -1.5;
    m.add(h, tip);
  } else if (itemId === 'splitterklinge') {
    m = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), darkMat); grip.rotation.x = Math.PI / 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.9), new THREE.MeshStandardMaterial({ color: 0xc4b5fd, emissive: 0x8b5cf6, emissiveIntensity: 1.8 }));
    blade.position.z = -0.55; m.add(grip, blade);
  } else if (itemId === 'bogen') {
    m = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 6, 16, Math.PI), wood); m.rotation.set(0, Math.PI / 2, Math.PI / 2); m.position.z = -0.1;
  } else if (def.type === 'Nahrung') {
    m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(c));
  } else if (def.type === 'Bauteil') {
    m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), mat(c));
  } else {
    m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat(c));
  }
  m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  u.hand.add(m);
}

/* ---------------- Fahrzeuge ---------------- */
// Physikwerte je Typ. Front zeigt in +x. Räder: [x, z] relativ zum Fahrgestell.
export const VEHICLE_SPECS = {
  gelaendewagen: { half: [1.9, 0.35, 0.95], density: 90, wheels: [[1.3, 0.85], [1.3, -0.85], [-1.3, 0.85], [-1.3, -0.85]], radius: 0.42, rest: 0.45, connY: -0.15, engine: 1500, maxFwd: 27, maxRev: 9, steer: 0.5, seat: [-0.35, 0.9, 0.35], cam: 9.5 },
  quad: { half: [1.0, 0.3, 0.6], density: 70, wheels: [[0.75, 0.6], [0.75, -0.6], [-0.75, 0.6], [-0.75, -0.6]], radius: 0.34, rest: 0.35, connY: -0.1, engine: 520, maxFwd: 31, maxRev: 7, steer: 0.6, seat: [-0.25, 0.75, 0], cam: 7 },
  truck: { half: [2.9, 0.55, 1.2], density: 80, wheels: [[2.0, 1.1], [2.0, -1.1], [-1.9, 1.1], [-1.9, -1.1]], radius: 0.6, rest: 0.55, connY: -0.35, engine: 5200, maxFwd: 21, maxRev: 7, steer: 0.42, seat: [1.6, 1.6, 0.45], cam: 13 },
};

export function makeVehicle(type, color) {
  const spec = VEHICLE_SPECS[type] || VEHICLE_SPECS.gelaendewagen;
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.5, metalness: 0.6 });
  const light = mat('#ffffff', { emissive: 0xfff1d6, emissiveIntensity: 2 });
  const tail = mat('#400000', { emissive: 0xff2a3a, emissiveIntensity: 1.6 });
  const add = (m, x, y, z) => { m.position.set(x, y, z); shadow(m); g.add(m); return m; };
  const bar = (x1, y1, z1, x2, y2, z2, r = 0.05) => {
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), frame);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    shadow(m); g.add(m);
  };
  const [hx, hy, hz] = spec.half;
  if (type === 'quad') {
    add(new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.35, hz * 1.6), paint), 0, 0.1, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.5), frame), -0.25, 0.38, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 1.1), paint), 0.65, 0.3, 0);
    bar(0.55, 0.35, 0, 0.45, 0.85, 0, 0.04); bar(0.45, 0.85, -0.35, 0.45, 0.85, 0.35, 0.035);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.22), light), 0.92, 0.32, 0);
  } else if (type === 'truck') {
    add(new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.5, hz * 2), frame), 0, -0.05, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.6, hz * 2), paint), 1.9, 0.95, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, hz * 1.7), mat('#1d2738', { roughness: 0.1, metalness: 0.8 })), 2.76, 1.3, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.8, hz * 2), paint), -0.95, 0.55, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, hz * 1.8), frame), -0.95, 0.95, 0);
    for (const z of [-0.8, 0.8]) { add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.36), light), 2.76, 0.45, z); add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.34), tail), -2.76, 0.45, z); }
  } else {
    add(new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.5, 1.8), paint), 0, 0.1, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 1.6), paint), 1.15, 0.45, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.4), frame), -0.35, 0.5, 0);
    for (const z of [-0.75, 0.75]) { bar(0.4, 0.35, z, 0.0, 1.35, z); bar(-1.1, 0.35, z, -0.9, 1.35, z); bar(0.0, 1.35, z, -0.9, 1.35, z); }
    bar(0.0, 1.35, -0.75, 0.0, 1.35, 0.75); bar(-0.9, 1.35, -0.75, -0.9, 1.35, 0.75);
    for (const z of [-0.6, 0.6]) { add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.32), light), 1.91, 0.22, z); add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), tail), -1.91, 0.22, z); }
  }
  // Räder sitzen von Anfang an in Ruhelage – auch bei Fahrzeugen anderer Spieler sichtbar.
  const r = spec.radius;
  const wheelGeo = new THREE.CylinderGeometry(r, r, r * 0.8, 18); wheelGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(r * 0.48, r * 0.48, r * 0.85, 6); rimGeo.rotateX(Math.PI / 2);
  const tire = mat('#15141a', { roughness: 0.9 });
  const rim = mat('#9b96a8', { roughness: 0.4, metalness: 0.8 });
  const wheels = spec.wheels.map(([x, z]) => {
    const w = new THREE.Group();
    w.add(shadow(new THREE.Mesh(wheelGeo, tire)), new THREE.Mesh(rimGeo, rim));
    w.position.set(x, spec.connY - spec.rest * 0.6, z);
    g.add(w);
    return w;
  });
  g.userData = { wheels, spec, spin: 0 };
  return g;
}

/* ---------------- Kreaturen ---------------- */
/** Prozedurale Kreatur. Vorne = +z (passend zur Server-Richtung). */
export function makeCreature(id, sp) {
  const g = new THREE.Group();
  const root = new THREE.Group(); g.add(root);
  const color = sp.color || '#888888';
  const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#e8dcc8'), 0.45), roughness: 0.9, flatShading: true });
  const eyeMat = sp.glow ? mat('#ffffff', { emissive: 0xa78bfa, emissiveIntensity: 3 }) : mat('#111111', { emissive: 0xffd27a, emissiveIntensity: 0.6 });
  const crystal = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, emissive: 0x7c3aed, emissiveIntensity: 2.2, roughness: 0.2 });
  const legs = [];
  const add = (parent, geo, m, x, y, z) => { const o = shadow(new THREE.Mesh(geo, m)); o.position.set(x, y, z); parent.add(o); return o; };
  const legPivot = (x, y, z, len, thick) => {
    const p = new THREE.Group(); p.position.set(x, y, z);
    const geo = new THREE.CylinderGeometry(thick, thick * 0.75, len, 6); geo.translate(0, -len / 2, 0);
    add(p, geo, skin, 0, 0, 0);
    add(p, new THREE.BoxGeometry(thick * 2.2, thick * 0.8, thick * 2.6), belly, 0, -len, thick * 0.4);
    root.add(p); legs.push(p); return p;
  };
  let head, tail;
  if (sp.body === 'Zweibeiner') {
    const torso = add(root, new THREE.SphereGeometry(0.55, 10, 8), skin, 0, 1.25, 0); torso.scale.set(0.9, 0.85, 1.6);
    add(root, new THREE.SphereGeometry(0.45, 8, 6), belly, 0, 1.1, 0.2).scale.set(0.8, 0.7, 1.2);
    const neck = new THREE.Group(); neck.position.set(0, 1.5, 0.75); root.add(neck);
    add(neck, new THREE.CylinderGeometry(0.2, 0.28, 0.6, 6), skin, 0, 0.15, 0.1).rotation.x = 0.7;
    head = new THREE.Group(); head.position.set(0, 0.45, 0.4); neck.add(head);
    add(head, new THREE.BoxGeometry(0.42, 0.4, 0.75), skin, 0, 0, 0.2);
    const jaw = add(head, new THREE.BoxGeometry(0.36, 0.12, 0.6), belly, 0, -0.22, 0.25); jaw.rotation.x = 0.12;
    for (const x of [-0.17, 0.17]) add(head, new THREE.SphereGeometry(0.06, 6, 5), eyeMat, x, 0.1, 0.38);
    legPivot(-0.3, 1.1, 0, 1.05, 0.15); legPivot(0.3, 1.1, 0, 1.05, 0.15);
    for (const x of [-0.3, 0.3]) add(root, new THREE.CylinderGeometry(0.06, 0.04, 0.45, 5), skin, x, 1.15, 0.65).rotation.x = 1.1;
    tail = new THREE.Group(); tail.position.set(0, 1.3, -0.8); root.add(tail);
    add(tail, new THREE.ConeGeometry(0.3, 1.8, 6), skin, 0, 0, -0.8).rotation.x = -Math.PI / 2 + 0.15;
  } else {
    const torso = add(root, new THREE.SphereGeometry(0.6, 10, 8), skin, 0, 1.0, 0); torso.scale.set(1.0, 0.8, 1.7);
    add(root, new THREE.SphereGeometry(0.5, 8, 6), belly, 0, 0.82, 0).scale.set(0.85, 0.6, 1.5);
    const neck = new THREE.Group(); neck.position.set(0, 1.15, 0.95); root.add(neck);
    add(neck, new THREE.CylinderGeometry(0.2, 0.3, 0.5, 6), skin, 0, 0.1, 0.12).rotation.x = 1.0;
    head = new THREE.Group(); head.position.set(0, 0.25, 0.45); neck.add(head);
    add(head, new THREE.BoxGeometry(0.42, 0.36, 0.55), skin, 0, 0, 0.12);
    for (const x of [-0.17, 0.17]) add(head, new THREE.SphereGeometry(0.055, 6, 5), eyeMat, x, 0.08, 0.3);
    for (const [x, z] of [[-0.42, 0.65], [0.42, 0.65], [-0.42, -0.65], [0.42, -0.65]]) legPivot(x, 0.85, z, 0.8, 0.14);
    tail = new THREE.Group(); tail.position.set(0, 1.05, -1.0); root.add(tail);
    add(tail, new THREE.ConeGeometry(0.22, 1.3, 6), skin, 0, 0, -0.6).rotation.x = -Math.PI / 2 + 0.2;
  }
  // Artspezifische Merkmale
  if (id === 'panzerruecken') {
    for (let i = 0; i < 6; i++) { const p = add(root, new THREE.BoxGeometry(0.08, 0.5 - Math.abs(i - 2.5) * 0.07, 0.38), belly, 0, 1.55, 0.7 - i * 0.28); p.rotation.x = 0.1; }
    for (const z of [-0.2, -0.45]) add(tail, new THREE.ConeGeometry(0.08, 0.4, 5), belly, 0, 0.2, z - 0.6);
  }
  if (id === 'splitterbestie') {
    for (let i = 0; i < 7; i++) { const c = add(root, new THREE.OctahedronGeometry(0.16 + (i % 3) * 0.05, 0), crystal, (i % 2 ? 0.2 : -0.2), 1.5, 0.7 - i * 0.22); c.scale.y = 2; }
  }
  if (id === 'schattenkoloss') {
    for (let i = 0; i < 5; i++) add(root, new THREE.ConeGeometry(0.1, 0.45, 5), crystal, 0, 1.75, 0.5 - i * 0.3);
  }
  if (sp.glow) { const l = new THREE.PointLight(0x8b5cf6, 1.2, 8 * (Number(sp.scale) || 1)); l.position.y = 1.5; root.add(l); }
  g.scale.setScalar(Number(sp.scale) || 1);
  g.userData = { root, legs, head, tail, phase: Math.random() * 6, lunge: 0 };
  return g;
}

export function animateCreature(m, moving, dt, attack) {
  const u = m.userData;
  const sp = moving ? (moving === 2 ? 11 : 5) : 0;
  u.phase += dt * sp;
  const amp = moving ? (moving === 2 ? 0.7 : 0.4) : 0;
  u.legs.forEach((l, i) => { l.rotation.x = Math.sin(u.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * amp; });
  if (u.tail) u.tail.rotation.y = Math.sin(u.phase * 0.5 + 1) * 0.25;
  if (attack) u.lunge = 1;
  if (u.lunge > 0) { u.lunge = Math.max(0, u.lunge - dt * 3); if (u.head) u.head.rotation.x = Math.sin(u.lunge * Math.PI) * -0.6; }
  u.root.position.y = moving ? Math.abs(Math.sin(u.phase)) * 0.05 : 0;
}

/* ---------------- Bauteile ---------------- */
const woodMat = new THREE.MeshStandardMaterial({ color: 0x9c6a43, roughness: 0.85 });
const woodDark = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.9 });
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8794, roughness: 0.95, flatShading: true });

/** Liefert Mesh-Gruppe und Kollisionsquader [hx, hy, hz, ox, oy, oz] (lokal, vor Drehung). */
export function makeStructure(type) {
  const g = new THREE.Group();
  const boxes = [];
  const box = (w, h, d, x, y, z, m = woodMat, collide = true) => {
    const mesh = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)); mesh.position.set(x, y, z); g.add(mesh);
    if (collide) boxes.push([w / 2, h / 2, d / 2, x, y, z]);
    return mesh;
  };
  let door = null;
  switch (type) {
    case 'fundament': box(3, 0.4, 3, 0, 0.2, 0, stoneMat); break;
    case 'wand': box(3, 3, 0.25, 0, 1.5, 0); for (const x of [-1.45, 1.45]) box(0.12, 3, 0.3, x, 1.5, 0, woodDark, false); break;
    case 'wand_tuer':
      box(0.9, 3, 0.25, -1.05, 1.5, 0); box(0.9, 3, 0.25, 1.05, 1.5, 0); box(1.2, 0.6, 0.25, 0, 2.7, 0);
      door = new THREE.Group(); door.position.set(-0.6, 0, 0);
      { const p = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.12), woodDark)); p.position.set(0.6, 1.2, 0); door.add(p); }
      g.add(door);
      break;
    case 'decke': box(3, 0.25, 3, 0, 0.125, 0, woodMat); break;
    case 'lagerfeuer': {
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const s = box(0.16, 0.16, 0.7, Math.cos(a) * 0.45, 0.08, Math.sin(a) * 0.45, stoneMat, false); s.rotation.y = -a; }
      for (let i = 0; i < 3; i++) { const l = box(0.12, 0.12, 0.9, 0, 0.15, 0, woodDark, false); l.rotation.set(0.35, (i / 3) * Math.PI, 0); }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 7), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff7a1a, emissiveIntensity: 3, transparent: true, opacity: 0.9 }));
      flame.position.y = 0.45; g.add(flame);
      const light = new THREE.PointLight(0xff9a3c, 2.2, 14); light.position.y = 1; g.add(light);
      g.userData.flame = flame; g.userData.light = light;
      boxes.push([0.6, 0.3, 0.6, 0, 0.3, 0]);
      break;
    }
    case 'schlafsack': box(0.9, 0.18, 2, 0, 0.09, 0, new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.9 }), false); box(0.7, 0.14, 0.4, 0, 0.2, -0.75, new THREE.MeshStandardMaterial({ color: 0xe5e7eb }), false); break;
    default: box(1, 1, 1, 0, 0.5, 0); break;
  }
  g.userData.boxes = boxes;
  g.userData.door = door;
  return g;
}

/* ---------------- Namensschilder & Lebensbalken ---------------- */
export function makeLabel(text, color, sub = '') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.font = '600 50px "Space Grotesk", system-ui, sans-serif';
  const w = Math.min(500, x.measureText(text).width + 60 + (sub ? 70 : 0));
  x.fillStyle = 'rgba(8,8,11,0.72)';
  const rx = (512 - w) / 2;
  x.beginPath(); x.roundRect(rx, 22, w, 84, 42); x.fill();
  x.fillStyle = color; x.beginPath(); x.arc(rx + 34, 64, 11, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#F4F4F6'; x.textBaseline = 'middle'; x.fillText(text, rx + 54, 66);
  if (sub) { x.fillStyle = '#FBBF24'; x.font = '700 34px "Space Grotesk", system-ui'; x.fillText(sub, rx + w - 74, 66); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  return s;
}

export function makeBar() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(1.6, 0.2, 1);
  s.userData = { c, tex, v: -1 };
  return s;
}
export function setBar(bar, pct, color = '#EF4444') {
  if (bar.userData.v === pct) return;
  bar.userData.v = pct;
  const x = bar.userData.c.getContext('2d');
  x.clearRect(0, 0, 128, 16);
  x.fillStyle = 'rgba(8,8,11,0.75)'; x.fillRect(0, 0, 128, 16);
  x.fillStyle = color; x.fillRect(2, 2, Math.max(0, Math.round(124 * pct / 100)), 12);
  bar.userData.tex.needsUpdate = true;
}
