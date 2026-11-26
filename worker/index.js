// ECLIPSE – Dev Platform: API für die gemeinsamen Daten (Cloudflare Worker + D1).
// Statische Dateien (public/) liefert Cloudflare direkt aus; dieser Worker beantwortet /api/*.
import { COLLS, ID_RE, init, getDoc, putDoc, patchDoc, deleteDoc } from './store.js';

const COLL_SET = new Set(COLLS);
const MAX_BODY = 256 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- Schutz der Spielsteuerung ---------- */
// Spielstände, Befehle und Live-Status sind nur mit Dashboard-Passwort lesbar; alle game_*-Daten nur damit änderbar.
const PROTECTED_READ = new Set(['game_players', 'game_commands', 'game_status', 'game_tames']);
const isGame = (c) => c.startsWith('game_');
const fails = new Map();
const tooMany = (ip) => { const n = Date.now(); const l = (fails.get(ip) || []).filter((t) => n - t < 60000); fails.set(ip, l); return l.length >= 8; };
async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function keyRecord(db) {
  const row = await db.prepare("SELECT v FROM meta WHERE k = 'dash_key'").first();
  try { return row ? JSON.parse(row.v) : null; } catch { return null; }
}
/** true, wenn die Anfrage das richtige Dashboard-Passwort mitschickt. */
async function hasKey(request, db) {
  const key = request.headers.get('x-dash-key') || '';
  if (!key) return false;
  const rec = await keyRecord(db); if (!rec) return false;
  return safeEqual(await sha(rec.salt + key), rec.hash);
}
async function handleAuth(request, env, url) {
  const db = env.DB;
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (url.pathname === '/api/game-auth' && request.method === 'GET') return json({ configured: !!(await keyRecord(db)) });
  if (url.pathname === '/api/game-auth/setup' && request.method === 'POST') {
    if (await keyRecord(db)) return json({ error: 'Das Passwort ist bereits festgelegt.' }, 409);
    const { data, error } = await readJson(request); if (error) return error;
    const key = String(data.key || '');
    if (key.length < 6) return json({ error: 'Das Passwort braucht mindestens 6 Zeichen.' }, 400);
    const salt = crypto.randomUUID();
    await db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('dash_key', ?)").bind(JSON.stringify({ salt, hash: await sha(salt + key) })).run();
    return json({ ok: true });
  }
  if (url.pathname === '/api/game-auth/check' && request.method === 'POST') {
    if (tooMany(ip)) return json({ error: 'Zu viele Fehlversuche. Warte eine Minute.' }, 429);
    if (await hasKey(request, db)) return json({ ok: true });
    fails.set(ip, [...(fails.get(ip) || []), Date.now()]);
    return json({ error: 'Das Passwort ist falsch.', code: 'dash_key' }, 401);
  }
  return json({ error: 'Nicht gefunden' }, 404);
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: json({ error: 'Anfrage zu groß' }, 413) };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: json({ error: 'Objekt erwartet' }, 400) };
    return { data };
  } catch {
    return { error: json({ error: 'Ungültiges JSON' }, 400) };
  }
}

async function handleDocs(request, env, url) {
  const db = env.DB;
  const parts = url.pathname.replace(/^\/api\/docs\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

  if (request.method === 'GET' && parts.length === 0) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const { results } = await db.prepare('SELECT coll, id, data, deleted, updated FROM docs WHERE updated >= ? ORDER BY updated').bind(since).all();
    const row = await db.prepare('SELECT MAX(updated) AS m FROM docs').first();
    const authed = await hasKey(request, db);
    const docs = [];
    for (const r of results) {
      if (!authed && PROTECTED_READ.has(r.coll)) continue;
      let d = r.deleted ? null : JSON.parse(r.data);
      if (!authed && r.coll === 'game_settings' && d) { d = { ...d }; delete d.admin_code; }
      docs.push({ c: r.coll, id: r.id, d, x: r.deleted ? 1 : 0, u: r.updated });
    }
    return json({ cursor: Number(row && row.m) || 0, authed, docs });
  }

  if (parts.length !== 2) return json({ error: 'Nicht gefunden' }, 404);
  const [coll, id] = parts;
  if (!COLL_SET.has(coll) || !ID_RE.test(id)) return json({ error: 'Ungültiger Pfad' }, 400);
  if (isGame(coll) && request.method !== 'GET' && !(await hasKey(request, db))) return json({ error: 'Für die Spielsteuerung ist das Dashboard-Passwort nötig.', code: 'dash_key' }, 401);

  if (request.method === 'PUT') {
    const { data, error } = await readJson(request);
    if (error) return error;
    const t = await putDoc(db, coll, id, data);
    return json({ ok: true, updated: t });
  }
  if (request.method === 'PATCH') {
    const { data, error } = await readJson(request);
    if (error) return error;
    if (!(await getDoc(db, coll, id))) return json({ error: 'Dokument existiert nicht' }, 404);
    await patchDoc(db, coll, id, data);
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    const t = await deleteDoc(db, coll, id);
    return json({ ok: true, updated: t });
  }
  return json({ error: 'Methode nicht erlaubt' }, 405);
}

async function handleApi(request, env, url) {
  if (!env.DB) return json({ error: 'Keine Datenbank gebunden' }, 500);
  if (env.TEAM_KEY && !safeEqual(request.headers.get('x-team-key') || '', env.TEAM_KEY)) {
    return json({ error: 'Team-Schlüssel erforderlich' }, 401);
  }
  await init(env.DB);

  if (url.pathname.startsWith('/api/game-auth')) return handleAuth(request, env, url);
  if (url.pathname === '/api/docs' || url.pathname.startsWith('/api/docs/')) return handleDocs(request, env, url);
  return json({ error: 'Nicht gefunden' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return json({ error: 'Serverfehler', detail: String((e && e.message) || e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

