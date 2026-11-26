// Spielserver (Cloudflare Durable Object): ein gemeinsamer Raum für alle Spieler.
// Steuert Kreaturen (Bewegung, Angriffe, Zähmen), gemeinsame Fahrzeuge, Bauwerke und Spielstände
// und übernimmt Einstellungen und Befehle aus dem Dashboard (gemeinsame D1-Datenbank).
import { init, getDoc, listDocs, putDoc, patchDoc, deleteDoc, logActivity, nextStamp } from '../../worker/store.js';
import { buildGrid, makeSampler, SIZE, SPAWN } from '../src/terrain.js';
import * as D from '../src/shared/defaults.js';

const C = {
  settings: 'game_settings', items: 'game_items', recipes: 'game_recipes', species: 'game_species', quests: 'game_quests',
  vehicles: 'game_vehicles', players: 'game_players', buildings: 'game_buildings', commands: 'game_commands', status: 'game_status', tames: 'game_tames',
  events: 'game_events', records: 'game_records',
};
const EVENT_NAMES = { schatz: 'Gemeinsame Schatzsuche', sammeln: 'Team-Herausforderung', bauen: 'Gemeinsames Bauprojekt', jagd: 'Kreaturen-Wettbewerb', doppelt: 'Doppelte Erfahrung' };
const COURSES = { parcours: { name: 'Hindernisparcours', min: 6000 }, rennen: { name: 'Rennen', min: 25000 } };
const TICK = 100;               // ms je Simulationsschritt
const VIEW = 260;               // Kreaturen nur in diesem Umkreis an Spieler senden
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const now = () => Date.now();
const rid = (p) => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
const clampNum = (v, a, b, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
const round = (n, k = 10) => Math.round(n * k) / k;
// Kurzes, nicht umkehrbares Kennzeichen für Bestenlisten (die Spieler-ID selbst bleibt geheim)
const pidTag = (pid) => { let h = 0x811c9dc5; for (const ch of String(pid) + 'eclipse') { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const ensureMap = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? m : {});

let SAMPLER = null;
const heightAt = (x, z) => { if (!SAMPLER) SAMPLER = makeSampler(buildGrid()); return SAMPLER(x, z); };

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();   // ws → session
    this.creatures = new Map();
    this.vehicles = new Map();
    this.buildings = new Map();
    this.cfg = null;
    this.version = 0;
    this.timer = null;
    this.tickN = 0;
    this.seq = 0;
    this.ready = this.load().catch((e) => { this.loadError = String(e && e.message || e); });
  }

  /* ---------- Laden & Speichern ---------- */
  async seed(db) {
    const s = await getDoc(db, C.settings, 'main');
    if (s) {
      // Neue Inhalte in bestehende Welten nachtragen – nur, was es noch nicht gibt (Änderungen aus dem Dashboard bleiben)
      const cv = Number(s.content_version) || 1;
      if (cv < D.CONTENT_VERSION) {
        // Alles in einem Rutsch schreiben (wenige Datenbank-Abfragen → schneller Start).
        // INSERT OR IGNORE: vorhandene oder im Dashboard gelöschte Einträge bleiben, wie sie sind.
        const t0 = await nextStamp(db); let k = 0;
        const stmts = [];
        const ins = (coll, id, doc) => { if (doc) stmts.push(db.prepare('INSERT OR IGNORE INTO docs (coll, id, data, deleted, updated) VALUES (?, ?, ?, 0, ?)').bind(coll, id, JSON.stringify(doc), t0 + k++)); };
        for (let v = cv + 1; v <= D.CONTENT_VERSION; v++) {
          const add = D.CONTENT_ADDED[v]; if (!add) continue;
          for (const id of add.items || []) ins(C.items, id, D.DEFAULT_ITEMS[id]);
          for (const id of add.recipes || []) ins(C.recipes, id, D.DEFAULT_RECIPES[id]);
          for (const id of add.quests || []) ins(C.quests, id, D.DEFAULT_QUESTS[id]);
          for (const id of add.vehicles || []) ins(C.vehicles, id, D.DEFAULT_VEHICLES[id]);
          // Admin-Namen ergänzen (vorhandene bleiben)
          for (const name of add.admins || []) {
            const list = String(s.admins || '').split(',').map((x) => x.trim()).filter(Boolean);
            if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) s.admins = [...list, name].join(', ');
          }
        }
        if (stmts.length) await db.batch(stmts);
        await patchDoc(db, C.settings, 'main', { admins: s.admins, content_version: D.CONTENT_VERSION, version: (Number(s.version) || 1) + 1 });
        await logActivity(db, { actor: 'Spielserver', action: 'ergänzt', type: 'Spiel', title: 'Neue Bauteile', detail: `Neue Inhalte bis Version ${D.CONTENT_VERSION}; Admins: ${s.admins}` });
      }
      return;
    }
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await putDoc(db, C.settings, 'main', { ...D.DEFAULT_SETTINGS, admin_code: code, content_version: D.CONTENT_VERSION });
    for (const [id, v] of Object.entries(D.DEFAULT_ITEMS)) await putDoc(db, C.items, id, v);
    for (const [id, v] of Object.entries(D.DEFAULT_RECIPES)) await putDoc(db, C.recipes, id, v);
    for (const [id, v] of Object.entries(D.DEFAULT_SPECIES)) await putDoc(db, C.species, id, v);
    for (const [id, v] of Object.entries(D.DEFAULT_QUESTS)) await putDoc(db, C.quests, id, v);
    for (const [id, v] of Object.entries(D.DEFAULT_VEHICLES)) await putDoc(db, C.vehicles, id, v);
    await logActivity(db, { actor: 'Spielserver', action: 'angelegt', type: 'Spiel', title: 'Spielinhalte', detail: 'Standard-Kreaturen, Gegenstände, Rezepte, Quests und Fahrzeuge' });
  }

  async loadConfig() {
    const db = this.env.DB;
    const byId = (list) => Object.fromEntries(list.map(({ id, ...rest }) => [id, rest]));
    const [settings, items, recipes, species, quests] = await Promise.all([
      getDoc(db, C.settings, 'main'), listDocs(db, C.items), listDocs(db, C.recipes), listDocs(db, C.species), listDocs(db, C.quests),
    ]);
    this.cfg = {
      settings: { ...D.DEFAULT_SETTINGS, ...(settings || {}) },
      items: byId(items), recipes: byId(recipes), species: byId(species), quests: byId(quests),
    };
    this.version = Number(this.cfg.settings.version) || 1;
  }

  /** Konfiguration für Spieler (ohne Admin-Code). */
  publicConfig() {
    const s = { ...this.cfg.settings }; delete s.admin_code;
    s.xp_multiplier = this.xpMult();
    return { ...this.cfg, settings: s };
  }
  xpMult() {
    const base = clampNum(this.cfg.settings.xp_multiplier, 0, 100, 1);
    return this.event && this.event.type === 'doppelt' ? base * 2 : base;
  }
  /** Startpunkt aus dem Dashboard (auf Land). */
  spawnPoint() {
    const x = clampNum(this.cfg.settings.spawn_x, -SIZE / 2 + 30, SIZE / 2 - 30, SPAWN.x), z = clampNum(this.cfg.settings.spawn_z, -SIZE / 2 + 30, SIZE / 2 - 30, SPAWN.z);
    if (heightAt(x, z) > 1.5) return { x, z };
    return { x: SPAWN.x, z: SPAWN.z };
  }
  palette() {
    const list = String(this.cfg.settings.player_colors || '').split(',').map((c) => c.trim()).filter((c) => COLOR_RE.test(c));
    return list.length ? list : null;
  }

  async load() {
    const db = this.env.DB;
    await init(db);
    await this.seed(db);
    await this.loadConfig();
    for (const b of await listDocs(db, C.buildings)) this.buildings.set(b.id, b);
    this.records = {};
    for (const r of await listDocs(db, C.records)) this.records[r.id] = Array.isArray(r.top) ? r.top : [];
    this.lastEventEnd = now();
    await this.syncVehicles(true);
    for (const t of await listDocs(db, C.tames)) {
      const sp = this.cfg.species[t.species]; if (!sp) continue;
      this.creatures.set(t.id, this.makeCreature(t.species, t.x, t.z, { id: t.id, owner: t.owner, ownerName: t.ownerName, hp: t.hp, mode: t.mode || 'stay' }));
    }
    this.populate();
  }

  async syncVehicles(initial = false) {
    const docs = await listDocs(this.env.DB, C.vehicles);
    const seen = new Set();
    for (const d of docs) {
      seen.add(d.id);
      const type = D.VEHICLE_TYPES[d.type] ? d.type : 'gelaendewagen';
      const color = COLOR_RE.test(d.color) ? d.color : '#A78BFA';
      const v = this.vehicles.get(d.id);
      if (!v) {
        const x = clampNum(d.px ?? d.x, -SIZE / 2 + 20, SIZE / 2 - 20), z = clampNum(d.pz ?? d.z, -SIZE / 2 + 20, SIZE / 2 - 20);
        const ry = Number(d.ry) || 0;
        const p = Array.isArray(d.p) ? d.p : [x, heightAt(x, z) + 1.4, z];
        const q = Array.isArray(d.q) ? d.q : [0, Math.sin(ry / 2), 0, Math.cos(ry / 2)];
        this.vehicles.set(d.id, { id: d.id, type, color, p, q, sp: 0, st: 0, driver: null, ctrl: null, ctrlAt: 0, dirty: false, pass: [] });
      } else if (!initial) {
        if (v.type !== type || v.color !== color) { v.type = type; v.color = color; this.broadcast({ t: 'vdef', v: this.vehView(v) }); }
      }
    }
    if (!initial) for (const id of [...this.vehicles.keys()]) if (!seen.has(id)) { this.vehicles.delete(id); this.broadcast({ t: 'vdel', id }); }
  }

  /* ---------- Kreaturen ---------- */
  makeCreature(spId, x, z, extra = {}) {
    const sp = this.cfg.species[spId];
    return {
      id: extra.id || 'c' + (++this.seq) + Math.random().toString(36).slice(2, 5), sp: spId, x, z, y: heightAt(x, z), ry: Math.random() * 6.28,
      hp: extra.hp ?? (Number(sp.hp) || 50), state: 'wander', tx: x, tz: z, wait: 0, target: null, aggroUntil: 0, atkCd: 0, moving: 0,
      owner: extra.owner || null, ownerName: extra.ownerName || '', mode: extra.mode || 'follow', tame: {}, rider: null, home: [x, z],
    };
  }
  randomLand(minDistToPlayers = 60) {
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() - 0.5) * SIZE * 0.9, z = (Math.random() - 0.5) * SIZE * 0.9;
      const h = heightAt(x, z);
      if (h < 1.2 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 50) continue;
      let ok = true;
      for (const s of this.sessions.values()) if (s.pos && Math.hypot(s.pos[0] - x, s.pos[2] - z) < minDistToPlayers) { ok = false; break; }
      if (ok) return [x, z];
    }
    return null;
  }
  populate() {
    const mult = clampNum(this.cfg.settings.creature_multiplier, 0, 5, 1);
    const counts = {};
    for (const c of this.creatures.values()) if (!c.owner) counts[c.sp] = (counts[c.sp] || 0) + 1;
    for (const [id, sp] of Object.entries(this.cfg.species)) {
      const want = Math.round(clampNum(sp.count, 0, 200, 0) * mult);
      let have = counts[id] || 0;
      while (have < want) { const p = this.randomLand(); if (!p) break; const c = this.makeCreature(id, p[0], p[1]); this.creatures.set(c.id, c); have++; }
      if (have > want) for (const c of [...this.creatures.values()]) { if (have <= want) break; if (c.sp === id && !c.owner) { this.creatures.delete(c.id); this.broadcast({ t: 'crdie', id: c.id, silent: 1 }); have--; } }
    }
    for (const c of [...this.creatures.values()]) if (!this.cfg.species[c.sp]) { this.creatures.delete(c.id); this.broadcast({ t: 'crdie', id: c.id, silent: 1 }); }
  }

  sessionByPid(pid) { for (const s of this.sessions.values()) if (s.pid === pid && s.ready) return s; return null; }

  simulate(dt) {
    const set = this.cfg.settings;
    const players = [...this.sessions.values()].filter((s) => s.ready && s.pos && !s.dead && !s.invisible);
    for (const c of this.creatures.values()) {
      const sp = this.cfg.species[c.sp]; if (!sp) continue;
      if (c.rider) { c.moving = 0; continue; }
      const scale = clampNum(sp.scale, 0.3, 8, 1);
      const speed = clampNum(sp.speed, 0, 30, 4);
      const reach = 1.4 + scale * 0.9;
      c.atkCd -= dt;
      let gx = null, gz = null, run = false, chase = null;

      if (c.owner) {
        const o = this.sessionByPid(c.owner);
        const tgt = c.target && this.creatures.get(c.target);
        if (tgt && Math.hypot(tgt.x - c.x, tgt.z - c.z) < 50) { gx = tgt.x; gz = tgt.z; run = true; chase = tgt; }
        else if (o && o.pos && c.mode === 'follow') {
          c.target = null;
          const d = Math.hypot(o.pos[0] - c.x, o.pos[2] - c.z);
          if (d > 80) { c.x = o.pos[0] + 3; c.z = o.pos[2] + 3; }
          else if (d > 4 + scale) { gx = o.pos[0]; gz = o.pos[2]; run = d > 10; }
        }
      } else {
        let near = null, nd = Infinity;
        for (const p of players) { const d = Math.hypot(p.pos[0] - c.x, p.pos[2] - c.z); if (d < nd) { nd = d; near = p; } }
        const hurt = c.aggroUntil > now();
        const attacker = hurt && c.target && [...this.sessions.values()].find((s) => s.sid === c.target && s.pos && !s.dead);
        if (sp.behavior === 'Fliehend') {
          const threat = attacker || (near && nd < 14 ? near : null);
          if (threat) { const dx = c.x - threat.pos[0], dz = c.z - threat.pos[2], l = Math.hypot(dx, dz) || 1; gx = c.x + (dx / l) * 10; gz = c.z + (dz / l) * 10; run = true; }
        } else if (attacker && Math.hypot(attacker.pos[0] - c.x, attacker.pos[2] - c.z) < 70) { chase = attacker; }
        else if (sp.behavior === 'Aggressiv' && near && nd < 20 + scale * 4) { chase = near; c.target = near.sid; }
        if (chase) { gx = chase.pos[0]; gz = chase.pos[2]; run = true; }
      }

      // Angriff
      if (chase) {
        const tx = chase.pos ? chase.pos[0] : chase.x, tz = chase.pos ? chase.pos[2] : chase.z;
        const d = Math.hypot(tx - c.x, tz - c.z);
        if (d < reach + (chase.pos ? 0.4 : scale * 0.6)) {
          gx = null; c.ry = Math.atan2(tx - c.x, tz - c.z);
          if (c.atkCd <= 0) {
            c.atkCd = 1.3;
            const dmg = clampNum(sp.damage, 0, 1000, 5) * clampNum(set.damage_multiplier, 0, 10, 1);
            if (chase.ws) { if (dmg > 0) this.send(chase.ws, { t: 'dmg', n: Math.round(dmg), from: sp.name, knock: scale >= 2 ? 1 : 0, dir: [Math.sin(c.ry), Math.cos(c.ry)] }); }
            else this.damageCreature(chase, dmg * 1.5, null, c);
            c.atk = now();
          }
        }
      }

      // Umherstreifen
      if (gx === null && !chase && !c.owner) {
        c.wait -= dt;
        if (c.wait <= 0 && Math.hypot(c.tx - c.x, c.tz - c.z) < 1.5) {
          c.wait = 2 + Math.random() * 6;
          const a = Math.random() * 6.28, r = 8 + Math.random() * 30;
          c.tx = c.home[0] + Math.cos(a) * r; c.tz = c.home[1] + Math.sin(a) * r;
        }
        if (c.wait <= 0) { gx = c.tx; gz = c.tz; }
      }

      c.moving = 0;
      if (gx !== null) {
        const dx = gx - c.x, dz = gz - c.z, l = Math.hypot(dx, dz);
        if (l > 0.3) {
          const v = speed * (run ? 1 : 0.35) * dt;
          const nx = c.x + (dx / l) * Math.min(v, l), nz = c.z + (dz / l) * Math.min(v, l);
          const lim = SIZE / 2 - 15;
          if (heightAt(nx, nz) > 0.4 && Math.abs(nx) < lim && Math.abs(nz) < lim) { c.x = nx; c.z = nz; c.moving = run ? 2 : 1; }
          else { c.tx = c.home[0]; c.tz = c.home[1]; c.wait = 0; }
          c.ry = Math.atan2(dx, dz);
        }
      }
      c.y = heightAt(c.x, c.z);
    }
  }

  damageCreature(c, dmg, bySession, byCreature) {
    if (!c || c.hp <= 0) return;
    c.hp -= dmg;
    c.aggroUntil = now() + 25000;
    if (bySession) {
      c.target = bySession.sid;
      // gezähmte Begleiter des Angreifers greifen mit an
      for (const t of this.creatures.values()) if (t.owner === bySession.pid && t !== c && !t.rider) t.target = c.id;
    } else if (byCreature) c.target = byCreature.id;
    if (c.hp > 0) return;
    this.creatures.delete(c.id);
    const sp = this.cfg.species[c.sp] || {};
    this.broadcast({ t: 'crdie', id: c.id, x: c.x, y: c.y, z: c.z });
    const killer = bySession || (byCreature && byCreature.owner && this.sessionByPid(byCreature.owner));
    if (killer) this.send(killer.ws, { t: 'kill', sp: c.sp, name: sp.name, xp: Math.round(clampNum(sp.xp, 0, 100000, 10) * this.xpMult()), drops: ensureMap(sp.drops) });
    if (killer && this.event && this.event.type === 'jagd' && (!this.event.species || this.event.species === c.sp)) this.contribute(killer, 1);
    if (c.owner) { deleteDoc(this.env.DB, C.tames, c.id).catch(() => {}); const o = this.sessionByPid(c.owner); if (o) this.send(o.ws, { t: 'msg', text: `Dein ${sp.name || 'Begleiter'} wurde besiegt.` }); }
  }

  /* ---------- Netzwerk ---------- */
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { this.drop(ws); } }
  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const [ws, s] of this.sessions) if (s.ready && ws !== except) this.send(ws, data);
  }
  vehView(v) { return { id: v.id, type: v.type, color: v.color, p: v.p, q: v.q, driver: v.driver, ctrl: v.ctrl, seats: v.pass || [] }; }
  /** Mitfahrer-Plätze freigeben, die dieser Spieler belegt. */
  unseat(sid) {
    for (const v of this.vehicles.values()) {
      const i = (v.pass || []).indexOf(sid);
      if (i >= 0) { v.pass[i] = null; this.broadcast({ t: 'vseat', id: v.id, seats: v.pass }); }
    }
  }

  sendCreatures(s) {
    if (!s.pos) return;
    const list = [];
    for (const c of this.creatures.values()) {
      if (Math.abs(c.x - s.pos[0]) > VIEW || Math.abs(c.z - s.pos[2]) > VIEW) continue;
      const sp = this.cfg.species[c.sp]; if (!sp) continue;
      list.push([c.id, c.sp, round(c.x), round(c.y, 100), round(c.z), round(c.ry, 100), Math.max(0, Math.round((c.hp / (Number(sp.hp) || 1)) * 100)), c.moving, c.owner ? c.ownerName || '?' : '', c.atk && now() - c.atk < 400 ? 1 : 0, c.rider ? 1 : 0, c.owner === s.pid ? (c.mode === 'stay' ? 2 : 1) : 0]);
    }
    this.send(s.ws, { t: 'cr', c: list });
  }

  /** Spieler- und Fahrzeugzustände gebündelt verteilen (10 × pro Sekunde, nur in der Nähe; weit entfernte seltener). */
  flushStates() {
    const ready = [...this.sessions.values()].filter((s) => s.ready);
    const full = this.tickN % 20 === 0;
    const vehs = [...this.vehicles.values()].filter((v) => v.netDirty);
    for (const r of ready) {
      const list = [];
      for (const o of ready) {
        if (o === r || !o.st) continue;
        const far = r.pos && o.pos ? Math.hypot(o.pos[0] - r.pos[0], o.pos[2] - r.pos[2]) > 350 : false;
        if (full || (o.stDirty && (!far || this.tickN % 10 === 0))) list.push([o.sid, o.st]);
      }
      const vb = vehs.filter((v) => v.ctrl !== r.sid).map((v) => [v.id, v.p, v.q, v.sp, v.st]);
      if (list.length || vb.length) this.send(r.ws, { t: 'ps', a: list, vb });
    }
    for (const o of ready) o.stDirty = false;
    for (const v of vehs) v.netDirty = false;
  }

  drop(ws) {
    const s = this.sessions.get(ws);
    if (!s) return;
    this.sessions.delete(ws);
    for (const v of this.vehicles.values()) {
      if (v.driver === s.sid) v.driver = null;
      const pi = (v.pass || []).indexOf(s.sid); if (pi >= 0) { v.pass[pi] = null; if (s.ready) this.broadcast({ t: 'vseat', id: v.id, seats: v.pass }); }
      if (v.ctrl === s.sid) { v.ctrl = null; this.broadcast({ t: 'vown', id: v.id, driver: v.driver, ctrl: null }); }
    }
    for (const c of this.creatures.values()) if (c.rider === s.sid) c.rider = null;
    if (s.ready) {
      this.broadcast({ t: 'leave', id: s.sid });
      if (s.profile) this.saveProfile(s, true);
      this.writeStatus(true);
    }
    if (![...this.sessions.values()].some((x) => x.ready)) this.stopLoop();
  }

  async saveProfile(s, final = false) {
    if (!s.profile || String(s.pid).startsWith('psmoke')) return;
    const p = { ...s.profile, name: s.name, color: s.color, last_seen: new Date().toISOString(), pos: s.pos ? s.pos.map((n) => round(n)) : null };
    if (final) p.online = false;
    try { await putDoc(this.env.DB, C.players, s.pid, p); } catch { /* nächster Versuch */ }
  }

  sanitizeProfile(raw, prev) {
    const items = this.cfg.items;
    const inv = [];
    for (const it of Array.isArray(raw.inv) ? raw.inv.slice(0, D.INV_SLOTS) : []) {
      if (!it) { inv.push(null); continue; }
      const def = items[it.id]; if (!def) { inv.push(null); continue; }
      inv.push({ id: it.id, n: Math.floor(clampNum(it.n, 1, Math.max(1, Number(def.stack) || 1), 1)) });
    }
    const quests = {};
    for (const [k, v] of Object.entries(ensureMap(raw.quests))) if (this.cfg.quests[k]) quests[k] = { n: Math.floor(clampNum(v && v.n, 0, 1e6)), done: !!(v && v.done) };
    return {
      ...prev,
      level: Math.floor(clampNum(raw.level, 1, Number(this.cfg.settings.max_level) || 50, 1)),
      xp: Math.floor(clampNum(raw.xp, 0, 1e9)), coins: Math.floor(clampNum(raw.coins, 0, 1e9)),
      hp: clampNum(raw.hp, 0, 10000, 100), hunger: clampNum(raw.hunger, 0, 100, 100),
      inv, armor: items[raw.armor] ? raw.armor : '', quests,
      shards: Array.isArray(raw.shards) ? raw.shards.filter(Number.isInteger).slice(0, 200) : [],
      tamed: Math.floor(clampNum(raw.tamed, 0, 1e6)),
      stashes: Object.fromEntries(Object.entries(ensureMap(raw.stashes)).filter(([k, v]) => /^k\d{1,3}$/.test(k) && Number.isFinite(v)).slice(0, 100)),
      stats: { kills: Math.floor(clampNum(raw.stats && raw.stats.kills, 0, 1e9)), crafted: Math.floor(clampNum(raw.stats && raw.stats.crafted, 0, 1e9)), built: Math.floor(clampNum(raw.stats && raw.stats.built, 0, 1e9)) },
    };
  }

  isAdminName(name) {
    return String(this.cfg.settings.admins || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(name.toLowerCase());
  }

  async onHello(ws, s, m) {
    // War niemand online, läuft die Dashboard-Abfrage nicht: Einstellungen jetzt frisch laden
    if (!this.timer) {
      try {
        const st = await getDoc(this.env.DB, C.settings, 'main');
        if (st && Number(st.version) !== this.version) { await this.loadConfig(); await this.syncVehicles(false); }
      } catch { /* alte Einstellungen weiter nutzen */ }
    }
    let name = String(m.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
    if (name.length < 2) name = 'Spieler';
    const pid = /^[a-z0-9]{8,24}$/i.test(m.pid || '') ? m.pid : rid('p');
    // Admin-Namen sind geschützt: nur mit dem Admin-Code aus dem Dashboard
    if (this.isAdminName(name)) {
      const code = String(this.cfg.settings.admin_code || '');
      const given = String(m.code || '').trim();
      // Schutz gegen Durchprobieren: höchstens 20 falsche Codes pro 5 Minuten und Adresse (Schulnetz = eine Adresse)
      this.adminFails = this.adminFails || new Map();
      const fl = (this.adminFails.get(s.ip) || []).filter((t) => now() - t < 300000);
      if (fl.length >= 20) {
        this.send(ws, { t: 'denied', reason: 'Zu viele falsche Admin-Codes. Warte 5 Minuten.' });
        try { ws.close(4001, 'admin'); } catch { /* egal */ }
        return;
      }
      if (!code || given.toUpperCase() !== code.toUpperCase()) {
        if (given) { fl.push(now()); this.adminFails.set(s.ip, fl); }
        this.send(ws, { t: 'denied', reason: given
          ? 'Der Admin-Code ist falsch. Du findest ihn im Dashboard unter Spielsteuerung → Welt & Regeln (6 Zeichen).'
          : 'Der Name „' + name + '“ ist für einen Admin reserviert. Gib den Admin-Code ein oder wähle einen anderen Namen.' });
        try { ws.close(4001, 'admin'); } catch { /* egal */ }
        return;
      }
      s.admin = true;
    }
    const max = clampNum(this.cfg.settings.max_players, 1, 100, 40);
    if ([...this.sessions.values()].filter((x) => x.ready).length >= max) {
      this.send(ws, { t: 'denied', reason: `Der Server ist voll (${max} Spieler).` }); try { ws.close(4002, 'voll'); } catch { /* egal */ } return;
    }
    // Doppelte Namen unterscheiden
    const taken = new Set([...this.sessions.values()].filter((x) => x.ready && x !== s).map((x) => x.name.toLowerCase()));
    let finalName = name, n = 2;
    while (taken.has(finalName.toLowerCase())) finalName = name.slice(0, 17) + ' ' + n++;
    // gleiche Person in zweitem Tab: alte Verbindung beenden
    const old = this.sessionByPid(pid); if (old) { this.send(old.ws, { t: 'denied', reason: 'Du hast das Spiel in einem anderen Fenster geöffnet.' }); try { old.ws.close(4003, 'dup'); } catch { /* egal */ } this.drop(old.ws); }

    s.pid = pid; s.name = finalName; s.color = COLOR_RE.test(m.color) ? m.color : '#A78BFA';
    const pal = this.palette();
    if (pal && !pal.some((c) => c.toLowerCase() === s.color.toLowerCase())) s.color = pal[Math.floor(Math.random() * pal.length)];
    const saved = await getDoc(this.env.DB, C.players, pid);
    s.profile = saved ? { ...D.newProfile(pid, s.name, s.color, this.cfg.settings), ...saved, name: s.name, color: s.color } : D.newProfile(pid, s.name, s.color, this.cfg.settings);
    s.profile.online = true;
    s.ready = true;
    const others = [...this.sessions.values()].filter((p) => p !== s && p.ready).map((p) => ({ id: p.sid, name: p.name, color: p.color, s: p.st, admin: p.admin }));
    this.send(ws, {
      t: 'welcome', id: s.sid, pid, name: s.name, admin: !!s.admin, config: this.publicConfig(), version: this.version,
      profile: s.profile, players: others, vehicles: [...this.vehicles.values()].map((v) => this.vehView(v)),
      buildings: [...this.buildings.values()].map(({ inv, ...b }) => b), ev: this.eventView(), records: this.records,
    });
    this.broadcast({ t: 'join', id: s.sid, name: s.name, color: s.color, admin: !!s.admin }, ws);
    if (this.frozen && !s.admin) this.send(ws, { t: 'freeze', on: true, by: 'Admin' });
    if (!saved && !pid.startsWith('psmoke')) putDoc(this.env.DB, C.players, pid, s.profile).catch(() => {});
    this.startLoop();
    this.writeStatus(true);
  }

  onMessage(ws, s, m) {
    const db = this.env.DB;
    switch (m.t) {
      case 's': {
        if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
        s.pos = m.p.map((n) => round(n, 100));
        s.dead = !!m.dead;
        const st = { p: s.pos, r: round(Number(m.r) || 0, 1000), v: m.v ? String(m.v).slice(0, 24) : 0, sp: round(Number(m.sp) || 0), w: m.w ? String(m.w).slice(0, 24) : '', a: m.a ? 1 : 0, hp: Math.round(clampNum(m.hp, 0, 100, 100)), tq: Array.isArray(m.tq) ? m.tq.slice(0, 4).map((n) => round(Number(n) || 0, 1000)) : undefined, ride: m.ride ? String(m.ride).slice(0, 24) : '', fly: m.fly ? 1 : 0, se: Math.floor(clampNum(m.se, 0, 16, 0)) };
        s.st = st; s.stDirty = true;
        break;
      }
      case 'save': {
        if (!m.profile || typeof m.profile !== 'object') return;
        s.profile = this.sanitizeProfile(m.profile, s.profile);
        if (now() - (s.lastSave || 0) > 30000) { s.lastSave = now(); this.saveProfile(s); }
        break;
      }
      case 'hit': {
        const c = this.creatures.get(m.id); if (!c || !s.pos) return;
        const d = Math.hypot(c.x - s.pos[0], c.z - s.pos[2]);
        if (d > (m.ranged ? 90 : 9)) return;
        if (c.owner === s.pid) return;
        this.damageCreature(c, s.admin ? clampNum(m.n, 0, 100000, 10) : clampNum(m.n, 0, 300, 10), s);
        break;
      }
      case 'phit': {
        if (!this.cfg.settings.pvp) return;
        const t = [...this.sessions.values()].find((x) => x.sid === m.id && x.ready);
        if (!t || !t.pos || !s.pos || t.dead) return;
        if (Math.hypot(t.pos[0] - s.pos[0], t.pos[2] - s.pos[2]) > (m.ranged ? 90 : 6)) return;
        this.send(t.ws, { t: 'dmg', n: Math.round(clampNum(m.n, 0, 300, 10)), from: s.name, knock: 0, dir: [t.pos[0] - s.pos[0], t.pos[2] - s.pos[2]] });
        break;
      }
      case 'died': {
        this.broadcast({ t: 'msg', text: `${s.name} wurde ${m.by ? 'von ' + String(m.by).slice(0, 40) + ' ' : ''}besiegt.` });
        break;
      }
      case 'feed': {
        const c = this.creatures.get(m.id); if (!c || !s.pos || c.owner) return;
        const sp = this.cfg.species[c.sp]; if (!sp || !sp.tame_food || !(Number(sp.tame_amount) > 0)) return;
        if (Math.hypot(c.x - s.pos[0], c.z - s.pos[2]) > 7) return;
        c.tame[s.pid] = (c.tame[s.pid] || 0) + 1;
        const need = Number(sp.tame_amount);
        if (c.tame[s.pid] >= need) {
          c.owner = s.pid; c.ownerName = s.name; c.mode = 'follow'; c.hp = Number(sp.hp) || c.hp; c.target = null; c.aggroUntil = 0; c.home = [c.x, c.z];
          this.send(ws, { t: 'tamed', id: c.id, sp: c.sp, name: sp.name });
          this.broadcast({ t: 'msg', text: `${s.name} hat einen ${sp.name} gezähmt!` });
          putDoc(db, C.tames, c.id, { species: c.sp, owner: c.owner, ownerName: c.ownerName, x: round(c.x), z: round(c.z), hp: c.hp, mode: c.mode }).catch(() => {});
        } else this.send(ws, { t: 'tameprog', id: c.id, n: c.tame[s.pid], need, name: sp.name });
        break;
      }
      case 'tcmd': {
        const c = this.creatures.get(m.id); if (!c || c.owner !== s.pid) return;
        if (m.mode === 'follow' || m.mode === 'stay') { c.mode = m.mode; c.target = null; c.home = [c.x, c.z]; }
        if (m.mode === 'release') { c.owner = null; c.ownerName = ''; c.tame = {}; deleteDoc(db, C.tames, c.id).catch(() => {}); }
        break;
      }
      case 'ride': {
        const c = this.creatures.get(m.id); if (!c || c.owner !== s.pid || c.rider) return;
        const sp = this.cfg.species[c.sp]; if (!sp || !sp.rideable) return;
        c.rider = s.sid; this.send(ws, { t: 'rideok', id: c.id, sp: c.sp, p: [c.x, c.y, c.z], r: c.ry });
        break;
      }
      case 'rs': {
        const c = this.creatures.get(m.id); if (!c || c.rider !== s.sid || !Array.isArray(m.p)) return;
        const [x, , z] = m.p.map(Number); if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        if (Math.hypot(x - c.x, z - c.z) > 40) return;
        c.x = x; c.z = z; c.y = heightAt(x, z); c.ry = Number(m.r) || 0; c.moving = m.mv ? 2 : 0;
        break;
      }
      case 'unride': {
        const c = this.creatures.get(m.id); if (c && c.rider === s.sid) { c.rider = null; c.home = [c.x, c.z]; c.mode = 'stay'; }
        break;
      }
      case 'venter': {
        const v = this.vehicles.get(m.id); if (!v || !s.pos) return;
        const ctrlAlive = v.ctrl && [...this.sessions.values()].some((x) => x.sid === v.ctrl);
        if ((v.pass || []).includes(s.sid)) return;
        if (v.driver || (ctrlAlive && v.ctrl !== s.sid && now() - v.ctrlAt < 8000)) { this.send(ws, { t: 'msg', text: 'Dieses Fahrzeug wird gerade benutzt.' }); return; }
        if (Math.hypot(v.p[0] - s.pos[0], v.p[2] - s.pos[2]) > 8) return;
        v.driver = s.sid; v.ctrl = s.sid; v.ctrlAt = now();
        this.broadcast({ t: 'vown', id: v.id, driver: v.driver, ctrl: v.ctrl });
        break;
      }
      case 'vsit': {
        // Mitfahren: freien Platz in einem Fahrzeug belegen
        const v = this.vehicles.get(m.id); if (!v || !s.pos || v.driver === s.sid) return;
        const n = (D.VEHICLE_TYPES[v.type] || {}).seats || 0;
        if (Math.hypot(v.p[0] - s.pos[0], v.p[2] - s.pos[2]) > 9) return;
        this.unseat(s.sid);
        v.pass = Array.from({ length: n }, (_, i) => (v.pass && v.pass[i]) || null);
        const free = v.pass.indexOf(null);
        if (free < 0) { this.send(ws, { t: 'msg', text: n ? 'Alle Plätze sind besetzt.' : 'In diesem Fahrzeug ist nur Platz für den Fahrer.' }); return; }
        v.pass[free] = s.sid;
        this.broadcast({ t: 'vseat', id: v.id, seats: v.pass });
        break;
      }
      case 'vstand': this.unseat(s.sid); break;
      case 'vexit': {
        const v = this.vehicles.get(m.id); if (!v || v.driver !== s.sid) return;
        v.driver = null; v.ctrlAt = now();
        this.broadcast({ t: 'vown', id: v.id, driver: null, ctrl: v.ctrl });
        break;
      }
      case 'vrest': {
        const v = this.vehicles.get(m.id); if (!v || v.ctrl !== s.sid || v.driver) return;
        v.ctrl = null; this.broadcast({ t: 'vown', id: v.id, driver: null, ctrl: null });
        break;
      }
      case 'vs': {
        const v = this.vehicles.get(m.id); if (!v || v.ctrl !== s.sid) return;
        if (!Array.isArray(m.p) || !Array.isArray(m.q) || !m.p.every(Number.isFinite) || !m.q.every(Number.isFinite)) return;
        v.p = m.p.slice(0, 3).map((n) => round(n, 100)); v.q = m.q.slice(0, 4).map((n) => round(n, 1000));
        v.sp = round(Number(m.sp) || 0); v.st = round(Number(m.st) || 0, 100); v.ctrlAt = now(); v.dirty = true; v.netDirty = true;
        break;
      }
      case 'build': {
        const def = D.STRUCTURE_TYPES[m.type]; if (!def || !s.pos) return;
        const x = Number(m.x), y = Number(m.y), z = Number(m.z);
        if (![x, y, z].every(Number.isFinite) || Math.abs(x) > SIZE / 2 || Math.abs(z) > SIZE / 2 || y < -5 || y > 300) return;
        if (Math.hypot(x - s.pos[0], z - s.pos[2]) > 30 && !s.admin) return;
        const mine = [...this.buildings.values()].filter((b) => b.owner === s.pid).length;
        if (!s.admin && (mine >= 500 || this.buildings.size >= 8000)) { this.send(ws, { t: 'msg', text: 'Bau-Limit erreicht.' }); return; }
        const b = { id: rid('b'), type: m.type, x: round(x, 100), y: round(y, 100), z: round(z, 100), ry: round(Number(m.ry) || 0, 1000), owner: s.pid, ownerName: s.name, at: new Date().toISOString() };
        this.buildings.set(b.id, b);
        this.broadcast({ t: 'build', b });
        putDoc(db, C.buildings, b.id, b).catch(() => {});
        if (this.event && this.event.type === 'bauen') this.contribute(s, 1);
        break;
      }
      case 'demolish': {
        const b = this.buildings.get(m.id); if (!b) return;
        if (b.owner !== s.pid && !s.admin) { this.send(ws, { t: 'msg', text: 'Das gehört ' + (b.ownerName || 'jemand anderem') + '.' }); return; }
        if (b.type === 'truhe' && (b.inv || []).some(Boolean)) { this.send(ws, { t: 'msg', text: 'Leere zuerst die Truhe, bevor du sie abreißt.' }); return; }
        this.removeBuilding(b.id);
        this.send(ws, { t: 'refund', type: b.type });
        break;
      }
      case 'door': {
        const b = this.buildings.get(m.id); if (!b || b.type !== 'wand_tuer') return;
        b.open = !!m.open; this.broadcast({ t: 'door', id: b.id, open: b.open });
        break;
      }
      case 'adm': this.adminAction(ws, s, m); break;
      case 'chest': case 'chestput': case 'chesttake': this.chestAction(ws, s, m); break;
      case 'evc': {
        // Beitrag zur Team-Herausforderung (gesammelte Rohstoffe)
        if (!this.event || this.event.type !== 'sammeln' || m.item !== this.event.item) return;
        const t = now(); if (t - (s.evcAt || 0) < 150) return; s.evcAt = t;
        this.contribute(s, Math.floor(clampNum(m.n, 1, 30, 1)));
        break;
      }
      case 'evopen': {
        const ev = this.event; if (!ev || ev.type !== 'schatz' || !ev.chest || !s.pos) return;
        if (Math.hypot(ev.chest[0] - s.pos[0], ev.chest[2] - s.pos[2]) > 7) return;
        ev.opener = s.pid; ev.openerName = s.name;
        this.endEvent(true);
        break;
      }
      case 'rec': {
        const course = COURSES[m.course]; const ms = Math.round(Number(m.ms));
        if (!course || !Number.isFinite(ms) || ms < course.min || ms > 30 * 60000) return;
        if (now() - (s.recAt || 0) < 3000) return; s.recAt = now();
        this.addRecord(s, m.course, ms);
        break;
      }
      default: break;
    }
  }

  /* ---------- Lagertruhen ---------- */
  chestAction(ws, s, m) {
    const b = this.buildings.get(m.id);
    if (!b || b.type !== 'truhe' || !s.pos) return;
    if (Math.hypot(b.x - s.pos[0], b.z - s.pos[2]) > 7) { this.send(ws, { t: 'msg', text: 'Du bist zu weit von der Truhe entfernt.' }); return; }
    if (b.owner !== s.pid && !s.admin) { this.send(ws, { t: 'msg', text: 'Diese Truhe gehört ' + (b.ownerName || 'jemand anderem') + '.' }); return; }
    const inv = Array.from({ length: D.CHEST_SLOTS }, (_, i) => (Array.isArray(b.inv) && b.inv[i]) || null);
    const out = { t: 'chest', id: b.id, inv, owner: b.ownerName || '' };
    if (m.t === 'chestput') {
      const def = this.cfg.items[m.item]; if (!def) return;
      const stack = Math.max(1, Number(def.stack) || 1);
      let left = Math.floor(clampNum(m.n, 1, stack * D.CHEST_SLOTS, 1));
      const want = left;
      for (const x of inv) { if (left <= 0) break; if (x && x.id === m.item && x.n < stack) { const k = Math.min(stack - x.n, left); x.n += k; left -= k; } }
      for (let i = 0; i < inv.length && left > 0; i++) if (!inv[i]) { const k = Math.min(stack, left); inv[i] = { id: m.item, n: k }; left -= k; }
      out.put = { item: m.item, n: want - left };
      if (left > 0) out.full = 1;
    } else if (m.t === 'chesttake') {
      const i = Math.floor(clampNum(m.slot, 0, D.CHEST_SLOTS - 1, 0)); const x = inv[i]; if (!x) return;
      const n = Math.floor(clampNum(m.n, 1, x.n, x.n));
      x.n -= n; if (x.n <= 0) inv[i] = null;
      out.took = { item: x.id, n };
    }
    if (out.put || out.took) {
      b.inv = inv;
      putDoc(this.env.DB, C.buildings, b.id, b).catch(() => {});
    }
    this.send(ws, out);
  }

  /* ---------- Events & Bestzeiten ---------- */
  eventView() {
    const e = this.event; if (!e) return null;
    return { type: e.type, title: e.title, text: e.text, left: Math.max(0, e.ends - now()), target: e.target || 0, progress: e.progress || 0, item: e.item || '', species: e.species || '', chest: e.chest || null, participants: Object.keys(e.contrib).length, xp: e.xp, coins: e.coins };
  }
  startEvent(o) {
    if (this.event) this.endEvent(false, true);
    const type = EVENT_NAMES[o.type] ? o.type : 'schatz';
    const minutes = clampNum(o.minutes, 1, 180, 15);
    const e = { type, title: EVENT_NAMES[type], started: now(), ends: now() + minutes * 60000, contrib: {}, names: {}, progress: 0,
      xp: Math.round(clampNum(o.xp, 0, 100000, 200)), coins: Math.round(clampNum(o.coins, 0, 100000, 50)) };
    if (type === 'schatz') {
      let p = null;
      for (let i = 0; i < 80 && !p; i++) { const c = this.randomLand(0); if (c && Math.hypot(c[0] - SPAWN.x, c[1] - SPAWN.z) > 90 && heightAt(c[0], c[1]) < 32) p = c; }
      p = p || this.randomLand(0) || [60, 60];
      e.chest = [round(p[0]), round(heightAt(p[0], p[1]), 100), round(p[1])];
      e.text = 'Eine Schatztruhe ist erschienen! Folge dem Lichtstrahl. Alle, die beim Öffnen in der Nähe sind, bekommen die Belohnung.';
    } else if (type === 'sammeln') {
      e.item = this.cfg.items[o.item] ? o.item : 'holz';
      e.target = Math.round(clampNum(o.target, 1, 100000, 300));
      e.text = `Sammelt zusammen ${e.target}× ${(this.cfg.items[e.item] || {}).name || e.item}!`;
    } else if (type === 'bauen') {
      e.target = Math.round(clampNum(o.target, 1, 10000, 40));
      e.text = `Baut zusammen ${e.target} Bauteile!`;
    } else if (type === 'jagd') {
      e.species = this.cfg.species[o.species] ? o.species : '';
      e.text = `Wer besiegt die meisten ${e.species ? this.cfg.species[e.species].name : 'Kreaturen'}? Die besten drei bekommen Extra-Belohnungen.`;
    } else {
      e.text = 'Für alle gibt es jetzt doppelte Erfahrungspunkte!';
    }
    this.event = e;
    this.broadcast({ t: 'ev', ev: this.eventView(), start: 1 });
    if (type === 'doppelt') this.broadcast({ t: 'config', config: this.publicConfig(), version: this.version });
    this.writeStatus(true);
  }
  contribute(s, n) {
    const e = this.event; if (!e) return;
    e.contrib[s.pid] = (e.contrib[s.pid] || 0) + n; e.names[s.pid] = s.name;
    e.progress += n; e.dirty = true;
    if (e.target && e.progress >= e.target) this.endEvent(true);
  }
  reward(pid, xp, coins, text) {
    const s = this.sessionByPid(pid);
    if (s) this.send(s.ws, { t: 'reward', xp: Math.round(xp), coins: Math.round(coins), text });
  }
  endEvent(success, silent = false) {
    const e = this.event; if (!e) return;
    this.event = null; this.lastEventEnd = now();
    let result = '', rewarded = 0;
    const ranking = Object.entries(e.contrib).sort((a, b) => b[1] - a[1]);
    if (e.type === 'schatz') {
      if (success) {
        const near = [...this.sessions.values()].filter((x) => x.ready && x.pos && Math.hypot(x.pos[0] - e.chest[0], x.pos[2] - e.chest[2]) < 50);
        for (const x of near) { this.reward(x.pid, e.xp * (x.pid === e.opener ? 1.5 : 1), e.coins * (x.pid === e.opener ? 1.5 : 1), x.pid === e.opener ? 'Du hast den Schatz geöffnet!' : 'Schatz gefunden!'); }
        rewarded = near.length;
        result = `${e.openerName} hat den Schatz geöffnet · ${near.length} Spieler belohnt`;
      } else result = 'Der Schatz wurde nicht gefunden.';
    } else if (e.type === 'jagd') {
      ranking.forEach(([pid, n], i) => { const k = i === 0 ? 3 : i === 1 ? 2 : i === 2 ? 1.5 : 0.4; this.reward(pid, e.xp * k, e.coins * k, `Platz ${i + 1} mit ${n} Siegen`); });
      rewarded = ranking.length;
      result = ranking.length ? ranking.slice(0, 3).map(([pid, n], i) => `${i + 1}. ${e.names[pid]} (${n})`).join(' · ') : 'Niemand hat mitgemacht.';
    } else if (e.type === 'sammeln' || e.type === 'bauen') {
      if (success) for (const [pid] of ranking) this.reward(pid, e.xp, e.coins, 'Gemeinsames Ziel erreicht!');
      rewarded = success ? ranking.length : 0;
      result = success ? `Ziel erreicht: ${e.progress} / ${e.target} · ${ranking.length} Helfer` : `Nicht geschafft: ${e.progress} / ${e.target}`;
    } else {
      result = 'Doppelte Erfahrung ist vorbei.';
    }
    if (!silent) this.broadcast({ t: 'ev', ev: null, title: e.title, result, ok: success || e.type === 'jagd' || e.type === 'doppelt' ? 1 : 0 });
    if (e.type === 'doppelt') this.broadcast({ t: 'config', config: this.publicConfig(), version: this.version });
    const id = 'e' + e.started.toString(36);
    putDoc(this.env.DB, C.events, id, { type: e.type, title: e.title, result, participants: Math.max(rewarded, ranking.length), started: new Date(e.started).toISOString(), ended: new Date().toISOString(),
      top: ranking.slice(0, 5).map(([pid, n]) => ({ name: e.names[pid], n })) }).catch(() => {});
    logActivity(this.env.DB, { actor: 'Spielserver', action: 'beendet', type: 'Event', title: e.title, detail: result }).catch(() => {});
    this.writeStatus(true);
  }
  tickEvent() {
    const e = this.event;
    if (e) {
      if (now() >= e.ends) { this.endEvent(e.type === 'jagd' || e.type === 'doppelt'); return; }
      if (e.dirty && this.tickN % 10 === 0) { e.dirty = false; this.broadcast({ t: 'ev', ev: this.eventView() }); }
      return;
    }
    const every = clampNum(this.cfg.settings.treasure_every, 0, 600, 0);
    if (every > 0 && now() - this.lastEventEnd > every * 60000 && [...this.sessions.values()].some((x) => x.ready)) this.startEvent({ type: 'schatz', minutes: 10, xp: 150, coins: 40 });
  }
  addRecord(s, course, ms) {
    const who = pidTag(s.pid);
    const list = (this.records[course] || []).filter((r) => r.who !== who || r.ms <= ms);
    const mine = list.find((r) => r.who === who);
    if (mine) { this.send(s.ws, { t: 'msg', text: `Zeit ${(ms / 1000).toFixed(2)} s · deine Bestzeit bleibt ${(mine.ms / 1000).toFixed(2)} s` }); return; }
    list.push({ who, name: s.name, ms, at: new Date().toISOString() });
    list.sort((a, b) => a.ms - b.ms);
    const top = list.slice(0, 10);
    this.records[course] = top;
    const place = top.findIndex((r) => r.who === who) + 1;
    if (!String(s.pid).startsWith('psmoke')) putDoc(this.env.DB, C.records, course, { name: COURSES[course].name, top }).catch(() => {});
    if (place === 1) this.broadcast({ t: 'msg', text: `Neuer Rekord im ${COURSES[course].name}: ${s.name} mit ${(ms / 1000).toFixed(2)} s!`, big: 1 });
    else this.send(s.ws, { t: 'msg', text: place ? `Neue Bestzeit: ${(ms / 1000).toFixed(2)} s · Platz ${place}` : `Neue Bestzeit: ${(ms / 1000).toFixed(2)} s` });
    this.broadcast({ t: 'recs', course, top: top.map((r) => ({ name: r.name, ms: r.ms })) });
  }

  removeBuilding(id) {
    if (!this.buildings.has(id)) return;
    this.buildings.delete(id);
    this.broadcast({ t: 'unbuild', id });
    deleteDoc(this.env.DB, C.buildings, id).catch(() => {});
  }

  /** Admin-Befehle aus dem Spiel (nur für bestätigte Admins). */
  adminAction(ws, s, m) {
    if (!s.admin) return;
    // Ziele über die Sitzungs-ID (die Spieler-ID bleibt geheim, sie schützt den Spielstand)
    const target = m.sid ? [...this.sessions.values()].find((x) => x.sid === m.sid && x.ready) : null;
    switch (m.op) {
      case 'spawn': {
        const sp = this.cfg.species[m.sp]; if (!sp || !s.pos) return;
        const n = Math.floor(clampNum(m.n, 1, 20, 1));
        for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; const c = this.makeCreature(m.sp, s.pos[0] + Math.cos(a) * 18, s.pos[2] + Math.sin(a) * 18); this.creatures.set(c.id, c); }
        this.send(ws, { t: 'msg', text: `${n} × ${sp.name} erschaffen.` });
        break;
      }
      case 'clear': {
        if (!s.pos) return; let n = 0;
        for (const c of [...this.creatures.values()]) if (!c.owner && Math.hypot(c.x - s.pos[0], c.z - s.pos[2]) < clampNum(m.r, 5, 2000, 60)) { this.creatures.delete(c.id); this.broadcast({ t: 'crdie', id: c.id, silent: 1 }); n++; }
        this.send(ws, { t: 'msg', text: `${n} Kreaturen entfernt.` });
        break;
      }
      case 'tpto': { if (target && target.pos) this.send(ws, { t: 'admin', op: 'teleport', p: target.pos }); break; }
      case 'bring': { if (target && s.pos) this.send(target.ws, { t: 'admin', op: 'teleport', p: [s.pos[0] + 2, s.pos[1], s.pos[2] + 2] }); break; }
      case 'give': { if (target && this.cfg.items[m.item]) this.send(target.ws, { t: 'admin', op: 'give', item: m.item, n: Math.floor(clampNum(m.n, 1, 1000, 1)), by: s.name }); break; }
      case 'heal': { if (target) this.send(target.ws, { t: 'admin', op: 'heal' }); break; }
      case 'kick': { if (target && target !== s) { this.send(target.ws, { t: 'denied', reason: 'Du wurdest von einem Admin aus dem Spiel entfernt.' }); try { target.ws.close(4004, 'kick'); } catch { /* egal */ } this.drop(target.ws); } break; }
      case 'msg': { const text = String(m.text || '').slice(0, 200).trim(); if (text) this.broadcast({ t: 'msg', text: `${s.name}: ${text}`, big: 1 }); break; }
      case 'pvp': {
        this.cfg.settings.pvp = !!m.on;
        patchDoc(this.env.DB, C.settings, 'main', { pvp: !!m.on, version: this.version + 1 }).catch(() => {});
        this.version += 1; this.cfg.settings.version = this.version;
        this.broadcast({ t: 'config', config: this.publicConfig(), version: this.version });
        this.broadcast({ t: 'msg', text: m.on ? 'Kämpfe zwischen Spielern sind jetzt AN.' : 'Kämpfe zwischen Spielern sind jetzt AUS.', big: 1 });
        break;
      }
      case 'world': {
        // Wetter und Tageszeit direkt aus dem Spiel ändern
        const ch = {};
        if (['Klar', 'Nebel', 'Regen', 'Sturm'].includes(m.weather)) ch.weather = m.weather;
        if (['Finsternis', 'Morgen', 'Tag', 'Abend', 'Nacht', 'Zyklus'].includes(m.time_mode)) ch.time_mode = m.time_mode;
        if (Object.keys(ch).length) this.saveSettings(ch, `${s.name} hat ${[ch.weather && 'Wetter: ' + ch.weather, ch.time_mode && 'Tageszeit: ' + ch.time_mode].filter(Boolean).join(', ')} eingestellt.`);
        break;
      }
      case 'spawnhere': {
        if (!s.pos) return;
        this.saveSettings({ spawn_x: Math.round(s.pos[0]), spawn_z: Math.round(s.pos[2]) });
        this.send(ws, { t: 'msg', text: `Neuer Startplatz: ${Math.round(s.pos[0])}, ${Math.round(s.pos[2])}` });
        break;
      }
      case 'event': this.startEvent({ type: m.type, minutes: m.minutes, item: m.item || 'holz', target: m.target || (m.type === 'bauen' ? 30 : 200), xp: 200, coins: 50 }); break;
      case 'eventstop': if (this.event) this.endEvent(this.event.type === 'jagd' || this.event.type === 'doppelt'); break;
      case 'callveh': {
        // Nächstes freies Fahrzeug (optional eines Typs) neben den Admin holen
        if (!s.pos) return;
        const busy = (v) => v.driver || (v.pass || []).some(Boolean) || (v.ctrl && now() - v.ctrlAt < 8000);
        const list = [...this.vehicles.values()].filter((v) => !busy(v) && (!m.type || v.type === m.type))
          .sort((a, b) => Math.hypot(a.p[0] - s.pos[0], a.p[2] - s.pos[2]) - Math.hypot(b.p[0] - s.pos[0], b.p[2] - s.pos[2]));
        const v = list[0];
        if (!v) { this.send(ws, { t: 'msg', text: 'Kein freies Fahrzeug gefunden.' }); return; }
        const yaw = Number(m.yaw) || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const x = s.pos[0] + fx * 7, z = s.pos[2] + fz * 7, ry = Math.atan2(-fz, fx);
        v.p = [round(x), round(heightAt(x, z) + 2, 100), round(z)]; v.q = [0, round(Math.sin(ry / 2), 1000), 0, round(Math.cos(ry / 2), 1000)];
        v.ctrl = null; v.dirty = true;
        this.broadcast({ t: 'vdef', v: this.vehView(v) });
        this.send(ws, { t: 'msg', text: `${(D.VEHICLE_TYPES[v.type] || {}).name || 'Fahrzeug'} ist da.` });
        break;
      }
      case 'bringall': {
        if (!s.pos) return; let i = 0;
        for (const x of this.sessions.values()) {
          if (!x.ready || x === s) continue;
          const a = (i++ / 12) * Math.PI * 2, r = 3 + Math.floor(i / 12) * 2;
          this.send(x.ws, { t: 'admin', op: 'teleport', p: [s.pos[0] + Math.cos(a) * r, s.pos[1], s.pos[2] + Math.sin(a) * r] });
        }
        this.send(ws, { t: 'msg', text: `${i} Spieler hergeholt.` });
        break;
      }
      case 'freeze': {
        this.frozen = !!m.on;
        for (const x of this.sessions.values()) if (x.ready && !x.admin) this.send(x.ws, { t: 'freeze', on: this.frozen, by: s.name });
        this.send(ws, { t: 'msg', text: this.frozen ? 'Alle Spieler sind eingefroren.' : 'Alle Spieler können sich wieder bewegen.' });
        break;
      }
      case 'resetveh': this.runCommand({ op: 'reset_vehicles' }).catch(() => {}); this.send(ws, { t: 'msg', text: 'Alle Fahrzeuge stehen wieder am Startplatz.' }); break;
      case 'respawncr': this.runCommand({ op: 'respawn_creatures' }).catch(() => {}); this.send(ws, { t: 'msg', text: 'Kreaturen wurden neu verteilt.' }); break;
      case 'healall': for (const x of this.sessions.values()) if (x.ready) this.send(x.ws, { t: 'admin', op: 'heal' }); break;
      default: break;
    }
  }

  /** Einstellungen ändern, speichern und an alle schicken (ohne doppeltes Neuladen). */
  saveSettings(changes, announce = '') {
    Object.assign(this.cfg.settings, changes);
    this.version += 1; this.cfg.settings.version = this.version;
    patchDoc(this.env.DB, C.settings, 'main', { ...changes, version: this.version }).catch(() => {});
    this.broadcast({ t: 'config', config: this.publicConfig(), version: this.version });
    if (announce) this.broadcast({ t: 'msg', text: announce });
    this.writeStatus(true);
  }

  /* ---------- Dashboard-Anbindung ---------- */
  async pollDashboard() {
    const db = this.env.DB;
    const st = await getDoc(db, C.settings, 'main');
    if (st && Number(st.version) !== this.version) {
      await this.loadConfig();
      await this.syncVehicles(false);
      this.populate();
      for (const c of this.creatures.values()) { const sp = this.cfg.species[c.sp]; if (sp && c.hp > Number(sp.hp)) c.hp = Number(sp.hp); }
      this.broadcast({ t: 'config', config: this.publicConfig(), version: this.version });
    }
    const cmds = await listDocs(db, C.commands);
    cmds.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const cmd of cmds) {
      await deleteDoc(db, C.commands, cmd.id);
      try { await this.runCommand(cmd); } catch { /* ein fehlerhafter Befehl soll die anderen nicht blockieren */ }
    }
  }

  async runCommand(cmd) {
    const db = this.env.DB;
    const target = cmd.pid ? this.sessionByPid(cmd.pid) : null;
    const patchOffline = async (fn) => { const p = await getDoc(db, C.players, cmd.pid); if (p) await putDoc(db, C.players, cmd.pid, fn({ ...p })); };
    switch (cmd.op) {
      case 'give': {
        if (!this.cfg.items[cmd.item]) return;
        const n = Math.floor(clampNum(cmd.n, 1, 10000, 1));
        if (target) this.send(target.ws, { t: 'admin', op: 'give', item: cmd.item, n, by: 'Dashboard' });
        else await patchOffline((p) => { p.pending = [...(Array.isArray(p.pending) ? p.pending : []), { op: 'give', item: cmd.item, n }]; return p; });
        break;
      }
      case 'set': {
        const f = {};
        for (const k of ['level', 'xp', 'coins', 'hp', 'hunger']) if (cmd[k] !== undefined && cmd[k] !== '' && Number.isFinite(Number(cmd[k]))) f[k] = Number(cmd[k]);
        if (target) this.send(target.ws, { t: 'admin', op: 'set', f });
        else await patchOffline((p) => ({ ...p, ...f }));
        break;
      }
      case 'heal': if (target) this.send(target.ws, { t: 'admin', op: 'heal' }); else await patchOffline((p) => ({ ...p, hp: 100000, hunger: 100 })); break;
      case 'teleport': if (target) { const sp = this.spawnPoint(); this.send(target.ws, { t: 'admin', op: 'teleport', p: [sp.x, heightAt(sp.x, sp.z) + 1, sp.z] }); } else await patchOffline((p) => ({ ...p, pos: null })); break;
      case 'kick': if (target) { this.send(target.ws, { t: 'denied', reason: 'Du wurdest über das Dashboard aus dem Spiel entfernt.' }); try { target.ws.close(4004, 'kick'); } catch { /* egal */ } this.drop(target.ws); } break;
      case 'reset': {
        const fresh = D.newProfile(cmd.pid, '', '', this.cfg.settings);
        if (target) { target.profile = { ...fresh, name: target.name, color: target.color }; this.send(target.ws, { t: 'admin', op: 'reset', profile: target.profile }); }
        else await patchOffline((p) => ({ ...fresh, name: p.name, color: p.color }));
        break;
      }
      case 'msg': { const text = String(cmd.text || '').slice(0, 200).trim(); if (text) this.broadcast({ t: 'msg', text: 'Ansage: ' + text, big: 1 }); break; }
      case 'event_start': this.startEvent(cmd); break;
      case 'event_stop': if (this.event) this.endEvent(this.event.type === 'jagd' || this.event.type === 'doppelt'); break;
      case 'respawn_creatures': {
        for (const c of [...this.creatures.values()]) if (!c.owner) { this.creatures.delete(c.id); this.broadcast({ t: 'crdie', id: c.id, silent: 1 }); }
        this.populate(); break;
      }
      case 'remove_building': this.removeBuilding(cmd.bid); break;
      case 'remove_buildings_of': for (const b of [...this.buildings.values()]) if (b.owner === cmd.owner) this.removeBuilding(b.id); break;
      case 'remove_all_buildings': for (const id of [...this.buildings.keys()]) this.removeBuilding(id); break;
      case 'reset_vehicles': {
        for (const v of this.vehicles.values()) {
          const d = await getDoc(db, C.vehicles, v.id); if (!d) continue;
          const x = Number(d.x) || 0, z = Number(d.z) || 0, ry = Number(d.ry) || 0;
          v.p = [x, heightAt(x, z) + 1.4, z]; v.q = [0, Math.sin(ry / 2), 0, Math.cos(ry / 2)]; v.driver = null; v.ctrl = null; v.pass = [];
          await patchDoc(db, C.vehicles, v.id, { p: v.p, q: v.q });
        }
        this.broadcast({ t: 'vreset', vehicles: [...this.vehicles.values()].map((v) => this.vehView(v)) });
        break;
      }
      default: break;
    }
  }

  async writeStatus(force = false) {
    if (!force && now() - (this.lastStatus || 0) < 10000) return;
    this.lastStatus = now();
    const online = [...this.sessions.values()].filter((s) => s.ready).map((s) => ({
      pid: s.pid, name: s.name, color: s.color, admin: !!s.admin, level: s.profile ? s.profile.level : 1,
      x: s.pos ? Math.round(s.pos[0]) : null, z: s.pos ? Math.round(s.pos[2]) : null,
      vehicle: s.st && s.st.v ? s.st.v : '', hp: s.st ? s.st.hp : 100,
    }));
    const counts = {};
    for (const c of this.creatures.values()) counts[c.sp] = (counts[c.sp] || 0) + 1;
    try {
      await putDoc(this.env.DB, C.status, 'live', {
        online, creatures: counts, tamed: [...this.creatures.values()].filter((c) => c.owner).length,
        buildings: this.buildings.size, vehicles: this.vehicles.size, updated: new Date().toISOString(),
        event: this.event ? { ...this.eventView(), ends: new Date(this.event.ends).toISOString() } : null,
        weather: this.cfg.settings.weather || 'Klar', time_mode: this.cfg.settings.time_mode || 'Finsternis',
      });
    } catch { /* egal */ }
  }

  async saveVehicles() {
    for (const v of this.vehicles.values()) {
      if (!v.dirty) continue; v.dirty = false;
      await patchDoc(this.env.DB, C.vehicles, v.id, { p: v.p, q: v.q }).catch(() => {});
    }
  }

  async saveTames() {
    for (const c of this.creatures.values()) {
      if (!c.owner) continue;
      await putDoc(this.env.DB, C.tames, c.id, { species: c.sp, owner: c.owner, ownerName: c.ownerName, x: round(c.x), z: round(c.z), hp: Math.round(c.hp), mode: c.mode === 'follow' ? 'stay' : c.mode }).catch(() => {});
    }
  }

  startLoop() {
    if (this.timer) return;
    let last = now();
    this.timer = setInterval(() => {
      const t = now(); const dt = Math.min(0.5, (t - last) / 1000); last = t;
      this.tickN++;
      try { this.simulate(dt); } catch { /* Simulation weiterlaufen lassen */ }
      this.flushStates();
      try { this.tickEvent(); } catch { /* weiter */ }
      if (this.tickN % 2 === 0) for (const s of this.sessions.values()) if (s.ready) this.sendCreatures(s);
      if (this.tickN % 20 === 0) { this.pollDashboard().catch(() => {}); this.writeStatus().catch(() => {}); }
      if (this.tickN % 100 === 0) { this.populate(); }
      if (this.tickN % 300 === 0) {
        this.saveVehicles(); this.saveTames();
        for (const s of this.sessions.values()) if (s.ready) this.saveProfile(s);
        for (const v of this.vehicles.values()) if (v.ctrl && !v.driver && t - v.ctrlAt > 15000) { v.ctrl = null; this.broadcast({ t: 'vown', id: v.id, driver: null, ctrl: null }); }
      }
    }, TICK);
  }
  stopLoop() {
    if (!this.timer) return;
    clearInterval(this.timer); this.timer = null;
    this.saveVehicles(); this.saveTames(); this.writeStatus(true);
  }

  async fetch(request) {
    await this.ready;
    if (this.loadError) return new Response('Spielserver konnte nicht starten: ' + this.loadError, { status: 500 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const s = { sid: Math.random().toString(36).slice(2, 10), ip: request.headers.get('cf-connecting-ip') || 'x', ws: server, ready: false, name: '', color: '#A78BFA', pos: null, st: null, win: 0, count: 0 };
    this.sessions.set(server, s);
    server.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 12000) return;
      const t = now();
      if (t - s.win > 1000) { s.win = t; s.count = 0; }
      if (++s.count > 80) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') { if (!s.ready && !s.helloing) { s.helloing = true; this.onHello(server, s, m).catch(() => {}).finally(() => { s.helloing = false; }); } return; }
      if (!s.ready) return;
      try { this.onMessage(server, s, m); } catch { /* fehlerhafte Nachricht ignorieren */ }
    });
    server.addEventListener('close', () => this.drop(server));
    server.addEventListener('error', () => this.drop(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

