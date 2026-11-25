// Neues Spiel – Backend: Cloudflare Worker + D1-Datenbank.
// Statische Dateien (public/) liefert Cloudflare direkt aus; dieser Worker beantwortet /api/*.
//
// Datenmodell: Dokumente (JSON) in Sammlungen, z. B. players/abc, scores/xyz, saves/slot-1.
// Sammlungen müssen nicht vorher angelegt werden – sie entstehen beim ersten Schreiben.
//
//   GET    /api/status                    Datenbank-Status und Sammlungen mit Anzahl
//   GET    /api/docs?since=<zeit>         Alle Änderungen seit <zeit> (für Live-Abgleich per Polling)
//   GET    /api/docs/<sammlung>           Alle Dokumente einer Sammlung
//   GET    /api/docs/<sammlung>/<id>      Ein Dokument
//   PUT    /api/docs/<sammlung>/<id>      Dokument anlegen oder ersetzen
//   PATCH  /api/docs/<sammlung>/<id>      Felder zusammenführen
//   DELETE /api/docs/<sammlung>/<id>      Dokument löschen
//
// Lesen ist offen. Schreiben ist offen, solange kein Secret WRITE_KEY gesetzt ist;
// mit WRITE_KEY muss jede Schreibanfrage den Header x-write-key mitschicken.

const COLL_RE = /^[a-z][a-z0-9_-]{0,47}$/;
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const MAX_BODY = 256 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  },
});

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: json({ error: 'Anfrage zu groß' }, 413) };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: json({ error: 'JSON-Objekt erwartet' }, 400) };
    delete data.id;
    return { data };
  } catch {
    return { error: json({ error: 'Ungültiges JSON' }, 400) };
  }
}

let initialized = false;
async function init(db) {
  if (initialized) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, PRIMARY KEY (coll, id))'),
    db.prepare('CREATE INDEX IF NOT EXISTS docs_updated ON docs (updated)'),
    db.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'),
    db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('created', ?)").bind(new Date().toISOString()),
  ]);
  initialized = true;
}

// Streng monoton steigende Zeit, damit das Polling keine Änderung verpasst.
async function nextStamp(db) {
  const row = await db.prepare('SELECT MAX(updated) AS m FROM docs').first();
  return Math.max(Date.now(), (Number(row && row.m) || 0) + 1);
}

async function getDoc(db, coll, id) {
  const row = await db.prepare('SELECT data, updated FROM docs WHERE coll = ? AND id = ? AND deleted = 0').bind(coll, id).first();
  return row ? { id, ...JSON.parse(row.data), _updated: row.updated } : null;
}

async function putDoc(db, coll, id, data) {
  const t = await nextStamp(db);
  await db.prepare('INSERT INTO docs (coll, id, data, deleted, updated) VALUES (?, ?, ?, 0, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, deleted = 0, updated = excluded.updated')
    .bind(coll, id, JSON.stringify(data), t).run();
  return t;
}

async function handleDocs(request, env, url) {
  const db = env.DB;
  const parts = url.pathname.replace(/^\/api\/docs\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const write = request.method !== 'GET';

  if (write && env.WRITE_KEY && !safeEqual(request.headers.get('x-write-key') || '', env.WRITE_KEY)) {
    return json({ error: 'Schreibschlüssel fehlt oder ist falsch (Header x-write-key)' }, 401);
  }

  if (request.method === 'GET' && parts.length === 0) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const { results } = await db.prepare('SELECT coll, id, data, deleted, updated FROM docs WHERE updated > ? ORDER BY updated LIMIT 5000').bind(since).all();
    const row = await db.prepare('SELECT MAX(updated) AS m FROM docs').first();
    return json({
      cursor: Number(row && row.m) || 0,
      docs: results.map((r) => ({ c: r.coll, id: r.id, d: r.deleted ? null : JSON.parse(r.data), x: r.deleted ? 1 : 0, u: r.updated })),
    });
  }

  const [coll, id] = parts;
  if (!coll || !COLL_RE.test(coll) || parts.length > 2) return json({ error: 'Ungültige Sammlung (a–z, 0–9, _ und -)' }, 400);

  if (parts.length === 1) {
    if (request.method !== 'GET') return json({ error: 'Methode nicht erlaubt' }, 405);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
    const { results } = await db.prepare('SELECT id, data, updated FROM docs WHERE coll = ? AND deleted = 0 ORDER BY updated DESC LIMIT ?').bind(coll, limit).all();
    return json({ docs: results.map((r) => ({ id: r.id, ...JSON.parse(r.data), _updated: r.updated })) });
  }

  if (!ID_RE.test(id)) return json({ error: 'Ungültige ID' }, 400);

  if (request.method === 'GET') {
    const doc = await getDoc(db, coll, id);
    return doc ? json(doc) : json({ error: 'Nicht gefunden' }, 404);
  }
  if (request.method === 'PUT') {
    const { data, error } = await readJson(request);
    if (error) return error;
    return json({ ok: true, updated: await putDoc(db, coll, id, data) });
  }
  if (request.method === 'PATCH') {
    const { data, error } = await readJson(request);
    if (error) return error;
    const cur = await getDoc(db, coll, id);
    if (!cur) return json({ error: 'Dokument existiert nicht' }, 404);
    delete cur.id; delete cur._updated;
    return json({ ok: true, updated: await putDoc(db, coll, id, { ...cur, ...data }) });
  }
  if (request.method === 'DELETE') {
    const t = await nextStamp(db);
    await db.prepare('UPDATE docs SET data = NULL, deleted = 1, updated = ? WHERE coll = ? AND id = ? AND deleted = 0').bind(t, coll, id).run();
    return json({ ok: true, updated: t });
  }
  return json({ error: 'Methode nicht erlaubt' }, 405);
}

async function handleApi(request, env, url) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-write-key',
      'access-control-max-age': '86400',
    } });
  }
  if (!env.DB) return json({ error: 'Keine Datenbank gebunden' }, 500);
  await init(env.DB);

  if (url.pathname === '/api/status' && request.method === 'GET') {
    const t0 = Date.now();
    const { results } = await env.DB.prepare('SELECT coll, COUNT(*) AS n, MAX(updated) AS last FROM docs WHERE deleted = 0 GROUP BY coll ORDER BY coll').all();
    const created = await env.DB.prepare("SELECT v FROM meta WHERE k = 'created'").first();
    return json({
      ok: true,
      database: 'verbunden',
      latency_ms: Date.now() - t0,
      created: created ? created.v : null,
      write_protected: !!env.WRITE_KEY,
      collections: results.map((r) => ({ name: r.coll, count: r.n, last: r.last })),
    });
  }
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
