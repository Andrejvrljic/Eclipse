// Basenbau: Bauteile darstellen (mit Kollision), Vorschau beim Platzieren, Einrasten auf dem 3-m-Raster, Türen.
import * as THREE from 'three';
import { makeStructure } from './models.js';

const GRID = 3;
const cellOf = (v) => Math.round(v / GRID) * GRID;
const WALLS = new Set(['wand', 'wand_tuer', 'fensterwand']);
const WALL_LIKE = new Set(['wand', 'wand_tuer', 'fensterwand', 'zaun']);
/** Blickrichtung auf 90°-Schritte runden (+ Drehung mit R). */
const snapYaw = (fx, fz, rot) => Math.round(Math.atan2(fx, fz) / (Math.PI / 2)) * (Math.PI / 2) + rot * (Math.PI / 2);

export function createBuildings(RAPIER, physics, scene, world) {
  const map = new Map();
  let ghost = null, ghostType = '';
  const okMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35, depthWrite: false });
  const badMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35, depthWrite: false });
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), qx = new THREE.Quaternion(), xAxis = new THREE.Vector3(1, 0, 0);

  function add(b) {
    if (map.has(b.id)) remove(b.id);
    const mesh = makeStructure(b.type);
    mesh.position.set(b.x, b.y, b.z); mesh.rotation.y = b.ry || 0;
    scene.add(mesh);
    q.setFromAxisAngle(up, b.ry || 0);
    const body = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    for (const [hx, hy, hz, ox, oy, oz, rx] of mesh.userData.boxes) {
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ox, oy, oz);
      if (rx) { qx.setFromAxisAngle(xAxis, rx); cd.setRotation({ x: qx.x, y: qx.y, z: qx.z, w: qx.w }); }
      physics.createCollider(cd, body);
    }
    let doorCol = null;
    if (b.type === 'wand_tuer') doorCol = physics.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 1.2, 0.06).setTranslation(0, 1.2, 0), body);
    const e = { b, mesh, body, doorCol, open: false };
    map.set(b.id, e);
    if (b.open) door(b.id, true);
    return e;
  }
  function remove(id) {
    const e = map.get(id); if (!e) return;
    scene.remove(e.mesh);
    physics.removeRigidBody(e.body);
    map.delete(id);
  }
  function door(id, open) {
    const e = map.get(id); if (!e || !e.mesh.userData.door) return;
    e.open = open;
    e.mesh.userData.door.rotation.y = open ? -Math.PI / 2 : 0;
    if (e.doorCol) e.doorCol.setEnabled(!open);
  }

  const near = (x, z, r, type) => [...map.values()].filter((e) => (!type || e.b.type === type) && Math.hypot(e.b.x - x, e.b.z - z) < r);

  /** Berechnet den Bauplatz für ein Bauteil vor dem Spieler. */
  /** Oberkante von Fundament/Decke/Treppe in einer Zelle, die am besten zur Fußhöhe passt (oder null). */
  function floorAt(cx, cz, feetY) {
    const tops = [...near(cx, cz, 0.5, 'fundament').map((e) => e.b.y + 0.4), ...near(cx, cz, 0.5, 'decke').map((e) => e.b.y + 0.25)]
      .filter((h) => h < feetY + 1.6).sort((a, b) => b - a);
    return tops.length ? tops[0] : null;
  }

  function placement(type, feet, yaw, rot = 0) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const tx = feet.x + fx * 4.5, tz = feet.z + fz * 4.5;
    let x = tx, z = tz, y = world.heightAt(tx, tz), ry = 0, valid = true;
    if (type === 'fundament') {
      x = cellOf(tx); z = cellOf(tz);
      const corners = [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([a, b]) => world.heightAt(x + a, z + b));
      y = Math.max(...corners) - 0.15;
      const neighbor = near(x, z, 4.3, 'fundament').find((e) => Math.abs(e.b.y - y) < 1.2);
      if (neighbor) y = neighbor.b.y;
      if (near(x, z, 0.5, 'fundament').some((e) => Math.abs(e.b.y - y) < 1)) valid = false;
      if (y < 0.2) valid = false;
    } else if (WALL_LIKE.has(type)) {
      const cx = cellOf(tx), cz = cellOf(tz);
      const ox = tx - cx, oz = tz - cz;
      if (Math.abs(ox) > Math.abs(oz)) { x = cx + Math.sign(ox || 1) * GRID / 2; z = cz; ry = Math.PI / 2; }
      else { x = cx; z = cz + Math.sign(oz || 1) * GRID / 2; ry = 0; }
      // Auf Fundament oder Decke stellen, deren Oberkante am nächsten an den Füßen liegt
      const supports = [...near(cx, cz, 0.5, 'fundament').map((e) => e.b.y + 0.4), ...near(cx, cz, 0.5, 'decke').map((e) => e.b.y + 0.25),
        ...near(x * 2 - cx, z * 2 - cz, 0.5, 'fundament').map((e) => e.b.y + 0.4), ...near(x * 2 - cx, z * 2 - cz, 0.5, 'decke').map((e) => e.b.y + 0.25)];
      if (supports.length) { supports.sort((a, b) => Math.abs(a - feet.y) - Math.abs(b - feet.y)); y = supports[0]; }
      else y = world.heightAt(x, z) - 0.05;
      if (near(x, z, 0.4).some((e) => WALL_LIKE.has(e.b.type) && Math.abs(e.b.y - y) < 1)) valid = false;
    } else if (type === 'treppe') {
      x = cellOf(tx); z = cellOf(tz);
      ry = snapYaw(fx, fz, rot);
      const f = floorAt(x, z, feet.y);
      y = f ?? world.heightAt(x, z) - 0.05;
      if (near(x, z, 0.5, 'treppe').some((e) => Math.abs(e.b.y - y) < 1)) valid = false;
      if (y < 0.2) valid = false;
    } else if (type === 'decke' || type === 'dach') {
      x = cellOf(tx); z = cellOf(tz);
      if (type === 'dach') ry = snapYaw(fx, fz, rot);
      const walls = [...map.values()].filter((e) => WALLS.has(e.b.type) && Math.abs(Math.abs(e.b.x - x) + Math.abs(e.b.z - z) - 1.5) < 0.2);
      const ceil = [...near(x, z, 4.3, 'decke'), ...near(x, z, 4.3, 'dach')];
      if (walls.length) { walls.sort((a, b) => Math.abs(a.b.y + 3 - feet.y - 3) - Math.abs(b.b.y + 3 - feet.y - 3)); y = walls[0].b.y + 3; }
      else if (ceil.length) y = ceil[0].b.y;
      else valid = false;
      if ([...near(x, z, 0.5, 'decke'), ...near(x, z, 0.5, 'dach')].some((e) => Math.abs(e.b.y - y) < 1)) valid = false;
    } else {
      x = tx; z = tz; ry = yaw + rot * (Math.PI / 2);
      const floor = [...near(cellOf(tx), cellOf(tz), 0.5, 'fundament'), ...near(cellOf(tx), cellOf(tz), 0.5, 'decke')]
        .map((e) => e.b.y + (e.b.type === 'fundament' ? 0.4 : 0.25)).filter((h) => h < feet.y + 1.5).sort((a, b) => b - a)[0];
      y = Math.max(world.heightAt(x, z), floor ?? -Infinity);
      if (y < 0.2) valid = false;
    }
    if (Math.hypot(x - feet.x, z - feet.z) > 12) valid = false;
    return { x, y, z, ry, valid };
  }

  return {
    map, add, remove, door,
    sync(list) { for (const id of [...map.keys()]) remove(id); for (const b of list) add(b); },
    /** Vorschau anzeigen (oder mit type = '' ausblenden). */
    preview(type, feet, yaw, rot = 0) {
      if (!type) { if (ghost) { scene.remove(ghost); ghost = null; ghostType = ''; } return null; }
      if (ghostType !== type) {
        if (ghost) scene.remove(ghost);
        ghost = makeStructure(type); ghostType = type;
        ghost.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } if (o.isLight) o.visible = false; });
        scene.add(ghost);
      }
      const p = placement(type, feet, yaw, rot);
      ghost.position.set(p.x, p.y, p.z); ghost.rotation.y = p.ry;
      ghost.traverse((o) => { if (o.isMesh) o.material = p.valid ? okMat : badMat; });
      return p;
    },
    /** Bauteil vor dem Spieler (für Tür und Abriss). */
    pick(feet, yaw, maxDist = 4.5) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let best = null, bd = maxDist;
      for (const e of map.values()) {
        const dx = e.b.x - feet.x, dz = e.b.z - feet.z, d = Math.hypot(dx, dz);
        if (d > bd || e.b.y > feet.y + 3.2 || e.b.y + 3.2 < feet.y) continue;
        if ((dx * fx + dz * fz) / (d || 1) < 0.2 && d > 1.6) continue;
        bd = d; best = e;
      }
      return best;
    },
    nearStation(pos, type, r = 5) { return near(pos.x, pos.z, r, type).some((e) => Math.abs(e.b.y - pos.y) < 3); },
    bedsOf(pid) { return [...map.values()].filter((e) => e.b.type === 'schlafsack' && e.b.owner === pid).map((e) => e.b); },
    update(t) {
      for (const e of map.values()) {
        const f = e.mesh.userData.flame;
        if (f) { f.scale.set(1 + Math.sin(t * 13 + e.b.x) * 0.12, 1 + Math.sin(t * 9 + e.b.z) * 0.18, 1); e.mesh.userData.light.intensity = 2 + Math.sin(t * 11) * 0.4; }
      }
    },
  };
}
