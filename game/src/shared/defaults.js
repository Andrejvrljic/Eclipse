// Standard-Spielinhalte. Werden beim ersten Start in die Datenbank geschrieben und sind danach im Dashboard bearbeitbar.
// Wird vom Spielserver (Worker) und vom Browser-Spiel gemeinsam genutzt.

export const STRUCTURE_TYPES = {
  fundament: { name: 'Fundament', w: 3, h: 0.4, d: 3 },
  wand: { name: 'Wand', w: 3, h: 3, d: 0.25 },
  wand_tuer: { name: 'Türwand', w: 3, h: 3, d: 0.25 },
  decke: { name: 'Decke', w: 3, h: 0.25, d: 3 },
  lagerfeuer: { name: 'Lagerfeuer', w: 1.2, h: 0.6, d: 1.2 },
  schlafsack: { name: 'Schlafsack', w: 1, h: 0.2, d: 2 },
  treppe: { name: 'Treppe', w: 3, h: 3, d: 3 },
  fensterwand: { name: 'Fensterwand', w: 3, h: 3, d: 0.25 },
  zaun: { name: 'Zaun', w: 3, h: 1.2, d: 0.15 },
  dach: { name: 'Schrägdach', w: 3, h: 1.5, d: 3 },
  truhe: { name: 'Lagertruhe', w: 1.1, h: 0.8, d: 0.7 },
};

/** Plätze in einer Lagertruhe. */
export const CHEST_SLOTS = 16;

export const ITEM_TYPES = ['Rohstoff', 'Nahrung', 'Werkzeug', 'Waffe', 'Rüstung', 'Bauteil', 'Besonderes'];
export const BEHAVIORS = ['Fliehend', 'Neutral', 'Aggressiv'];
export const BODY_TYPES = ['Vierbeiner', 'Zweibeiner'];
export const QUEST_TYPES = ['Sammeln', 'Herstellen', 'Besiegen', 'Bauen', 'Zähmen', 'Level erreichen'];

export const DEFAULT_SETTINGS = {
  xp_multiplier: 1,
  gather_multiplier: 1,
  damage_multiplier: 1,
  creature_multiplier: 1,
  hunger_rate: 1,
  level_base: 100,
  level_exp: 1.5,
  max_level: 50,
  start_coins: 0,
  motd: 'Willkommen auf ECLIPSE! Drück Tab für Inventar, Herstellen und Quests.',
  pvp: false,
  admins: 'dranoelgaming',
  admin_code: '',
  max_players: 40,
  version: 1,
};

// Fahrzeugtypen (Fahrphysik und Modell sind im Spiel festgelegt)
export const VEHICLE_TYPES = {
  gelaendewagen: { name: 'Geländewagen' },
  quad: { name: 'Quad' },
  truck: { name: 'Truck' },
  sportwagen: { name: 'Sportwagen' },
  buggy: { name: 'Buggy' },
  pickup: { name: 'Pickup' },
};

// id → Fahrzeug in der Welt (Position wird vom Spiel fortlaufend gespeichert)
export const DEFAULT_VEHICLES = {
  v1: { type: 'gelaendewagen', color: '#7C3AED', x: 12, z: 6, ry: 0.4, order: 1 },
  v2: { type: 'gelaendewagen', color: '#0EA5E9', x: -10, z: 9, ry: 2.2, order: 2 },
  v3: { type: 'quad', color: '#22C55E', x: 4, z: -14, ry: -1.3, order: 3 },
  v4: { type: 'quad', color: '#F59E0B', x: -14, z: -8, ry: 0.9, order: 4 },
  v5: { type: 'truck', color: '#EF4444', x: 20, z: -12, ry: 2.8, order: 5 },
  v6: { type: 'gelaendewagen', color: '#F472B6', x: 180, z: 140, ry: 1.0, order: 6 },
  v7: { type: 'quad', color: '#38BDF8', x: -220, z: 90, ry: 0.2, order: 7 },
  v8: { type: 'truck', color: '#A78BFA', x: 60, z: -260, ry: -0.6, order: 8 },
  v9: { type: 'gelaendewagen', color: '#FBBF24', x: -150, z: -210, ry: 2.6, order: 9 },
  v10: { type: 'quad', color: '#F87171', x: 260, z: -60, ry: -2.0, order: 10 },
  // Parkplatz am Startplatz
  v11: { type: 'sportwagen', color: '#EF4444', x: -22, z: -16, ry: 0.8, order: 11 },
  v12: { type: 'buggy', color: '#22C55E', x: -17, z: -20, ry: 0.8, order: 12 },
  v13: { type: 'pickup', color: '#0EA5E9', x: -12, z: -24, ry: 0.8, order: 13 },
  v14: { type: 'sportwagen', color: '#FBBF24', x: 24, z: 6, ry: -1.6, order: 14 },
  v15: { type: 'buggy', color: '#F472B6', x: 22, z: 14, ry: -2.0, order: 15 },
  v16: { type: 'pickup', color: '#A78BFA', x: 25, z: -3, ry: -1.4, order: 16 },
  // an der Rennstrecke
  v17: { type: 'sportwagen', color: '#38BDF8', x: 98, z: 30, ry: 1.9, order: 17 },
  v18: { type: 'sportwagen', color: '#F97316', x: 96, z: 24, ry: 1.9, order: 18 },
  // über die Insel verteilt
  v19: { type: 'buggy', color: '#FACC15', x: 186, z: 235, ry: 0.5, order: 19 },
  v20: { type: 'pickup', color: '#14B8A6', x: 13, z: 300, ry: 2.4, order: 20 },
  v21: { type: 'sportwagen', color: '#E11D48', x: -166, z: 250, ry: -0.7, order: 21 },
  v22: { type: 'buggy', color: '#84CC16', x: -281, z: 105, ry: 1.2, order: 22 },
  v23: { type: 'pickup', color: '#6366F1', x: -289, z: -81, ry: -2.2, order: 23 },
  v24: { type: 'gelaendewagen', color: '#10B981', x: -11, z: -270, ry: 0.3, order: 24 },
  v25: { type: 'buggy', color: '#FB7185', x: 166, z: -250, ry: -1.0, order: 25 },
  v26: { type: 'sportwagen', color: '#C084FC', x: 289, z: 81, ry: 2.8, order: 26 },
};

// id → Gegenstand
export const DEFAULT_ITEMS = {
  holz: { name: 'Holz', type: 'Rohstoff', color: '#8B5A2B', stack: 100, order: 1 },
  stein: { name: 'Stein', type: 'Rohstoff', color: '#8A8794', stack: 100, order: 2 },
  beeren: { name: 'Beeren', type: 'Nahrung', color: '#C2185B', stack: 50, food: 8, heal: 2, order: 3 },
  fleisch: { name: 'Rohes Fleisch', type: 'Nahrung', color: '#E57373', stack: 40, food: 10, heal: -3, order: 4 },
  gebratenes_fleisch: { name: 'Gebratenes Fleisch', type: 'Nahrung', color: '#A1662F', stack: 40, food: 30, heal: 15, order: 5 },
  haut: { name: 'Tierhaut', type: 'Rohstoff', color: '#C9A27A', stack: 50, order: 6 },
  splitter: { name: 'Eclipse-Splitter', type: 'Besonderes', color: '#A78BFA', stack: 50, order: 7 },
  steinaxt: { name: 'Steinaxt', type: 'Werkzeug', color: '#9CA3AF', stack: 1, damage: 12, wood: 3, stone: 1, order: 10 },
  spitzhacke: { name: 'Spitzhacke', type: 'Werkzeug', color: '#6B7280', stack: 1, damage: 10, wood: 1, stone: 3, order: 11 },
  speer: { name: 'Speer', type: 'Waffe', color: '#D6B98C', stack: 1, damage: 22, reach: 3.4, order: 12 },
  splitterklinge: { name: 'Splitterklinge', type: 'Waffe', color: '#8B5CF6', stack: 1, damage: 45, reach: 2.8, order: 13 },
  lederruestung: { name: 'Lederrüstung', type: 'Rüstung', color: '#A0522D', stack: 1, armor: 30, order: 14 },
  bogen: { name: 'Bogen', type: 'Waffe', color: '#B45309', stack: 1, damage: 28, ranged: true, order: 15 },
  pfeil: { name: 'Pfeil', type: 'Rohstoff', color: '#E5E7EB', stack: 100, order: 16 },
  fundament: { name: 'Fundament', type: 'Bauteil', color: '#B08968', stack: 20, structure: 'fundament', order: 20 },
  wand: { name: 'Wand', type: 'Bauteil', color: '#9C6644', stack: 20, structure: 'wand', order: 21 },
  wand_tuer: { name: 'Türwand', type: 'Bauteil', color: '#7F5539', stack: 20, structure: 'wand_tuer', order: 22 },
  decke: { name: 'Decke', type: 'Bauteil', color: '#DDB892', stack: 20, structure: 'decke', order: 23 },
  lagerfeuer: { name: 'Lagerfeuer', type: 'Bauteil', color: '#F59E0B', stack: 5, structure: 'lagerfeuer', order: 24 },
  schlafsack: { name: 'Schlafsack', type: 'Bauteil', color: '#38BDF8', stack: 5, structure: 'schlafsack', order: 25 },
  treppe: { name: 'Treppe', type: 'Bauteil', color: '#B5835A', stack: 10, structure: 'treppe', order: 26 },
  fensterwand: { name: 'Fensterwand', type: 'Bauteil', color: '#A9785A', stack: 20, structure: 'fensterwand', order: 27 },
  zaun: { name: 'Zaun', type: 'Bauteil', color: '#8D6E53', stack: 30, structure: 'zaun', order: 28 },
  dach: { name: 'Schrägdach', type: 'Bauteil', color: '#7A4B3A', stack: 20, structure: 'dach', order: 29 },
  truhe: { name: 'Lagertruhe', type: 'Bauteil', color: '#A16207', stack: 5, structure: 'truhe', order: 30 },
};

// id → Rezept: Ergebnis, Menge, Zutaten { itemId: anzahl }, Mindestlevel, Station (leer oder "lagerfeuer")
export const DEFAULT_RECIPES = {
  r_steinaxt: { item: 'steinaxt', amount: 1, ingredients: { holz: 3, stein: 2 }, level: 1, station: '', order: 1 },
  r_spitzhacke: { item: 'spitzhacke', amount: 1, ingredients: { holz: 3, stein: 3 }, level: 2, station: '', order: 2 },
  r_speer: { item: 'speer', amount: 1, ingredients: { holz: 6, stein: 2, haut: 1 }, level: 3, station: '', order: 3 },
  r_lederruestung: { item: 'lederruestung', amount: 1, ingredients: { haut: 8, holz: 2 }, level: 4, station: '', order: 4 },
  r_splitterklinge: { item: 'splitterklinge', amount: 1, ingredients: { splitter: 4, stein: 10, holz: 4 }, level: 8, station: '', order: 5 },
  r_bogen: { item: 'bogen', amount: 1, ingredients: { holz: 10, haut: 3 }, level: 5, station: '', order: 7 },
  r_pfeil: { item: 'pfeil', amount: 5, ingredients: { holz: 2, stein: 1 }, level: 5, station: '', order: 8 },
  r_braten: { item: 'gebratenes_fleisch', amount: 1, ingredients: { fleisch: 1 }, level: 1, station: 'lagerfeuer', order: 6 },
  r_fundament: { item: 'fundament', amount: 1, ingredients: { holz: 8, stein: 4 }, level: 2, station: '', order: 10 },
  r_wand: { item: 'wand', amount: 1, ingredients: { holz: 6 }, level: 2, station: '', order: 11 },
  r_wand_tuer: { item: 'wand_tuer', amount: 1, ingredients: { holz: 8 }, level: 3, station: '', order: 12 },
  r_decke: { item: 'decke', amount: 1, ingredients: { holz: 6, stein: 2 }, level: 3, station: '', order: 13 },
  r_lagerfeuer: { item: 'lagerfeuer', amount: 1, ingredients: { holz: 5, stein: 5 }, level: 1, station: '', order: 14 },
  r_schlafsack: { item: 'schlafsack', amount: 1, ingredients: { haut: 4, holz: 2 }, level: 2, station: '', order: 15 },
  r_zaun: { item: 'zaun', amount: 2, ingredients: { holz: 4 }, level: 1, station: '', order: 16 },
  r_truhe: { item: 'truhe', amount: 1, ingredients: { holz: 12, stein: 2 }, level: 2, station: '', order: 17 },
  r_fensterwand: { item: 'fensterwand', amount: 1, ingredients: { holz: 6, stein: 1 }, level: 3, station: '', order: 18 },
  r_treppe: { item: 'treppe', amount: 1, ingredients: { holz: 10, stein: 2 }, level: 3, station: '', order: 19 },
  r_dach: { item: 'dach', amount: 1, ingredients: { holz: 7, haut: 1 }, level: 4, station: '', order: 20 },
};

// id → Kreaturenart (eigene Fantasie-Arten)
export const DEFAULT_SPECIES = {
  graslaeufer: {
    name: 'Grasläufer', body: 'Vierbeiner', color: '#B7A57A', scale: 0.8, hp: 40, damage: 0, speed: 6.5,
    behavior: 'Fliehend', count: 40, xp: 20, drops: { fleisch: 2, haut: 1 }, tame_food: 'beeren', tame_amount: 4, rideable: false, order: 1,
  },
  panzerruecken: {
    name: 'Panzerrücken', body: 'Vierbeiner', color: '#6B7F4A', scale: 2.1, hp: 320, damage: 22, speed: 3.4,
    behavior: 'Neutral', count: 14, xp: 120, drops: { fleisch: 8, haut: 5 }, tame_food: 'beeren', tame_amount: 12, rideable: true, order: 2,
  },
  klauenjaeger: {
    name: 'Klauenjäger', body: 'Zweibeiner', color: '#8A3B2E', scale: 1.0, hp: 75, damage: 9, speed: 8.2,
    behavior: 'Aggressiv', count: 22, xp: 60, drops: { fleisch: 3, haut: 2 }, tame_food: 'fleisch', tame_amount: 6, rideable: true, order: 3,
  },
  splitterbestie: {
    name: 'Splitterbestie', body: 'Vierbeiner', color: '#4C1D95', scale: 1.3, hp: 170, damage: 16, speed: 5.4,
    behavior: 'Aggressiv', count: 12, xp: 150, drops: { splitter: 1, haut: 2 }, tame_food: '', tame_amount: 0, rideable: false, glow: true, order: 4,
  },
  schattenkoloss: {
    name: 'Schattenkoloss', body: 'Zweibeiner', color: '#2B1F3A', scale: 3.3, hp: 1600, damage: 40, speed: 6.0,
    behavior: 'Aggressiv', count: 3, xp: 900, drops: { fleisch: 20, haut: 10, splitter: 3 }, tame_food: '', tame_amount: 0, rideable: false, glow: true, order: 5,
  },
};

// id → Quest
export const DEFAULT_QUESTS = {
  q_holz: { title: 'Erste Schritte', description: 'Sammle Holz an einem Baum.', type: 'Sammeln', target: 'holz', count: 10, xp: 50, coins: 10, reward_item: '', reward_amount: 0, order: 1 },
  q_axt: { title: 'Steinzeit', description: 'Stelle eine Steinaxt her.', type: 'Herstellen', target: 'steinaxt', count: 1, xp: 75, coins: 10, reward_item: '', reward_amount: 0, order: 2 },
  q_jagd: { title: 'Jäger', description: 'Besiege drei Grasläufer.', type: 'Besiegen', target: 'graslaeufer', count: 3, xp: 120, coins: 20, reward_item: 'fleisch', reward_amount: 5, order: 3 },
  q_feuer: { title: 'Feuerstelle', description: 'Baue ein Lagerfeuer.', type: 'Bauen', target: 'lagerfeuer', count: 1, xp: 80, coins: 15, reward_item: '', reward_amount: 0, order: 4 },
  q_haus: { title: 'Ein Dach über dem Kopf', description: 'Baue vier Fundamente.', type: 'Bauen', target: 'fundament', count: 4, xp: 150, coins: 30, reward_item: '', reward_amount: 0, order: 5 },
  q_splitter: { title: 'Splittersucher', description: 'Sammle fünf Eclipse-Splitter.', type: 'Sammeln', target: 'splitter', count: 5, xp: 200, coins: 50, reward_item: '', reward_amount: 0, order: 6 },
  q_zaehmen: { title: 'Zähmer', description: 'Zähme eine Kreatur, indem du sie fütterst.', type: 'Zähmen', target: '', count: 1, xp: 250, coins: 40, reward_item: '', reward_amount: 0, order: 7 },
  q_level: { title: 'Überlebender', description: 'Erreiche Level 10.', type: 'Level erreichen', target: '', count: 10, xp: 300, coins: 60, reward_item: '', reward_amount: 0, order: 8 },
  q_truhe: { title: 'Sicheres Lager', description: 'Baue eine Lagertruhe für deine Vorräte.', type: 'Bauen', target: 'truhe', count: 1, xp: 100, coins: 20, reward_item: '', reward_amount: 0, order: 10 },
  q_obergeschoss: { title: 'Hoch hinaus', description: 'Baue eine Treppe in dein Haus.', type: 'Bauen', target: 'treppe', count: 1, xp: 150, coins: 25, reward_item: '', reward_amount: 0, order: 11 },
  q_koloss: { title: 'Der Koloss', description: 'Besiege einen Schattenkoloss.', type: 'Besiegen', target: 'schattenkoloss', count: 1, xp: 800, coins: 200, reward_item: 'splitter', reward_amount: 5, order: 9 },
};

/** Benötigte Erfahrung für den Aufstieg von `level` auf `level + 1`. */
export function xpForLevel(level, s = DEFAULT_SETTINGS) {
  return Math.round((Number(s.level_base) || 100) * Math.pow(level, Number(s.level_exp) || 1.5));
}

/** Startwerte eines neuen Spielers. */
export function newProfile(pid, name, color, settings = DEFAULT_SETTINGS) {
  return {
    pid, name, color, level: 1, xp: 0, coins: Number(settings.start_coins) || 0,
    hp: 100, hunger: 100, inv: [{ id: 'beeren', n: 5 }], armor: '', quests: {}, shards: [], tamed: 0,
    stats: { kills: 0, crafted: 0, built: 0 },
  };
}

export const maxHp = (level) => 100 + (level - 1) * 10;
export const maxStamina = (level) => 100 + (level - 1) * 5;
export const INV_SLOTS = 32;
export const HOTBAR = 8;

/** Inhalte, die nach dem ersten Start dazugekommen sind (werden in bestehende Welten nachgetragen). */
export const CONTENT_VERSION = 3;
export const CONTENT_ADDED = {
  2: { items: ['treppe', 'fensterwand', 'zaun', 'dach', 'truhe'], recipes: ['r_zaun', 'r_truhe', 'r_fensterwand', 'r_treppe', 'r_dach'], quests: ['q_truhe', 'q_obergeschoss'] },
  3: { vehicles: ['v11', 'v12', 'v13', 'v14', 'v15', 'v16', 'v17', 'v18', 'v19', 'v20', 'v21', 'v22', 'v23', 'v24', 'v25', 'v26'] },
};
