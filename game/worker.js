// ECLIPSE – Spiel-Worker: liefert die Spielseite aus und leitet WebSocket-Verbindungen an den gemeinsamen Spielraum.
import { getDoc } from '../worker/store.js';
export { Room } from './server/room.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const room = env.ROOM.get(env.ROOM.idFromName('welt'));
      return room.fetch(request);
    }
    // Öffentliche Einstellungen für den Startbildschirm (ohne Admin-Code)
    if (url.pathname === '/api/public') {
      let colors = [];
      try {
        const s = await getDoc(env.DB, 'game_settings', 'main');
        colors = String((s && s.player_colors) || '').split(',').map((c) => c.trim()).filter((c) => COLOR_RE.test(c)).slice(0, 12);
      } catch { /* Datenbank noch leer */ }
      return new Response(JSON.stringify({ colors }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  },
};
