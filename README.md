# BISON Schichtuebersicht

Kleine interne Web-App fuer eine datenschutzfreundliche 7-Tage-Uebersicht der Produktionsschichten aus Planday. Die App ist fuer TV/Kiosk-Anzeigen im Querformat optimiert und zeigt ausschliesslich konfigurierte Teamnamen an.

## Architektur

- Node.js/Express Backend liefert die statische TV-Oberflaeche und die interne JSON-API.
- Planday wird nur serverseitig abgefragt. Zugangsdaten werden ausschliesslich ueber Umgebungsvariablen geladen.
- Die Adminoberflaeche unter `/admin` verwaltet Planday-Verbindung, Department, Teams, Farben, Fuehrung und Stellvertretung.
- Beim ersten Setup startet die Adminoberflaeche den Planday OAuth-Flow und speichert den Refresh Token lokal in `data/planday-token.json`.
- Das Backend reduziert die Rohdaten auf Datum, Schichtart, Teamname und Teamfarbe. Mitarbeiterdaten, Mitarbeiter-IDs und sonstige personenbezogene Felder werden nicht ans Frontend ausgeliefert.
- Die bearbeitbare Konfiguration liegt persistent in `data/app-config.json`; `.env` enthaelt nur Zugangsdaten.
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
│   │   ├── adminAuth.js
│   │   ├── configStore.js
│   │   ├── plandayClient.js
│   │   ├── shiftCache.js
│   │   └── tokenStore.js
│   ├── routes/
│   │   ├── adminRoutes.js
│   │   └── publicRoutes.js
│   ├── app.js
│   └── server.js
├── data/
│   ├── app-config.json     # wird durch die Adminoberflaeche verwaltet
│   └── planday-token.json  # wird beim Setup erzeugt
├── config/
│   └── schedule.json       # optionale einmalige Migrationsquelle
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

Die App verwendet ausschliesslich lesende Scopes: `shift:read`, `employee:read` und `department:read`.

## Benoetigte Konfigurationswerte

Aus Planday bzw. aus eurer Planday API-App benoetigst du:

- `PLANDAY_CLIENT_ID`: Application/Client ID der Planday API-App.
- `PLANDAY_CLIENT_SECRET`: falls fuer eure App erforderlich.
- `PLANDAY_REDIRECT_URI`: Callback-URL, die auch in der Planday API-App erlaubt sein muss, z. B. `http://localhost:3000/setup/planday/callback`.
- `ADMIN_PASSWORD`: frei gewaehltes langes Passwort fuer die Adminoberflaeche.

Im oeffentlichen Frontend werden weiterhin nur Teamname, Teamfarbe und Schichtart angezeigt. Accountnamen und Employee-IDs sind ausschliesslich im passwortgeschuetzten Adminbereich sichtbar.

`PLANDAY_REFRESH_TOKEN` ist nur noch optional. Du kannst ihn setzen, wenn du bereits einen Token hast. Normalerweise erzeugt die App `data/planday-token.json` selbst.

## Erstes Setup

1. `.env` aus `.env.example` erstellen und `ADMIN_PASSWORD`, `PLANDAY_CLIENT_ID`, ggf. `PLANDAY_CLIENT_SECRET` sowie `PLANDAY_REDIRECT_URI` setzen.
2. In der Planday API-App die Scopes `openid offline_access shift:read employee:read department:read` freischalten.
3. App starten und `http://localhost:3000/admin` oeffnen.
4. Mit `ADMIN_PASSWORD` anmelden und „Mit Planday verbinden“ waehlen.
5. Department und Teams konfigurieren; pro Team genau einen fuehrenden und einen stellvertretenden Account auswaehlen.

Wenn die Planday-Scopes geaendert wurden, muss Planday in der Adminoberflaeche neu verbunden werden. Bestehende Refresh Tokens erhalten neue Scopes nicht automatisch.

## Schichtplan konfigurieren

Die Adminoberflaeche speichert die fachliche Konfiguration atomar in `data/app-config.json`:

```json
{
  "version": 2,
  "departmentId": "21985",
  "teams": [
    {
      "id": "team-alex",
      "name": "Team Alex",
      "color": "#FA7E01",
      "leaderEmployeeId": "1001",
      "substituteEmployeeId": "2001"
    }
  ]
}
```

Die App ordnet Schichten anhand ihrer Startzeit zu: 04:00–11:59 Uhr ist Fruehschicht, 12:00–19:59 Uhr Spaetschicht, der Rest Nachtschicht. Treffen Personen mehrerer Teams in derselben Schicht aufeinander, gewinnt das Team mit den meisten anwesenden konfigurierten Schichtfuehrern/Vertretern; bei Gleichstand ein Team mit Schichtfuehrer.

Eine vorhandene `config/schedule.json` im alten Format wird beim ersten Start automatisch uebernommen. Danach ist `data/app-config.json` die fuehrende Datei.

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

Refresh Token und Admin-Konfiguration werden bei Docker in `./data` auf dem Host gespeichert. Sichere dieses Verzeichnis regelmaessig.

Bei Betrieb direkt per HTTP im internen Netz, z. B. `http://192.168.x.x:3020`, liefert die App keine automatische HTTPS-Aufwertung fuer statische Assets aus. Wenn die App spaeter ueber das Internet oder ein weniger vertrauenswuerdiges Netz erreichbar ist, sollte HTTPS vor die App gesetzt werden, z. B. per Reverse Proxy.

## Healthcheck

Der Healthcheck-Endpunkt liegt unter:

```text
GET /health
```

Er liefert nur technische Cache-/Statusdaten und keine Planday-Rohdaten.

## Datenschutzverhalten

- Keine Mitarbeiternamen oder Mitarbeiter-IDs in der oeffentlichen Kioskansicht.
- Accountnamen werden nur nach Adminanmeldung aus Planday geladen und nicht in der Konfigurationsdatei gespeichert.
- Auf Platte liegen nur technische Employee-IDs fuer die Zuordnung und der OAuth Refresh Token.
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
