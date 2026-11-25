// Fahrzeug: Rapier-Raycast-Fahrzeug (Front zeigt in +x).
import * as THREE from 'three';
import { makeCar } from './models.js';

const WHEELS = [[1.3, 0.85], [1.3, -0.85], [-1.3, 0.85], [-1.3, -0.85]]; // vorne links/rechts, hinten links/rechts
const CONN_Y = -0.15, REST = 0.45, RADIUS = 0.42;
const ENGINE = 1500, MAX_FWD = 27, MAX_REV = 9, MAX_STEER = 0.5;

export function createVehicle(RAPIER, physics, scene, at, yaw, color) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(at.x, at.y + 1.2, at.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setCanSleep(true).setLinearDamping(0.05).setAngularDamping(0.8));
  const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(1.9, 0.35, 0.95).setDensity(90).setTranslation(0, 0.1, 0).setFriction(0.6), body);
  const ctl = physics.createVehicleController(body);
  for (const [x, z] of WHEELS) ctl.addWheel({ x, y: CONN_Y, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, REST, RADIUS);
  for (let i = 0; i < 4; i++) {
    ctl.setWheelSuspensionStiffness(i, 28); ctl.setWheelSuspensionCompression(i, 2.4); ctl.setWheelSuspensionRelaxation(i, 3.2);
    ctl.setWheelFrictionSlip(i, 2.2); ctl.setWheelSideFrictionStiffness(i, 1.2);
    ctl.setWheelMaxSuspensionTravel(i, 0.35); ctl.setWheelMaxSuspensionForce(i, 60000);
  }
  const mesh = makeCar(color);
  scene.add(mesh);
  const wheels = mesh.userData.wheels;

  let steer = 0, occupied = false;
  const tmpQ = new THREE.Quaternion(), fwd = new THREE.Vector3(), steerQ = new THREE.Quaternion(), spinQ = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), axle = new THREE.Vector3(0, 0, -1);

  return {
    body, collider, mesh,
    get occupied() { return occupied; },
    set occupied(v) { occupied = v; if (!v) for (let i = 0; i < 4; i++) { ctl.setWheelEngineForce(i, 0); ctl.setWheelBrake(i, 4); } },
    /** Geschwindigkeit in m/s (positiv = vorwärts). */
    speed() { const l = body.linvel(), f = this.forward(fwd); return l.x * f.x + l.y * f.y + l.z * f.z; },
    forward(out = new THREE.Vector3()) { const r = body.rotation(); return out.set(1, 0, 0).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w)); },
    step(dt, input) {
      if (occupied) {
        const sp = this.speed();
        const throttle = input.move.y;
        let engine = 0, brake = 0;
        if (throttle > 0.05) { if (sp < -0.5) brake = 45; else if (sp < MAX_FWD) engine = -ENGINE * throttle; }
        else if (throttle < -0.05) { if (sp > 0.5) brake = 45; else if (sp > -MAX_REV) engine = ENGINE * 0.6 * -throttle; }
        else brake = 3;
        const target = -input.move.x * MAX_STEER * (1 - Math.min(0.55, Math.abs(sp) / 45));
        steer += (target - steer) * Math.min(1, dt * 8);
        for (let i = 0; i < 4; i++) {
          ctl.setWheelEngineForce(i, i >= 2 ? engine : engine * 0.5);
          ctl.setWheelBrake(i, input.brake ? (i >= 2 ? 90 : 20) : brake);
        }
        ctl.setWheelSteering(0, steer); ctl.setWheelSteering(1, steer);
        if (Math.abs(engine) > 0) body.wakeUp();
      }
      ctl.updateVehicle(dt);
    },
    render() {
      const t = body.translation(), r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
      for (let i = 0; i < 4; i++) {
        const len = ctl.wheelSuspensionLength(i) ?? REST;
        wheels[i].position.set(WHEELS[i][0], CONN_Y - len, WHEELS[i][1]);
        steerQ.setFromAxisAngle(up, i < 2 ? (ctl.wheelSteering(i) ?? 0) : 0);
        spinQ.setFromAxisAngle(axle, ctl.wheelRotation(i) ?? 0);
        wheels[i].quaternion.copy(steerQ).multiply(spinQ);
      }
      void fwd;
    },
    /** Steht das Auto auf dem Dach oder der Seite? */
    flipped() { const r = body.rotation(); return 1 - 2 * (r.x * r.x + r.z * r.z) < 0.3; },
    reset(heightAt) {
      const t = body.translation(), f = this.forward();
      const yaw = Math.atan2(-f.z, f.x);
      const qq = new THREE.Quaternion().setFromAxisAngle(up, yaw);
      body.setTranslation({ x: t.x, y: heightAt(t.x, t.z) + 1.6, z: t.z }, true);
      body.setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },
    /** Ausstiegspunkt links neben dem Fahrer. */
    exitPoint() {
      const r = body.rotation(); tmpQ.set(r.x, r.y, r.z, r.w);
      const off = new THREE.Vector3(-0.3, 0, -2.0).applyQuaternion(tmpQ);
      const t = body.translation();
      return { x: t.x + off.x, z: t.z + off.z };
    },
  };
}
