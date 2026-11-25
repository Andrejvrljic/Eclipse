# ECLIPSE

Dieses Repository enthält zwei Websites:

- **Dev Platform** (Projekt-Dashboard): https://eclipse.dinnerboneagg.workers.dev
- **Spiel** (spielbarer Prototyp): https://spiel.dinnerboneagg.workers.dev

## Spiel (`game/`)

Survival-Mehrspieler im Browser auf einer 1,2 × 1,2 km großen Insel: Rohstoffe sammeln, Werkzeuge und Waffen herstellen,
Basen bauen, Kreaturen jagen, zähmen und reiten, Fahrzeuge (Geländewagen, Quad, Truck) gemeinsam nutzen, Quests und Level.

| Teil | Technik |
| --- | --- |
| Rendering | Three.js (`game/src/world.js`, `models.js`) |
| Physik | Rapier.js: Charakter-Controller, Abrollen, Raycast-Fahrzeuge, Höhenfeld |
| Spielserver | Cloudflare Durable Object (`game/server/room.js`): Kreaturen-KI, Fahrzeuge, Bauwerke, Spielstände |
| Steuerung aus dem Dashboard | gemeinsame D1-Datenbank: `game_*`-Sammlungen, Befehle über `game_commands` |
| Admins | Namen und Admin-Code in den Spielregeln (Dashboard → Spielsteuerung → Regeln) |

Lokal starten: `npm install && npm run dev:game`

# ECLIPSE – Dev Platform

Gemeinsames Projekt-Dashboard für die Entwicklung des 3D-Open-World-Multiplayer-Spiels **ECLIPSE**.
Die Plattform ist das Planungswerkzeug, nicht das Spiel selbst.

**Live (claude.ai):** https://claude.ai/artifact/Svdgzg2oGynfg6nfsXS8to
**Live (Cloudflare):** https://eclipse.dinnerboneagg.workers.dev (Subdomain wird vom Workflow automatisch angelegt) – wird per GitHub Actions veröffentlicht

> Die beiden Versionen haben **getrennte Datenbanken**. Entscheidet euch für eine als Hauptversion.

## Veröffentlichung über GitHub Actions (Cloudflare)

`.github/workflows/deploy.yml` baut die Seite (`scripts/build.mjs` → `public/index.html`), legt bei Bedarf
die D1-Datenbank `eclipse-db` an und veröffentlicht den Worker (`worker/index.js`). Beim ersten Aufruf
legt der Worker die Startdaten einmalig an.

Repository-Secrets (Settings → Secrets and variables → Actions):

| Secret | Pflicht | Inhalt |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | ja | API-Token mit *Workers Scripts: Edit*, *D1: Edit*, *Account Settings: Read* |
| `CLOUDFLARE_ACCOUNT_ID` | nur bei mehreren Konten | Cloudflare-Account-ID |
| `TEAM_KEY` | – | Wird nicht mehr verwendet: Die Seite ist ohne Passwort erreichbar |


Lokal testen: `node scripts/build.mjs && npx wrangler dev`

## Inhalt

| Datei | Zweck |
| --- | --- |
| `eclipse-platform.html` | Die komplette Plattform (eine Seite, Vanilla JS, keine Abhängigkeiten außer Google Fonts) |
| `seed/build-seed.mjs` | Erzeugt die einmaligen Startdaten (`node seed/build-seed.mjs`) |
| `seed/startdaten.json` | Alle Startdaten in einer Datei |
| `seed/data/<collection>/<id>.json` | Startdaten als einzelne Dokumente |

## Seiten

Dashboard · Phasen · Aufgaben (Kanban + Liste) · Bereiche (+ Detailseiten) · Team · Technik · Aktivität

## Datenmodell (Collections)

`project`, `phases`, `tasks`, `developers`, `areas`, `techdocs`, `files`, `activity`

- Fortschritt von Projekt, Phasen und Bereichen wird immer aus den Aufgaben berechnet
  (gewichtet nach geschätzten Stunden). Die gespeicherten `progress`-Felder von Phasen
  und Bereichen werden bei jeder Aufgabenänderung nachgeführt.
- Jede Änderung schreibt einen Eintrag in `activity`.
- Änderungen werden sofort angezeigt (optimistisch) und bei einem Speicherfehler zurückgenommen.

## Zugriff

Die Daten liegen in der gemeinsamen Datenbank des veröffentlichten Artifacts. Beide Entwickler
brauchen Zugriff auf dieselbe URL mit mindestens der Rolle **Mitwirkender (Contributor)**;
Betrachter können nur lesen. Wer gerade arbeitet („Entwickler 1“ / „Entwickler 2“), wird pro
Browser gewählt und als Autor im Aktivitätslog verwendet.
