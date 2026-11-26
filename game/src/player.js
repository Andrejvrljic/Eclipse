// Spielfigur: kinematischer Charakter-Controller (Rapier), Abrollen mit echter Physik, Schwimmen, Admin-Flug.
import * as THREE from 'three';
import { makeFigure, animateFigure } from './models.js';
import { SIZE, SEA_LEVEL } from './terrain.js';

const HALF = 0.5, RADIUS = 0.4, CENTER = HALF + RADIUS;
const GRAVITY = -24, WALK = 5.4, RUN = 10, SWIM = 3.2, JUMP = 8.8, FLY = 28;

export function createPlayer(RAPIER, physics, scene, spawn, color, events = {}) {
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CENTER + 0.3, spawn.z));
  const collider = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setFriction(0), body);
  const ctl = physics.createCharacterController(0.03);
  ctl.enableAutostep(0.5, 0.2, false);
  ctl.enableSnapToGround(0.4);
  ctl.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
  ctl.setMinSlopeSlideAngle((46 * Math.PI) / 180);
  ctl.setApplyImpulsesToDynamicBodies(true);
  ctl.setCharacterMass(80);
  const EXCLUDE_SENSORS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;

  const fig = makeFigure(color);
  scene.add(fig);
  const root = fig.userData.root;

  let vy = 0, grounded = false, speed = 0, facing = 0, swimming = false, swimT = 0, fallFrom = null;
  let tumble = null; // { body, collider, t, rest }
  let flying = false, hidden = false, standT = 0, stuckT = 0;
  const lastPos = new THREE.Vector3();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), dir = new THREE.Vector3();

  function endTumble() {
    const p = tumble.body.translation();
    physics.removeRigidBody(tumble.body);
    tumble = null;
    const ground = events.heightAt ? events.heightAt(p.x, p.z) : p.y - CENTER;
    const y = Math.max(p.y, Math.max(ground, SEA_LEVEL - 1) + CENTER + 0.05);
    body.setTranslation({ x: p.x, y, z: p.z }, true);
    body.setNextKinematicTranslation({ x: p.x, y, z: p.z });
    collider.setEnabled(!hidden);
    root.position.set(0, 0, 0); fig.quaternion.identity(); fig.rotation.y = facing;
    vy = 0; standT = 0.7;
    events.onRecover?.();
  }

  const api = {
    body, collider, mesh: fig,
    get speed() { return speed; },
    get swimming() { return swimming; },
    get tumbling() { return !!tumble; },
    get grounded() { return grounded; },
    get flying() { return flying; },
    set flying(v) { flying = !!v; collider.setEnabled(!flying && !hidden); vy = 0; },
    get facing() { return facing; },
    set facing(v) { facing = v; },
    /** Mittelpunkt (bzw. Abroll-Körper). */
    center(out = new THREE.Vector3()) { const t = (tumble ? tumble.body : body).translation(); return out.set(t.x, t.y, t.z); },
    feet(out = new THREE.Vector3()) { return this.center(out).setY(out.y - CENTER); },
    figureQuat() { return tumble ? tumble.body.rotation() : null; },

    /** Wegschleudern mit echter Physik (Absprung aus dem Auto, harte Treffer, angefahren werden). */
    tumble(vel, spin = null) {
      if (tumble || flying) return;
      const t = body.translation();
      collider.setEnabled(false);
      const rb = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(t.x, t.y + 0.1, t.z).setLinvel(vel.x, vel.y, vel.z)
        .setAngvel(spin || { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 8 })
        .setLinearDamping(0.25).setAngularDamping(0.6).setCcdEnabled(true));
      const col = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS * 0.95).setDensity(1.1).setFriction(0.9).setRestitution(0.2), rb);
      tumble = { body: rb, collider: col, t: 0, rest: 0, real: performance.now() };
      root.position.set(0, -CENTER, 0);
    },

    step(dt, input, camYaw, opts = {}) {
      if (hidden) return;
      if (tumble) {
        tumble.t += dt;
        const lv = tumble.body.linvel();
        const v = Math.hypot(lv.x, lv.y, lv.z);
        if (tumble.t > 0.5 && v < 1.3) tumble.rest += dt; else tumble.rest = 0;
        const tp = tumble.body.translation();
        // Sicherheitsgrenze auch in Echtzeit, damit langsame Geräte nicht lange liegen bleiben
        if (tp.y < SEA_LEVEL - 1.5 || tumble.rest > 0.35 || tumble.t > 5 || performance.now() - tumble.real > 6000) endTumble();
        speed = v;
        return;
      }
      fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
      dir.set(0, 0, 0).addScaledVector(fwd, input.move.y).addScaledVector(right, input.move.x);
      const len = Math.min(1, dir.length());
      if (len > 0.01) dir.normalize();
      const t = body.translation();

      if (flying) {
        const up = (input.jumpHeld ? 1 : 0) - (input.down ? 1 : 0);
        const sp = FLY * (input.sprint ? 2.5 : 1);
        const nx = t.x + dir.x * sp * len * dt, ny = Math.max(-5, t.y + up * sp * dt), nz = t.z + dir.z * sp * len * dt;
        body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
        speed = sp * len; if (len > 0.05) facing = Math.atan2(-dir.x, -dir.z);
        grounded = false; swimming = false;
        return;
      }

      swimming = t.y - CENTER < SEA_LEVEL - 0.9;
      const target = swimming ? SWIM : (input.sprint && opts.canSprint !== false) ? RUN : WALK;
      const v = target * len;
      if (swimming) {
        vy += (SEA_LEVEL - 0.6 - (t.y - CENTER)) * 6 * dt;
        vy *= 0.9;
        if (input.jump) vy = 4;
        swimT += dt;
        // Zu lange im Wasser: zurück an Land
        if (swimT > 2.5) { swimT = 0; events.onWater?.(); return; }
      } else {
        swimT = 0;
        vy += GRAVITY * dt;
        if (grounded && vy < 0) vy = -2;
        if (grounded && input.jump && opts.canJump !== false) { vy = JUMP; grounded = false; events.onJump?.(); }
      }
      ctl.computeColliderMovement(collider, { x: dir.x * v * dt, y: vy * dt, z: dir.z * v * dt }, EXCLUDE_SENSORS);
      const m = ctl.computedMovement();
      const wasGrounded = grounded;
      grounded = ctl.computedGrounded();
      if (!grounded && vy > 0 && m.y < vy * dt * 0.5) vy = 0; // Kopf gestoßen
      // Fallschaden
      if (!grounded && !swimming) { if (fallFrom === null) fallFrom = t.y; }
      if (grounded && !wasGrounded) { fig.userData.land = 1; }
      if (grounded && !wasGrounded && fallFrom !== null) { const h = fallFrom - t.y; if (h > 7) events.onFall?.(h); fallFrom = null; }
      if (swimming) fallFrom = null;
      const lim = SIZE / 2 - 6;
      const nx = Math.max(-lim, Math.min(lim, t.x + m.x)), nz = Math.max(-lim, Math.min(lim, t.z + m.z));
      body.setNextKinematicTranslation({ x: nx, y: t.y + m.y, z: nz });
      speed = Math.hypot(m.x, m.z) / dt;
      if (len > 0.05) facing = Math.atan2(-dir.x, -dir.z);
      // Unter den Boden gerutscht? Sofort zurück nach oben.
      const ground = events.heightAt ? events.heightAt(nx, nz) : -Infinity;
      if (t.y + m.y - CENTER < ground - 1.2 && ground > SEA_LEVEL - 0.5) { body.setNextKinematicTranslation({ x: nx, y: ground + CENTER + 0.2, z: nz }); vy = 0; }
      // Feststecken: Bewegung gewollt, aber seit 2,5 s kaum vorangekommen → freischieben
      if (len > 0.3 && !swimming) {
        if (Math.hypot(t.x - lastPos.x, t.z - lastPos.z) < 0.02 * dt * 60) stuckT += dt; else stuckT = 0;
        if (stuckT > 2.5) {
          stuckT = 0;
          const bx = t.x - dir.x * 1.2, bz = t.z - dir.z * 1.2;
          const gy = events.heightAt ? Math.max(events.heightAt(bx, bz), t.y - CENTER) : t.y - CENTER;
          body.setTranslation({ x: bx, y: gy + CENTER + 0.6, z: bz }, true); body.setNextKinematicTranslation({ x: bx, y: gy + CENTER + 0.6, z: bz });
          events.onUnstuck?.();
        }
      } else stuckT = 0;
      lastPos.set(t.x, t.y, t.z);
    },

    render(dt) {
      if (tumble) {
        const t = tumble.body.translation(), r = tumble.body.rotation();
        fig.position.set(t.x, t.y, t.z);
        fig.quaternion.set(r.x, r.y, r.z, r.w);
        animateFigure(fig, 0, dt);
        fig.userData.legL.rotation.x = 0.6; fig.userData.legR.rotation.x = -0.4; fig.userData.armL.rotation.x = -1.2;
        return;
      }
      const t = body.translation();
      fig.position.set(t.x, t.y - CENTER, t.z);
      let d = facing - fig.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      fig.rotation.set(0, fig.rotation.y + d * Math.min(1, dt * 12), 0);
      // Aufstehen nach dem Abrollen
      if (standT > 0) { standT = Math.max(0, standT - dt); const k = standT / 0.7; root.rotation.x = -k * k * 1.45; } else root.rotation.x = 0;
      animateFigure(fig, grounded || swimming || flying ? speed : 0, dt, flying, !grounded && !swimming && !flying);
    },
    teleport(x, y, z) {
      if (tumble) { physics.removeRigidBody(tumble.body); tumble = null; root.position.set(0, 0, 0); fig.quaternion.identity(); }
      body.setTranslation({ x, y: y + CENTER + 0.1, z }, true);
      body.setNextKinematicTranslation({ x, y: y + CENTER + 0.1, z });
      vy = 0; fallFrom = null; swimT = 0;
    },
    /** Unsichtbar und ohne Kollision (z. B. beim Fahren oder Reiten). */
    setHidden(on, showFigure = false) {
      hidden = on; collider.setEnabled(!on && !flying); fig.visible = !on || showFigure;
      if (on && tumble) { physics.removeRigidBody(tumble.body); tumble = null; root.position.set(0, 0, 0); fig.quaternion.identity(); }
    },
    get hidden() { return hidden; },
  };
  return api;
}
