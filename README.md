# ECLIPSE Arena – das Spiel 🎮

3D-Multiplayer-Shooter im Browser (Ordner `game/`): Accounts mit Passwort, Rangliste, Level/XP,
drei Waffen, Bots, Chat und mehrere Räume.

**Spiel-Link:** https://eclipse-game.dinnerboneagg.workers.dev (wird vom Workflow automatisch veröffentlicht)

| Teil | Technik |
| --- | --- |
| Grafik | Three.js (WebGL) im Browser, keine Installation nötig |
| Server / Multiplayer | Cloudflare Worker + **Durable Objects** (ein Objekt pro Raum, WebSockets, 20 Updates/s) |
| Datenbank | Cloudflare **D1** (`eclipse-game-db`): Accounts, Sitzungen, Statistik, Match-Verlauf |
| Veröffentlichung | GitHub Actions: `.github/workflows/deploy-game.yml` |

**Was du einrichten musst:** nichts Neues. Der Workflow nutzt dasselbe Secret `CLOUDFLARE_API_TOKEN` wie die
Dev-Plattform und legt die Datenbank `eclipse-game-db` beim ersten Lauf selbst an. Die Tabellen erstellt der
Worker beim ersten Aufruf.

- Modus: Jeder gegen jeden, 6 Minuten oder 25 Kills. Bots füllen Räume mit weniger als 4 Spielern auf.
- Der Server ist Schiedsrichter: Er prüft Bewegungen (kein Durch-die-Wand-Laufen) und berechnet jeden Treffer
  selbst, mit Lag-Ausgleich.
- Passwörter werden mit PBKDF2 (100 000 Runden, Salt) gespeichert; die Anmeldung läuft über ein HttpOnly-Cookie.
- Kostenloser Cloudflare-Plan reicht zum Spielen mit Freunden (grob 30 Spielerstunden pro Tag);
  für mehr: Workers Paid (5 $/Monat).

Lokal testen: `cd game && npm run dev` → http://localhost:8787

| Datei | Zweck |
| --- | --- |
| `game/src/index.js` | Worker: Registrierung, Login, Rangliste, Raumliste, WebSocket-Zugang |
| `game/src/room.js` | Spielraum (Durable Object): Spielschleife, Treffer, Bots, Statistik → D1 |
| `game/public/shared/` | Karte, Physik und Waffenwerte – gleich für Browser und Server |
| `game/public/js/game.js` | 3D-Welt, Steuerung, Waffen, Netzwerk |
| `game/public/js/main.js` | Menüs, Anmeldung, Einstellungen |

---

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
| `ADMIN_KEY` | für den KI-Assistenten | Admin-Passwort: Nur damit kann man im KI-Chat Änderungen machen |
| `ANTHROPIC_API_KEY` | für den KI-Assistenten | API-Schlüssel von console.anthropic.com (Claude) |

## KI-Assistent

Unten rechts auf der Cloudflare-Version: Der Admin meldet sich mit `ADMIN_KEY` an und gibt Anweisungen
in normaler Sprache („Setz ECL-009 auf Hoch und gib sie Entwickler 1“). Claude (Modell `claude-opus-5-5`)
liest und ändert die Daten über Werkzeuge im Worker (`worker/chat.js`); jede Änderung wird geprüft und im
Aktivitätslog vermerkt. Löschen nur nach ausdrücklicher Bestätigung im Chat.

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
