// Gemeinsame Fahrzeuge: Wer steuert, simuliert die Physik und sendet die Lage; alle anderen sehen das Fahrzeug
// in derselben Farbe, mit drehenden und lenkenden Rädern.
import * as THREE from 'three';
import { makeVehicle, VEHICLE_SPECS } from './models.js';
import { SEA_LEVEL } from './terrain.js';

export function createVehicles(RAPIER, physics, scene, world) {
  const list = new Map();
  const tmpQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), axle = new THREE.Vector3(0, 0, -1);
  const steerQ = new THREE.Quaternion(), spinQ = new THREE.Quaternion(), fwd = new THREE.Vector3();
  const EXCLUDE_SENSORS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;

  function build(v) {
    const spec = VEHICLE_SPECS[v.type] || VEHICLE_SPECS.gelaendewagen;
    const [px, py, pz] = v.p, [qx, qy, qz, qw] = v.q;
    const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(px, py, pz).setRotation({ x: qx, y: qy, z: qz, w: qw })
      .setCanSleep(true).setLinearDamping(0.05).setAngularDamping(0.8).setCcdEnabled(true));
    const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(...spec.half).setDensity(spec.density).setTranslation(0, 0.1, 0).setFriction(0.6), body);
    const ctl = physics.createVehicleController(body);
    for (const [x, z] of spec.wheels) ctl.addWheel({ x, y: spec.connY, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, spec.rest, spec.radius);
    for (let i = 0; i < spec.wheels.length; i++) {
      ctl.setWheelSuspensionStiffness(i, 30); ctl.setWheelSuspensionCompression(i, 3.0); ctl.setWheelSuspensionRelaxation(i, 4.0);
      ctl.setWheelFrictionSlip(i, 2.2); ctl.setWheelSideFrictionStiffness(i, 1.2);
      ctl.setWheelMaxSuspensionTravel(i, spec.rest * 0.8); ctl.setWheelMaxSuspensionForce(i, 200000);
    }
    const mesh = makeVehicle(v.type, v.color);
    scene.add(mesh);
    const e = {
      id: v.id, type: v.type, color: v.color, spec, body, collider, ctl, mesh,
      mode: 'remote', driver: v.driver || null, ctrl: v.ctrl || null,
      pos: new THREE.Vector3(px, py, pz), quat: new THREE.Quaternion(qx, qy, qz, qw),
      tPos: new THREE.Vector3(px, py, pz), tQuat: new THREE.Quaternion(qx, qy, qz, qw),
      sp: 0, st: 0, steer: 0, spin: 0, restT: 0, lastSend: 0, seats: v.seats || [], boost: 1,
    };
    list.set(v.id, e);
    return e;
  }
  function destroy(e) {
    scene.remove(e.mesh);
    try { physics.removeRigidBody(e.body); } catch { /* bereits entfernt */ }
    list.delete(e.id);
  }

  function setLocal(e, on) {
    if (on && e.mode !== 'local') {
      e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      e.mode = 'local'; e.restT = 0;
    } else if (!on && e.mode !== 'remote') {
      const t = e.body.translation(), r = e.body.rotation();
      e.tPos.set(t.x, t.y, t.z); e.tQuat.set(r.x, r.y, r.z, r.w); e.pos.copy(e.tPos); e.quat.copy(e.tQuat);
      e.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      e.mode = 'remote';
    }
  }

  const api = {
    list,
    /** Vollständige Liste vom Server übernehmen. */
    sync(arr, mySid) {
      const seen = new Set();
      for (const v of arr) {
        seen.add(v.id);
        let e = list.get(v.id);
        if (e && (e.type !== v.type || e.color !== v.color)) { destroy(e); e = null; }
        if (!e) e = build(v);
        e.driver = v.driver; e.ctrl = v.ctrl; e.seats = v.seats || [];
        if (v.ctrl !== mySid) { setLocal(e, false); e.tPos.fromArray(v.p); e.tQuat.fromArray(v.q); e.pos.copy(e.tPos); e.quat.copy(e.tQuat); }
      }
      for (const e of [...list.values()]) if (!seen.has(e.id)) destroy(e);
    },
    define(v, mySid) { const e = list.get(v.id); if (e) destroy(e); const n = build(v); if (v.ctrl === mySid) setLocal(n, true); },
    remove(id) { const e = list.get(id); if (e) destroy(e); },
    setSeats(id, seats) { const e = list.get(id); if (e) e.seats = seats || []; },
    /** Freie Mitfahrer-Plätze. */
    freeSeats(e) { const n = (e.spec.seats || []).length; let f = 0; for (let i = 0; i < n; i++) if (!e.seats[i]) f++; return f; },
    /** Sitzposition: 0 = Fahrer, 1… = Mitfahrer. */
    seatAt(e, idx, out = new THREE.Vector3()) {
      const off = idx > 0 ? (e.spec.seats || [])[idx - 1] || e.spec.seat : e.spec.seat;
      const r = e.mode === 'local' ? e.body.rotation() : e.quat;
      tmpQ.set(r.x, r.y, r.z, r.w);
      const t = api.position(e);
      return out.set(off[0], off[1], off[2]).applyQuaternion(tmpQ).add(new THREE.Vector3(t.x, t.y, t.z));
    },
    owner(id, driver, ctrl, mySid) {
      const e = list.get(id); if (!e) return;
      e.driver = driver; e.ctrl = ctrl;
      setLocal(e, ctrl === mySid);
    },
    remote(id, p, q, sp, st) {
      const e = list.get(id); if (!e || e.mode === 'local') return;
      e.tPos.fromArray(p); e.tQuat.fromArray(q); e.sp = sp || 0; e.st = st || 0;
    },
    get(id) { return list.get(id); },
    speed(e) { const l = e.body.linvel(); const f = api.forward(e, fwd); return l.x * f.x + l.y * f.y + l.z * f.z; },
    forward(e, out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(e.mode === 'local' ? tmpQ.copy(e.body.rotation()) : e.quat); },
    position(e) { return e.mode === 'local' ? e.body.translation() : e.pos; },
    nearest(p, maxDist) {
      let best = null, bd = maxDist;
      for (const e of list.values()) {
        const t = api.position(e);
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d < bd + e.spec.half[0] * 0.5 && Math.abs(t.y - p.y) < 3.5) { bd = d; best = e; }
      }
      return best;
    },
    flipped(e) { const r = e.body.rotation(); return 1 - 2 * (r.x * r.x + r.z * r.z) < 0.3; },

    /** Physik-Schritt für Fahrzeuge, die dieser Client steuert. */
    step(dt, drivenId, input) {
      for (const e of list.values()) {
        if (e.mode !== 'local') continue;
        const s = e.spec, n = s.wheels.length;
        if (e.id === drivenId) {
          const sp = api.speed(e), throttle = input.move.y;
          let engine = 0, brake = 0;
          // Boost mit Shift: mehr Kraft und höhere Spitze, solange die Anzeige reicht
          const boosting = input.sprint && throttle > 0.05 && e.boost > 0.02;
          if (boosting) e.boost = Math.max(0, e.boost - dt * 0.33); else e.boost = Math.min(1, e.boost + dt * 0.12);
          const bk = boosting ? 1.7 : 1, maxF = s.maxFwd * (boosting ? 1.3 : 1);
          const curve = 1 - 0.6 * Math.min(1, (Math.abs(sp) / maxF) ** 2); // viel Kraft beim Anfahren, weniger bei Höchstgeschwindigkeit
          if (throttle > 0.05) { if (sp < -0.5) brake = s.engine / 28; else if (sp < maxF) engine = -s.engine * bk * throttle * curve; }
          else if (throttle < -0.05) { if (sp > 0.5) brake = s.engine / 28; else if (sp > -s.maxRev) engine = s.engine * 0.6 * -throttle; }
          else brake = s.engine / 450;
          const target = -input.move.x * s.steer * (1 - Math.min(0.55, Math.abs(sp) / 45));
          e.steer += (target - e.steer) * Math.min(1, dt * 8);
          for (let i = 0; i < n; i++) {
            e.ctl.setWheelEngineForce(i, i >= 2 ? engine : engine * 0.5);
            e.ctl.setWheelBrake(i, input.brake ? (i >= 2 ? s.engine / 16 : s.engine / 70) : brake);
          }
          e.ctl.setWheelSteering(0, e.steer); e.ctl.setWheelSteering(1, e.steer);
          if (engine) e.body.wakeUp();
        } else {
          for (let i = 0; i < n; i++) { e.ctl.setWheelEngineForce(i, 0); e.ctl.setWheelBrake(i, s.engine / 300); }
          e.steer *= 0.9; e.ctl.setWheelSteering(0, e.steer); e.ctl.setWheelSteering(1, e.steer);
        }
        e.ctl.updateVehicle(dt, EXCLUDE_SENSORS);
        // Selbstaufrichten: bei starker Schräglage sanft zurück auf die Räder drehen
        const r = e.body.rotation();
        const ux = 2 * (r.x * r.y - r.w * r.z), uy = 1 - 2 * (r.x * r.x + r.z * r.z), uz = 2 * (r.y * r.z + r.w * r.x);
        if (uy < 0.85) {
          const m = e.body.mass() * dt * 4.5 * (1 - uy);
          e.body.applyTorqueImpulse({ x: -uz * m, y: 0, z: ux * m }, true); // Drehachse = eigene Hochachse × Welt-Hoch
        }
      }
    },

    render(dt) {
      const k = 1 - Math.exp(-dt * 12);
      for (const e of list.values()) {
        const s = e.spec, wheels = e.mesh.userData.wheels;
        if (e.mode === 'local') {
          const t = e.body.translation(), r = e.body.rotation();
          e.mesh.position.set(t.x, t.y, t.z); e.mesh.quaternion.set(r.x, r.y, r.z, r.w);
          for (let i = 0; i < wheels.length; i++) {
            const len = e.ctl.wheelSuspensionLength(i) ?? s.rest;
            wheels[i].position.set(s.wheels[i][0], s.connY - len, s.wheels[i][1]);
            steerQ.setFromAxisAngle(up, i < 2 ? (e.ctl.wheelSteering(i) ?? 0) : 0);
            spinQ.setFromAxisAngle(axle, e.ctl.wheelRotation(i) ?? 0);
            wheels[i].quaternion.copy(steerQ).multiply(spinQ);
          }
          e.sp = api.speed(e); e.st = e.steer;
        } else {
          e.pos.lerp(e.tPos, k); e.quat.slerp(e.tQuat, k);
          e.body.setNextKinematicTranslation(e.pos); e.body.setNextKinematicRotation(e.quat);
          e.mesh.position.copy(e.pos); e.mesh.quaternion.copy(e.quat);
          // Räder anderer Fahrzeuge: Ruhelage, Lenkeinschlag und Drehung aus der Geschwindigkeit
          e.spin -= (e.sp / s.radius) * dt;
          for (let i = 0; i < wheels.length; i++) {
            const gh = world.heightAt(e.pos.x, e.pos.z);
            const sag = Math.min(s.rest, Math.max(s.rest * 0.4, e.pos.y - gh - 0.5));
            wheels[i].position.set(s.wheels[i][0], s.connY - sag, s.wheels[i][1]);
            steerQ.setFromAxisAngle(up, i < 2 ? e.st : 0);
            spinQ.setFromAxisAngle(axle, e.spin);
            wheels[i].quaternion.copy(steerQ).multiply(spinQ);
          }
        }
      }
    },

    /** Fahrzeuge, die zur Ruhe gekommen sind oder ins Wasser gefallen sind. */
    maintain(dt, drivenId, onRest) {
      for (const e of list.values()) {
        if (e.mode !== 'local') continue;
        const t = e.body.translation();
        if (t.y < SEA_LEVEL - 0.6) api.reset(e, true);
        else if (t.y < world.heightAt(t.x, t.z) - 1.5) api.reset(e, false); // im Boden verschwunden → hochsetzen
        if (e.id === drivenId) continue;
        const l = e.body.linvel();
        if (Math.hypot(l.x, l.y, l.z) < 0.4) e.restT += dt; else e.restT = 0;
        if (e.restT > 1.2) { e.restT = 0; onRest(e); }
      }
    },

    /** Aufrecht hinstellen (und bei Bedarf an Land). */
    reset(e, toLand = false) {
      const t = e.body.translation(), f = api.forward(e);
      let x = t.x, z = t.z;
      if (toLand && world.findLand) { const l = world.findLand(x, z); x = l.x; z = l.z; }
      const yaw = Math.atan2(-f.z, f.x);
      const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
      e.body.setTranslation({ x, y: world.heightAt(x, z) + 1.8, z }, true);
      e.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },
    exitPoint(e) {
      const r = e.mode === 'local' ? e.body.rotation() : e.quat;
      tmpQ.set(r.x, r.y, r.z, r.w);
      const off = new THREE.Vector3(-0.3, 0, -(e.spec.half[2] + 1.1)).applyQuaternion(tmpQ);
      const t = api.position(e);
      return { x: t.x + off.x, y: t.y, z: t.z + off.z };
    },
    seatPos(e, out) {
      const r = e.mode === 'local' ? e.body.rotation() : e.quat;
      tmpQ.set(r.x, r.y, r.z, r.w);
      const t = api.position(e);
      return out.set(...e.spec.seat).applyQuaternion(tmpQ).add(new THREE.Vector3(t.x, t.y, t.z));
    },
    velocity(e) { if (e.mode === 'local') { const l = e.body.linvel(); return new THREE.Vector3(l.x, l.y, l.z); } return api.forward(e).multiplyScalar(e.sp); },
  };
  return api;
}
