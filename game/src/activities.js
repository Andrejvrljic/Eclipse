// Aktivitäten: Hindernisparcours, Rennstrecke, versteckte Truhen (Ruinen, Wachtürme, Verstecke) und Server-Events.
// Alles wird zusätzlich zur bestehenden Insel aufgebaut; das Gelände selbst bleibt unverändert.
import * as THREE from 'three';
import { SPAWN, SIZE, rng } from './terrain.js';
import { makeLabel } from './models.js';

const STASH_COOLDOWN = 30 * 60000;
const $ = (id) => document.getElementById(id);
const fmt = (ms) => (ms / 1000).toFixed(2) + ' s';

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function makeChest(gold = false) {
  const g = new THREE.Group();
  const base = box(1.1, 0.6, 0.7, 0x6b4426); base.position.y = 0.3;
  const lid = box(1.15, 0.25, 0.75, 0x7a4f2c); lid.position.y = 0.72;
  const band = box(0.16, 0.9, 0.78, gold ? 0xfbbf24 : 0xa8a29e, { metalness: 0.6, roughness: 0.4 }); band.position.y = 0.45;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: gold ? 0xfbbf24 : 0xa78bfa, transparent: true, opacity: 0.18, depthWrite: false }));
  glow.position.y = 0.6;
  g.add(base, lid, band, glow);
  g.userData = { lid, glow };
  return g;
}
function makeBeacon(color) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 160, 10, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.position.y = 80;
  return m;
}

export function createActivities({ scene, RAPIER, physics, world, ui, send, getProfile, onLoot }) {
  const fixed = (x, y, z, hx, hy, hz, ry = 0) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const b = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.8), b);
  };

  /* ---------- Hindernisparcours am Startplatz ---------- */
  const PROF = [0.5, 1.3, 2.1, 2.9, 3.6, 4.4, 5.1, 5.1, 4.4, 3.7, 2.9, 2.1, 1.3, 0.5];
  const plats = PROF.map((dh, i) => {
    const a = ((95 + (i / (PROF.length - 1)) * 100) * Math.PI) / 180, r = 27 + (i % 2 ? 1.2 : -1.2);
    const x = SPAWN.x + Math.cos(a) * r, z = SPAWN.z + Math.sin(a) * r;
    const size = i === 0 || i === PROF.length - 1 ? 3 : i % 3 === 1 ? 1.7 : 2.2;
    const top = world.heightAt(x, z) + dh, h = top - world.heightAt(x, z) + 0.6;
    const color = i === 0 ? 0x22c55e : i === PROF.length - 1 ? 0xfbbf24 : 0x5b4a86;
    const m = box(size, h, size, color); m.position.set(x, top - h / 2, z); scene.add(m);
    fixed(x, top - h / 2, z, size / 2, h / 2, size / 2);
    return { x, z, top, half: size / 2 };
  });
  const startLabel = makeLabel('Hindernisparcours', '#22C55E', 'START'); startLabel.position.set(plats[0].x, plats[0].top + 2.6, plats[0].z); startLabel.scale.set(4, 1, 1); scene.add(startLabel);
  const endLabel = makeLabel('Parcours-Ziel', '#FBBF24'); endLabel.position.set(plats.at(-1).x, plats.at(-1).top + 2.6, plats.at(-1).z); endLabel.scale.set(3.4, 0.85, 1); scene.add(endLabel);
  const onPlat = (p, feet) => Math.abs(feet.x - p.x) < p.half + 0.35 && Math.abs(feet.z - p.z) < p.half + 0.35 && Math.abs(feet.y - p.top) < 0.45;
  const park = { state: 'idle', t0: 0 };

  /* ---------- Rennstrecke (Checkpoints für Fahrzeuge) ---------- */
  const CP = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    let best = null;
    for (let r = 115; r >= 70 && !best; r -= 5) {
      const x = SPAWN.x + Math.cos(a) * r, z = SPAWN.z + Math.sin(a) * r, h = world.heightAt(x, z);
      if (h > 1.8 && h < 24 && world.slopeAt(x, z) < 0.6) best = { x, z, h };
    }
    if (best) CP.push(best);
  }
  const ringGeo = new THREE.TorusGeometry(6, 0.35, 8, 32);
  const rings = CP.map((c, i) => {
    const n = CP[(i + 1) % CP.length], p = CP[(i - 1 + CP.length) % CP.length];
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: i === 0 ? 0xfbbf24 : 0x38bdf8, transparent: true, opacity: 0.55, fog: true }));
    m.position.set(c.x, c.h + 5.2, c.z);
    m.rotation.y = Math.atan2(n.x - p.x, n.z - p.z);
    scene.add(m);
    return m;
  });
  if (CP.length) { const l = makeLabel('Rennstrecke', '#FBBF24', 'START'); l.position.set(CP[0].x, CP[0].h + 12.5, CP[0].z); l.scale.set(4.4, 1.1, 1); scene.add(l); }
  const raceBeacon = makeBeacon(0x38bdf8); raceBeacon.visible = false; scene.add(raceBeacon);
  const race = { state: 'idle', next: 0, t0: 0 };

  /* ---------- Ruinen, Wachtürme und versteckte Truhen ---------- */
  const r = rng(777), stashes = [];
  for (let tries = 0; tries < 4000 && stashes.length < 18; tries++) {
    const x = (r() - 0.5) * SIZE * 0.86, z = (r() - 0.5) * SIZE * 0.86;
    const h = world.heightAt(x, z);
    if (h < 2.2 || h > 30 || world.slopeAt(x, z) > 0.45 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 75) continue;
    if (stashes.some((s) => Math.hypot(s.x - x, s.z - z) < 60)) continue;
    stashes.push({ id: 'k' + stashes.length, x, z, h, kind: ['ruine', 'turm', 'versteck'][stashes.length % 3] });
  }
  for (const s of stashes) {
    const ry = r() * Math.PI;
    const c = Math.cos(ry), sn = Math.sin(ry);
    const at = (lx, lz) => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
    if (s.kind === 'ruine') {
      for (const [lx, lz, w, hh, rot] of [[0, -3, 6, 2.6, 0], [-3, 0, 4, 1.6, Math.PI / 2], [3, 0.8, 3, 3.2, Math.PI / 2]]) {
        const [wx, wz] = at(lx, lz); const gy = world.heightAt(wx, wz);
        const m = box(w, hh, 0.6, 0x77707f); m.position.set(wx, gy + hh / 2 - 0.2, wz); m.rotation.y = ry + rot; scene.add(m);
        fixed(wx, gy + hh / 2 - 0.2, wz, w / 2, hh / 2, 0.3, ry + rot);
      }
    } else if (s.kind === 'turm') {
      for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        const [wx, wz] = at(lx, lz); const gy = world.heightAt(wx, wz);
        const m = box(0.35, 7, 0.35, 0x5a4030); m.position.set(wx, gy + 3.3, wz); scene.add(m);
        fixed(wx, gy + 3.3, wz, 0.18, 3.5, 0.18);
      }
      const roof = box(4.4, 0.3, 4.4, 0x6b4a32); roof.position.set(s.x, s.h + 6.8, s.z); roof.rotation.y = ry; scene.add(roof);
    } else {
      for (let i = 0; i < 3; i++) {
        const [wx, wz] = at((i - 1) * 1.6, 1.4 + (i % 2) * 0.5); const gy = world.heightAt(wx, wz);
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9 + i * 0.15, 0), new THREE.MeshStandardMaterial({ color: 0x6d6875, roughness: 1, flatShading: true }));
        m.position.set(wx, gy + 0.4, wz); m.castShadow = true; scene.add(m);
      }
    }
    const chest = makeChest(false);
    chest.position.set(s.x, s.h, s.z); chest.rotation.y = ry; scene.add(chest);
    s.mesh = chest;
  }
  const stashReady = (s) => { const p = getProfile(); const t = p && p.stashes && p.stashes[s.id]; return !t || Date.now() - t > STASH_COOLDOWN; };

  /* ---------- Server-Events ---------- */
  let ev = null, evEnds = 0, treasure = null;
  function setTreasure(chest) {
    if (treasure) { scene.remove(treasure.group); treasure = null; }
    if (!chest) return;
    const g = new THREE.Group(); const c = makeChest(true); g.add(c, makeBeacon(0xfbbf24));
    g.position.set(chest[0], chest[1], chest[2]); scene.add(g);
    treasure = { group: g, chest: c, x: chest[0], y: chest[1], z: chest[2] };
  }

  const runbar = $('runbar');
  function showRun(text) { runbar.hidden = !text; if (text) runbar.textContent = text; }

  const api = {
    stashes, checkpoints: CP, platforms: plats,
    get event() { return ev; },
    setEvent(e, msg) {
      if (e) { ev = e; evEnds = performance.now() + (e.left || 0); setTreasure(e.type === 'schatz' ? e.chest : null); if (msg && msg.start) ui.big(`${e.title}: ${e.text}`); }
      else { ev = null; setTreasure(null); if (msg && msg.result) ui.big(`${msg.title || 'Event'} beendet · ${msg.result}`); }
      api.hud(0);
    },
    hud(yaw) {
      const bar = $('evbar');
      if (!ev) { bar.hidden = true; return; }
      bar.hidden = false;
      const left = Math.max(0, evEnds - performance.now());
      const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
      $('ev-title').textContent = ev.title;
      let info = `noch ${mm}:${String(ss).padStart(2, '0')}`;
      if (ev.target) info += ` · ${ev.progress} / ${ev.target}`;
      if (ev.type === 'schatz' && treasure && api._feet) {
        const dx = treasure.x - api._feet.x, dz = treasure.z - api._feet.z;
        const d = Math.hypot(dx, dz);
        // Richtung relativ zur Blickrichtung
        let a = Math.atan2(-dx, -dz) - yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
        const arrows = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
        info += ` · Schatz ${Math.round(d)} m ${arrows[(Math.round(a / (Math.PI / 4)) + 8) % 8]}`;
      }
      if (ev.type === 'jagd') info += ` · ${ev.participants || 0} Teilnehmer`;
      $('ev-info').textContent = info;
      $('ev-pbar').hidden = !ev.target;
      if (ev.target) $('ev-p').style.width = Math.min(100, (ev.progress / ev.target) * 100) + '%';
    },

    /** Hinweis für die Taste E (oder null). */
    prompt(feet, touch) {
      const k = touch ? 'Benutzen' : 'E';
      if (treasure && Math.hypot(treasure.x - feet.x, treasure.z - feet.z) < 4) return `${k}: Schatztruhe öffnen`;
      for (const s of stashes) if (Math.hypot(s.x - feet.x, s.z - feet.z) < 2.8) return stashReady(s) ? `${k}: Truhe öffnen` : 'Diese Truhe ist leer. Schau später wieder vorbei.';
      return '';
    },
    interact(feet) {
      if (treasure && Math.hypot(treasure.x - feet.x, treasure.z - feet.z) < 4) { send({ t: 'evopen' }); return true; }
      for (const s of stashes) {
        if (Math.hypot(s.x - feet.x, s.z - feet.z) >= 2.8) continue;
        if (!stashReady(s)) { ui.toast('Diese Truhe ist leer. In 30 Minuten ist sie wieder gefüllt.', 'warn'); return true; }
        const p = getProfile(); p.stashes = { ...(p.stashes || {}), [s.id]: Date.now() };
        const roll = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
        const pool = [['holz', roll(6, 14)], ['stein', roll(6, 14)], ['gebratenes_fleisch', roll(1, 3)], ['pfeil', roll(5, 10)], ['haut', roll(2, 4)], ['splitter', 1]];
        const loot = [];
        for (let i = 0; i < 3; i++) loot.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        onLoot(loot, roll(10, 30), s.kind);
        return true;
      }
      return false;
    },

    update(dt, ctx) {
      const t = performance.now();
      const { feet, grounded, driving, vpos } = ctx;
      api._feet = feet;
      if (treasure) { treasure.chest.rotation.y += dt * 0.8; treasure.chest.userData.glow.material.opacity = 0.25 + Math.sin(t / 300) * 0.1; }
      for (const s of stashes) if (Math.abs(s.x - feet.x) < 120 && Math.abs(s.z - feet.z) < 120) s.mesh.userData.glow.visible = stashReady(s);

      // Parcours
      if (!driving) {
        if (park.state === 'idle' && grounded && onPlat(plats[0], feet)) { park.state = 'ready'; ui.toast('Hindernisparcours: Spring los! Die Zeit läuft, sobald du den Start verlässt. Boden berühren = von vorn.'); }
        if (park.state === 'ready' && !onPlat(plats[0], feet)) {
          if (!grounded || plats.some((p, i) => i > 0 && onPlat(p, feet))) { park.state = 'run'; park.t0 = t; }
          else park.state = 'idle';
        }
        if (park.state === 'run') {
          showRun('Parcours ' + fmt(t - park.t0));
          if (grounded && feet.y < world.heightAt(feet.x, feet.z) + 0.3) { park.state = 'idle'; showRun(''); ui.toast('Boden berührt – zurück zum Start!', 'warn'); }
          else if (grounded && onPlat(plats.at(-1), feet)) { const ms = Math.round(t - park.t0); park.state = 'done'; showRun(''); ui.big(`Parcours geschafft in ${fmt(ms)}!`); send({ t: 'rec', course: 'parcours', ms }); }
          else if (t - park.t0 > 5 * 60000) { park.state = 'idle'; showRun(''); }
        }
        if (park.state === 'done' && !onPlat(plats.at(-1), feet)) park.state = 'idle';
      } else if (park.state === 'run') { park.state = 'idle'; showRun(''); }

      // Rennen
      if (CP.length >= 4) {
        const near = (i, p) => Math.hypot(CP[i].x - p.x, CP[i].z - p.z) < 9;
        if (!driving) { if (race.state === 'run') { race.state = 'idle'; showRun(''); ui.toast('Rennen abgebrochen (ausgestiegen).', 'warn'); } }
        else if (race.state === 'idle' && near(0, vpos)) { race.state = 'run'; race.next = 1; race.t0 = t; ui.toast(`Rennen gestartet! Fahr durch alle ${CP.length} Tore.`); }
        else if (race.state === 'run') {
          if (near(race.next % CP.length, vpos)) {
            if (race.next === CP.length) { const ms = Math.round(t - race.t0); race.state = 'cool'; race.cool = t; showRun(''); ui.big(`Rennen beendet in ${fmt(ms)}!`); send({ t: 'rec', course: 'rennen', ms }); }
            else race.next++;
          }
          if (race.state === 'run') showRun(`Rennen ${fmt(t - race.t0)} · Tor ${race.next}/${CP.length}`);
          if (race.state === 'run' && t - race.t0 > 10 * 60000) { race.state = 'idle'; showRun(''); }
        }
        if (race.state === 'cool' && t - race.cool > 4000 && !near(0, vpos)) race.state = 'idle';
        rings.forEach((m, i) => { m.material.opacity = race.state === 'run' ? (i === race.next % CP.length ? 0.9 : 0.18) : 0.5; });
        raceBeacon.visible = race.state === 'run';
        if (raceBeacon.visible) { const c = CP[race.next % CP.length]; raceBeacon.position.set(c.x, c.h + 80, c.z); }
      }
      if (ev) api.hud(ctx.yaw);
    },
  };
  return api;
}
