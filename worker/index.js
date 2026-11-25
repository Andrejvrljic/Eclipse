// ECLIPSE – Dev Platform: API für die gemeinsamen Daten (Cloudflare Worker + D1).
// Statische Dateien (public/) liefert Cloudflare direkt aus; dieser Worker beantwortet /api/*.
import seed from '../seed/startdaten.json';

const COLLS = new Set(['project', 'phases', 'tasks', 'developers', 'areas', 'techdocs', 'files', 'activity']);
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const MAX_BODY = 256 * 1024;

let initialized = false;

async function init(db) {
  if (initialized) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, PRIMARY KEY (coll, id))'),
    db.prepare('CREATE INDEX IF NOT EXISTS docs_updated ON docs (updated)'),
    db.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'),
  ]);
  const seeded = await db.prepare("SELECT v FROM meta WHERE k = 'seeded'").first();
  if (!seeded) {
    // Startdaten genau einmal anlegen; danach ist alles frei editierbar.
    const now = Date.now();
    const stmts = [];
    for (const [coll, docs] of Object.entries(seed)) {
      for (const [id, doc] of Object.entries(docs)) {
        stmts.push(db.prepare('INSERT OR IGNORE INTO docs (coll, id, data, deleted, updated) VALUES (?, ?, ?, 0, ?)').bind(coll, id, JSON.stringify(doc), now));
      }
    }
    stmts.push(db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('seeded', ?)").bind(new Date(now).toISOString()));
    await db.batch(stmts);
  }
  initialized = true;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Liefert eine streng monoton steigende Zeit, damit Polling keine Änderung verpasst.
async function nextStamp(db) {
  const row = await db.prepare('SELECT MAX(updated) AS m FROM docs').first();
  return Math.max(Date.now(), (Number(row && row.m) || 0) + 1);
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: json({ error: 'Dokument zu groß' }, 413) };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: json({ error: 'Objekt erwartet' }, 400) };
    delete data.id;
    return { data };
  } catch {
    return { error: json({ error: 'Ungültiges JSON' }, 400) };
  }
}

async function handleApi(request, env, url) {
  if (!env.DB) return json({ error: 'Keine Datenbank gebunden' }, 500);
  if (env.TEAM_KEY && !safeEqual(request.headers.get('x-team-key') || '', env.TEAM_KEY)) {
    return json({ error: 'Team-Schlüssel erforderlich' }, 401);
  }
  const db = env.DB;
  await init(db);

  const parts = url.pathname.replace(/^\/api\/docs\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

  if (request.method === 'GET' && parts.length === 0) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const { results } = await db.prepare('SELECT coll, id, data, deleted, updated FROM docs WHERE updated >= ? ORDER BY updated').bind(since).all();
    const row = await db.prepare('SELECT MAX(updated) AS m FROM docs').first();
    return json({
      cursor: Number(row && row.m) || 0,
      docs: results.map((r) => ({ c: r.coll, id: r.id, d: r.deleted ? null : JSON.parse(r.data), x: r.deleted ? 1 : 0, u: r.updated })),
    });
  }

  if (parts.length !== 2) return json({ error: 'Nicht gefunden' }, 404);
  const [coll, id] = parts;
  if (!COLLS.has(coll) || !ID_RE.test(id)) return json({ error: 'Ungültiger Pfad' }, 400);

  if (request.method === 'PUT') {
    const { data, error } = await readBody(request);
    if (error) return error;
    const t = await nextStamp(db);
    await db.prepare('INSERT INTO docs (coll, id, data, deleted, updated) VALUES (?, ?, ?, 0, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, deleted = 0, updated = excluded.updated')
      .bind(coll, id, JSON.stringify(data), t).run();
    return json({ ok: true, updated: t });
  }

  if (request.method === 'PATCH') {
    const { data, error } = await readBody(request);
    if (error) return error;
    const cur = await db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ? AND deleted = 0').bind(coll, id).first();
    if (!cur) return json({ error: 'Dokument existiert nicht' }, 404);
    const merged = { ...JSON.parse(cur.data), ...data };
    const t = await nextStamp(db);
    await db.prepare('UPDATE docs SET data = ?, updated = ? WHERE coll = ? AND id = ?').bind(JSON.stringify(merged), t, coll, id).run();
    return json({ ok: true, updated: t });
  }

  if (request.method === 'DELETE') {
    const t = await nextStamp(db);
    await db.prepare('INSERT INTO docs (coll, id, data, deleted, updated) VALUES (?, ?, NULL, 1, ?) ON CONFLICT (coll, id) DO UPDATE SET data = NULL, deleted = 1, updated = excluded.updated')
      .bind(coll, id, t).run();
    return json({ ok: true, updated: t });
  }

  return json({ error: 'Methode nicht erlaubt' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/docs' || url.pathname.startsWith('/api/docs/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return json({ error: 'Serverfehler', detail: String(e && e.message || e) }, 500);
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Nicht gefunden' }, 404);
    return env.ASSETS.fetch(request);
  },
};
