// Gemeinsamer Datenzugriff (D1) für die Website-API und den KI-Assistenten.
import seed from '../seed/startdaten.json';

export const COLLS = ['project', 'phases', 'tasks', 'developers', 'areas', 'techdocs', 'files', 'activity'];
export const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

let initialized = false;

export async function init(db) {
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

// Streng monoton steigende Zeit, damit das Polling der Clients keine Änderung verpasst.
export async function nextStamp(db) {
  const row = await db.prepare('SELECT MAX(updated) AS m FROM docs').first();
  return Math.max(Date.now(), (Number(row && row.m) || 0) + 1);
}

export async function getDoc(db, coll, id) {
  const row = await db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ? AND deleted = 0').bind(coll, id).first();
  return row ? JSON.parse(row.data) : null;
}

export async function listDocs(db, coll) {
  const { results } = await db.prepare('SELECT id, data FROM docs WHERE coll = ? AND deleted = 0').bind(coll).all();
  return results.map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
}

export async function putDoc(db, coll, id, data) {
  const clean = { ...data };
  delete clean.id;
  const t = await nextStamp(db);
  await db.prepare('INSERT INTO docs (coll, id, data, deleted, updated) VALUES (?, ?, ?, 0, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, deleted = 0, updated = excluded.updated')
    .bind(coll, id, JSON.stringify(clean), t).run();
  return t;
}

/** Führt Felder zusammen. Gibt null zurück, wenn das Dokument nicht existiert. */
export async function patchDoc(db, coll, id, changes) {
  const cur = await getDoc(db, coll, id);
  if (!cur) return null;
  const merged = { ...cur, ...changes };
  delete merged.id;
  const t = await nextStamp(db);
  await db.prepare('UPDATE docs SET data = ?, updated = ? WHERE coll = ? AND id = ?').bind(JSON.stringify(merged), t, coll, id).run();
  return merged;
}

export async function deleteDoc(db, coll, id) {
  const t = await nextStamp(db);
  await db.prepare('INSERT INTO docs (coll, id, data, deleted, updated) VALUES (?, ?, NULL, 1, ?) ON CONFLICT (coll, id) DO UPDATE SET data = NULL, deleted = 1, updated = excluded.updated')
    .bind(coll, id, t).run();
  return t;
}

export async function logActivity(db, { actor, action, type, title, detail = '' }) {
  const id = 'a-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await putDoc(db, 'activity', id, {
    actor, actor_id: '', action, target_type: type,
    target_title: String(title || '').slice(0, 200), detail: String(detail || '').slice(0, 400),
    timestamp: new Date().toISOString(),
  });
}

/** Fortschritt aus Aufgaben, gewichtet nach geschätztem Aufwand (wie im Dashboard). */
export function progressOf(tasks) {
  if (!tasks.length) return 0;
  let w = 0, s = 0;
  for (const t of tasks) {
    const h = Math.max(1, Number(t.estimate_hours) || 1);
    const p = t.status === 'Erledigt' ? 100 : Math.min(100, Math.max(0, Number(t.progress) || 0));
    w += h; s += h * p;
  }
  return Math.round(s / w);
}

/** Hält die gespeicherten Fortschrittswerte von Phasen und Bereichen aktuell. */
export async function syncDerived(db, phaseIds, areaIds) {
  const tasks = await listDocs(db, 'tasks');
  for (const id of new Set(phaseIds.filter(Boolean))) {
    const p = await getDoc(db, 'phases', id);
    if (!p) continue;
    const v = progressOf(tasks.filter((t) => t.phase === id));
    if (Number(p.progress) !== v) await patchDoc(db, 'phases', id, { progress: v });
  }
  for (const id of new Set(areaIds.filter(Boolean))) {
    const a = await getDoc(db, 'areas', id);
    if (!a) continue;
    const v = progressOf(tasks.filter((t) => t.area === id));
    if (Number(a.progress) !== v) await patchDoc(db, 'areas', id, { progress: v });
  }
}
