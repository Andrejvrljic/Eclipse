// Tageszeit und Wetter: steuerbar über das Dashboard (Welt & Regeln).
// Tageszeit „Zyklus“ läuft für alle Spieler gleich, weil sie aus der Uhrzeit berechnet wird.
import * as THREE from 'three';

const c = (h) => new THREE.Color(h);
// Himmel oben/mitte/horizont, Nebel, Halbkugel-Licht (Farbe, Boden, Stärke), Sonne (Farbe, Stärke), Sterne, Finsternis-Korona
const PRESETS = {
  Finsternis: { top: c(0x08051a), mid: c(0x2c1a4d), hor: c(0x8c456b), fog: c(0x2b1d42), hemi: c(0xa898f0), ground: c(0x3a3048), hi: 1.5, sunC: c(0xffd4e6), si: 2.1, stars: 0.8, corona: 1, glow: 1 },
  Morgen: { top: c(0x3a5a9a), mid: c(0x8a8ac0), hor: c(0xf2a77a), fog: c(0x9c8aa8), hemi: c(0xd8c8f0), ground: c(0x504038), hi: 1.6, sunC: c(0xffc8a0), si: 2.3, stars: 0.1, corona: 0, glow: 0.6 },
  Tag: { top: c(0x2f6fd0), mid: c(0x6fa4e8), hor: c(0xbfd8f0), fog: c(0xa9c3dc), hemi: c(0xdfeaff), ground: c(0x4e5a3c), hi: 1.9, sunC: c(0xfff4e0), si: 2.8, stars: 0, corona: 0, glow: 0.35 },
  Abend: { top: c(0x26285a), mid: c(0x7a4a7a), hor: c(0xf07a4a), fog: c(0x7a5068), hemi: c(0xe0b0c0), ground: c(0x40303a), hi: 1.4, sunC: c(0xffa070), si: 2.0, stars: 0.3, corona: 0, glow: 0.9 },
  Nacht: { top: c(0x020309), mid: c(0x0a0f26), hor: c(0x1c2444), fog: c(0x0c1020), hemi: c(0x6070b0), ground: c(0x202030), hi: 1.15, sunC: c(0x9fb0ff), si: 0.8, stars: 1, corona: 0, glow: 0.15 },
};
const CYCLE = ['Morgen', 'Tag', 'Tag', 'Abend', 'Nacht', 'Nacht'];
const WEATHER = {
  Klar: { fog: 1, light: 1, rain: 0, gray: 0 },
  Nebel: { fog: 3.6, light: 0.85, rain: 0, gray: 0.35 },
  Regen: { fog: 1.9, light: 0.72, rain: 1, gray: 0.45 },
  Sturm: { fog: 2.5, light: 0.55, rain: 2, gray: 0.6 },
};
const GRAY = new THREE.Color(0x6a6c78);

export function createAtmosphere(scene, world, { lowEnd = false } = {}) {
  const { mat, stars, corona, disc } = world.sky.userData;
  const cur = { ...PRESETS.Finsternis, top: PRESETS.Finsternis.top.clone(), mid: PRESETS.Finsternis.mid.clone(), hor: PRESETS.Finsternis.hor.clone(), fog: PRESETS.Finsternis.fog.clone(), hemi: PRESETS.Finsternis.hemi.clone(), ground: PRESETS.Finsternis.ground.clone(), sunC: PRESETS.Finsternis.sunC.clone() };
  let timeMode = 'Finsternis', cycleMin = 20, weather = 'Klar', wf = { ...WEATHER.Klar }, flash = 0, nextFlash = 5;

  // Regen: Linien um die Kamera, die nach unten fallen
  const N = lowEnd ? 700 : 1800, AREA = 60, H = 40;
  const rp = new Float32Array(N * 6), seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { seeds[i * 3] = (Math.random() - 0.5) * AREA * 2; seeds[i * 3 + 1] = Math.random() * H; seeds[i * 3 + 2] = (Math.random() - 0.5) * AREA * 2; }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab4d0, transparent: true, opacity: 0.45, depthWrite: false }));
  rain.frustumCulled = false; rain.visible = false;
  scene.add(rain);

  const mixInto = (a, b, k) => {
    for (const key of ['top', 'mid', 'hor', 'fog', 'hemi', 'ground', 'sunC']) cur[key].copy(a[key]).lerp(b[key], k);
    for (const key of ['hi', 'si', 'stars', 'corona', 'glow']) cur[key] = a[key] + (b[key] - a[key]) * k;
  };
  function target() {
    if (timeMode !== 'Zyklus') { const p = PRESETS[timeMode] || PRESETS.Finsternis; mixInto(p, p, 0); return; }
    const period = Math.max(2, cycleMin) * 60000;
    const ph = ((Date.now() % period) / period) * CYCLE.length;
    const i = Math.floor(ph), k = ph - i;
    const s = k * k * (3 - 2 * k);
    mixInto(PRESETS[CYCLE[i]], PRESETS[CYCLE[(i + 1) % CYCLE.length]], s);
  }

  return {
    get weather() { return weather; },
    get label() { return timeMode === 'Zyklus' ? 'Tag-Nacht-Zyklus' : timeMode; },
    apply(settings = {}) {
      timeMode = (PRESETS[settings.time_mode] || settings.time_mode === 'Zyklus') ? settings.time_mode : 'Finsternis';
      cycleMin = Number(settings.cycle_minutes) || 20;
      weather = WEATHER[settings.weather] ? settings.weather : 'Klar';
      wf = { ...WEATHER[weather] };
    },
    update(dt, focus) {
      target();
      const L = wf.light;
      mat.uniforms.top.value.copy(cur.top).lerp(GRAY, wf.gray * 0.6);
      mat.uniforms.mid.value.copy(cur.mid).lerp(GRAY, wf.gray * 0.7);
      mat.uniforms.hor.value.copy(cur.hor).lerp(GRAY, wf.gray * 0.8);
      mat.uniforms.glow.value = cur.glow * (1 - wf.gray);
      stars.material.opacity = cur.stars * (1 - wf.gray);
      corona.material.opacity = cur.corona * (1 - wf.gray * 0.8);
      disc.material.opacity = cur.corona;
      scene.fog.color.copy(cur.fog).lerp(GRAY, wf.gray * 0.5);
      scene.background.copy(scene.fog.color);
      scene.fog.density = 0.0042 * wf.fog;
      world.hemi.color.copy(cur.hemi); world.hemi.groundColor.copy(cur.ground);
      world.hemi.intensity = cur.hi * L;
      world.sun.color.copy(cur.sunC); world.sun.intensity = cur.si * L;
      // Blitze bei Sturm
      if (weather === 'Sturm') {
        nextFlash -= dt;
        if (nextFlash <= 0) { flash = 1; nextFlash = 4 + Math.random() * 9; }
      }
      if (flash > 0) { world.hemi.intensity += flash * 4; flash = Math.max(0, flash - dt * 5); }
      // Regen
      rain.visible = wf.rain > 0;
      if (rain.visible) {
        const t = performance.now() / 1000, sp = 26 + wf.rain * 8, slant = wf.rain > 1 ? 0.35 : 0.08, len = 0.9 + wf.rain * 0.3;
        const n = Math.floor(N * Math.min(1, wf.rain * 0.6));
        for (let i = 0; i < N; i++) {
          const o = i * 6;
          if (i >= n) { rp[o] = rp[o + 3] = 0; rp[o + 1] = rp[o + 4] = -9999; rp[o + 2] = rp[o + 5] = 0; continue; }
          const y = H - ((seeds[i * 3 + 1] + t * sp) % H);
          const x = focus.x + seeds[i * 3], z = focus.z + seeds[i * 3 + 2];
          rp[o] = x + y * slant; rp[o + 1] = focus.y - 8 + y; rp[o + 2] = z;
          rp[o + 3] = x + (y - len) * slant; rp[o + 4] = focus.y - 8 + y - len; rp[o + 5] = z;
        }
        rg.attributes.position.needsUpdate = true;
      }
    },
  };
}
