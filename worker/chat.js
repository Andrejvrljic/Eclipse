// KI-Assistent für den Admin: Claude liest und ändert die Plattform-Daten über Werkzeuge.
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { getDoc, listDocs, putDoc, patchDoc, deleteDoc, logActivity, syncDerived } from './store.js';

const MODEL = 'claude-opus-5-5';

const STATUS = ['Backlog', 'In Arbeit', 'Review', 'Erledigt'];
const PRIO = ['Niedrig', 'Mittel', 'Hoch', 'Kritisch'];
const PHASE_STATUS = ['Ausstehend', 'Aktiv', 'Abgeschlossen'];
const PROJECT_STATUS = ['Planung', 'In Entwicklung', 'Pause', 'Release'];
const ONLINE = ['Online', 'Abwesend', 'Offline'];
const DOC_STATUS = ['Entwurf', 'Aktuell', 'Veraltet'];
const DOC_CATS = ['Architektur', 'Leitfaden', 'Referenz', 'Entscheidung'];
const TECHS = ['HTML', 'CSS', 'JavaScript', 'Three.js', 'Node.js', 'Socket.IO', 'Rapier.js'];
const FILE_CATS = ['Client', 'Server', 'Shared', 'Assets', 'Docs'];
const FILE_TYPES = ['HTML', 'CSS', 'JavaScript', 'JSON', 'Markdown', '3D-Modell', 'Textur', 'Audio', 'Konfiguration', 'Sonstiges'];
const AREA_ICONS = ['compass', 'ruler', 'cog', 'cube', 'network', 'wheel', 'person', 'slots', 'hammer', 'flag', 'levels', 'base'];

const LABEL = { project: 'Projekt', phases: 'Phase', tasks: 'Aufgabe', developers: 'Entwickler', areas: 'Bereich', techdocs: 'Dokument', files: 'Datei', activity: 'Aktivität' };

// Erlaubte Felder je Sammlung mit Typ bzw. erlaubten Werten.
const SCHEMA = {
  tasks: {
    title: 'text', description: 'text', phase: 'ref:phases', area: 'ref:areas', assignee: 'ref?:developers',
    status: STATUS, priority: PRIO, progress: 'percent', estimate_hours: 'hours', due_date: 'date', tags: 'tags',
  },
  phases: { number: 'int', name: 'text', description: 'text', status: PHASE_STATUS, color: 'color' },
  project: {
    name: 'text', codename: 'text', description: 'text', status: PROJECT_STATUS, current_phase: 'ref:phases',
    start_date: 'date', target_date: 'date', version: 'text', genre: 'text', engine_notes: 'text',
  },
  developers: { name: 'text', role: 'text', avatar_initials: 'initials', color: 'color', focus_area: 'text', online_status: ONLINE },
  areas: { name: 'text', description: 'text', icon: AREA_ICONS },
  techdocs: { title: 'text', category: DOC_CATS, tech: TECHS, description: 'text', status: DOC_STATUS, link: 'url', notes: 'text' },
  files: { name: 'text', type: FILE_TYPES, path: 'path', category: FILE_CATS, description: 'text' },
};
const REQUIRED = {
  tasks: ['title', 'phase', 'area'], phases: ['number', 'name'], developers: ['name', 'avatar_initials'],
  techdocs: ['title', 'tech'], files: ['name', 'path'],
};
const WRITABLE = Object.keys(SCHEMA);
const CREATABLE = ['tasks', 'phases', 'techdocs', 'files'];
const DELETABLE = ['tasks', 'phases', 'techdocs', 'files'];

const FIELD = {
  title: 'Titel', description: 'Beschreibung', phase: 'Phase', area: 'Bereich', assignee: 'Zugewiesen an', status: 'Status',
  priority: 'Priorität', progress: 'Fortschritt', estimate_hours: 'Schätzung', due_date: 'Fällig am', tags: 'Tags', number: 'Nummer',
  name: 'Name', color: 'Farbe', codename: 'Codename', current_phase: 'Aktuelle Phase', start_date: 'Start', target_date: 'Zieltermin',
  version: 'Version', genre: 'Genre', engine_notes: 'Engine-Notizen', role: 'Rolle', avatar_initials: 'Initialen', focus_area: 'Fokus',
  online_status: 'Status', icon: 'Symbol', category: 'Kategorie', tech: 'Technologie', link: 'Link', notes: 'Notizen', type: 'Typ', path: 'Ordner',
};
const titleOf = (coll, d) => (coll === 'files' ? `${d.path || ''}${d.name || ''}` : d.title || d.name || d.key || '');

/** Prüft und normalisiert Änderungen. Wirft einen verständlichen Fehler bei ungültigen Werten. */
async function clean(db, coll, input) {
  const schema = SCHEMA[coll];
  const out = {};
  for (const [k, raw] of Object.entries(input || {})) {
    const rule = schema[k];
    if (!rule) throw new Error(`Feld "${k}" gibt es bei ${LABEL[coll]} nicht. Erlaubt: ${Object.keys(schema).join(', ')}.`);
    let v = raw;
    if (Array.isArray(rule)) {
      if (!rule.includes(v)) throw new Error(`"${v}" ist kein gültiger Wert für ${k}. Erlaubt: ${rule.join(', ')}.`);
    } else if (rule === 'text') {
      v = String(v ?? '').trim().slice(0, 2000);
    } else if (rule === 'int') {
      v = Number(v); if (!Number.isInteger(v) || v < 1 || v > 99) throw new Error(`${k} muss eine ganze Zahl von 1 bis 99 sein.`);
    } else if (rule === 'percent') {
      v = Math.round(Number(v)); if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('progress muss zwischen 0 und 100 liegen.');
    } else if (rule === 'hours') {
      v = Number(v); if (!Number.isFinite(v) || v < 0 || v > 999) throw new Error('estimate_hours muss zwischen 0 und 999 liegen.');
    } else if (rule === 'date') {
      v = String(v ?? '').trim(); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${k} muss im Format JJJJ-MM-TT sein oder leer.`);
    } else if (rule === 'tags') {
      if (!Array.isArray(v)) v = String(v ?? '').split(',');
      v = [...new Set(v.map((s) => String(s).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 8).map((s) => s.slice(0, 24));
    } else if (rule === 'color') {
      v = String(v ?? ''); if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`${k} muss eine Farbe wie #A78BFA sein.`);
    } else if (rule === 'initials') {
      v = String(v ?? '').trim().slice(0, 3); if (!v) throw new Error('avatar_initials darf nicht leer sein.');
    } else if (rule === 'url') {
      v = String(v ?? '').trim(); if (v && !/^https:\/\/\S+$/.test(v)) throw new Error('link muss mit https:// beginnen oder leer sein.');
    } else if (rule === 'path') {
      v = String(v ?? '').trim().replace(/^\/+/, ''); if (!v.endsWith('/')) v += '/';
      if (!/^(client|server|shared|assets|docs)\//.test(v) || v.includes('..')) throw new Error('path muss mit client/, server/, shared/, assets/ oder docs/ beginnen.');
    } else if (rule.startsWith('ref')) {
      const optional = rule.startsWith('ref?');
      const target = rule.split(':')[1];
      v = String(v ?? '').trim();
      if (!v && optional) { out[k] = ''; continue; }
      if (!(await getDoc(db, target, v))) throw new Error(`${k}: "${v}" existiert nicht in ${target}. Nutze die id aus list_items.`);
    }
    out[k] = v;
  }
  return out;
}

const COLL_ENUM = ['project', 'phases', 'tasks', 'developers', 'areas', 'techdocs', 'files', 'activity'];

function makeTools(db, actor, changes) {
  const fail = (msg) => `Fehler: ${msg}`;
  const fmt = (coll, d) => {
    const copy = { ...d };
    if (copy.description && copy.description.length > 300) copy.description = copy.description.slice(0, 300) + ' …';
    if (coll === 'tasks') delete copy.created_at;
    return copy;
  };

  return [
    betaTool({
      name: 'list_items',
      description: 'Listet Einträge einer Sammlung der Plattform. Mit "search" werden nur Einträge geliefert, deren Felder den Suchtext enthalten (z. B. Titel, Aufgaben-Schlüssel wie ECL-009, Name). Nutze das, um ids zu finden, bevor du etwas änderst. activity liefert die neuesten Einträge zuerst.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: COLL_ENUM },
          search: { type: 'string', description: 'Optionaler Suchtext, Groß-/Kleinschreibung egal.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Höchstens so viele Einträge (Standard 50).' },
        },
        required: ['collection'],
        additionalProperties: false,
      },
      run: async ({ collection, search, limit }) => {
        if (!COLL_ENUM.includes(collection)) return fail('Unbekannte Sammlung.');
        let docs = await listDocs(db, collection);
        if (collection === 'activity') docs.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
        else docs.sort((a, b) => String(a.key || a.order || a.number || a.id).localeCompare(String(b.key || b.order || b.number || b.id), 'de', { numeric: true }));
        if (search) { const q = search.toLowerCase(); docs = docs.filter((d) => JSON.stringify(d).toLowerCase().includes(q)); }
        const total = docs.length;
        docs = docs.slice(0, limit || 50).map((d) => fmt(collection, d));
        return JSON.stringify({ total, shown: docs.length, items: docs });
      },
    }),
    betaTool({
      name: 'get_item',
      description: 'Liest einen einzelnen Eintrag vollständig.',
      inputSchema: {
        type: 'object',
        properties: { collection: { type: 'string', enum: COLL_ENUM }, id: { type: 'string' } },
        required: ['collection', 'id'],
        additionalProperties: false,
      },
      run: async ({ collection, id }) => {
        const d = await getDoc(db, collection, id);
        return d ? JSON.stringify({ id, ...d }) : fail(`${LABEL[collection] || collection} "${id}" nicht gefunden.`);
      },
    }),
    betaTool({
      name: 'update_item',
      description: 'Ändert Felder eines bestehenden Eintrags. Nur die angegebenen Felder werden geändert. Aufgaben: status auf "Erledigt" setzt progress automatisch auf 100. Referenzen (phase, area, assignee, current_phase) brauchen die id, nicht den Namen. Für project ist die id "eclipse".',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: WRITABLE },
          id: { type: 'string' },
          changes: { type: 'object', description: 'Feldname → neuer Wert.' },
        },
        required: ['collection', 'id', 'changes'],
        additionalProperties: false,
      },
      run: async ({ collection, id, changes: ch }) => {
        if (!WRITABLE.includes(collection)) return fail('Diese Sammlung kann nicht geändert werden.');
        const prev = await getDoc(db, collection, id);
        if (!prev) return fail(`${LABEL[collection]} "${id}" nicht gefunden.`);
        let data;
        try { data = await clean(db, collection, ch); } catch (e) { return fail(e.message); }
        if (!Object.keys(data).length) return fail('Keine Änderungen angegeben.');
        if (Object.keys(data).every((k) => JSON.stringify(prev[k]) === JSON.stringify(data[k]))) {
          return JSON.stringify({ ok: true, id, changed: [], note: 'Alle Werte waren bereits so gesetzt; nichts geändert.' });
        }
        if (collection === 'tasks') {
          if (data.status === 'Erledigt') data.progress = 100;
          else if (data.status && prev.status === 'Erledigt' && data.progress === undefined && Number(prev.progress) >= 100) data.progress = 90;
          data.updated_at = new Date().toISOString();
        }
        const next = await patchDoc(db, collection, id, data);
        // Lesbare Werte fürs Aktivitätslog: Referenzen als Namen statt ids.
        const show = async (k, v) => {
          if (Array.isArray(v)) return v.join(', ') || '–';
          const rule = SCHEMA[collection][k];
          if (typeof rule === 'string' && rule.startsWith('ref') && v) {
            const ref = await getDoc(db, rule.split(':')[1], v);
            if (ref) return ref.name || ref.title || v;
          }
          return v === undefined || v === null || v === '' ? '–' : String(v);
        };
        const diff = [];
        for (const k of Object.keys(data)) {
          if (k === 'updated_at' || JSON.stringify(prev[k]) === JSON.stringify(next[k])) continue;
          diff.push(`${FIELD[k] || k}: ${await show(k, prev[k])} → ${await show(k, next[k])}`);
        }
        if (!diff.length) return JSON.stringify({ ok: true, id, changed: [] });
        const action = collection === 'tasks' && data.status === 'Erledigt' && prev.status !== 'Erledigt' ? 'als erledigt markiert' : 'bearbeitet';
        await logActivity(db, { actor, action, type: LABEL[collection], title: titleOf(collection, next), detail: diff.slice(0, 3).join(' · ') });
        if (collection === 'tasks') await syncDerived(db, [prev.phase, next.phase], [prev.area, next.area]);
        if (collection === 'project' && data.current_phase) {
          // Die gewählte Phase wird aktiv, andere aktive Phasen werden passend umgestellt.
          const phases = await listDocs(db, 'phases');
          const target = phases.find((p) => p.id === data.current_phase);
          for (const p of phases) {
            const want = p.id === data.current_phase ? 'Aktiv' : p.status === 'Aktiv' ? (Number(p.number) < Number(target.number) ? 'Abgeschlossen' : 'Ausstehend') : p.status;
            if (want !== p.status) await patchDoc(db, 'phases', p.id, { status: want });
          }
        }
        changes.push({ collection, id, action, title: titleOf(collection, next), detail: diff.join(' · ') });
        return JSON.stringify({ ok: true, id, changed: diff });
      },
    }),
    betaTool({
      name: 'create_item',
      description: `Legt einen neuen Eintrag an. Möglich für: ${CREATABLE.join(', ')}. Aufgaben brauchen title, phase (id) und area (id); Schlüssel (ECL-…), Zeitstempel und Ersteller werden automatisch gesetzt.`,
      inputSchema: {
        type: 'object',
        properties: { collection: { type: 'string', enum: CREATABLE }, data: { type: 'object', description: 'Feldname → Wert.' } },
        required: ['collection', 'data'],
        additionalProperties: false,
      },
      run: async ({ collection, data: raw }) => {
        if (!CREATABLE.includes(collection)) return fail('In dieser Sammlung kann nichts angelegt werden.');
        let data;
        try { data = await clean(db, collection, raw); } catch (e) { return fail(e.message); }
        const missing = (REQUIRED[collection] || []).filter((k) => data[k] === undefined || data[k] === '');
        if (missing.length) return fail(`Pflichtfelder fehlen: ${missing.join(', ')}.`);
        const now = new Date().toISOString();
        const rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        let id;
        if (collection === 'tasks') {
          const all = await listDocs(db, 'tasks');
          const n = all.reduce((m, t) => Math.max(m, parseInt(String(t.key || '').replace(/\D/g, ''), 10) || 0), 0) + 1;
          id = 't-' + rid;
          data = {
            description: '', assignee: '', status: 'Backlog', priority: 'Mittel', progress: 0, estimate_hours: 4, due_date: '', tags: [],
            ...data, key: 'ECL-' + String(n).padStart(3, '0'), created_by_name: actor, created_at: now, updated_at: now,
          };
          if (data.status === 'Erledigt') data.progress = 100;
        } else if (collection === 'phases') {
          const all = await listDocs(db, 'phases');
          if (all.some((p) => Number(p.number) === data.number)) return fail(`Phase ${data.number} gibt es schon.`);
          id = 'phase-' + rid;
          data = { description: '', status: 'Ausstehend', color: '#A78BFA', ...data, order: data.number, progress: 0 };
        } else if (collection === 'techdocs') {
          id = 'doc-' + rid;
          data = { category: 'Leitfaden', status: 'Entwurf', description: '', link: '', notes: '', ...data };
        } else {
          id = 'f-' + rid;
          data = { type: 'Sonstiges', category: 'Client', description: '', ...data, updated_by: actor, updated_at: now };
        }
        await putDoc(db, collection, id, data);
        await logActivity(db, { actor, action: 'erstellt', type: LABEL[collection], title: titleOf(collection, data) });
        if (collection === 'tasks') await syncDerived(db, [data.phase], [data.area]);
        changes.push({ collection, id, action: 'erstellt', title: titleOf(collection, data) });
        return JSON.stringify({ ok: true, id, key: data.key });
      },
    }),
    betaTool({
      name: 'delete_item',
      description: `Löscht einen Eintrag endgültig (möglich für: ${DELETABLE.join(', ')}). Nur aufrufen, nachdem der Admin das Löschen dieses konkreten Eintrags im Chat ausdrücklich bestätigt hat; dann confirmed=true setzen.`,
      inputSchema: {
        type: 'object',
        properties: { collection: { type: 'string', enum: DELETABLE }, id: { type: 'string' }, confirmed: { type: 'boolean' } },
        required: ['collection', 'id', 'confirmed'],
        additionalProperties: false,
      },
      run: async ({ collection, id, confirmed }) => {
        if (!confirmed) return fail('Nicht gelöscht: Frag den Admin zuerst nach einer ausdrücklichen Bestätigung.');
        if (!DELETABLE.includes(collection)) return fail('Diese Sammlung kann nicht gelöscht werden.');
        const prev = await getDoc(db, collection, id);
        if (!prev) return fail(`${LABEL[collection]} "${id}" nicht gefunden.`);
        if (collection === 'phases') {
          const n = (await listDocs(db, 'tasks')).filter((t) => t.phase === id).length;
          if (n) return fail(`Die Phase enthält noch ${n} Aufgaben. Verschiebe oder lösche sie zuerst.`);
          const proj = await getDoc(db, 'project', 'eclipse');
          if (proj && proj.current_phase === id) return fail('Die aktuelle Phase kann nicht gelöscht werden.');
        }
        await deleteDoc(db, collection, id);
        await logActivity(db, { actor, action: 'gelöscht', type: LABEL[collection], title: titleOf(collection, prev) });
        if (collection === 'tasks') await syncDerived(db, [prev.phase], [prev.area]);
        changes.push({ collection, id, action: 'gelöscht', title: titleOf(collection, prev) });
        return JSON.stringify({ ok: true });
      },
    }),
  ];
}

const SYSTEM = `Du bist der KI-Assistent der „ECLIPSE – Dev Platform“, dem Projekt-Dashboard für ein browserbasiertes 3D-Open-World-Multiplayer-Spiel, an dem zwei Entwickler arbeiten. Du sprichst mit dem Admin und führst seine Anweisungen direkt mit deinen Werkzeugen aus.

Datenmodell (Sammlungen):
- project (id "eclipse"): name, codename, description, status (${PROJECT_STATUS.join('/')}), current_phase (Phasen-id), start_date, target_date, version, genre, engine_notes
- phases: number, name, description, status (${PHASE_STATUS.join('/')}), color, progress (wird automatisch berechnet)
- tasks: key (z. B. ECL-009, automatisch), title, description, phase (id), area (id), assignee (Entwickler-id oder leer), status (${STATUS.join('/')}), priority (${PRIO.join('/')}), progress (0–100), estimate_hours, due_date (JJJJ-MM-TT), tags
- developers: name, role, avatar_initials, color, focus_area, online_status (${ONLINE.join('/')})
- areas (12 Spielbereiche): name, slug, icon, description, progress (automatisch)
- techdocs: title, category (${DOC_CATS.join('/')}), tech (${TECHS.join('/')}), description, status (${DOC_STATUS.join('/')}), link, notes
- files: name, type, path (Ordner wie client/src/), category (${FILE_CATS.join('/')}), description
- activity: Protokoll aller Änderungen (nur lesen)

Arbeitsweise:
- Wenn der Admin etwas über Namen, Titel oder Schlüssel nennt, suche zuerst mit list_items die passende id. Erfinde niemals ids.
- Ist ein Name mehrdeutig oder gibt es keinen Treffer, frag kurz nach, statt zu raten.
- Fortschritt von Phasen, Bereichen und Projekt wird aus den Aufgaben berechnet; ändere ihn über die Aufgaben, nicht direkt.
- Löschen nur nach ausdrücklicher Bestätigung im Chat: frag erst „Soll ich … wirklich löschen?“ und lösche erst, wenn der Admin zustimmt.
- Gibt es etwas, das die Plattform nicht abbilden kann (z. B. Spieler-Konten oder Geldbeträge), sag das klar und schlag vor, was stattdessen geht.
- Antworte auf Deutsch, kurz und konkret. Nenne nach Änderungen in einem Satz oder einer kurzen Liste, was du geändert hast (mit Aufgaben-Schlüssel, wenn vorhanden). Kein Markdown außer einfachen Listen mit „- “.`;

/**
 * Verarbeitet eine Chat-Nachricht des Admins.
 * body: { messages: [{role:'user'|'assistant', content:string}], actor?: string }
 */
export async function runChat(env, db, body) {
  const history = Array.isArray(body && body.messages) ? body.messages : [];
  const messages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return { status: 400, body: { error: 'Die letzte Nachricht muss vom Admin kommen.' } };
  }
  const actor = (String((body && body.actor) || 'Admin').slice(0, 40) || 'Admin') + ' (KI-Assistent)';
  const changes = [];
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });

  try {
    const final = await client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      // Lehnt das Modell aus Sicherheitsgründen ab, übernimmt automatisch ein Ersatzmodell.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: `${SYSTEM}\n\nHeute ist ${today}.`,
      tools: makeTools(db, actor, changes),
      messages,
      max_iterations: 15,
    });
    let reply = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (final.stop_reason === 'refusal') reply = reply || 'Diese Anfrage kann ich nicht ausführen.';
    else if (final.stop_reason === 'tool_use') reply = (reply ? reply + '\n\n' : '') + 'Ich habe nach vielen Schritten abgebrochen. Bitte teile die Aufgabe in kleinere Anweisungen auf.';
    else if (final.stop_reason === 'max_tokens') reply = (reply ? reply + '\n\n' : '') + '(Antwort gekürzt)';
    if (!reply) reply = changes.length ? 'Erledigt.' : 'Ich habe keine Antwort erhalten. Versuch es bitte noch einmal.';
    return { status: 200, body: { reply, changes } };
  } catch (e) {
    let msg = 'Die KI ist gerade nicht erreichbar. Versuch es gleich noch einmal.';
    let status = 502;
    if (e instanceof Anthropic.AuthenticationError) { msg = 'Der Anthropic-API-Schlüssel ist ungültig. Prüfe das Secret ANTHROPIC_API_KEY.'; status = 503; }
    else if (e instanceof Anthropic.PermissionDeniedError) { msg = 'Der Anthropic-API-Schlüssel hat keine Berechtigung (Guthaben/Abrechnung in der Anthropic Console prüfen).'; status = 503; }
    else if (e instanceof Anthropic.RateLimitError) { msg = 'Zu viele Anfragen an die KI. Warte kurz und versuch es erneut.'; status = 429; }
    else if (e instanceof Anthropic.BadRequestError) { msg = 'Die Anfrage an die KI war ungültig: ' + String(e.message || '').slice(0, 200); status = 400; }
    else if (e instanceof Anthropic.APIError) { msg = `Fehler der KI-Schnittstelle (${e.status ?? '–'}). Versuch es gleich noch einmal.`; }
    // Bereits ausgeführte Änderungen trotzdem melden, damit die Oberfläche aktualisiert.
    return { status, body: { error: msg, changes } };
  }
}
