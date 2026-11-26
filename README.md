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
| Admins | Namen und Admin-Code in Dashboard → Spielsteuerung → Welt & Regeln |

Lokal starten: `npm install && npm run dev:game`

### Steuerung
WASD laufen/fahren · Maus umsehen · Leertaste springen (im Auto Handbremse) · Shift sprinten · **E interagieren**
(ein-/aussteigen, Türen, Truhen, Schatz, füttern) · Linksklick angreifen/sammeln/bauen · Tab Inventar · F reiten ·
X abreißen · R Bauteil drehen / Auto aufstellen · M Inselkarte · H Hilfe · P Admin-Menü. Auf Tablets gibt es Touch-Knöpfe.

### Basenbau
Fundament (mit Steinsockel am Hang), Wand, Türwand, Fensterwand, Decke, Schrägdach, Treppe (8 Stufen, 3 m hoch),
Zaun, Lagerfeuer, Schlafsack und **Lagertruhe** (16 Plätze, nur Besitzer und Admins, Inhalt auf dem Server gespeichert;
volle Truhen lassen sich nicht abreißen). R dreht Bauteile. Admins können im Admin-Menü „Kostenlos bauen“ einschalten.

### Fahrzeuge
34 Fahrzeuge in 9 Typen: Geländewagen, Sportwagen, Rennwagen, Buggy, Pickup, Monstertruck, **Schulbus** (10 Mitfahrer),
Quad und Truck – über ein Dutzend am Startplatz, 5 an der Rennstrecke, der Rest auf der Insel verteilt.
**Mitfahren:** E an einem Fahrzeug mit Fahrer belegt einen freien Platz (Pickup 5, Bus 10, die meisten anderen 1).
**Boost:** Shift im Fahrzeug (auf Tablets: Joystick ganz nach vorn). Bei Nacht und Sturm haben Fahrzeuge Scheinwerfer.
Neue Inhalte werden in bestehende Welten automatisch nachgetragen (`content_version` in `game_settings/main`),
ohne Änderungen aus dem Dashboard zu überschreiben.

### Admin-Menü im Spiel (P)
Fliegen, unverwundbar, kostenlos bauen, Wetter und Tageszeit, Startplatz setzen, Events starten/beenden,
Fahrzeug (auch nach Typ) herholen, alle Fahrzeuge zurücksetzen, alle Spieler herholen, alle einfrieren/auftauen
(auch wer später beitritt), alle heilen, Kreaturen erschaffen/entfernen/neu verteilen, Gegenstände geben,
Spieler teleportieren/herholen/heilen/entfernen, Ansagen, PvP. Auf der Inselkarte (M) teleportiert ein Klick dorthin.

### Aktivitäten
- **Hindernisparcours** am Startplatz (grüner Start, goldenes Ziel; Boden berühren = von vorn), Bestzeiten in `game_records/parcours`
- **Rennstrecke** mit 10 Toren rund um den Startplatz (nur im Fahrzeug), Bestzeiten in `game_records/rennen`
- **18 Truhen** in Ruinen, an Wachtürmen und in Verstecken; jede Truhe füllt sich nach 30 Minuten wieder
- **Events** (Dashboard → Spielsteuerung → Events): Schatzsuche, Team-Sammeln, Bauprojekt, Kreaturen-Wettbewerb,
  doppelte EP; Fortschritt und Zeit sieht jeder im Spiel, Ergebnisse landen in `game_events`

### Dashboard-Schutz
Die Spielsteuerung ist mit einem **Dashboard-Passwort** geschützt (beim ersten Öffnen festlegen; gespeichert als
gesalzener SHA-256-Hash in der Tabelle `meta`). Ohne Passwort sind Spielstände, Live-Status, Befehle und der
Admin-Code nicht lesbar, und alle `game_*`-Daten sind nicht änderbar. Die Projektplanung bleibt frei bearbeitbar.
Passwort vergessen: Zeile `dash_key` in der D1-Tabelle `meta` im Cloudflare-Dashboard löschen, dann neu festlegen.

### Welt & Regeln (Dashboard)
Wetter (Klar/Nebel/Regen/Sturm), Tageszeit (Finsternis/Morgen/Tag/Abend/Nacht/Zyklus), Zykluslänge, Spawnpunkt,
erlaubte Spielerfarben, automatische Schatzsuche, Multiplikatoren, PvP, Admins und Admin-Code.

### Tests
`node scripts/smoke.mjs <spiel-url> <dashboard-url>` prüft Seiten, Datenbank, Beitreten, Positionen, Kreaturen,
Fahrzeugfarben und doppelte Sitzungen. Läuft nach jedem Deploy automatisch in GitHub Actions.

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
