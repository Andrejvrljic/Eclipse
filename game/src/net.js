// Mehrspieler: WebSocket zum Spielserver. Andere Spieler werden geglättet dargestellt.
import * as THREE from 'three';
import { makeFigure, animateFigure, makeLabel, makeBar, setBar, setHeld, swingFigure } from './models.js';

const SEND_MS = 100;

export function createNet(scene, opts) {
  const remotes = new Map();
  let ws = null, retry = 0, lastSend = 0, lastSent = '', stopped = false;
  const api = { id: null, remotes, connected: false };

  function addRemote(p) {
    if (remotes.has(p.id) || p.id === api.id) return;
    const fig = makeFigure(p.color || '#A78BFA');
    const label = makeLabel(p.name || 'Spieler', p.color || '#A78BFA', p.admin ? 'ADMIN' : '');
    const bar = makeBar(); bar.visible = false;
    scene.add(fig, label, bar);
    const r = { ...p, fig, label, bar, has: false, pos: new THREE.Vector3(), target: new THREE.Vector3(), rot: 0, targetRot: 0, st: {}, tq: null };
    remotes.set(p.id, r);
    if (p.s) apply(r, p.s);
    opts.onCount?.(remotes.size + 1);
  }
  function removeRemote(id) {
    const r = remotes.get(id); if (!r) return;
    scene.remove(r.fig, r.label, r.bar);
    remotes.delete(id);
    opts.onCount?.(remotes.size + 1);
  }
  function apply(r, s) {
    if (!Array.isArray(s.p) || s.p.length !== 3 || !s.p.every(Number.isFinite)) return;
    r.target.set(s.p[0], s.p[1], s.p[2]);
    r.targetRot = Number(s.r) || 0;
    if (s.a && !r.st.a) swingFigure(r.fig);
    r.st = s;
    r.tq = Array.isArray(s.tq) && s.tq.length === 4 ? new THREE.Quaternion(...s.tq) : null;
    if (!r.has) { r.pos.copy(r.target); r.rot = r.targetRot; r.has = true; }
  }

  function connect() {
    stopped = false;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    try { ws = new WebSocket(url); } catch { schedule(); return; }
    const sock = ws;
    const guard = setTimeout(() => { if (!api.connected) { try { sock.close(); } catch { /* egal */ } } }, 12000);
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', ...opts.hello() })); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        clearTimeout(guard); retry = 0;
        api.id = m.id; api.connected = true;
        for (const id of [...remotes.keys()]) removeRemote(id);
        for (const p of m.players || []) addRemote(p);
        opts.onStatus?.(true);
      } else if (m.t === 'join') { addRemote(m); opts.onJoin?.(m.name); }
      else if (m.t === 'leave') { const r = remotes.get(m.id); if (r) opts.onLeave?.(r.name); removeRemote(m.id); }
      else if (m.t === 's') { const r = remotes.get(m.id); if (r) apply(r, m); }
      else if (m.t === 'ps') {
        for (const [id, st] of m.a || []) { const r = remotes.get(id); if (r) apply(r, st); }
        for (const [id, p, q, sp, st] of m.vb || []) opts.onMessage?.({ t: 'vs', id, p, q, sp, st });
        return;
      }
      opts.onMessage?.(m);
    };
    ws.onclose = (ev) => {
      // 4000–4099: vom Server abgelehnt (Admin-Code, voll, zweites Fenster, entfernt) → nicht neu verbinden
      const final = ev.code >= 4000 && ev.code < 4100;
      if (final) stopped = true;
      api.connected = false; opts.onStatus?.(false, ev.code ? `Code ${ev.code}${ev.reason ? ', ' + ev.reason : ''}` : '', final);
      if (!stopped) schedule();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* egal */ } };
  }
  function schedule() { retry = Math.min(retry + 1, 4); setTimeout(() => { if (!stopped) connect(); }, 500 * 2 ** retry + Math.random() * 500); }

  return Object.assign(api, {
    connect,
    get count() { return remotes.size + 1; },
    send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    /** Eigenen Zustand senden (gedrosselt, nur bei Änderung). */
    sendState(state) {
      const t = performance.now();
      if (!ws || ws.readyState !== 1 || t - lastSend < SEND_MS) return;
      const msg = JSON.stringify({ t: 's', ...state });
      if (msg === lastSent && t - lastSend < 2000) return;
      ws.send(msg); lastSend = t; lastSent = msg;
    },
    update(dt, camera, getItemDef, mounts = {}) {
      const k = 1 - Math.exp(-dt * 10);
      for (const r of remotes.values()) {
        const s = r.st;
        r.pos.lerp(r.target, k);
        let d = r.targetRot - r.rot; d = Math.atan2(Math.sin(d), Math.cos(d)); r.rot += d * k;
        // Fahrer sitzt sichtbar im Fahrzeug, Reiter auf dem Tier
        const seat = s.v && mounts.seat ? mounts.seat(s.v, s.se || 0) : null;
        const mount = s.ride && mounts.mount ? mounts.mount(s.ride) : null;
        const hidden = !r.has || (s.v && !seat) || (s.ride && !mount);
        r.fig.visible = !hidden; r.label.visible = r.has;
        if (seat || mount) {
          const root = r.fig.userData.root; root.position.y = 0; r.fig.quaternion.identity();
          if (seat) { r.fig.position.set(seat.pos.x, seat.pos.y - 0.55, seat.pos.z); r.fig.rotation.y = seat.yaw; }
          else { r.fig.position.set(mount.pos.x, mount.pos.y + 1.35 * mount.scale, mount.pos.z); r.fig.rotation.y = mount.ry + Math.PI; }
          setHeld(r.fig, '', null);
          animateFigure(r.fig, 0, dt);
          r.fig.userData.legL.rotation.x = -1.3; r.fig.userData.legR.rotation.x = -1.3;
          r.pos.copy(r.fig.position);
        } else if (!hidden) {
          const root = r.fig.userData.root;
          if (r.tq) { r.fig.position.set(r.pos.x, r.pos.y + 0.9, r.pos.z); r.fig.quaternion.slerp(r.tq, k); root.position.y = -0.9; }
          else { r.fig.position.copy(r.pos); r.fig.quaternion.identity(); r.fig.rotation.y = r.rot; root.position.y = 0; }
          setHeld(r.fig, s.w, s.w && getItemDef(s.w));
          animateFigure(r.fig, r.tq ? 0 : s.sp || 0, dt, !!s.fly);
        }
        const topY = r.pos.y + (s.v ? 2.6 : 2.25);
        r.label.position.set(r.pos.x, topY, r.pos.z);
        const dist = camera.position.distanceTo(r.label.position);
        const sc = Math.max(1, dist / 14);
        r.label.scale.set(2.4 * sc, 0.6 * sc, 1);
        r.bar.visible = r.has && (s.hp ?? 100) < 100 && !s.v;
        if (r.bar.visible) { setBar(r.bar, s.hp, '#22C55E'); r.bar.position.set(r.pos.x, topY - 0.35 * sc, r.pos.z); r.bar.scale.set(1.6 * sc, 0.2 * sc, 1); }
      }
    },
    /** Nächster Mitspieler vor einem Punkt (für Kämpfe zwischen Spielern). */
    pick(origin, dir, maxDist) {
      let best = null, bd = maxDist;
      for (const r of remotes.values()) {
        if (!r.has || r.st.v) continue;
        const dx = r.pos.x - origin.x, dz = r.pos.z - origin.z, d = Math.hypot(dx, dz);
        if (d > bd) continue;
        if ((dx * dir.x + dz * dir.z) / (d || 1) < 0.4 && d > 1) continue;
        bd = d; best = r;
      }
      return best;
    },
    close() { stopped = true; ws?.close(); },
  });
}
