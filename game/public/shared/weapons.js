// Waffenwerte – der Server nutzt dieselben Zahlen für Schaden und Feuerrate.
export const WEAPONS = {
  rifle: {
    key: 'rifle', name: 'Pulsgewehr', slot: 1, dmg: 20, head: 1.8, interval: 100, mag: 30, reload: 1.9,
    pellets: 1, spread: 0.012, moveSpread: 0.03, airSpread: 0.06, adsMul: 0.35, range: 160,
    falloff: [45, 90, 0.65], auto: true, recoil: 0.011, zoom: 1.4,
  },
  sniper: {
    key: 'sniper', name: 'Lanze', slot: 2, dmg: 90, head: 2.5, interval: 1150, mag: 5, reload: 2.6,
    pellets: 1, spread: 0.06, moveSpread: 0.05, airSpread: 0.12, adsMul: 0.008, range: 400,
    falloff: null, auto: false, recoil: 0.06, zoom: 4.2,
  },
  shotgun: {
    key: 'shotgun', name: 'Brecher', slot: 3, dmg: 13, head: 1.5, interval: 820, mag: 6, reload: 2.3,
    pellets: 9, spread: 0.075, moveSpread: 0.01, airSpread: 0.02, adsMul: 0.75, range: 45,
    falloff: [9, 30, 0.25], auto: false, recoil: 0.05, zoom: 1.15,
  },
};
export const WEAPON_ORDER = ['rifle', 'sniper', 'shotgun'];

/** Schaden eines Treffers auf Entfernung dist. */
export function damageAt(w, dist, head) {
  let dmg = w.dmg * (head ? w.head : 1);
  if (w.falloff) {
    const [a, b, min] = w.falloff;
    if (dist > a) dmg *= dist >= b ? min : 1 - (1 - min) * ((dist - a) / (b - a));
  }
  return dmg;
}

export const MATCH = { duration: 6 * 60 * 1000, scoreLimit: 25, intermission: 12000, respawn: 3000, protect: 2000, maxHumans: 12, botFill: 4 };
