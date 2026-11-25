// Spielstand des eigenen Spielers: Inventar, Herstellen, Erfahrung/Level, Quests, Essen, Rüstung.
import { INV_SLOTS, HOTBAR, xpForLevel, maxHp, maxStamina } from './shared/defaults.js';

export function createState(getCfg, events = {}) {
  let p = null;
  let dirty = false;
  const touch = () => { dirty = true; events.onChange?.(); };
  const items = () => getCfg().items;
  const def = (id) => items()[id];

  const api = {
    get profile() { return p; },
    get dirty() { return dirty; },
    clean() { dirty = false; },
    load(profile) {
      p = { ...profile };
      const inv = Array.isArray(p.inv) ? p.inv.slice(0, INV_SLOTS) : [];
      while (inv.length < INV_SLOTS) inv.push(null);
      p.inv = inv.map((s) => (s && def(s.id) ? { id: s.id, n: Math.max(1, Math.floor(s.n || 1)) } : null));
      p.quests = p.quests && typeof p.quests === 'object' ? p.quests : {};
      p.stats = p.stats || { kills: 0, crafted: 0, built: 0 };
      p.shards = Array.isArray(p.shards) ? p.shards : [];
      p.level = Math.max(1, p.level || 1); p.xp = p.xp || 0; p.coins = p.coins || 0;
      p.hp = Math.min(api.maxHp, Number.isFinite(p.hp) && p.hp > 0 ? p.hp : api.maxHp);
      p.hunger = Number.isFinite(p.hunger) ? p.hunger : 100;
      p.stamina = api.maxStamina;
      // Gegenstände, die das Dashboard verschickt hat, während der Spieler offline war
      for (const op of Array.isArray(p.pending) ? p.pending : []) if (op.op === 'give') api.add(op.item, op.n, { silent: true });
      p.pending = [];
      api.checkLevelQuest();
      touch();
    },
    get maxHp() { return maxHp(p ? p.level : 1); },
    get maxStamina() { return maxStamina(p ? p.level : 1); },
    get xpNeed() { return xpForLevel(p.level, getCfg().settings); },
    get armor() { const d = p && p.armor && def(p.armor); return d ? Number(d.armor) || 0 : 0; },
    def,
    hotbar() { return p.inv.slice(0, HOTBAR); },
    count(id) { return p.inv.reduce((s, x) => s + (x && x.id === id ? x.n : 0), 0); },

    /** Gegenstände hinzufügen; liefert, wie viele nicht mehr gepasst haben. */
    add(id, n, opts = {}) {
      const d = def(id); if (!d || n <= 0) return n;
      const stack = Math.max(1, Number(d.stack) || 1);
      let left = Math.floor(n);
      for (const s of p.inv) { if (left <= 0) break; if (s && s.id === id && s.n < stack) { const k = Math.min(stack - s.n, left); s.n += k; left -= k; } }
      for (let i = 0; i < p.inv.length && left > 0; i++) if (!p.inv[i]) { const k = Math.min(stack, left); p.inv[i] = { id, n: k }; left -= k; }
      const added = Math.floor(n) - left;
      if (added > 0) {
        if (opts.count) api.progress('Sammeln', id, added);
        if (!opts.silent) events.onItem?.(id, added);
        touch();
      }
      if (left > 0 && !opts.silent) events.onFull?.(id, left);
      return left;
    },
    remove(id, n) {
      let left = n;
      for (let i = p.inv.length - 1; i >= 0 && left > 0; i--) {
        const s = p.inv[i];
        if (s && s.id === id) { const k = Math.min(s.n, left); s.n -= k; left -= k; if (s.n <= 0) p.inv[i] = null; }
      }
      if (p.armor === id && api.count(id) === 0) p.armor = '';
      touch();
      return n - left;
    },
    removeSlot(i, n = 1) { const s = p.inv[i]; if (!s) return; s.n -= n; if (s.n <= 0) p.inv[i] = null; touch(); },
    swap(a, b) { [p.inv[a], p.inv[b]] = [p.inv[b], p.inv[a]]; touch(); },

    canCraft(rid, nearStation) {
      const r = getCfg().recipes[rid]; if (!r) return { ok: false, why: 'Unbekanntes Rezept' };
      if (p.level < (Number(r.level) || 1)) return { ok: false, why: `Ab Level ${r.level}` };
      if (r.station && !nearStation(r.station)) return { ok: false, why: `Nur am ${def(r.station)?.name || r.station}` };
      for (const [id, n] of Object.entries(r.ingredients || {})) if (api.count(id) < n) return { ok: false, why: `${def(id)?.name || id} fehlt` };
      return { ok: true };
    },
    craft(rid, nearStation) {
      const c = api.canCraft(rid, nearStation); if (!c.ok) return c;
      const r = getCfg().recipes[rid];
      for (const [id, n] of Object.entries(r.ingredients || {})) api.remove(id, n);
      const left = api.add(r.item, Number(r.amount) || 1, { silent: true });
      p.stats.crafted++;
      api.progress('Herstellen', r.item, (Number(r.amount) || 1) - left);
      api.addXp(5 + Object.values(r.ingredients || {}).reduce((a, b) => a + b, 0));
      touch();
      return { ok: true, left };
    },

    addXp(n) {
      const s = getCfg().settings;
      p.xp += Math.round(n * (Number(s.xp_multiplier) || 1));
      const maxL = Number(s.max_level) || 50;
      let up = false;
      while (p.level < maxL && p.xp >= xpForLevel(p.level, s)) { p.xp -= xpForLevel(p.level, s); p.level++; up = true; }
      if (up) { p.hp = api.maxHp; events.onLevel?.(p.level); api.checkLevelQuest(); }
      touch();
    },
    checkLevelQuest() { for (const [qid, q] of Object.entries(getCfg().quests)) if (q.type === 'Level erreichen') { const st = p.quests[qid] || { n: 0, done: false }; if (!st.done) { st.n = p.level; p.quests[qid] = st; if (st.n >= q.count) api.finishQuest(qid); } } },
    /** Fortschritt für alle passenden Quests. */
    progress(type, target, n = 1) {
      for (const [qid, q] of Object.entries(getCfg().quests)) {
        if (q.type !== type) continue;
        if (q.target && q.target !== target) continue;
        const st = p.quests[qid] || { n: 0, done: false };
        if (st.done) continue;
        st.n = Math.min(Number(q.count) || 1, st.n + n);
        p.quests[qid] = st;
        if (st.n >= (Number(q.count) || 1)) api.finishQuest(qid);
      }
      touch();
    },
    finishQuest(qid) {
      const q = getCfg().quests[qid]; const st = p.quests[qid] || { n: 0 };
      if (st.done) return;
      st.done = true; p.quests[qid] = st;
      p.coins += Number(q.coins) || 0;
      if (q.reward_item && Number(q.reward_amount) > 0) api.add(q.reward_item, Number(q.reward_amount), { silent: true });
      events.onQuest?.(q);
      api.addXp(Number(q.xp) || 0);
    },
    openQuests() {
      return Object.entries(getCfg().quests).filter(([id]) => !(p.quests[id] && p.quests[id].done))
        .sort((a, b) => (Number(a[1].order) || 0) - (Number(b[1].order) || 0));
    },

    eat(slot) {
      const s = p.inv[slot]; if (!s) return false;
      const d = def(s.id); if (!d || d.type !== 'Nahrung') return false;
      p.hunger = Math.min(100, p.hunger + (Number(d.food) || 0));
      p.hp = Math.max(1, Math.min(api.maxHp, p.hp + (Number(d.heal) || 0)));
      api.removeSlot(slot, 1);
      return true;
    },
    toggleArmor(id) { p.armor = p.armor === id ? '' : id; touch(); },

    damage(n) {
      const real = Math.max(1, Math.round(n * (1 - Math.min(0.8, api.armor / 100))));
      p.hp = Math.max(0, p.hp - real); touch();
      return real;
    },
    heal(n) { p.hp = Math.min(api.maxHp, p.hp + n); touch(); },
    serialize() {
      const { stamina, ...rest } = p; void stamina;
      return rest;
    },
  };
  return api;
}
