// ECLIPSE – Spiel-Worker: liefert die Spielseite aus und leitet WebSocket-Verbindungen an den gemeinsamen Spielraum.
export { Room } from './server/room.js';

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
