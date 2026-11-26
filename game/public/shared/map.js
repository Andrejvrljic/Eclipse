// Nova Strike – Karte "Krater" (gemeinsam für Browser und Server).
// Y zeigt nach oben, der Boden liegt bei y = 0. Jede Box ist ein achsenparalleler Quader.
export const ARENA = 44; // halbe Kantenlänge der Spielfläche in Metern

export const BOXES = [];

/** Quader mit Mittelpunkt (x, z), Breite w (x), Tiefe d (z), Höhe h, Unterkante y. */
function box(x, z, w, d, h, y = 0, k = 'wall') {
  BOXES.push({ min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], k });
}

// Außenmauern
box(0, -ARENA - 0.5, ARENA * 2 + 2, 1, 9, 0, 'outer');
box(0, ARENA + 0.5, ARENA * 2 + 2, 1, 9, 0, 'outer');
box(-ARENA - 0.5, 0, 1, ARENA * 2 + 2, 9, 0, 'outer');
box(ARENA + 0.5, 0, 1, ARENA * 2 + 2, 9, 0, 'outer');

// Zentrum: erhöhte Plattform mit Treppen nach Norden und Süden
box(0, 0, 14, 14, 3, 0, 'plat');
for (const s of [1, -1]) {
  for (let i = 0; i < 5; i++) box(0, s * (7.4 + i * 0.8), 4.5, 0.8, 3 - (i + 1) * 0.5, 0, 'step');
}
box(-4.6, 0, 0.8, 4.5, 1.2, 3, 'cover');
box(4.6, 0, 0.8, 4.5, 1.2, 3, 'cover');
box(0, -4.2, 3, 0.8, 1.2, 3, 'cover');
for (const sx of [1, -1]) for (const sz of [1, -1]) box(sx * 6.4, sz * 6.4, 1.2, 1.2, 7, 0, 'pillar');

// Vier Eckgebäude mit Türen Richtung Mitte
for (const sx of [1, -1]) {
  for (const sz of [1, -1]) {
    const cx = 28 * sx, cz = 28 * sz, H = 5, T = 0.8;
    // Wand zur Mitte (x) mit Tür
    box(cx - 7 * sx, cz - 4.5, T, 5, H);
    box(cx - 7 * sx, cz + 4.5, T, 5, H);
    // Außenwand (x)
    box(cx + 7 * sx, cz, T, 14.8, H);
    // Wand zur Mitte (z) mit Tür
    box(cx - 4.5, cz - 7 * sz, 5, T, H);
    box(cx + 4.5, cz - 7 * sz, 5, T, H);
    // Außenwand (z)
    box(cx, cz + 7 * sz, 14.8, T, H);
    // Türsturz über den Türen
    box(cx - 7 * sx, cz, T, 4, 1.4, H - 1.4);
    box(cx, cz - 7 * sz, 4, T, 1.4, H - 1.4);
    // Kisten im Inneren
    box(cx + 3.5 * sx, cz + 3.5 * sz, 2.2, 2.2, 2.2, 0, 'crate');
    box(cx + 3.5 * sx, cz + 1.0 * sz, 1.6, 1.6, 1.6, 0, 'crate');
  }
}

// Scharfschützentürme im Osten und Westen
for (const s of [1, -1]) {
  const cx = 37.5 * s;
  box(cx, 0, 5, 6, 4, 0, 'plat');
  for (let i = 0; i < 7; i++) box(cx - s * (2.9 + i * 0.8), 0, 0.8, 3, 4 - (i + 1) * 0.5, 0, 'step');
  box(cx + s * 2.3, 0, 0.4, 6, 1.1, 4, 'cover');
  box(cx, 2.8, 5, 0.4, 1.1, 4, 'cover');
  box(cx, -2.8, 5, 0.4, 1.1, 4, 'cover');
}

// Halbhohe Deckungsmauern
box(-19, 0, 0.8, 9, 1.3, 0, 'cover');
box(19, 0, 0.8, 9, 1.3, 0, 'cover');
box(0, 21, 9, 0.8, 1.3, 0, 'cover');
box(0, -21, 9, 0.8, 1.3, 0, 'cover');
box(-12, 30, 0.8, 6, 2.4, 0, 'wall');
box(12, -30, 0.8, 6, 2.4, 0, 'wall');
box(30, 12, 6, 0.8, 2.4, 0, 'wall');
box(-30, -12, 6, 0.8, 2.4, 0, 'wall');

// Kisten
const crates = [[-12, 14], [12, -14], [14, 10], [-14, -10], [-30, 4], [30, -4], [5, 31], [-5, -31], [-37, -16], [37, 16], [20, 38], [-20, -38], [-24, 18], [24, -18]];
crates.forEach(([x, z], i) => {
  box(x, z, 2, 2, 2, 0, 'crate');
  if (i % 3 === 0) box(x + 0.2, z - 0.1, 1.4, 1.4, 1.4, 2, 'crate');
  if (i % 2 === 0) box(x + 2.2, z + 0.3, 1.5, 1.5, 1.5, 0, 'crate');
});

// Startpunkte (x, z) – liegen alle frei auf dem Boden
export const SPAWNS = [
  [28, 28], [-28, 28], [28, -28], [-28, -28],
  [0, 15], [0, -15], [-14, 2], [14, -2],
  [-38, 30], [38, -30], [-22, -41], [22, 41],
  [41, 30], [-41, -30], [-33, 10], [33, -10],
];

// Wegpunkte für die Bots (Spawns + Kreuzungen)
export const WAYPOINTS = SPAWNS.concat([
  [0, 26], [0, -26], [-26, 0], [26, 0], [-10, 10], [10, -10], [-10, -18], [10, 18],
  [-31, 7], [31, -7], [0, 40], [0, -40], [-40, 40], [40, -40], [40, 40], [-40, -40],
]);
