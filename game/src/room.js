// ECLIPSE Arena – ein Spielraum (Durable Object). Der Raum ist der Schiedsrichter:
// Er prüft Bewegungen, berechnet Treffer (mit Lag-Ausgleich), zählt Punkte, steuert Bots
// und schreibt die Statistiken der Spieler in die D1-Datenbank.
import { DurableObject } from 'cloudflare:workers';
import { BOXES, SPAWNS, WAYPOINTS, ARENA } from '../public/shared/map.js';
import { PLAYER, MOVE, step, accelerate, hitBox, rayMap, rayPlayer, dirFrom } from '../public/shared/physics.js';
import { WEAPONS, WEAPON_ORDER, MATCH, damageAt } from '../public/shared/weapons.js';

const TICK = 50; // ms → 20 Snapshots pro Sekunde
const HISTORY = 24; // ~1,2 s Positionsverlauf für den Lag-Ausgleich
const INTERP = 120; // ms Puffer, mit dem der Browser andere Spieler darstellt
const BOT_NAMES = ['Nova', 'Orion', 'Vega', 'Lyra', 'Kepler', 'Rigel', 'Atlas', 'Sirius'];
const BOT_COLORS = ['#94a3b8', '#a8a29e', '#9ca3af', '#a1a1aa'];

const r2 = (n) => Math.round(n * 100) / 100;
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every(fin);
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
// Für die Anti-Durch-die-Wand-Prüfung etwas kleinere Boxen (Rundungsfehler der Clients verzeihen)
const SOLID = BOXES.map((b) => ({ min: b.min.map((v) => v + 0.12), max: b.max.map((v) => v - 0.12) }));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();
    this.nextId = 1;
    this.room = 'arena';
    this.match = { state: 'idle', endsAt: 0, nextAt: 0, startedAt: 0 };
    this.timer = null;
    this.last = Date.now();
    this.lastSb = 0;
    this.lastPing = 0;
    // Nach einem Neustart des Objekts noch offene Verbindungen wieder aufnehmen
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a) { try { ws.close(1012, 'Neustart'); } catch {} continue; }
      this.room = a.room || this.room;
      const p = this.makePlayer(a, ws);
      this.nextId = Math.max(this.nextId, p.id + 1);
      this.spawn(p, Date.now());
    }
    if (this.humans() > 0) { this.startMatch(Date.now()); this.ensureTimer(); this.syncBots(); }
  }

  humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/info') {
      return Response.json({ humans: this.humans(), bots: this.players.size - this.humans(), state: this.match.state, endsAt: this.match.endsAt });
    }
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });

    const uid = Number(request.headers.get('x-user-id'));
    const info = {
      uid,
      name: request.headers.get('x-user-name') || 'Spieler',
      color: request.headers.get('x-user-color') || '#a78bfa',
      level: Number(request.headers.get('x-user-level')) || 1,
      room: request.headers.get('x-room') || 'arena',
    };
    this.room = info.room;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Derselbe Account nur einmal pro Raum: alte Verbindung beenden
    for (const p of [...this.players.values()]) {
      if (!p.bot && p.uid === uid) { this.removePlayer(p, 'Du hast dich an einem anderen Ort verbunden'); }
    }
    if (this.humans() >= MATCH.maxHumans) {
      server.send(JSON.stringify({ t: 'err', msg: 'Der Raum ist voll. Wähle einen anderen Raum.' }));
      server.close(4003, 'Raum voll');
      return new Response(null, { status: 101, webSocket: client });
    }

    info.id = this.nextId++;
    server.serializeAttachment(info);
    const now = Date.now();
    const p = this.makePlayer(info, server);
    if (this.match.state === 'idle') this.startMatch(now);
    this.spawn(p, now, true);
    this.send(p, {
      t: 'welcome', you: p.id, room: this.room, st: now,
      spawn: { p: p.body.p, ry: r2(p.ry), sq: p.sq },
      match: this.matchInfo(), players: [...this.players.values()].map((q) => this.pub(q)),
    });
    this.broadcast({ t: 'join', p: this.pub(p) }, p);
    this.syncBots();
    this.ensureTimer();
    return new Response(null, { status: 101, webSocket: client });
  }

  makePlayer(info, ws) {
    const p = {
      id: info.id, uid: info.uid, name: info.name, color: info.color, level: info.level, bot: false, ws,
      body: { p: [0, 0, 0], v: [0, 0, 0], onGround: true }, ry: 0, rx: 0, w: 0,
      hp: 100, alive: false, respawnAt: 0, prot: 0, sq: 0, lastInput: 0, lastShot: 0, lastDmg: 0,
      lastChat: 0, k: 0, d: 0, rtt: 80, hist: [],
      stat: { kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, xp: 0, wins: 0, matches: 0 },
    };
    this.players.set(p.id, p);
    return p;
  }

  pub(p) { return { id: p.id, name: p.name, color: p.color, level: p.level, bot: p.bot, k: p.k, d: p.d }; }

  matchInfo() {
    return { state: this.match.state, endsAt: this.match.endsAt, nextAt: this.match.nextAt, limit: MATCH.scoreLimit };
  }

  send(p, msg) {
    if (p.bot || !p.ws) return;
    try { p.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch {}
  }

  broadcast(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except) this.send(p, s);
  }

  ensureTimer() {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => {
      try { this.tick(); } catch (e) { console.log('tick error', e && e.stack); }
    }, TICK);
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------- WebSocket-Ereignisse (Hibernation-API) ----------
  webSocketMessage(ws, data) {
    const a = ws.deserializeAttachment();
    const p = a && this.players.get(a.id);
    if (!p || p.ws !== ws || typeof data !== 'string' || data.length > 4000) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const now = Date.now();
    switch (m.t) {
      case 'i': this.onInput(p, m, now); break;
      case 'f': this.onFire(p, m, now); break;
      case 'pong': if (fin(m.s)) p.rtt = Math.min(1000, Math.max(0, now - m.s)); break;
      case 'chat': this.onChat(p, m, now); break;
      default: break;
    }
  }

  webSocketClose(ws, code) {
    this.dropSocket(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch {}
  }

  webSocketError(ws) { this.dropSocket(ws); }

  dropSocket(ws) {
    for (const p of this.players.values()) if (p.ws === ws) { this.removePlayer(p); break; }
  }

  removePlayer(p, reason) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    if (!p.bot) {
      this.flush([p]);
      if (reason) {
        this.send(p, { t: 'err', msg: reason });
        try { p.ws.close(4001, 'Ersetzt'); } catch {}
      }
    }
    this.broadcast({ t: 'leave', id: p.id });
    if (!p.bot) this.syncBots();
    if (this.humans() === 0) {
      for (const q of [...this.players.values()]) this.players.delete(q.id);
      this.match = { state: 'idle', endsAt: 0, nextAt: 0, startedAt: 0 };
      this.stopTimer();
    }
  }

  // ---------- Eingaben ----------
  onInput(p, m, now) {
    if (m.sq !== p.sq || !p.alive || !vec3(m.p) || !fin(m.ry) || !fin(m.rx)) return;
    if (Number.isInteger(m.w) && m.w >= 0 && m.w < WEAPON_ORDER.length) p.w = m.w;
    p.ry = wrap(m.ry);
    p.rx = Math.max(-1.55, Math.min(1.55, m.rx));
    const dt = Math.min(1, Math.max(0.02, (now - (p.lastInput || now)) / 1000));
    p.lastInput = now;
    const cur = p.body.p;
    const np = m.p;
    const horiz = Math.sqrt(dist2(cur, np));
    const ok = horiz <= MOVE.sprint * 1.35 * dt + 0.9
      && Math.abs(np[0]) < ARENA && Math.abs(np[2]) < ARENA && np[1] > -1 && np[1] < 14
      && !hitBox([np[0], np[1] + 0.05, np[2]], SOLID);
    if (!ok) {
      p.badMoves = (p.badMoves || 0) + 1;
      this.send(p, { t: 'pos', p: cur.map(r2) });
      return;
    }
    p.body.p = [np[0], np[1], np[2]];
  }

  onChat(p, m, now) {
    const msg = String(m.msg || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!msg || now - p.lastChat < 800) return;
    p.lastChat = now;
    this.broadcast({ t: 'chat', id: p.id, msg });
  }

  onFire(p, m, now) {
    const key = WEAPON_ORDER[m.w];
    const w = WEAPONS[key];
    if (!w || !vec3(m.o) || !Array.isArray(m.d) || m.d.length < 1 || m.d.length > w.pellets) return;
    if (now - p.lastShot < w.interval * 0.8) return;
    const dirs = [];
    for (const d of m.d) {
      if (!vec3(d)) return;
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l < 0.5 || l > 1.5) return;
      dirs.push([d[0] / l, d[1] / l, d[2] / l]);
    }
    const eye = [p.body.p[0], p.body.p[1] + PLAYER.eye, p.body.p[2]];
    const o = Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) < 2.2 ? m.o : eye;
    const rewind = now - Math.min(400, p.rtt / 2 + INTERP);
    this.fire(p, key, o, dirs, now, rewind, 1);
  }

  // ---------- Treffer ----------
  fire(p, key, o, dirs, now, at, mult) {
    if (!p.alive || this.match.state !== 'live') return;
    const w = WEAPONS[key];
    p.lastShot = now;
    p.prot = 0;
    p.w = WEAPON_ORDER.indexOf(key);
    const targets = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      targets.push({ q, pos: this.posAt(q, at) });
    }
    const dmg = new Map();
    const ends = [];
    let anyHit = false;
    for (const d of dirs) {
      let best = rayMap(o, d, w.range, BOXES);
      let hit = null;
      for (const tg of targets) {
        const r = rayPlayer(o, d, tg.pos);
        if (r.t < best) { best = r.t; hit = { q: tg.q, head: r.head }; }
      }
      ends.push([r2(o[0] + d[0] * best), r2(o[1] + d[1] * best), r2(o[2] + d[2] * best), hit ? 1 : 0]);
      if (hit) {
        anyHit = true;
        const e = dmg.get(hit.q) || { dmg: 0, head: false };
        e.dmg += damageAt(w, best, hit.head) * mult;
        e.head = e.head || hit.head;
        dmg.set(hit.q, e);
      }
    }
    if (!p.bot) { p.stat.shots++; if (anyHit) p.stat.hits++; }
    this.broadcast({ t: 'shot', id: p.id, w: p.w, o: o.map(r2), e: ends }, p);
    for (const [q, e] of dmg) this.damage(q, Math.round(e.dmg), p, key, e.head, now);
  }

  damage(q, amount, from, key, head, now) {
    if (!q.alive || q.prot > now || amount <= 0) return;
    q.hp -= amount;
    q.lastDmg = now;
    const killed = q.hp <= 0;
    this.send(q, { t: 'dmg', hp: Math.max(0, q.hp), from: [r2(from.body.p[0]), r2(from.body.p[2])] });
    this.send(from, { t: 'hm', hs: head ? 1 : 0, k: killed ? 1 : 0, dmg: amount });
    if (killed) this.kill(q, from, key, head, now);
  }

  kill(v, k, key, head, now) {
    v.alive = false;
    v.hp = 0;
    v.respawnAt = now + MATCH.respawn;
    v.d++;
    if (!v.bot) v.stat.deaths++;
    if (k && k !== v) {
      k.k++;
      if (!k.bot) {
        k.stat.kills++;
        k.stat.xp += 100 + (head ? 25 : 0);
        if (head) k.stat.headshots++;
      }
    }
    this.broadcast({ t: 'kill', k: k ? k.id : 0, v: v.id, w: WEAPON_ORDER.indexOf(key), hs: head ? 1 : 0 });
    if (k && k.k >= MATCH.scoreLimit) this.endMatch(now);
  }

  posAt(q, t) {
    const h = q.hist;
    if (!h.length || t >= h[h.length - 1].t) return q.body.p;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (a.t <= t) {
        const f = (t - a.t) / Math.max(1, b.t - a.t);
        return [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f];
      }
    }
    return h[0].p;
  }

  // ---------- Spawns und Match ----------
  spawn(p, now, quiet = false) {
    const enemies = [...this.players.values()].filter((q) => q !== p && q.alive);
    const scored = SPAWNS.map((s) => {
      let min = 1e9;
      for (const q of enemies) min = Math.min(min, dist2([s[0], 0, s[1]], q.body.p));
      return { s, score: min + Math.random() * 120 };
    }).sort((a, b) => b.score - a.score);
    const s = scored[Math.floor(Math.random() * Math.min(3, scored.length))].s;
    p.body = { p: [s[0], 0, s[1]], v: [0, 0, 0], onGround: true };
    p.ry = Math.atan2(s[0], s[1]);
    p.rx = 0;
    p.hp = 100;
    p.alive = true;
    p.prot = now + MATCH.protect;
    p.sq++;
    p.hist = [];
    p.lastInput = now;
    if (p.bot) p.ai = null;
    if (!quiet) this.broadcast({ t: 'spawn', id: p.id, p: p.body.p, ry: r2(p.ry), sq: p.sq });
  }

  startMatch(now) {
    this.match = { state: 'live', endsAt: now + MATCH.duration, nextAt: 0, startedAt: now };
    for (const p of this.players.values()) { p.k = 0; p.d = 0; }
  }

  endMatch(now) {
    if (this.match.state !== 'live') return;
    const all = [...this.players.values()].sort((a, b) => b.k - a.k || a.d - b.d);
    const top = all[0];
    const winner = top && !top.bot && top.k > 0 ? top : null;
    for (const p of all) {
      if (p.bot) continue;
      p.stat.matches++;
      p.stat.xp += 50;
      if (p === winner) { p.stat.wins++; p.stat.xp += 500; }
    }
    this.match = { state: 'end', endsAt: now, nextAt: now + MATCH.intermission, startedAt: this.match.startedAt };
    const ranking = all.map((p) => ({ id: p.id, name: p.name, bot: p.bot, k: p.k, d: p.d, color: p.color }));
    this.broadcast({ t: 'end', ranking, winner: winner ? winner.id : 0, nextAt: this.match.nextAt });
    this.flush(all.filter((p) => !p.bot));
    if (this.env.DB && all.some((p) => !p.bot)) {
      this.env.DB.prepare('INSERT INTO matches (room, ended_at, winner_id, winner_name, players, top) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(this.room, now, winner ? winner.uid : null, winner ? winner.name : null, this.humans(),
          JSON.stringify(ranking.slice(0, 3).map((r) => ({ name: r.name, k: r.k, d: r.d, bot: r.bot }))))
        .run().catch((e) => console.log('match insert', e && e.message));
    }
  }

  flush(list) {
    const db = this.env.DB;
    if (!db) return;
    const stmts = [];
    for (const p of list) {
      const s = p.stat;
      if (!s.kills && !s.deaths && !s.shots && !s.xp && !s.matches) continue;
      stmts.push(db.prepare(
        `UPDATE users SET kills = kills + ?, deaths = deaths + ?, headshots = headshots + ?, shots = shots + ?,
         hits = hits + ?, wins = wins + ?, matches = matches + ?, xp = xp + ?, last_seen = ? WHERE id = ?`,
      ).bind(s.kills, s.deaths, s.headshots, s.shots, s.hits, s.wins, s.matches, s.xp, Date.now(), p.uid));
      p.stat = { kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, xp: 0, wins: 0, matches: 0 };
    }
    if (stmts.length) db.batch(stmts).catch((e) => console.log('flush', e && e.message));
  }

  syncBots() {
    const humans = this.humans();
    const want = humans > 0 ? Math.max(0, MATCH.botFill - humans) : 0;
    const bots = [...this.players.values()].filter((p) => p.bot);
    const now = Date.now();
    for (let i = bots.length; i < want; i++) {
      const used = new Set(bots.map((b) => b.name));
      const name = 'BOT ' + (BOT_NAMES.find((n) => !used.has('BOT ' + n)) || 'X' + this.nextId);
      const b = this.makePlayer({ id: this.nextId++, uid: 0, name, color: BOT_COLORS[i % BOT_COLORS.length], level: 1 }, null);
      b.bot = true;
      bots.push(b);
      this.spawn(b, now);
      this.broadcast({ t: 'join', p: this.pub(b) });
    }
    while (bots.length > want) {
      const b = bots.pop();
      this.players.delete(b.id);
      this.broadcast({ t: 'leave', id: b.id });
    }
  }

  // ---------- Spielschleife ----------
  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.humans() === 0) { this.stopTimer(); return; }

    if (this.match.state === 'live' && now >= this.match.endsAt) this.endMatch(now);
    if (this.match.state === 'end' && now >= this.match.nextAt) {
      this.startMatch(now);
      for (const p of this.players.values()) this.spawn(p, now);
      this.broadcast({ t: 'start', match: this.matchInfo() });
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (now >= p.respawnAt && this.match.state === 'live') this.spawn(p, now);
        continue;
      }
      if (p.bot) this.botThink(p, now, dt);
      if (p.hp < 100 && now - p.lastDmg > 5000) p.hp = Math.min(100, p.hp + 12 * dt);
      p.hist.push({ t: now, p: [p.body.p[0], p.body.p[1], p.body.p[2]] });
      if (p.hist.length > HISTORY) p.hist.shift();
    }

    const snap = [];
    for (const p of this.players.values()) {
      const b = p.body.p;
      snap.push([p.id, r2(b[0]), r2(b[1]), r2(b[2]), r2(p.ry), r2(p.rx), Math.ceil(p.hp), p.alive ? 1 : 0, p.w, p.prot > now ? 1 : 0]);
    }
    this.broadcast({ t: 's', st: now, p: snap });

    if (now - this.lastSb > 1000) {
      this.lastSb = now;
      this.broadcast({ t: 'sb', p: [...this.players.values()].map((p) => [p.id, p.k, p.d, p.bot ? 0 : Math.round(p.rtt)]), match: this.matchInfo() });
    }
    if (now - this.lastPing > 2000) {
      this.lastPing = now;
      this.broadcast({ t: 'ping', s: now });
    }
  }

  // ---------- Bots ----------
  botThink(b, now, dt) {
    const ai = b.ai || (b.ai = {
      wp: WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)], target: null, scanAt: 0, reactAt: 0,
      strafe: 1, strafeAt: 0, checkAt: now + 1000, checkP: b.body.p.slice(), nextShot: 0,
    });
    const eye = [b.body.p[0], b.body.p[1] + PLAYER.eye, b.body.p[2]];

    if (now >= ai.scanAt) {
      ai.scanAt = now + 300;
      let best = null, bestD = 48 * 48;
      for (const q of this.players.values()) {
        if (q === b || !q.alive || q.prot > now) continue;
        const d2 = dist2(b.body.p, q.body.p);
        if (d2 >= bestD) continue;
        const tp = [q.body.p[0], q.body.p[1] + 1.2, q.body.p[2]];
        const dv = [tp[0] - eye[0], tp[1] - eye[1], tp[2] - eye[2]];
        const len = Math.hypot(dv[0], dv[1], dv[2]);
        if (rayMap(eye, [dv[0] / len, dv[1] / len, dv[2] / len], len, BOXES) < len - 0.3) continue;
        best = q; bestD = d2;
      }
      if (best && best !== ai.target) ai.reactAt = now + 380 + Math.random() * 420;
      ai.target = best;
    }

    let wx = 0, wz = 0, speed = MOVE.walk * 0.85;
    const t = ai.target && ai.target.alive ? ai.target : null;
    if (t) {
      const tp = [t.body.p[0], t.body.p[1] + 1.2, t.body.p[2]];
      const dx = tp[0] - eye[0], dy = tp[1] - eye[1], dz = tp[2] - eye[2];
      const flat = Math.hypot(dx, dz);
      const wantRy = Math.atan2(-dx, -dz), wantRx = Math.atan2(dy, flat);
      const turn = 5 * dt;
      const ey = wrap(wantRy - b.ry);
      b.ry = wrap(b.ry + Math.max(-turn, Math.min(turn, ey)));
      b.rx += Math.max(-turn, Math.min(turn, wantRx - b.rx));
      if (now >= ai.strafeAt) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeAt = now + 500 + Math.random() * 900; }
      const fx = dx / (flat || 1), fz = dz / (flat || 1);
      const fwd = flat > 20 ? 1 : flat < 8 ? -0.6 : 0;
      wx = fx * fwd + -fz * ai.strafe * 0.8;
      wz = fz * fwd + fx * ai.strafe * 0.8;
      const err = Math.abs(ey) + Math.abs(wantRx - b.rx);
      if (now >= ai.reactAt && now >= ai.nextShot && err < 0.15 && this.match.state === 'live') {
        ai.nextShot = now + 150 + Math.random() * 140;
        const sp = 0.05;
        const d = dirFrom(b.ry + (Math.random() - 0.5) * sp, b.rx + (Math.random() - 0.5) * sp);
        b.w = 0;
        this.fire(b, 'rifle', eye, [d], now, now, 0.55);
        if (!b.alive) return;
      }
    } else {
      const dx = ai.wp[0] - b.body.p[0], dz = ai.wp[1] - b.body.p[2];
      const d = Math.hypot(dx, dz);
      if (d < 1.5) ai.wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
      wx = dx / (d || 1); wz = dz / (d || 1);
      const ey = wrap(Math.atan2(-wx, -wz) - b.ry);
      b.ry = wrap(b.ry + Math.max(-4 * dt, Math.min(4 * dt, ey)));
      b.rx *= 0.9;
    }
    const l = Math.hypot(wx, wz);
    if (l > 1) { wx /= l; wz /= l; }
    accelerate(b.body, wx, wz, speed, dt);
    step(b.body, dt, BOXES);

    if (now >= ai.checkAt) {
      const moved = Math.sqrt(dist2(ai.checkP, b.body.p));
      if (moved < 0.6 && l > 0.1) {
        if (b.body.onGround) b.body.v[1] = MOVE.jump;
        if (!t) ai.wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
        else ai.strafe = -ai.strafe;
      }
      ai.checkAt = now + 1000;
      ai.checkP = b.body.p.slice();
    }
  }
}

