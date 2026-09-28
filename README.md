# HandyBridge

Kleine PWA, um Text und Dateien zwischen Handy und Laptop hin- und herzuschicken — ohne eigenen
Server. Beide Geräte melden sich mit demselben Google-Konto an, die App legt einen Ordner
`HandyBridge-Inbox` in deinem Drive an, und jede gesendete Nachricht/Datei landet dort als eigene
Datei. Kein Read-Modify-Write auf einer gemeinsamen Datei → keine Konflikte, wenn beide Geräte
gleichzeitig senden.

## Setup (einmalig, ca. 10 Minuten)

### 1. Google Cloud Projekt + OAuth-Client-ID

1. https://console.cloud.google.com/ → neues Projekt anlegen (z.B. "HandyBridge").
2. **APIs & Services → Bibliothek** → "Google Drive API" suchen → **Aktivieren**.
3. **APIs & Services → OAuth-Zustimmungsbildschirm**:
   - User Type: **Extern** (External), Status bleibt "Testing" — dafür ist keine Google-Prüfung nötig.
   - App-Name: "HandyBridge", Support-E-Mail: deine E-Mail.
   - Scopes: nicht nötig manuell hinzuzufügen (die App fragt nur `drive.file` an — Dateien, die sie
     selbst erstellt; das ist ein "nicht-sensibler" Scope).
   - Unter **Testnutzer**: deine eigene Google-E-Mail-Adresse eintragen.
4. **APIs & Services → Anmeldedaten → + Anmeldedaten erstellen → OAuth-Client-ID**:
   - Typ: **Webanwendung**.
   - **Autorisierte JavaScript-Quellen** hinzufügen:
     - `http://localhost:5500` (oder welcher Port auch immer beim lokalen Testen benutzt wird)
     - `https://<dein-github-username>.github.io` (für den späteren Live-Betrieb)
   - Erstellen → die **Client-ID** kopieren (Format `....apps.googleusercontent.com`).

### 2. Client-ID eintragen

In [config.js](config.js) die Zeile ersetzen:

```js
const HANDYBRIDGE_CLIENT_ID = "PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com";
```

Das ist **keine geheime Zuganggsdaten** — OAuth-Client-IDs für Webanwendungen sind zur
Veröffentlichung im Frontend gedacht (Absicherung läuft über die autorisierten Quellen), sie
können also bedenkenlos mit ins Git-Repo.

### 3. Lokal testen

Kein Build-Schritt nötig, reines statisches HTML/JS. Einfach einen lokalen Webserver im
Projektordner starten (`file://` funktioniert NICHT, Google OAuth verlangt http/https), z.B.:

```
py -m http.server 5500
```

Dann `http://localhost:5500` öffnen, mit Google anmelden (Testnutzer-Account), Gerät wählen,
Nachricht senden — auf einem zweiten Tab/Gerät sollte sie innerhalb von ~6 Sekunden erscheinen.

### 4. Deploy (GitHub Pages)

1. Neues GitHub-Repo anlegen (kann privat sein — Pages funktioniert auch bei privaten Repos mit
   GitHub Pro/Team; bei einem kostenlosen privaten Repo ohne Pages-Freischaltung stattdessen ein
   öffentliches Repo nehmen, der Code enthält keine Geheimnisse).
2. Diesen Ordner-Inhalt pushen.
3. **Settings → Pages** → Source: `Deploy from branch`, Branch `main` / `/ (root)`.
4. Die resultierende URL (`https://<user>.github.io/<repo>/`) zu den autorisierten
   JavaScript-Quellen der OAuth-Client-ID hinzufügen (Schritt 1.4).
5. Auf dem Handy die URL öffnen → "Zum Home-Bildschirm hinzufügen" für App-artiges Verhalten.

## Architektur

- Reines Frontend (HTML/CSS/Vanilla-JS), keine Backend-Abhängigkeit → "immer online" durch
  statisches Hosting (GitHub Pages).
- Auth: Google Identity Services (`initTokenClient`), Scope `drive.file` — die App sieht nur
  Dateien, die sie selbst anlegt, nicht das restliche Drive.
- Sync: Polling alle 6s (nur wenn Tab sichtbar) + sofortiger Refresh bei Tab-Fokus. Kein Realtime/
  Push, aber für den Anwendungsfall (Text/Dateien gelegentlich rüberschicken) ausreichend.
- Löschen verschiebt Dateien in den Drive-Papierkorb (`trashed: true`), nicht endgültig löschen.
- Gelesen-Status ist rein lokal (`localStorage`), synct nicht zwischen Geräten.

## Bekannte Grenzen

- Safari/iOS: Silent-Token-Refresh kann durch strikte Cookie-Regeln gelegentlich fehlschlagen →
  dann einfach erneut auf "Anmelden" tippen.
- Kein Backend heißt: kein Server-seitiges "neue Nachricht"-Push, nur Polling.
- Sehr große Dateien (>~100 MB) sind über den simplen Multipart-Upload nicht getestet — für den
  Anwendungsfall (Fotos, Dokumente) aber unkritisch.
