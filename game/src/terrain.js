// Prozedurale Insel: deterministisch (gleicher Seed = gleiche Welt für alle Spieler).

export const SIZE = 480;        // Kantenlänge der Welt in Metern
export const SEG = 192;         // Rasterzellen pro Kante (2,5 m pro Zelle)
export const SEA_LEVEL = 0;

// Kleines, schnelles Pseudo-Zufallssystem mit festem Seed.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D-Gradientenrauschen (Perlin-artig) mit fester Permutation.
const perm = new Uint8Array(512);
{
  const r = rng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y) {
  switch (h & 7) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x; case 5: return -x; case 6: return y; default: return -y;
  }
}
export function noise(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const a = perm[X] + Y, b = perm[X + 1] + Y;
  const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y));
  const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1));
  return (l1 + v * (l2 - l1)) * 0.7071;
}
function fbm(x, y, oct = 5) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

/** Analytische Geländehöhe an Weltkoordinate (x, z). */
export function heightAt(x, z) {
  const half = SIZE / 2;
  // Inselform: zum Rand hin abfallen, damit das Meer die Welt begrenzt.
  const d = Math.min(1, Math.hypot(x, z) / (half * 0.92));
  const island = 1 - Math.pow(d, 3.4);
  let h = fbm(x * 0.0065 + 11.3, z * 0.0065 - 4.1) * 26;          // große Hügel
  h += Math.pow(Math.max(0, fbm(x * 0.012 - 7, z * 0.012 + 3, 4) * 2.2), 1.7) * 30; // Berge
  h += fbm(x * 0.05, z * 0.05, 3) * 1.6;                              // kleine Unebenheiten
  h = h * island + island * 13 - (1 - island) * 12;
  // Startplatz in der Mitte einebnen.
  const c = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  const flat = Math.min(1, Math.max(0, (c - 14) / 26));
  return h * flat + SPAWN_H * (1 - flat);
}
export const SPAWN = { x: 0, z: 0 };
const SPAWN_H = 8;

/** Höhen am Raster: Index [ix * (SEG + 1) + iz] (ix entlang x, iz entlang z). */
export function buildGrid() {
  const n = SEG + 1;
  const h = new Float32Array(n * n);
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const x = -SIZE / 2 + (ix / SEG) * SIZE;
      const z = -SIZE / 2 + (iz / SEG) * SIZE;
      h[ix * n + iz] = heightAt(x, z);
    }
  }
  return h;
}

/** Höhe aus dem Raster, bilinear wie das Physik-Gelände (für Platzierung und Kamera). */
export function makeSampler(grid) {
  const n = SEG + 1, cell = SIZE / SEG;
  return (x, z) => {
    const fx = Math.min(SEG - 1e-6, Math.max(0, (x + SIZE / 2) / cell));
    const fz = Math.min(SEG - 1e-6, Math.max(0, (z + SIZE / 2) / cell));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = grid[ix * n + iz], b = grid[(ix + 1) * n + iz], c = grid[ix * n + iz + 1], d = grid[(ix + 1) * n + iz + 1];
    // Dreiecksweise Interpolation passend zur Mesh-Triangulierung.
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  };
}
