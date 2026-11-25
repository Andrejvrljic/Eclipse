// ECLIPSE – Spielserver: liefert die Spielseite aus und verbindet alle Spieler über einen Durable Object „Raum“.

const MAX_PLAYERS = 32;
const COLORS = /^#[0-9a-fA-F]{6}$/;

export class Room {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map(); // WebSocket -> Spieler
  }

  broadcast(msg, except) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const [ws, p] of this.sessions) {
      if (ws === except || !p.ready) continue;
      try { ws.send(data); } catch { this.drop(ws); }
    }
  }

  drop(ws) {
    const p = this.sessions.get(ws);
    if (!p) return;
    this.sessions.delete(ws);
    if (p.ready) this.broadcast({ t: 'leave', id: p.id });
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });
    if (this.sessions.size >= MAX_PLAYERS) return new Response('Server voll', { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const player = { id: crypto.randomUUID().slice(0, 8), name: 'Spieler', color: '#A78BFA', s: null, ready: false, win: 0, count: 0 };
    this.sessions.set(server, player);

    server.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 600) return;
      // Einfaches Mengenlimit: höchstens 40 Nachrichten pro Sekunde
      const now = Date.now();
      if (now - player.win > 1000) { player.win = now; player.count = 0; }
      if (++player.count > 40) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'hello' && !player.ready) {
        player.name = String(m.name || 'Spieler').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20) || 'Spieler';
        player.color = COLORS.test(m.color) ? m.color : '#A78BFA';
        player.ready = true;
        const others = [...this.sessions.values()].filter((p) => p !== player && p.ready).map(({ id, name, color, s }) => ({ id, name, color, s }));
        server.send(JSON.stringify({ t: 'welcome', id: player.id, players: others }));
        this.broadcast({ t: 'join', id: player.id, name: player.name, color: player.color }, server);
      } else if (m.t === 's' && player.ready) {
        const s = {
          p: Array.isArray(m.p) ? m.p.slice(0, 3).map((n) => Math.round(Number(n) * 100) / 100) : null,
          r: Math.round((Number(m.r) || 0) * 1000) / 1000,
          v: m.v ? 1 : 0,
          q: Array.isArray(m.q) ? m.q.slice(0, 4).map((n) => Math.round(Number(n) * 1000) / 1000) : undefined,
          sp: Math.round((Number(m.sp) || 0) * 10) / 10,
        };
        if (!s.p || !s.p.every(Number.isFinite)) return;
        player.s = s;
        this.broadcast({ t: 's', id: player.id, ...s }, server);
      }
    });
    server.addEventListener('close', () => this.drop(server));
    server.addEventListener('error', () => this.drop(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const room = env.ROOM.get(env.ROOM.idFromName('welt'));
      return room.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
