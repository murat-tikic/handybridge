# HandyBridge — CONTEXT.md

## Zweck
Kleine PWA, um Text und Dateien schnell zwischen Handy und Laptop hin- und herzuschicken, ohne
Messenger/E-Mail/USB-Kabel zu bemühen. Genutzt wird Murats eigenes Google Drive als Transport —
kein eigener Server, kein neues Konto nötig.

## Architektur
- Reines statisches Frontend: `index.html` + `style.css` + `app.js` + `config.js`, kein Build-Schritt.
- Auth: Google Identity Services (`google.accounts.oauth2.initTokenClient`), Scope
  `https://www.googleapis.com/auth/drive.file` (App sieht nur selbst erstellte Dateien).
- Datenmodell: **ein Drive-File pro Nachricht** im Ordner `HandyBridge-Inbox` (nicht eine
  gemeinsame JSON-Datei) — vermeidet Read-Modify-Write-Konflikte zwischen den Geräten.
  `appProperties` je Datei: `{app: "handybridge", kind: "text"|"file", from: "Handy"|"Laptop"}`.
- Sync: Polling alle 6s wenn Tab sichtbar + sofortiger Refresh bei Tab-Fokus/visibilitychange.
  Kein echtes Push (kein Backend vorhanden, das Drive-Webhooks empfangen könnte).
- Löschen = Drive-Papierkorb (`trashed: true`), nicht endgültig.
- Gelesen-Status liegt nur in `localStorage`, ist nicht geräteübergreifend synchronisiert.
- Service Worker (`sw.js`) cached nur die App-Shell fürs schnelle Laden, nicht die Drive-Daten.

## Run-Befehl
Lokal: `py -m http.server 5500` im Projektordner, dann `http://localhost:5500` (nicht `file://`,
OAuth verlangt http/https). Live: GitHub Pages, sobald deployt.

## Setup-Voraussetzung (einmalig, nicht automatisierbar durch Claude)
Google Cloud Projekt + OAuth-Client-ID + Testnutzer-Eintrag — Murat muss das selbst in der
Google Cloud Console anlegen (Schritt-für-Schritt in README.md). Ohne eingetragene Client-ID in
`config.js` zeigt die App nur eine Fehlermeldung.

## Datenfluss
Handy/Laptop → Google Identity Services (OAuth-Token) → Drive REST API v3 (`files.create` als
Multipart-Upload für neue Nachricht, `files.list` fürs Polling, `files.get?alt=media` zum
Herunterladen/Anzeigen, `files.update{trashed:true}` zum Löschen) → gemeinsamer Ordner
`HandyBridge-Inbox` im Drive des Nutzers.

## Offene Punkte (Stand 2026-09-28)
- OAuth-Client-ID noch nicht eingetragen (Platzhalter in `config.js`) — wartet auf Murat.
- Noch nicht auf GitHub gepusht/deployt (Außenwirkung-Regel: vor Deploy erst Murats Freigabe).
- Kein echtes Push/Realtime — falls das später stört, wäre eine Cloud-Function mit Drive-Push-
  Notifications die nächste Ausbaustufe (bräuchte dann doch einen minimalen Backend-Endpunkt).
- Icons sind ein simples generiertes "H"-Icon (PowerShell/System.Drawing), kein Designentwurf.
