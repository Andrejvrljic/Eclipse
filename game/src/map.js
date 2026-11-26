// Karte: kleine Karte oben rechts (Norden oben) und große Inselkarte mit M.
// Zeigt dich, andere Spieler, freie Fahrzeuge, den Event-Schatz, Parcours und Rennstrecke.
// Versteckte Truhen werden absichtlich nicht angezeigt.
import { SIZE, SEA_LEVEL } from './terrain.js';

const RES = 256;

export function createMap(world, { mini, big, bigWrap }) {
  // Gelände einmal als Bild berechnen
  const base = document.createElement('canvas'); base.width = base.height = RES;
  const bx = base.getContext('2d'); const img = bx.createImageData(RES, RES);
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const x = -SIZE / 2 + (i + 0.5) * (SIZE / RES), z = -SIZE / 2 + (j + 0.5) * (SIZE / RES);
    const h = world.heightAt(x, z), s = world.slopeAt(x, z);
    let c;
    if (h < SEA_LEVEL) { const d = Math.min(1, -h / 12); c = [30 - d * 14, 44 - d * 18, 92 - d * 30]; }
    else if (h < 1.6) c = [196, 176, 128];
    else if (h > 36) c = [228, 226, 236];
    else if (s > 0.8 || h > 30) c = [112, 106, 120];
    else { const k = Math.min(1, h / 30); c = [64 + k * 30, 112 - k * 20, 58 + k * 10]; }
    const o = (j * RES + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  bx.putImageData(img, 0, 0);

  const toPx = (x, z, cx, cz, scale, w, h) => [w / 2 + (x - cx) * scale, h / 2 + (z - cz) * scale];

  function draw(ctx, w, h, cx, cz, scale, data, labels) {
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    const k = RES / SIZE;
    // Ausschnitt der Grundkarte
    const sw = w / scale * k, sh = h / scale * k;
    ctx.drawImage(base, (cx + SIZE / 2) * k - sw / 2, (cz + SIZE / 2) * k - sh / 2, sw, sh, 0, 0, w, h);
    const dot = (x, z, r, fill, stroke = 'rgba(0,0,0,.6)') => {
      const [px, py] = toPx(x, z, cx, cz, scale, w, h); if (px < -10 || py < -10 || px > w + 10 || py > h + 10) return null;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke();
      return [px, py];
    };
    const label = (p, text, color = '#fff') => { if (!p || !labels) return; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.65)'; const tw = ctx.measureText(text).width; ctx.fillRect(p[0] + 7, p[1] - 9, tw + 8, 17); ctx.fillStyle = color; ctx.fillText(text, p[0] + 11, p[1] + 4); };
    // Orte
    if (data.parcours) label(dot(data.parcours.x, data.parcours.z, 4, '#22C55E'), 'Parcours', '#86EFAC');
    if (data.race && data.race.length) {
      ctx.strokeStyle = 'rgba(56,189,248,.55)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
      data.race.forEach((c, i) => { const [px, py] = toPx(c.x, c.z, cx, cz, scale, w, h); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      label(dot(data.race[0].x, data.race[0].z, 4.5, '#FBBF24'), 'Rennen', '#FDE68A');
    }
    if (data.spawn) label(dot(data.spawn.x, data.spawn.z, 3.5, '#E5E7EB'), 'Start');
    // Fahrzeuge
    for (const v of data.vehicles) {
      const [px, py] = toPx(v.x, v.z, cx, cz, scale, w, h); if (px < -6 || py < -6 || px > w + 6 || py > h + 6) continue;
      ctx.fillStyle = v.busy ? 'rgba(160,160,170,.55)' : v.color; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.2;
      ctx.fillRect(px - 3.5, py - 3.5, 7, 7); ctx.strokeRect(px - 3.5, py - 3.5, 7, 7);
    }
    // Andere Spieler
    for (const p of data.players) label(dot(p.x, p.z, 4, p.color, '#fff'), p.name, '#fff');
    // Schatz
    if (data.treasure) {
      const p = toPx(data.treasure.x, data.treasure.z, cx, cz, scale, w, h);
      const px = Math.max(8, Math.min(w - 8, p[0])), py = Math.max(8, Math.min(h - 8, p[1]));
      ctx.save(); ctx.translate(px, py); ctx.fillStyle = '#FBBF24'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 3.5 : 8; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      if (labels) label([px, py], 'Schatz', '#FDE68A');
    }
    // Ich (Pfeil in Blickrichtung)
    const [mx, my] = toPx(data.me.x, data.me.z, cx, cz, scale, w, h);
    ctx.save(); ctx.translate(mx, my); ctx.rotate(-data.me.yaw);
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#7C3AED'; ctx.stroke(); ctx.restore();
  }

  const mctx = mini.getContext('2d'), bctx = big.getContext('2d');
  let bigOpen = false;
  return {
    get open() { return bigOpen; },
    /** Klickposition auf der großen Karte → Weltkoordinaten. */
    toWorld(ev) {
      const r = big.getBoundingClientRect(); if (!r.width) return null;
      const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      return { x: (u - 0.5) * SIZE, z: (v - 0.5) * SIZE };
    },
    toggle(on = !bigOpen) {
      bigOpen = on; bigWrap.hidden = !on;
      if (on) { const s = Math.min(innerWidth, innerHeight) * 0.86; big.width = big.height = Math.round(s * Math.min(2, devicePixelRatio)); big.style.width = big.style.height = s + 'px'; }
    },
    update(data) {
      draw(mctx, mini.width, mini.height, data.me.x, data.me.z, mini.width / 320, data, false);
      if (bigOpen) {
        const sc = big.width / SIZE; bctx.save(); bctx.scale(1, 1);
        draw(bctx, big.width, big.height, 0, 0, sc, data, true);
        bctx.restore();
      }
    },
  };
}
