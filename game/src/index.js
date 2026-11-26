// Nova Strike – Cloudflare Worker: Accounts (D1), Ranglisten und WebSocket-Zugang zu den Spielräumen.
// Statische Dateien (public/) liefert Cloudflare direkt aus; dieser Worker beantwortet /api/*.
export { GameRoom } from './room.js';

const ROOMS = ['arena-1', 'arena-2', 'arena-3'];
const ROOM_RE = /^[a-z0-9-]{1,24}$/;
const NAME_RE = /^[A-Za-z0-9_-]{3,16}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/;
const SESSION_DAYS = 30;
const COOKIE = 'eg_sid';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#a78bfa',
    created_at INTEGER NOT NULL,
    last_seen INTEGER,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    headshots INTEGER NOT NULL DEFAULT 0,
    shots INTEGER NOT NULL DEFAULT 0,
    hits INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    matches INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC)',
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
  `CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    ended_at INTEGER NOT NULL,
    winner_id INTEGER,
    winner_name TEXT,
    players INTEGER NOT NULL,
    top TEXT NOT NULL
  )`,
];

let schemaReady = null;
export function ensureSchema(db) {
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

export const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 250)) + 1;

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 100000 }, key, 256);
  return hex(bits);
}
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Schutz gegen Passwort-Raten: höchstens 8 Fehlversuche pro Minute und IP (pro Worker-Instanz).
const failed = new Map();
function locked(ip) {
  const now = Date.now();
  const list = (failed.get(ip) || []).filter((t) => now - t < 60000);
  failed.set(ip, list);
  if (failed.size > 5000) failed.clear();
  return list.length >= 8;
}
const noteFail = (ip) => failed.set(ip, [...(failed.get(ip) || []), Date.now()]);

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

async function createSession(db, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), userId, now, now + SESSION_DAYS * 86400000),
  ]);
  return token;
}

async function currentUser(request, db) {
  const token = getCookie(request, COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ).bind(await sha256(token), Date.now()).first();
  return row || null;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, color: u.color, createdAt: u.created_at, level: levelOf(u.xp),
    stats: { kills: u.kills, deaths: u.deaths, headshots: u.headshots, shots: u.shots, hits: u.hits, wins: u.wins, matches: u.matches, xp: u.xp },
  };
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 4096) return null;
  try { const d = JSON.parse(text); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch { return null; }
}

async function handleApi(request, env, url) {
  const db = env.DB;
  if (!db) return json({ error: 'Keine Datenbank gebunden' }, 500);
  await ensureSchema(db);
  const path = url.pathname;
  const ip = request.headers.get('cf-connecting-ip') || 'local';

  if (path === '/api/register' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body) return json({ error: 'Ungültige Anfrage' }, 400);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!NAME_RE.test(username)) return json({ error: 'Name: 3–16 Zeichen, nur Buchstaben, Zahlen, _ und -' }, 400);
    if (password.length < 6 || password.length > 128) return json({ error: 'Passwort: mindestens 6 Zeichen' }, 400);
    if (locked(ip)) return json({ error: 'Zu viele Versuche. Warte eine Minute.' }, 429);
    const exists = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (exists) { noteFail(ip); return json({ error: 'Dieser Name ist schon vergeben' }, 409); }
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const colors = ['#a78bfa', '#f472b6', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#a3e635'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    let res;
    try {
      res = await db.prepare('INSERT INTO users (username, pass_hash, salt, color, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(username, await hashPassword(password, salt), salt, color, Date.now(), Date.now()).run();
    } catch {
      return json({ error: 'Dieser Name ist schon vergeben' }, 409);
    }
    const id = res.meta.last_row_id;
    const token = await createSession(db, id);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    return json({ user: publicUser(user) }, 201, { 'set-cookie': sessionCookie(token, request) });
  }

  if (path === '/api/login' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body) return json({ error: 'Ungültige Anfrage' }, 400);
    if (locked(ip)) return json({ error: 'Zu viele Fehlversuche. Warte eine Minute.' }, 429);
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(String(body.username || '').trim()).first();
    const ok = user && safeEqual(await hashPassword(String(body.password || ''), user.salt), user.pass_hash);
    if (!ok) { noteFail(ip); return json({ error: 'Name oder Passwort falsch' }, 401); }
    const token = await createSession(db, user.id);
    await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), user.id).run();
    return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(token, request) });
  }

  if (path === '/api/logout' && request.method === 'POST') {
    const token = getCookie(request, COOKIE);
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', request) });
  }

  if (path === '/api/leaderboard' && request.method === 'GET') {
    const { results } = await db.prepare(
      'SELECT username, color, kills, deaths, headshots, wins, matches, xp FROM users ORDER BY xp DESC, kills DESC LIMIT 25',
    ).all();
    const recent = await db.prepare('SELECT room, ended_at, winner_name, players, top FROM matches ORDER BY id DESC LIMIT 8').all();
    return json({
      players: results.map((r) => ({ ...r, level: levelOf(r.xp) })),
      matches: recent.results.map((m) => ({ ...m, top: JSON.parse(m.top) })),
    });
  }

  if (path === '/api/rooms' && request.method === 'GET') {
    const rooms = await Promise.all(ROOMS.map(async (name) => {
      try {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(name));
        const r = await stub.fetch('https://room/info');
        return { name, ...(await r.json()) };
      } catch {
        return { name, humans: 0, bots: 0, state: 'idle' };
      }
    }));
    return json({ rooms });
  }

  // Ab hier nur mit Anmeldung
  const user = await currentUser(request, db);
  if (!user) return json({ error: 'Nicht angemeldet' }, 401);

  if (path === '/api/me' && request.method === 'GET') return json({ user: publicUser(user) });

  if (path === '/api/me' && request.method === 'POST') {
    const body = await readJson(request);
    const color = String((body && body.color) || '').toLowerCase();
    if (!COLOR_RE.test(color)) return json({ error: 'Ungültige Farbe' }, 400);
    await db.prepare('UPDATE users SET color = ? WHERE id = ?').bind(color, user.id).run();
    return json({ user: publicUser({ ...user, color }) });
  }

  if (path === '/api/ws') {
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return json({ error: 'WebSocket erwartet' }, 426);
    const room = String(url.searchParams.get('room') || 'arena-1').toLowerCase();
    if (!ROOM_RE.test(room)) return json({ error: 'Ungültiger Raumname' }, 400);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
    const headers = new Headers(request.headers);
    headers.set('x-user-id', String(user.id));
    headers.set('x-user-name', user.username);
    headers.set('x-user-color', user.color);
    headers.set('x-user-level', String(levelOf(user.xp)));
    headers.set('x-room', room);
    await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), user.id).run();
    return stub.fetch(new Request('https://room/ws', { headers }));
  }

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
