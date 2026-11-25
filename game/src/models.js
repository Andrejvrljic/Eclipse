// Einfache, stilisierte Modelle aus Grundformen (keine externen Assets nötig).
import * as THREE from 'three';

const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1824, roughness: 0.6, metalness: 0.3 });

/** Spielfigur: Anzug in Spielerfarbe, dunkler Helm mit leuchtendem Visier. Füße bei y = 0. */
export function makeFigure(color) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), emissiveIntensity: 1.6 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 6, 14), suit);
  body.position.y = 0.95; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), darkMat);
  head.position.y = 1.58; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.12), glow);
  visor.position.set(0, 1.6, -0.21);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), darkMat);
  pack.position.set(0, 1.05, 0.33); pack.castShadow = true;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 8), suit);
  const legR = legL.clone();
  legL.position.set(-0.14, 0.32, 0); legR.position.set(0.14, 0.32, 0);
  legL.castShadow = legR.castShadow = true;
  g.add(body, head, visor, pack, legL, legR);
  g.userData = { legL, legR, body, phase: 0 };
  return g;
}

/** Laufanimation: Beine pendeln abhängig von der Geschwindigkeit. */
export function animateFigure(fig, speed, dt) {
  const u = fig.userData;
  u.phase += dt * (4 + speed * 1.6);
  const swing = Math.min(1, speed / 5) * 0.55;
  u.legL.rotation.x = Math.sin(u.phase) * swing;
  u.legR.rotation.x = -Math.sin(u.phase) * swing;
  u.body.position.y = 0.95 + Math.abs(Math.sin(u.phase)) * 0.04 * Math.min(1, speed / 3);
}

/** Geländewagen; Front zeigt in +x. Ursprung = Schwerpunkt des Fahrgestells. */
export function makeCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.5, metalness: 0.6 });
  const light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2a3a, emissiveIntensity: 1.6 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.5, 1.8), paint);
  chassis.position.y = 0.1; chassis.castShadow = true; chassis.receiveShadow = true;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 1.6), paint);
  hood.position.set(1.15, 0.45, 0); hood.castShadow = true;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.4), frame);
  seat.position.set(-0.35, 0.5, 0);
  g.add(chassis, hood, seat);
  // Überrollkäfig
  const bar = (x1, y1, z1, x2, y2, z2) => {
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6), frame);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true; g.add(m);
  };
  for (const z of [-0.75, 0.75]) { bar(0.4, 0.35, z, 0.0, 1.35, z); bar(-1.1, 0.35, z, -0.9, 1.35, z); bar(0.0, 1.35, z, -0.9, 1.35, z); }
  bar(0.0, 1.35, -0.75, 0.0, 1.35, 0.75); bar(-0.9, 1.35, -0.75, -0.9, 1.35, 0.75);
  for (const z of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.32), light); l.position.set(1.91, 0.22, z); g.add(l);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), tail); t.position.set(-1.91, 0.22, z); g.add(t);
  }
  // Räder (Position wird pro Bild aus der Federung gesetzt)
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18);
  wheelGeo.rotateX(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: 0x15141a, roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9b96a8, roughness: 0.4, metalness: 0.8 });
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Group();
    const t = new THREE.Mesh(wheelGeo, tire); t.castShadow = true;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 6).rotateX(Math.PI / 2), rim);
    w.add(t, r);
    g.add(w); wheels.push(w);
  }
  g.userData.wheels = wheels;
  return g;
}

/** Namensschild über einem Spieler. */
export function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.font = '600 52px "Space Grotesk", system-ui, sans-serif';
  const w = Math.min(500, x.measureText(text).width + 60);
  x.fillStyle = 'rgba(8,8,11,0.72)';
  const rx = (512 - w) / 2;
  x.beginPath(); x.roundRect(rx, 22, w, 84, 42); x.fill();
  x.fillStyle = color; x.beginPath(); x.arc(rx + 34, 64, 11, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#F4F4F6'; x.textBaseline = 'middle'; x.fillText(text, rx + 54, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  return s;
}
