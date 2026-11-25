// Kreaturen im Browser: Darstellung der vom Server gesteuerten Tiere und Monster (geglättet).
import * as THREE from 'three';
import { makeCreature, animateCreature, makeBar, setBar, makeLabel } from './models.js';

export function createCreatures(scene, getConfig) {
  const map = new Map();
  const corpses = [];

  function ensure(id, spId) {
    let c = map.get(id);
    const sp = getConfig().species[spId];
    if (c && c.sp === spId) return c;
    if (c) remove(id);
    if (!sp) return null;
    const mesh = makeCreature(spId, sp);
    const bar = makeBar(); bar.visible = false;
    scene.add(mesh, bar);
    c = { id, sp: spId, def: sp, mesh, bar, label: null, owner: '', pos: new THREE.Vector3(), target: new THREE.Vector3(), ry: 0, tRy: 0, hp: 100, moving: 0, atk: 0, has: false, seen: 0, mine: 0, ridden: 0 };
    map.set(id, c);
    return c;
  }
  function remove(id) {
    const c = map.get(id); if (!c) return;
    scene.remove(c.mesh, c.bar); if (c.label) scene.remove(c.label);
    map.delete(id);
  }

  return {
    map,
    /** Server-Schnappschuss: [id, art, x, y, z, ry, hp%, bewegung, besitzer, angriff, geritten, meins]. */
    snapshot(list, now) {
      for (const r of list) {
        const [id, spId, x, y, z, ry, hp, moving, owner, atk, ridden, mine] = r;
        const c = ensure(id, spId); if (!c) continue;
        c.target.set(x, y, z); c.tRy = ry; c.hp = hp; c.moving = moving; c.atk = atk; c.seen = now; c.ridden = ridden; c.mine = mine;
        if (!c.has) { c.pos.copy(c.target); c.ry = ry; c.has = true; }
        if (owner !== c.owner) {
          c.owner = owner;
          if (c.label) { scene.remove(c.label); c.label = null; }
          if (owner) { c.label = makeLabel(`${c.def.name} · ${owner}`, '#A78BFA'); scene.add(c.label); }
        }
      }
      // Kreaturen außerhalb der Sichtweite ausblenden
      for (const c of [...map.values()]) if (now - c.seen > 3000) remove(c.id);
    },
    die(id, silent) {
      const c = map.get(id); if (!c) return;
      if (!silent) { corpses.push({ mesh: c.mesh, t: 0 }); scene.remove(c.bar); if (c.label) scene.remove(c.label); map.delete(id); }
      else remove(id);
    },
    update(dt, camera, ridingId, ridePose) {
      const k = 1 - Math.exp(-dt * 8);
      for (const c of map.values()) {
        if (c.id === ridingId && ridePose) { c.pos.copy(ridePose.p); c.ry = ridePose.r; }
        else {
          c.pos.lerp(c.target, k);
          let d = c.tRy - c.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); c.ry += d * k;
        }
        c.mesh.position.copy(c.pos); c.mesh.rotation.y = c.ry;
        animateCreature(c.mesh, c.id === ridingId ? (ridePose && ridePose.moving) : c.moving, dt, c.atk);
        const sc = Number(c.def.scale) || 1;
        const top = c.pos.y + 2.2 * sc + 0.3;
        c.bar.visible = c.hp < 100 && c.hp > 0;
        if (c.bar.visible) { setBar(c.bar, c.hp, c.owner ? '#A78BFA' : '#EF4444'); c.bar.position.set(c.pos.x, top, c.pos.z); }
        if (c.label) {
          c.label.position.set(c.pos.x, top + 0.35, c.pos.z);
          const dist = camera.position.distanceTo(c.label.position);
          const s = Math.max(1, dist / 16); c.label.scale.set(2.4 * s, 0.6 * s, 1);
        }
      }
      for (let i = corpses.length - 1; i >= 0; i--) {
        const p = corpses[i]; p.t += dt;
        p.mesh.rotation.z = Math.min(Math.PI / 2, p.t * 3);
        p.mesh.position.y -= dt * 0.25;
        if (p.t > 4) { scene.remove(p.mesh); corpses.splice(i, 1); }
      }
    },
    /** Nächste Kreatur vor dem Spieler (für Angriffe und Füttern). */
    pick(origin, dir, maxDist, filter = () => true) {
      let best = null, bs = Infinity;
      for (const c of map.values()) {
        if (!filter(c)) continue;
        const sc = Number(c.def.scale) || 1;
        const dx = c.pos.x - origin.x, dz = c.pos.z - origin.z;
        const d = Math.hypot(dx, dz) - sc * 0.9;
        if (d > maxDist) continue;
        const dot = (dx * dir.x + dz * dir.z) / (Math.hypot(dx, dz) || 1);
        if (dot < 0.35 && d > 1) continue;
        const score = d - dot * 2;
        if (score < bs) { bs = score; best = c; }
      }
      return best;
    },
    clear() { for (const id of [...map.keys()]) remove(id); },
  };
}
