// Nova Strike – Menüs, Anmeldung und Verbindung zwischen Oberfläche und Spiel.
import { Game } from './game.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#a78bfa', '#f472b6', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#a3e635', '#f97316', '#e879f9', '#60a5fa', '#facc15'];
const ROOM_LABELS = { 'arena-1': 'Krater Alpha', 'arena-2': 'Krater Beta', 'arena-3': 'Krater Gamma' };

let me = null;
let authMode = 'login';
let roomTimer = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || `Fehler ${res.status}`), { status: res.status });
  return data;
}

function show(id) {
  for (const s of ['screen-auth', 'screen-menu', 'screen-pause', 'loading']) $(s).hidden = s !== id;
}

function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

const sfx = new Sfx();
const game = new Game($('view'), sfx, {
  onPause() { syncSettingsUi(); show('screen-pause'); },
  onJoined() { show(null); },
  onLeave(reason) {
    openMenu();
    if (reason) toast(reason);
  },
});
sfx.setVolume(game.settings.vol);
window.__game = game; // für Tests in der Konsole

// ---------------- Anmeldung ----------------
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('#auth-form .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  document.querySelector('.reg-only').hidden = mode !== 'register';
  $('auth-submit').textContent = mode === 'login' ? 'Anmelden' : 'Account erstellen';
  document.querySelector('#auth-form [name=password]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('auth-err').textContent = '';
}
document.querySelectorAll('#auth-form .tabs button').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  sfx.init();
  const f = new FormData(e.target);
  const username = String(f.get('username') || '').trim();
  const password = String(f.get('password') || '');
  if (authMode === 'register' && password !== f.get('password2')) { $('auth-err').textContent = 'Die Passwörter stimmen nicht überein.'; return; }
  $('auth-submit').disabled = true;
  try {
    const { user } = await api(authMode === 'login' ? '/api/login' : '/api/register', { method: 'POST', body: { username, password } });
    me = user;
    e.target.reset();
    openMenu();
    if (authMode === 'register') toast(`Willkommen, ${user.username}! Dein Account ist angelegt.`);
  } catch (err) {
    $('auth-err').textContent = err.message;
  } finally {
    $('auth-submit').disabled = false;
  }
});

// ---------------- Menü ----------------
document.querySelectorAll('.menu-tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

function openTab(tab) {
  document.querySelectorAll('.menu-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.menu-body .tab').forEach((t) => { t.hidden = t.dataset.tab !== tab; });
  if (tab === 'ranks') loadRanks();
  if (tab === 'profile') loadProfile();
}

async function openMenu() {
  show('screen-menu');
  try { me = (await api('/api/me')).user; } catch (e) { if (e.status === 401) { me = null; show('screen-auth'); return; } }
  renderWho();
  loadRooms();
  clearInterval(roomTimer);
  roomTimer = setInterval(() => { if (!$('screen-menu').hidden) loadRooms(); }, 5000);
  const tab = document.querySelector('.menu-tabs button.on');
  if (tab && tab.dataset.tab === 'profile') loadProfile();
}

function renderWho() {
  if (!me) return;
  $('who-name').textContent = me.username;
  $('who-level').textContent = 'LVL ' + me.level;
  $('who-swatch').style.color = me.color;
  $('who-swatch').style.background = me.color;
  game.myColor = me.color;
}

async function loadRooms() {
  let rooms = [];
  try { rooms = (await api('/api/rooms')).rooms; } catch { rooms = Object.keys(ROOM_LABELS).map((name) => ({ name, humans: 0, bots: 0 })); }
  $('rooms').innerHTML = rooms.map((r) => `<button class="room" data-room="${esc(r.name)}">
      <span class="count">${r.humans}/12</span>
      <h4>${esc(ROOM_LABELS[r.name] || r.name)}</h4>
      <div class="meta">Jeder gegen jeden · ${r.humans ? `${r.humans} Spieler online` : 'leer – Bots warten'}</div>
      <div class="go">BEITRETEN →</div>
    </button>`).join('');
  document.querySelectorAll('.room').forEach((b) => b.addEventListener('click', () => joinRoom(b.dataset.room)));
}

$('custom-room').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('room-code').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24);
  if (code) joinRoom('p-' + code);
});

function joinRoom(room) {
  sfx.init();
  game.lock();
  show('loading');
  game.join(room);
}

async function loadRanks() {
  try {
    const { players, matches } = await api('/api/leaderboard');
    $('lb-body').innerHTML = players.map((p, i) => `<tr class="${me && p.username === me.username ? 'me' : ''}"><td>${i + 1}</td>
      <td><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.username)}</td><td>${p.level}</td><td>${p.xp}</td>
      <td>${p.kills}</td><td>${(p.kills / Math.max(1, p.deaths)).toFixed(2)}</td><td>${p.wins}</td></tr>`).join('')
      || '<tr><td colspan="7">Noch keine Spieler.</td></tr>';
    $('lb-matches').innerHTML = matches.map((m) => `<div class="match"><div><b>${esc(m.winner_name || 'Kein Sieger')}</b>
      <span>· ${m.top.map((t) => `${esc(t.name)} ${t.k}/${t.d}`).join(', ')}</span></div>
      <span>${esc(ROOM_LABELS[m.room] || m.room)} · ${new Date(m.ended_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</span></div>`).join('')
      || '<p class="fine">Noch keine Matches gespielt.</p>';
  } catch (e) { toast(e.message); }
}

function loadProfile() {
  if (!me) return;
  const s = me.stats;
  const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
  const items = [
    ['Level', me.level], ['XP', s.xp], ['Kills', s.kills], ['Tode', s.deaths], ['K/D', (s.kills / Math.max(1, s.deaths)).toFixed(2)],
    ['Kopfschüsse', s.headshots], ['Trefferquote', acc + ' %'], ['Siege', s.wins], ['Matches', s.matches],
  ];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><small>${esc(k)}</small></div>`).join('');
  const lv = me.level;
  const cur = (lv - 1) ** 2 * 250, next = lv ** 2 * 250;
  $('xp-fill').style.width = `${Math.min(100, ((s.xp - cur) / (next - cur)) * 100)}%`;
  $('xp-text').textContent = `${s.xp - cur} / ${next - cur} XP bis Level ${lv + 1}`;
  $('colors').innerHTML = COLORS.map((c) => `<button data-c="${c}" class="${c === me.color ? 'on' : ''}" style="background:${c};color:${c}" aria-label="Farbe ${c}"></button>`).join('');
  document.querySelectorAll('#colors button').forEach((b) => b.addEventListener('click', async () => {
    try { me = (await api('/api/me', { method: 'POST', body: { color: b.dataset.c } })).user; renderWho(); loadProfile(); } catch (e) { toast(e.message); }
  }));
}

$('btn-logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  me = null;
  clearInterval(roomTimer);
  show('screen-auth');
});

// ---------------- Pause & Einstellungen ----------------
function syncSettingsUi() {
  const s = game.settings;
  $('s-sens').value = s.sens; $('o-sens').textContent = Number(s.sens).toFixed(2);
  $('s-fov').value = s.fov; $('o-fov').textContent = s.fov + '°';
  $('s-vol').value = s.vol; $('o-vol').textContent = Math.round(s.vol * 100) + ' %';
  $('s-invert').checked = !!s.invert;
  const al = game.assistLevel();
  $('s-assist').value = al; $('o-assist').textContent = ['Aus', 'Schwach', 'Mittel', 'Stark'][al];
}
for (const [id, key, parse] of [['s-sens', 'sens', Number], ['s-fov', 'fov', Number], ['s-vol', 'vol', Number], ['s-assist', 'assist', Number]]) {
  $(id).addEventListener('input', () => { game.applySettings({ [key]: parse($(id).value) }); syncSettingsUi(); });
}
$('s-invert').addEventListener('change', () => game.applySettings({ invert: $('s-invert').checked }));
$('btn-resume').addEventListener('click', () => { sfx.init(); show(null); game.lock(); });
$('btn-leave').addEventListener('click', () => { game.leave(); });
$('view').addEventListener('click', () => { if (game.mode === 'game' && !game.locked && $('screen-pause').hidden) game.lock(); });

// ---------------- Start ----------------
if (matchMedia('(pointer: coarse)').matches) $('touch-note').hidden = false;
(async () => {
  try {
    me = (await api('/api/me')).user;
    openMenu();
  } catch {
    show('screen-auth');
  }
})();
