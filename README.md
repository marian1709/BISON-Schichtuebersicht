# BISON Schichtuebersicht

Kleine interne Web-App fuer eine datenschutzfreundliche 7-Tage-Uebersicht der Produktionsschichten aus Planday. Die App ist fuer TV/Kiosk-Anzeigen im Querformat optimiert und zeigt ausschliesslich konfigurierte Teamnamen an.

## Architektur

- Node.js/Express Backend liefert die statische TV-Oberflaeche und die interne JSON-API.
- Planday wird nur serverseitig abgefragt. Zugangsdaten werden ausschliesslich ueber Umgebungsvariablen geladen.
- Beim ersten Setup startet die App den Planday OAuth-Flow und speichert den Refresh Token lokal in `data/planday-token.json`.
- Das Backend reduziert die Rohdaten auf Datum, Schichtart, Teamname und Teamfarbe. Mitarbeiterdaten, Mitarbeiter-IDs und sonstige personenbezogene Felder werden nicht ans Frontend ausgeliefert.
- Teams und Department werden uebersichtlich in `config/schedule.json` gepflegt; `.env` enthaelt nur Zugangsdaten.
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
├── config/
│   └── schedule.json       # Teams, Farben und Department
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

Der Reports-Endpunkt `/reports/v1.0/schedulingHistory` wird bewusst nicht als Standard verwendet, weil Planday dafuer `shift:update` verlangen kann. Die App soll im Normalbetrieb nur mit lesenden Scopes wie `shift:read` autorisiert werden.

## Benoetigte Konfigurationswerte

Aus Planday bzw. aus eurer Planday API-App benoetigst du:

- `PLANDAY_CLIENT_ID`: Application/Client ID der Planday API-App.
- `PLANDAY_CLIENT_SECRET`: falls fuer eure App erforderlich.
- `PLANDAY_REDIRECT_URI`: Callback-URL, die auch in der Planday API-App erlaubt sein muss, z. B. `http://localhost:3000/setup/planday/callback`.
- `SETUP_TOKEN`: frei gewaehltes langes Passwort fuer die Setup-Endpunkte.

Die Team- und Department-Konfiguration steht separat in `config/schedule.json`. Im Frontend werden nur Teamname, Teamfarbe und Schichtart angezeigt. Employee-IDs werden nur serverseitig zum Ableiten des Teams verarbeitet.

`PLANDAY_REFRESH_TOKEN` ist nur noch optional. Du kannst ihn setzen, wenn du bereits einen Token hast. Normalerweise erzeugt die App `data/planday-token.json` selbst.

## Erstes Planday Setup

1. `.env` aus `.env.example` und `config/schedule.json` aus `config/schedule.example.json` erstellen. In `.env` mindestens `PLANDAY_CLIENT_ID`, ggf. `PLANDAY_CLIENT_SECRET`, `PLANDAY_REDIRECT_URI` und `SETUP_TOKEN` setzen.
2. App starten.
3. Im Browser diese URL oeffnen und `DEIN_SETUP_TOKEN` ersetzen:

```text
http://localhost:3000/setup/planday/authorize?token=DEIN_SETUP_TOKEN
```

4. Bei Planday anmelden und die App autorisieren.
5. Planday leitet zur Callback-URL zurueck. Danach liegt der Refresh Token lokal in `data/planday-token.json`.

Wenn du die App-Berechtigungen in Planday aenderst, loesche `data/planday-token.json` und fuehre diesen Setup-Flow erneut aus. Bereits erzeugte Refresh Tokens bekommen neue Scopes nicht automatisch.

Status pruefen:

```text
http://localhost:3000/setup/planday/status?token=DEIN_SETUP_TOKEN
```

## Schichtplan konfigurieren

Die komplette fachliche Konfiguration steht in `config/schedule.json`:

```json
{
  "departmentIds": [21985],
  "teams": [
    {
      "name": "Team Alex",
      "color": "#FA7E01",
      "leaders": [1001],
      "substitutes": [2001]
    }
  ]
}
```

Die App ordnet Schichten anhand ihrer Startzeit zu: 04:00–11:59 Uhr ist Fruehschicht, 12:00–19:59 Uhr Spaetschicht, der Rest Nachtschicht. Treffen Personen mehrerer Teams in derselben Schicht aufeinander, gewinnt das Team mit den meisten anwesenden konfigurierten Schichtfuehrern/Vertretern; bei Gleichstand ein Team mit Schichtfuehrer.

Die Department-IDs lassen sich nach erfolgreicher Autorisierung einmalig ueber den geschuetzten Setup-Endpunkt anzeigen:

```text
http://localhost:3000/setup/planday/departments?token=DEIN_SETUP_TOKEN
```

## Lokaler Start

```bash
npm install
cp .env.example .env
cp config/schedule.example.json config/schedule.json
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
cp config/schedule.example.json config/schedule.json
docker compose up --build -d
```

Die App ist danach unter `http://localhost:3000` erreichbar, sofern `PORT=3000` gesetzt ist.

Der Refresh Token wird bei Docker in `./data` auf dem Host gespeichert, weil `docker-compose.yml` dieses Verzeichnis als Volume einbindet.

Bei Betrieb direkt per HTTP im internen Netz, z. B. `http://192.168.x.x:3020`, liefert die App keine automatische HTTPS-Aufwertung fuer statische Assets aus. Wenn die App spaeter ueber das Internet oder ein weniger vertrauenswuerdiges Netz erreichbar ist, sollte HTTPS vor die App gesetzt werden, z. B. per Reverse Proxy.

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
