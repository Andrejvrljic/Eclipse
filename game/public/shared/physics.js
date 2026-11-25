// Bewegung, Kollision und Strahltests – identisch im Browser und auf dem Server.
export const PLAYER = { hw: 0.35, h: 1.8, eye: 1.6, step: 0.55 };
export const MOVE = { walk: 5.6, sprint: 8.2, jump: 7.2, gravity: 21, accel: 14, airAccel: 2.5 };
export const HEAD = { y: 1.62, r: 0.25 };
export const BODY = { hw: 0.4, h: 1.42 };

const EPS = 1e-4;

export function overlaps(p, b) {
  const hw = PLAYER.hw;
  return p[0] + hw > b.min[0] && p[0] - hw < b.max[0]
    && p[1] + PLAYER.h > b.min[1] && p[1] < b.max[1]
    && p[2] + hw > b.min[2] && p[2] - hw < b.max[2];
}

export function hitBox(p, boxes) {
  for (const b of boxes) if (overlaps(p, b)) return b;
  return null;
}

function moveAxis(body, a, d, boxes) {
  const p = body.p;
  p[a] += d;
  for (const b of boxes) {
    if (!overlaps(p, b)) continue;
    if (a !== 1) {
      const rise = b.max[1] - p[1];
      if (body.onGround && rise > 0 && rise <= PLAYER.step) {
        const oy = p[1];
        p[1] = b.max[1] + EPS;
        if (!hitBox(p, boxes)) continue; // Stufe hinauf
        p[1] = oy;
      }
      p[a] = d > 0 ? b.min[a] - PLAYER.hw - EPS : b.max[a] + PLAYER.hw + EPS;
      body.v[a] = 0;
    } else {
      if (d < 0) { p[1] = b.max[1]; body.onGround = true; } else { p[1] = b.min[1] - PLAYER.h - EPS; }
      body.v[1] = 0;
    }
  }
}

/** Bewegt body = { p:[x,y,z], v:[x,y,z], onGround } um dt Sekunden (Schwerkraft inklusive). */
export function step(body, dt, boxes) {
  body.v[1] -= MOVE.gravity * dt;
  if (body.v[1] < -40) body.v[1] = -40;
  const maxV = Math.max(Math.abs(body.v[0]), Math.abs(body.v[1]), Math.abs(body.v[2]));
  const n = Math.min(12, Math.max(1, Math.ceil((maxV * dt) / 0.2)));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) {
    moveAxis(body, 0, body.v[0] * sdt, boxes);
    moveAxis(body, 2, body.v[2] * sdt, boxes);
    const wasGround = body.onGround;
    body.onGround = false;
    moveAxis(body, 1, body.v[1] * sdt, boxes);
    if (body.p[1] <= 0) { body.p[1] = 0; body.v[1] = 0; body.onGround = true; }
    // Kleine Kanten nach unten "kleben" lassen (Treppe hinab ohne Hüpfen)
    if (!body.onGround && wasGround && body.v[1] <= 0) {
      const oy = body.p[1];
      body.p[1] -= PLAYER.step;
      let landed = body.p[1] <= 0 ? 0 : null;
      for (const b of boxes) if (overlaps(body.p, b) && b.max[1] <= oy + EPS) landed = Math.max(landed ?? -1, b.max[1]);
      if (landed !== null && landed >= oy - PLAYER.step) { body.p[1] = landed; body.onGround = true; body.v[1] = 0; }
      else body.p[1] = oy;
    }
  }
}

/** Beschleunigt die horizontale Geschwindigkeit Richtung (wx, wz) mit Tempo speed. */
export function accelerate(body, wx, wz, speed, dt) {
  const a = body.onGround ? MOVE.accel : MOVE.airAccel;
  const k = Math.min(1, a * dt);
  body.v[0] += (wx * speed - body.v[0]) * k;
  body.v[2] += (wz * speed - body.v[2]) * k;
}

/** Strahl gegen Quader (Slab-Methode). Liefert Abstand oder Infinity. */
export function rayAABB(o, d, min, max, tMax) {
  let t0 = 0, t1 = tMax;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      const inv = 1 / d[i];
      let a = (min[i] - o[i]) * inv, b = (max[i] - o[i]) * inv;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

export function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : Infinity;
}

/** Abstand bis zur ersten Wand oder zum Boden (höchstens maxT). */
export function rayMap(o, d, maxT, boxes) {
  let t = maxT;
  if (d[1] < -1e-6) t = Math.min(t, -o[1] / d[1]);
  for (const b of boxes) {
    const h = rayAABB(o, d, b.min, b.max, t);
    if (h < t) t = h;
  }
  return t;
}

/** Strahl gegen einen Spieler an Fußposition p. Liefert { t, head }. */
export function rayPlayer(o, d, p) {
  const th = raySphere(o, d, [p[0], p[1] + HEAD.y, p[2]], HEAD.r);
  const tb = rayAABB(o, d, [p[0] - BODY.hw, p[1], p[2] - BODY.hw], [p[0] + BODY.hw, p[1] + BODY.h, p[2] + BODY.hw], 1e9);
  if (th <= tb) return { t: th, head: th < Infinity };
  return { t: tb, head: false };
}

/** Blickrichtung aus Gier (ry) und Neigung (rx). ry = 0 schaut nach -z. */
export function dirFrom(ry, rx) {
  const c = Math.cos(rx);
  return [-Math.sin(ry) * c, Math.sin(rx), -Math.cos(ry) * c];
}
