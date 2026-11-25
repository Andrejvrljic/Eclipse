# ECLIPSE – Dev Platform

Gemeinsames Projekt-Dashboard für die Entwicklung des 3D-Open-World-Multiplayer-Spiels **ECLIPSE**.
Die Plattform ist das Planungswerkzeug, nicht das Spiel selbst.

**Live:** https://claude.ai/artifact/Svdgzg2oGynfg6nfsXS8to

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
