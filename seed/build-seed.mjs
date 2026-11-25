// Erzeugt die einmaligen Startdaten für ECLIPSE – Dev Platform.
// Ausgabe: seed/data/<collection>/<id>.json  +  seed/startdaten.json (alles in einer Datei)
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-11-25T12:00:00.000Z';

const project = {
  eclipse: {
    name: 'ECLIPSE',
    codename: 'UMBRA',
    description: 'Browserbasiertes 3D-Open-World-Multiplayer-Spiel: Erkunden, Fahren, Sammeln, Craften und Basen bauen in einer persistenten, gemeinsamen Welt.',
    status: 'In Entwicklung',
    current_phase: 'phase-2',
    start_date: '2026-09-01',
    target_date: '2028-03-31',
    version: '0.2.0-alpha',
    genre: 'Open World · Survival · Multiplayer',
    engine_notes: 'Rendering mit Three.js (WebGL2), Physik mit Rapier.js (WASM), autoritativer Spielserver auf Node.js mit Socket.IO. Gemeinsame Typen und Konstanten liegen in shared/.',
  },
};

const phaseDefs = [
  ['Technische Grundlage', 'Projektstruktur, Build-Setup, Konventionen und das erste Game Design Document.', 'Abgeschlossen', '#C4B5FD'],
  ['3D-Prototyp', 'Spielbare Szene mit Renderer, Physik, Charaktersteuerung, Terrain und erstem Fahrzeug.', 'Aktiv', '#A78BFA'],
  ['Multiplayer', 'Autoritativer Server, Räume, Netzwerkprotokoll, Client-Prediction und Synchronisation.', 'Ausstehend', '#8B5CF6'],
  ['Spielwelt', 'Größere Karte mit Chunk-Streaming, Beleuchtung, Tag-Nacht-Zyklus und Umgebungsdetails.', 'Ausstehend', '#818CF8'],
  ['Spielsysteme', 'Inventar, Crafting, Quests, Levelsystem und Basenbau als zusammenhängender Gameplay-Loop.', 'Ausstehend', '#60A5FA'],
  ['Große Open World', 'Mehrere Biome, Points of Interest, Performance-Feinschliff und Vorbereitung auf den Release.', 'Ausstehend', '#38BDF8'],
];
const phases = {};
phaseDefs.forEach(([name, description, status, color], i) => {
  phases[`phase-${i + 1}`] = { number: i + 1, name, description, status, progress: 0, color, order: i + 1 };
});

const developers = {
  'dev-1': { name: 'Entwickler 1', role: 'Lead Developer · Engine & Netzwerk', avatar_initials: 'E1', color: '#A78BFA', focus_area: 'Technische Planung, 3D-Welt, Multiplayer', online_status: 'Online', order: 1 },
  'dev-2': { name: 'Entwickler 2', role: 'Gameplay Developer', avatar_initials: 'E2', color: '#38BDF8', focus_area: 'Spielmechaniken, Charaktere, Fahrzeuge, Spielsysteme', online_status: 'Online', order: 2 },
};

const areaDefs = [
  ['game-design', 'Game Design', 'compass', 'Vision, Kern-Loop, Spielerziele und das Game Design Document.'],
  ['technische-planung', 'Technische Planung', 'ruler', 'Architektur, Projektstruktur, Build-Pipeline und Konventionen.'],
  ['spielmechaniken', 'Spielmechaniken', 'cog', 'Physik, Eingabe, Interaktionen und das Grundgefühl der Steuerung.'],
  ['3d-welt', '3D-Welt', 'cube', 'Renderer, Terrain, Assets, Beleuchtung und Streaming der Welt.'],
  ['multiplayer', 'Multiplayer', 'network', 'Server, Räume, Protokoll, Prediction und Synchronisation.'],
  ['fahrzeuge', 'Fahrzeuge', 'wheel', 'Fahrphysik, Fahrzeugtypen, Ein- und Aussteigen, Schäden.'],
  ['charaktere', 'Charaktere', 'person', 'Spielerfigur, Animationen, Kamera und Charakter-Controller.'],
  ['inventar', 'Inventar', 'slots', 'Item-Datenmodell, Slots, Stapel, Ausrüstung und Inventar-UI.'],
  ['crafting', 'Crafting', 'hammer', 'Rezepte, Werkbänke, Ressourcen und Herstellungszeiten.'],
  ['quests', 'Quests', 'flag', 'Questziele, Questketten, Belohnungen und Fortschrittsspeicherung.'],
  ['levelsystem', 'Levelsystem', 'levels', 'Erfahrungspunkte, Levelkurve, Freischaltungen und Fähigkeiten.'],
  ['basenbau', 'Basenbau', 'base', 'Bauteile, Grid-Platzierung, Snapping, Stabilität und Besitzrechte.'],
];
const areas = {};
areaDefs.forEach(([slug, name, icon, description], i) => {
  areas[slug] = { name, slug, icon, description, progress: 0, order: i + 1 };
});

// [titel, beschreibung, phase, bereich, dev, status, prio, progress, stunden, fällig, tags]
const taskDefs = [
  ['Projektstruktur client/server/shared anlegen', 'Monorepo-Ordner, npm-Workspaces und gemeinsame Skripte für Client und Server einrichten.', 1, 'technische-planung', 1, 'Erledigt', 'Mittel', 100, 4, '2026-09-08', ['setup']],
  ['Build-Setup mit Vite und ES-Modulen', 'Dev-Server mit Hot Reload für den Client, Produktions-Build und Alias auf shared/.', 1, 'technische-planung', 1, 'Erledigt', 'Hoch', 100, 6, '2026-09-15', ['build', 'vite']],
  ['Game Design Document v1', 'Vision, Kern-Loop, Zielgruppe, Steuerung und Abgrenzung der ersten spielbaren Version.', 1, 'game-design', 2, 'Erledigt', 'Hoch', 100, 12, '2026-09-30', ['gdd']],
  ['Coding-Konventionen & Ordner-Doku', 'ESLint/Prettier-Regeln, Benennung von Modulen und Aufbau von docs/ARCHITECTURE.md.', 1, 'technische-planung', 2, 'Erledigt', 'Niedrig', 100, 3, '2026-10-05', ['docs']],
  ['Three.js Renderer, Kamera & Game-Loop', 'WebGL2-Renderer, Resize-Handling, fester Physik-Tick und variabler Render-Schritt.', 2, '3d-welt', 1, 'Erledigt', 'Kritisch', 100, 10, '2026-10-20', ['three.js', 'core']],
  ['Rapier.js Physik-Welt integrieren', 'WASM laden, Physik-Welt mit 60 Hz takten, Kollisionsgruppen und Debug-Renderer.', 2, 'spielmechaniken', 1, 'In Arbeit', 'Kritisch', 60, 14, '2026-12-04', ['rapier', 'physik']],
  ['Third-Person-Charaktercontroller', 'Kinematischer Controller mit Laufen, Springen, Hangneigung und Kamera-Kollision.', 2, 'charaktere', 2, 'In Arbeit', 'Hoch', 45, 16, '2026-12-11', ['controller', 'kamera']],
  ['Terrain-Prototyp mit Heightmap', 'Heightmap laden, Mesh erzeugen, Heightfield-Collider in Rapier und einfache Texturierung.', 2, '3d-welt', 1, 'Review', 'Hoch', 85, 12, '2026-11-28', ['terrain']],
  ['Fahrzeug-Prototyp mit Raycast-Rädern', 'Erstes Buggy-Fahrzeug mit Raycast-Federung, Lenkung, Gas und Bremse.', 2, 'fahrzeuge', 2, 'Backlog', 'Mittel', 0, 18, '2026-12-23', ['fahrphysik']],
  ['Input-System für Tastatur, Maus und Gamepad', 'Aktionsbasiertes Mapping, Pointer Lock und Gamepad-API mit Deadzones.', 2, 'spielmechaniken', 2, 'In Arbeit', 'Hoch', 30, 8, '2026-12-02', ['input']],
  ['GLTF-Asset-Pipeline & Kompression', 'Draco/Meshopt-Kompression, KTX2-Texturen und ein Ladeskript mit Fortschrittsanzeige.', 2, '3d-welt', 1, 'Backlog', 'Mittel', 0, 6, '2026-12-18', ['assets', 'gltf']],
  ['Socket.IO-Server mit Raum-Verwaltung', 'Verbindungsaufbau, Räume pro Welt-Instanz, Join/Leave und Heartbeat.', 3, 'multiplayer', 1, 'Backlog', 'Kritisch', 10, 12, '2027-01-22', ['socket.io', 'server']],
  ['Client-Prediction & Server-Reconciliation', 'Eingaben puffern, lokal vorhersagen und mit autoritativem Serverstand abgleichen.', 3, 'multiplayer', 1, 'Backlog', 'Hoch', 0, 20, '2027-02-12', ['netcode']],
  ['Netzwerk-Protokoll in shared/ definieren', 'Event-Namen, Payload-Formate und Versionsnummer zentral für Client und Server.', 3, 'multiplayer', 2, 'Backlog', 'Mittel', 0, 6, '2027-01-15', ['protokoll']],
  ['Chunk-Streaming für große Karten', 'Welt in Chunks teilen, nach Spielerposition laden und entladen, Collider mitführen.', 4, '3d-welt', 1, 'Backlog', 'Hoch', 0, 24, '2027-04-09', ['streaming', 'performance']],
  ['Tag-Nacht-Zyklus & Beleuchtung', 'Sonnenstand, Himmelsfarbe, Schatten-Kaskaden und Lichtstimmung pro Tageszeit.', 4, '3d-welt', 2, 'Backlog', 'Niedrig', 0, 8, '2027-04-30', ['licht']],
  ['Inventar-Datenmodell & Slot-UI', 'Items, Stapelgrößen, Gewicht, Slots und ein Inventar-Overlay im HUD.', 5, 'inventar', 2, 'Backlog', 'Mittel', 0, 10, '2027-06-04', ['items', 'ui']],
  ['Crafting-Rezepte & Werkbank', 'Rezeptformat, Werkbank-Interaktion und Herstellungszeiten mit Fortschritt.', 5, 'crafting', 2, 'Backlog', 'Mittel', 0, 12, '2027-06-25', ['rezepte']],
  ['Quest-System mit Zielen & Belohnungen', 'Questdefinitionen, Zieltypen (sammeln, erreichen, besiegen) und Belohnungen.', 5, 'quests', 2, 'Backlog', 'Mittel', 0, 14, '2027-07-16', ['quests']],
  ['XP-Kurve & Levelaufstieg', 'Erfahrungsquellen, Levelkurve und Freischaltungen pro Stufe.', 5, 'levelsystem', 1, 'Backlog', 'Niedrig', 0, 6, '2027-07-30', ['balancing']],
  ['Basenbau: Grid-Platzierung & Snapping', 'Bauteile auf Raster platzieren, Snapping an Kanten, Vorschau und Kollisionsprüfung.', 5, 'basenbau', 1, 'Backlog', 'Hoch', 0, 16, '2027-08-20', ['bauen']],
  ['Biome & Points of Interest planen', 'Biome, Ressourcenverteilung und interessante Orte für die große Karte festlegen.', 6, 'game-design', 2, 'Backlog', 'Niedrig', 0, 8, '2027-10-01', ['welt', 'planung']],
];
const tasks = {};
taskDefs.forEach(([title, description, ph, area, dev, status, priority, progress, estimate_hours, due_date, tags], i) => {
  const n = String(i + 1).padStart(3, '0');
  tasks[`t-${n}`] = {
    key: `ECL-${n}`, title, description, phase: `phase-${ph}`, area, assignee: `dev-${dev}`,
    status, priority, progress, estimate_hours, due_date, tags,
    created_by_name: 'Startdaten', created_at: NOW, updated_at: NOW,
  };
});

// Fortschritt der Phasen und Bereiche aus den Aufgaben berechnen (gewichtet nach Aufwand).
const weighted = (list) => {
  if (!list.length) return 0;
  let w = 0, s = 0;
  for (const t of list) { const h = Math.max(1, +t.estimate_hours || 1); w += h; s += h * t.progress; }
  return Math.round(s / w);
};
for (const [id, p] of Object.entries(phases)) p.progress = weighted(Object.values(tasks).filter((t) => t.phase === id));
for (const [id, a] of Object.entries(areas)) a.progress = weighted(Object.values(tasks).filter((t) => t.area === id));

const techdocs = {
  'doc-html': { title: 'Einstiegsseite & Canvas-Container', category: 'Architektur', tech: 'HTML', description: 'Aufbau von client/index.html: Canvas, HUD-Layer, Ladebildschirm.', status: 'Aktuell', link: 'https://developer.mozilla.org/de/docs/Web/HTML', notes: 'Canvas füllt den Viewport, HUD liegt als DOM-Ebene darüber.' },
  'doc-css': { title: 'HUD- und Menü-Styles', category: 'Leitfaden', tech: 'CSS', description: 'Design-Tokens, HUD-Elemente und Menüs ohne Framework.', status: 'Entwurf', link: 'https://developer.mozilla.org/de/docs/Web/CSS', notes: '' },
  'doc-js': { title: 'Modulstruktur & ES2022', category: 'Leitfaden', tech: 'JavaScript', description: 'Wie Module geschnitten werden, Import-Regeln und Umgang mit shared/.', status: 'Aktuell', link: 'https://developer.mozilla.org/de/docs/Web/JavaScript', notes: 'Keine zirkulären Imports zwischen render/ und physics/.' },
  'doc-three': { title: 'Renderer-Setup & Szenengraph', category: 'Architektur', tech: 'Three.js', description: 'Renderer-Optionen, Kamera, Szenen-Hierarchie und Lade-Reihenfolge der Assets.', status: 'Aktuell', link: 'https://threejs.org/docs/', notes: 'Schatten zunächst nur für die Sonne.' },
  'doc-node': { title: 'Server-Architektur', category: 'Architektur', tech: 'Node.js', description: 'Prozessaufbau, Simulationsschleife des Servers und Konfiguration.', status: 'Entwurf', link: 'https://nodejs.org/docs/latest/api/', notes: '' },
  'doc-socket': { title: 'Event-Katalog & Tickrate', category: 'Referenz', tech: 'Socket.IO', description: 'Alle Netzwerk-Events mit Richtung, Payload und Frequenz.', status: 'Entwurf', link: 'https://socket.io/docs/v4/', notes: 'Server-Tick 20 Hz, Client-Eingaben 60 Hz gebündelt.' },
  'doc-rapier': { title: 'Physik-Schritt & Kollisionsgruppen', category: 'Referenz', tech: 'Rapier.js', description: 'Fester Zeitschritt, Kollisionsgruppen für Spieler, Fahrzeuge und Welt.', status: 'Aktuell', link: 'https://rapier.rs/docs/', notes: '' },
};

const fileDefs = [
  ['index.html', 'HTML', 'client/', 'Client', 'Einstieg mit Canvas und HUD-Layer'],
  ['main.js', 'JavaScript', 'client/src/', 'Client', 'Bootstrapping und Game-Loop'],
  ['scene.js', 'JavaScript', 'client/src/render/', 'Client', 'Renderer, Kamera und Szene'],
  ['world.js', 'JavaScript', 'client/src/physics/', 'Client', 'Rapier-Welt und fester Zeitschritt'],
  ['controls.js', 'JavaScript', 'client/src/input/', 'Client', 'Aktionsbasiertes Input-Mapping'],
  ['hud.css', 'CSS', 'client/styles/', 'Client', 'HUD- und Menü-Styles'],
  ['index.js', 'JavaScript', 'server/', 'Server', 'HTTP- und Socket.IO-Server'],
  ['rooms.js', 'JavaScript', 'server/', 'Server', 'Raum-Verwaltung pro Welt-Instanz'],
  ['simulation.js', 'JavaScript', 'server/', 'Server', 'Autoritative Serversimulation'],
  ['protocol.js', 'JavaScript', 'shared/', 'Shared', 'Event-Namen und Payload-Formate'],
  ['constants.js', 'JavaScript', 'shared/', 'Shared', 'Tickraten, Weltgrößen, Limits'],
  ['buggy.glb', '3D-Modell', 'assets/models/', 'Assets', 'Fahrzeug-Prototyp'],
  ['terrain_albedo.ktx2', 'Textur', 'assets/textures/', 'Assets', 'Terrain-Grundtextur'],
  ['GDD.md', 'Markdown', 'docs/', 'Docs', 'Game Design Document'],
  ['ARCHITECTURE.md', 'Markdown', 'docs/', 'Docs', 'Architektur und Konventionen'],
];
const files = {};
fileDefs.forEach(([name, type, path, category, description], i) => {
  files[`f-${String(i + 1).padStart(2, '0')}`] = { name, type, path, category, description, updated_by: 'Startdaten', updated_at: NOW };
});

const activity = {
  'a-seed': { actor: 'System', actor_id: '', action: 'angelegt', target_type: 'Projekt', target_title: 'ECLIPSE', detail: 'Startdaten: 6 Phasen, 12 Bereiche, 2 Entwickler, 22 Aufgaben', timestamp: NOW },
};

const all = { project, phases, developers, areas, tasks, techdocs, files, activity };
rmSync(join(here, 'data'), { recursive: true, force: true });
const writes = [];
for (const [coll, docs] of Object.entries(all)) {
  mkdirSync(join(here, 'data', coll), { recursive: true });
  for (const [id, doc] of Object.entries(docs)) {
    const p = join(here, 'data', coll, `${id}.json`);
    writeFileSync(p, JSON.stringify(doc, null, 2));
    writes.push({ op: 'set', collection: coll, doc_id: id, file_path: p });
  }
}
writeFileSync(join(here, 'startdaten.json'), JSON.stringify(all, null, 2));
writeFileSync(join(here, 'writes.json'), JSON.stringify(writes));
console.log('docs:', writes.length);
