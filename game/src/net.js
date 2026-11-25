// Mehrspieler: WebSocket zum Spielserver (Cloudflare Durable Object). Andere Spieler werden geglättet dargestellt.
import * as THREE from 'three';
import { makeFigure, animateFigure, makeCar, makeLabel } from './models.js';

const SEND_MS = 90;

export function createNet(scene, { name, color, onStatus, onJoin, onLeave }) {
  const remotes = new Map();
  let ws = null, myId = null, retry = 0, lastSend = 0, lastSent = '', closedByUs = false;

  function addRemote(p) {
    if (remotes.has(p.id) || p.id === myId) return;
    const fig = makeFigure(p.color || '#A78BFA');
    const car = makeCar(p.color || '#A78BFA'); car.visible = false;
    const label = makeLabel(p.name || 'Spieler', p.color || '#A78BFA');
    scene.add(fig, car, label);
    const r = {
      ...p, fig, car, label, has: false,
      pos: new THREE.Vector3(), target: new THREE.Vector3(), rot: 0, targetRot: 0,
      q: new THREE.Quaternion(), targetQ: new THREE.Quaternion(), v: 0, speed: 0,
    };
    remotes.set(p.id, r);
    if (p.s) applyState(r, p.s);
    onStatus?.(remotes.size + 1, true);
  }
  function removeRemote(id) {
    const r = remotes.get(id); if (!r) return;
    scene.remove(r.fig, r.car, r.label);
    remotes.delete(id);
    onStatus?.(remotes.size + 1, true);
  }
  function applyState(r, s) {
    if (!Array.isArray(s.p) || s.p.length !== 3 || !s.p.every(Number.isFinite)) return;
    r.target.set(s.p[0], s.p[1], s.p[2]);
    r.targetRot = Number(s.r) || 0;
    r.v = s.v ? 1 : 0;
    if (Array.isArray(s.q) && s.q.length === 4 && s.q.every(Number.isFinite)) r.targetQ.set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize();
    r.speed = Number(s.sp) || 0;
    if (!r.has) { r.pos.copy(r.target); r.rot = r.targetRot; r.q.copy(r.targetQ); r.has = true; }
  }

  function connect() {
    closedByUs = false;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    try { ws = new WebSocket(url); } catch { schedule(); return; }
    onStatus?.(remotes.size + 1, false);
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'hello', name, color })); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        myId = m.id;
        for (const id of [...remotes.keys()]) removeRemote(id);
        for (const p of m.players || []) addRemote(p);
        onStatus?.(remotes.size + 1, true);
      } else if (m.t === 'join') { addRemote(m); onJoin?.(m.name); }
      else if (m.t === 'leave') { const r = remotes.get(m.id); if (r) onLeave?.(r.name); removeRemote(m.id); }
      else if (m.t === 's') { const r = remotes.get(m.id); if (r) applyState(r, m); }
    };
    ws.onclose = () => { onStatus?.(remotes.size + 1, false); if (!closedByUs) schedule(); };
    ws.onerror = () => { try { ws.close(); } catch { /* egal */ } };
  }
  function schedule() {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 600 * 2 ** retry);
  }

  return {
    connect,
    get count() { return remotes.size + 1; },
    /** Eigenen Zustand senden (gedrosselt, nur bei Änderung). */
    send(state) {
      const now = performance.now();
      if (!ws || ws.readyState !== 1 || now - lastSend < SEND_MS) return;
      const msg = JSON.stringify({ t: 's', ...state });
      if (msg === lastSent && now - lastSend < 2000) return;
      ws.send(msg); lastSend = now; lastSent = msg;
    },
    update(dt, camera) {
      const k = 1 - Math.exp(-dt * 10);
      for (const r of remotes.values()) {
        if (!r.has) { r.fig.visible = r.car.visible = r.label.visible = false; continue; }
        r.pos.lerp(r.target, k);
        let d = r.targetRot - r.rot; d = Math.atan2(Math.sin(d), Math.cos(d)); r.rot += d * k;
        r.q.slerp(r.targetQ, k);
        r.fig.visible = !r.v; r.car.visible = !!r.v; r.label.visible = true;
        if (r.v) { r.car.position.copy(r.pos); r.car.quaternion.copy(r.q); r.label.position.set(r.pos.x, r.pos.y + 2.4, r.pos.z); }
        else {
          r.fig.position.copy(r.pos); r.fig.rotation.y = r.rot; animateFigure(r.fig, r.speed, dt);
          r.label.position.set(r.pos.x, r.pos.y + 2.25, r.pos.z);
        }
        // Namensschild in der Ferne etwas größer halten
        const dist = camera.position.distanceTo(r.label.position);
        const s = Math.max(1, dist / 14);
        r.label.scale.set(2.4 * s, 0.6 * s, 1);
      }
    },
    close() { closedByUs = true; ws?.close(); },
  };
}
