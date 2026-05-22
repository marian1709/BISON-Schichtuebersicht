# BISON Schichtuebersicht

Kleine interne Web-App fuer eine datenschutzfreundliche 7-Tage-Uebersicht der Produktionsschichten aus Planday. Die App ist fuer TV/Kiosk-Anzeigen im Querformat optimiert und zeigt ausschliesslich konfigurierte Schichtgruppennamen an.

## Architektur

- Node.js/Express Backend liefert die statische TV-Oberflaeche und die interne JSON-API.
- Planday wird nur serverseitig abgefragt. Zugangsdaten werden ausschliesslich ueber Umgebungsvariablen geladen.
- Beim ersten Setup startet die App den Planday OAuth-Flow und speichert den Refresh Token lokal in `data/planday-token.json`.
- Das Backend reduziert die Rohdaten auf Datum, Schichtart, Teamname und Teamfarbe. Mitarbeiterdaten, Mitarbeiter-IDs und sonstige personenbezogene Felder werden nicht ans Frontend ausgeliefert.
- Die reduzierten Daten werden 5 Minuten im Arbeitsspeicher gecacht. Bei Planday-Fehlern bleibt der letzte erfolgreiche Stand sichtbar.
- Das Frontend ruft `/api/shifts` regelmaessig ab und rendert eine kontrastreiche 7-Tage-Ansicht.

## Projektstruktur

```text
.
├── src/
│   ├── public/
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── app.js
│   ├── services/
│   │   ├── plandayClient.js
│   │   ├── shiftCache.js
│   │   └── tokenStore.js
│   └── server.js
├── data/
│   └── planday-token.json  # wird beim Setup erzeugt, nicht committen
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

## Planday API

Die MVP-Version nutzt OAuth2. Den Refresh Token musst du nicht manuell beschaffen; er wird beim ersten Setup ueber den Authorization-Code-Flow geholt:

- Authorize-Endpunkt: `https://id.planday.com/connect/authorize`
- Token-Endpunkt: `https://id.planday.com/connect/token`
- API-Basis: `https://openapi.planday.com`
- Lesender Scheduling-Shifts-Endpunkt: standardmaessig `GET /scheduling/v1.0/shifts`

Planday-Dokumentation nennt fuer API-Requests die Header:

- `Authorization: Bearer <ACCESS_TOKEN>`
- `X-ClientId: <PLANDAY_CLIENT_ID>`

Der konkrete Schicht-Endpunkt kann je nach Planday-Freischaltung/Portal leicht abweichen. Deshalb sind `PLANDAY_SHIFTS_PATH` und `PLANDAY_SHIFTS_METHOD` konfigurierbar.

Der Reports-Endpunkt `/reports/v1.0/schedulingHistory` wird bewusst nicht als Standard verwendet, weil Planday dafuer `shift:update` verlangen kann. Die App soll im Normalbetrieb nur mit lesenden Scopes wie `shift:read` autorisiert werden.

## Benoetigte Konfigurationswerte

Aus Planday bzw. aus eurer Planday API-App benoetigst du:

- `PLANDAY_CLIENT_ID`: Application/Client ID der Planday API-App.
- `PLANDAY_CLIENT_SECRET`: falls fuer eure App erforderlich.
- `PLANDAY_REDIRECT_URI`: Callback-URL, die auch in der Planday API-App erlaubt sein muss, z. B. `http://localhost:3000/setup/planday/callback`.
- `PLANDAY_SCOPES`: benoetigte Scopes, mindestens `openid offline_access` plus die fuer Schichten/HR-Listen freigeschalteten Planday-Scopes.
- `SETUP_TOKEN`: frei gewaehltes langes Passwort fuer die Setup-Endpunkte.
- `PLANDAY_DEPARTMENT_IDS`: optional, falls nur bestimmte Departments abgefragt werden sollen.
- `PLANDAY_SHIFT_GROUPS`: Mapping der erlaubten Schichtgruppen-IDs auf die anzeigbaren Gruppennamen.
- `PLANDAY_PERIOD_RULES`: Mapping von Planday-Schichttyp-IDs auf `early`, `late` und `night`.
- `PLANDAY_TEAM_RULES`: serverseitige Team-Erkennung ueber Schichtfuehrer und Vertreter.

Wichtig: Im Frontend werden nur Teamname, Teamfarbe und Schichtart angezeigt. Employee-IDs aus `PLANDAY_TEAM_RULES` werden nur serverseitig zum Ableiten des Teams verarbeitet.

`PLANDAY_REFRESH_TOKEN` ist nur noch optional. Du kannst ihn setzen, wenn du bereits einen Token hast. Normalerweise erzeugt die App `data/planday-token.json` selbst.

## Erstes Planday Setup

1. `.env` aus `.env.example` erstellen und mindestens `PLANDAY_CLIENT_ID`, ggf. `PLANDAY_CLIENT_SECRET`, `PLANDAY_REDIRECT_URI`, `PLANDAY_SCOPES` und `SETUP_TOKEN` setzen.
2. App starten.
3. Im Browser diese URL oeffnen und `DEIN_SETUP_TOKEN` ersetzen:

```text
http://localhost:3000/setup/planday/authorize?token=DEIN_SETUP_TOKEN
```

4. Bei Planday anmelden und die App autorisieren.
5. Planday leitet zur Callback-URL zurueck. Danach liegt der Refresh Token lokal in `data/planday-token.json`.

Wenn du `PLANDAY_SCOPES` oder die App-Berechtigungen in Planday aenderst, loesche `data/planday-token.json` und fuehre diesen Setup-Flow erneut aus. Bereits erzeugte Refresh Tokens bekommen neue Scopes nicht automatisch.

Status pruefen:

```text
http://localhost:3000/setup/planday/status?token=DEIN_SETUP_TOKEN
```

## Department- und Schichtgruppen-IDs finden

Nach erfolgreicher Planday-Autorisierung kannst du die IDs einmalig ueber geschuetzte Setup-Endpunkte ausgeben lassen:

```text
http://localhost:3000/setup/planday/departments?token=DEIN_SETUP_TOKEN
http://localhost:3000/setup/planday/shift-groups?token=DEIN_SETUP_TOKEN
```

Die Ausgabe enthaelt nur `id` und `name`. Trage die benoetigten Werte danach in `.env` ein:

```env
PLANDAY_DEPARTMENT_IDS=12,34
PLANDAY_SHIFT_GROUPS=101:Gruppe A;102:Gruppe B;103:Gruppe C;104:Gruppe D
```

Wenn Planday ueber `GET /scheduling/v1.0/shifts` Einzel-Schichten liefert, legt `PLANDAY_PERIOD_RULES` fest, welche `shiftTypeIds` Frueh-, Spaet- und Nachtschicht sind:

```env
PLANDAY_PERIOD_RULES=[{"period":"early","shiftTypeIds":[205105]},{"period":"late","shiftTypeIds":[205106]},{"period":"night","shiftTypeIds":[205107]}]
```

`PLANDAY_TEAM_RULES` erkennt pro Tag und Schichtart zuerst die Schichtfuehrer. Nur wenn keiner davon in der Schicht anwesend ist, werden die Vertreter genutzt:

```env
PLANDAY_TEAM_RULES=[{"team":"Team A","color":"#FA7E01","leaderEmployeeIds":[1001],"substituteEmployeeIds":[2001]}]
```

Unterstuetzte Perioden sind `early`, `late` und `night`. Als Fallback koennen Regeln weiterhin `categoryIds`, `employeeGroupIds` oder `departmentIds` enthalten.

Falls einer der ID-Endpunkte mit 404/403 fehlschlaegt, pruefe in Planday die freigeschalteten API-Scopes und passe bei Bedarf diese Pfade in `.env` an:

```env
PLANDAY_DEPARTMENTS_PATH=/hr/v1/Departments
PLANDAY_SHIFT_GROUPS_PATH=/hr/v1/EmployeeGroups
```

## Lokaler Start

```bash
npm install
cp .env.example .env
npm run dev
```

Dann `.env` ausfuellen, das Planday Setup ausfuehren und die Anzeige unter `http://localhost:3000` oeffnen.

Fuer Produktionsbetrieb lokal:

```bash
npm start
```

## Docker Start

```bash
cp .env.example .env
docker compose up --build -d
```

Die App ist danach unter `http://localhost:3000` erreichbar, sofern `PORT=3000` gesetzt ist.

Der Refresh Token wird bei Docker in `./data` auf dem Host gespeichert, weil `docker-compose.yml` dieses Verzeichnis als Volume einbindet.

## Healthcheck

Der Healthcheck-Endpunkt liegt unter:

```text
GET /health
```

Er liefert nur technische Cache-/Statusdaten und keine Planday-Rohdaten.

## Datenschutzverhalten

- Keine Mitarbeiternamen im Frontend.
- Keine Mitarbeiter-IDs im Frontend.
- Keine personenbezogenen Rohdaten auf Platte. Gespeichert wird nur der technische OAuth Refresh Token.
- Keine Planday-Rohdaten in Logs.
- Logs enthalten nur technische Fehlermeldungen wie HTTP-Statuscodes.
- Frontend erhaelt nur `date`, `weekday`, `label`, `groupName`, `color` und `periodLabel`.

## Fehlerverhalten

Wenn Planday nicht erreichbar ist oder ein API-Fehler auftritt:

- Die App zeigt weiter die zuletzt erfolgreich geladenen Daten.
- Im Frontend erscheint ein dezenter Warnhinweis.
- Das Backend versucht beim naechsten Intervall automatisch erneut zu aktualisieren.
- Einzelne fehlende Schichtfelder werden toleriert; unvollstaendige Eintraege werden uebersprungen oder ohne Uhrzeit angezeigt.

## Raspberry Pi/Kiosk

Die reine Display-Ansicht ist ohne Login erreichbar. Betreibe die App deshalb idealerweise nur im internen Netzwerk oder hinter einem Reverse Proxy/VPN. Beispiel fuer Chromium im Kiosk-Modus:

```bash
chromium-browser --kiosk http://SERVER-IP:3000
```

## Naechste sinnvolle Erweiterungen

- Admin-/Debug-Endpunkte mit einfachem Zugriffsschutz.
- Mehrere Display-Profile, falls unterschiedliche Standorte/Departments eigene Ansichten benoetigen.
- Expliziter Einrichtungs-Assistent fuer den Planday Authorization-Code-Flow.
