// Spielfigur: kinematischer Charakter-Controller (Rapier) + Modell.
import * as THREE from 'three';
import { makeFigure, animateFigure } from './models.js';
import { SIZE, SEA_LEVEL } from './terrain.js';

const HALF = 0.5, RADIUS = 0.4, CENTER = HALF + RADIUS; // Kapselmitte über den Füßen
const GRAVITY = -24, WALK = 5.2, RUN = 9.5, SWIM = 3.2, JUMP = 8.8;

export function createPlayer(RAPIER, physics, scene, spawn, color) {
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CENTER + 0.2, spawn.z));
  const collider = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setFriction(0), body);
  const ctl = physics.createCharacterController(0.03);
  ctl.enableAutostep(0.45, 0.25, false);
  ctl.enableSnapToGround(0.35);
  ctl.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
  ctl.setMinSlopeSlideAngle((44 * Math.PI) / 180);
  ctl.setApplyImpulsesToDynamicBodies(true);
  ctl.setCharacterMass(80);

  const fig = makeFigure(color);
  scene.add(fig);

  let vy = 0, grounded = false, speed = 0, facing = 0, swimming = false;
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), dir = new THREE.Vector3();
  const prev = new THREE.Vector3(), cur = new THREE.Vector3();

  const api = {
    body, collider, mesh: fig,
    get speed() { return speed; },
    get swimming() { return swimming; },
    get facing() { return facing; },
    /** Position der Füße. */
    feet(out = new THREE.Vector3()) { const t = body.translation(); return out.set(t.x, t.y - CENTER, t.z); },
    /** Ein fester Physik-Schritt. */
    step(dt, input, camYaw) {
      fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
      dir.set(0, 0, 0).addScaledVector(fwd, input.move.y).addScaledVector(right, input.move.x);
      const len = Math.min(1, dir.length());
      if (len > 0.01) dir.normalize();
      const t = body.translation();
      swimming = t.y - CENTER < SEA_LEVEL - 0.9;
      const target = swimming ? SWIM : input.sprint ? RUN : WALK;
      const v = target * len;

      if (swimming) {
        // Auftrieb: zur Oberfläche treiben
        vy += (SEA_LEVEL - 0.6 - (t.y - CENTER)) * 6 * dt;
        vy *= 0.9;
        if (input.jump) vy = 4;
      } else {
        vy += GRAVITY * dt;
        if (grounded && vy < 0) vy = -2;
        if (grounded && input.jump) { vy = JUMP; grounded = false; }
      }
      ctl.computeColliderMovement(collider, { x: dir.x * v * dt, y: vy * dt, z: dir.z * v * dt });
      const m = ctl.computedMovement();
      grounded = ctl.computedGrounded();
      if (!grounded && m.y > vy * dt + 1e-4 && vy > 0) vy = 0; // Kopf gestoßen
      const lim = SIZE / 2 - 6;
      const nx = Math.max(-lim, Math.min(lim, t.x + m.x)), nz = Math.max(-lim, Math.min(lim, t.z + m.z));
      body.setNextKinematicTranslation({ x: nx, y: t.y + m.y, z: nz });
      speed = Math.hypot(m.x, m.z) / dt;
      if (len > 0.05) facing = Math.atan2(-dir.x, -dir.z);
    },
    /** Nach dem Physik-Schritt: Modell nachführen. */
    render(dt) {
      const t = body.translation();
      fig.position.set(t.x, t.y - CENTER, t.z);
      let d = facing - fig.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      fig.rotation.y += d * Math.min(1, dt * 12);
      animateFigure(fig, grounded || swimming ? speed : 0, dt);
    },
    teleport(x, y, z) {
      body.setTranslation({ x, y: y + CENTER + 0.1, z }, true);
      body.setNextKinematicTranslation({ x, y: y + CENTER + 0.1, z });
      vy = 0;
    },
    setDriving(on) {
      collider.setEnabled(!on);
      fig.visible = !on;
    },
  };
  void prev; void cur;
  return api;
}
