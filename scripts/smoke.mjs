// Live-Test gegen die veröffentlichten Seiten: zwei unabhängige Spieler verbinden sich mit dem echten Spielserver.
// Aufruf: node scripts/smoke.mjs https://spiel.example.workers.dev https://eclipse.example.workers.dev
const GAME = (process.argv[2] || process.env.GAME_URL || '').replace(/\/$/, '');
const DASH = (process.argv[3] || process.env.DASH_URL || '').replace(/\/$/, '');
if (!GAME) { console.error('Spiel-Adresse fehlt'); process.exit(2); }

const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? 'OK  ' : 'FEHLER'}  ${name}${info ? ' – ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(url, name) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'eclipse-smoke-test' } });
    const body = await r.arrayBuffer();
    ok(name, r.ok, `${r.status}, ${Math.round(body.byteLength / 1024)} KB, ${Date.now() - t0} ms`);
    return r.ok;
  } catch (e) { ok(name, false, String(e.message || e)); return false; }
}

function client(label) {
  const wsUrl = GAME.replace(/^http/, 'ws') + '/ws';
  const ws = new WebSocket(wsUrl);
  const c = { label, ws, msgs: [], open: false, closed: null, waiters: [] };
  ws.addEventListener('open', () => { c.open = true; });
  ws.addEventListener('close', (e) => { c.closed = { code: e.code, reason: e.reason }; });
  ws.addEventListener('error', () => {});
  ws.addEventListener('message', (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    c.msgs.push(m);
    for (const w of [...c.waiters]) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.res(m); }
  });
  c.wait = (pred, ms = 15000) => new Promise((res) => {
    const found = c.msgs.find(pred); if (found) return res(found);
    const w = { pred, res }; c.waiters.push(w);
    setTimeout(() => { const i = c.waiters.indexOf(w); if (i >= 0) { c.waiters.splice(i, 1); res(null); } }, ms);
  });
  c.send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  return c;
}

async function main() {
  console.log(`Spiel: ${GAME}\nDashboard: ${DASH || '–'}\n`);
  await page(GAME + '/', 'Spielseite lädt');
  await page(GAME + '/game.js', 'Spiel-Code lädt');
  if (DASH) {
    await page(DASH + '/', 'Dashboard lädt');
    try {
      const r = await fetch(DASH + '/api/docs?since=' + (Date.now() + 1e9));
      const j = await r.json();
      ok('Dashboard-Datenbank antwortet', r.ok && Array.isArray(j.docs), `${r.status}`);
    } catch (e) { ok('Dashboard-Datenbank antwortet', false, String(e.message || e)); }
  }

  const rnd = () => Math.random().toString(36).slice(2, 10);
  const A = client('A'), B = client('B');
  const t0 = Date.now();
  for (let i = 0; i < 100 && !(A.open && B.open); i++) await sleep(100);
  ok('WebSocket-Verbindung A', A.open, A.closed ? `geschlossen ${A.closed.code} ${A.closed.reason}` : `${Date.now() - t0} ms`);
  ok('WebSocket-Verbindung B', B.open, B.closed ? `geschlossen ${B.closed.code} ${B.closed.reason}` : '');
  if (!A.open) return;

  A.send({ t: 'hello', pid: 'psmoke' + rnd() + 'a', name: 'Testlauf A', color: '#22C55E' });
  const wa = await A.wait((m) => m.t === 'welcome' || m.t === 'denied', 20000);
  ok('Spieler A tritt bei (welcome)', wa && wa.t === 'welcome', wa ? (wa.t === 'denied' ? wa.reason : `${(wa.vehicles || []).length} Fahrzeuge, ${(wa.buildings || []).length} Bauteile, ${Object.keys(wa.config?.species || {}).length} Kreaturenarten`) : 'keine Antwort in 20 s');
  if (!wa || wa.t !== 'welcome') return;

  B.send({ t: 'hello', pid: 'psmoke' + rnd() + 'b', name: 'Testlauf B', color: '#F59E0B' });
  const wb = await B.wait((m) => m.t === 'welcome' || m.t === 'denied', 20000);
  ok('Spieler B tritt bei (welcome)', wb && wb.t === 'welcome', wb && wb.t === 'denied' ? wb.reason : '');
  if (!wb || wb.t !== 'welcome') return;
  ok('B sieht A in der Spielerliste', (wb.players || []).some((p) => p.id === wa.id), `${(wb.players || []).length} andere Spieler`);
  const join = await A.wait((m) => m.t === 'join' && m.id === wb.id, 5000);
  ok('A bekommt „join“ von B mit Farbe', !!join && join.color === '#F59E0B', join ? join.color : 'keine Meldung');

  // Positionen austauschen
  const posA = [3, 9, 4];
  for (let i = 0; i < 5; i++) { A.send({ t: 's', p: posA, r: 0.5, v: 0, sp: 2, hp: 100 }); B.send({ t: 's', p: [6, 9, 6], r: 0, v: 0, sp: 0, hp: 100 }); await sleep(150); }
  const sAB = await B.wait((m) => m.t === 's' && m.id === wa.id, 5000);
  ok('B empfängt Position von A', !!sAB && JSON.stringify(sAB.p) === JSON.stringify(posA), sAB ? JSON.stringify(sAB.p) : 'nichts');
  const cr = await A.wait((m) => m.t === 'cr', 5000);
  ok('Kreaturen-Updates kommen an', !!cr, cr ? `${cr.c.length} Kreaturen in der Nähe` : 'nichts');
  ok('Gleiche Fahrzeugfarben für A und B', JSON.stringify((wa.vehicles || []).map((v) => [v.id, v.color]).sort()) === JSON.stringify((wb.vehicles || []).map((v) => [v.id, v.color]).sort()), `${(wa.vehicles || []).length} Fahrzeuge`);

  // Doppelte Sitzung: gleiche Spieler-ID nochmal
  const A2 = client('A2');
  for (let i = 0; i < 50 && !A2.open; i++) await sleep(100);
  A2.send({ t: 'hello', pid: (wa.pid), name: 'Testlauf A', color: '#22C55E' });
  const w2 = await A2.wait((m) => m.t === 'welcome', 15000);
  const kicked = await A.wait((m) => m.t === 'denied', 5000);
  ok('Doppelte Sitzung wird ersetzt (keine Geister-Spieler)', !!w2 && !!kicked, kicked ? kicked.reason : 'alte Sitzung blieb offen');
  const leave = await B.wait((m) => m.t === 'leave' && m.id === wa.id, 5000);
  ok('B bekommt „leave“ der alten Sitzung', !!leave);

  A2.ws.close(); B.ws.close(); try { A.ws.close(); } catch { /* egal */ }
  await sleep(500);
}

main().catch((e) => ok('Testlauf', false, String(e.stack || e))).finally(() => {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden.`);
  process.exit(failed.length ? 1 : 0);
});
