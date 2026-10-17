# 🎵 RedTune – TeamSpeak 6 & 3 YouTube Music Bot

Ein komplett **von Grund auf selbst programmierter** TeamSpeak-Musikbot in TypeScript / Node.js, der das moderne TeamSpeak 6 sowie TeamSpeak 3 Sprachprotokoll nativ unterstützt und über ein integriertes Echtzeit-Web-Dashboard gesteuert werden kann.

---

## 💡 Warum diese Eigenentwicklung?

- **Keine Legacy-Tools von Drittanbietern:** Verwendet nicht TS3AudioBot oder SinusBot, sondern basiert auf sauberem, transparentem TypeScript-Quellcode.
- **TeamSpeak 6 & 3 Kompatibilität:** Basiert auf der modernen `@honeybbq/teamspeak` Clean-Room Client-Implementierung und dem nativen Opus-Sprachprotokoll (Codec Opus Music).
- **YouTube Music & YouTube Support:** Unterstützt direkte Links von `music.youtube.com`, reguläre YouTube-Videos, Playlists und freie Titelsuche per Name.
- **Echtzeit-Web-Dashboard:** Integrierte Weboberfläche im modernen Dark-Mode mit Live-Fortschrittsbalken, WebSocket-Synchronisation, Warteschlangen-Verwaltung und Lautstärkeregler.
- **Persistente Identität:** Generiert beim ersten Start eine eigene TeamSpeak-Identität (`data/identity.txt`) und behält diese dauerhaft bei (gleiche UID, Rollen und Rechte).

---

## 📁 Projektstruktur

```
├── src/
│   ├── index.ts              # Haupteinstiegspunkt & Lifecycle-Management
│   ├── config.ts             # Typensicherer Konfigurations-Lader
│   ├── audio/
│   │   ├── player.ts         # Audio-Engine (yt-dlp -> ffmpeg -> PCM -> Opus -> TS6 Voice)
│   │   ├── queue.ts          # Warteschlange, Historie, Shuffle & Loop-Modi
│   │   └── resolver.ts       # YouTube Music & Metadaten-Resolver
│   ├── bot/
│   │   ├── client.ts         # TeamSpeak Client-Verbindung & Event-Handling
│   │   └── commands.ts       # Chat-Befehlsinterpreter (!play, !volume, etc.)
│   └── web/
│       ├── server.ts         # Express & WebSocket-Server (Port 58913)
│       └── public/           # Modernes Frontend (HTML, CSS, JS)
├── data/
│   └── config.json           # Deine Server- & Bot-Einstellungen
├── Dockerfile                # Node 22 + ffmpeg + yt-dlp Container
├── docker-compose.yml        # Docker-Verwaltung
├── setup.sh                  # Interaktives Setup-Skript für Linux vServer
└── update-ytdlp.sh           # Aktualisiert yt-dlp im laufenden Container
```

---

## 🚀 Installation auf dem Linux vServer

### 1. Ordner auf den vServer kopieren
Übertrage diesen Ordner von deinem PC auf deinen vServer:
```bash
scp -r "/home/bas_pit/Dokumente/Teamspeak Bot" user@DEINE_VSERVER_IP:/home/user/teamspeak-bot
```

### 2. Setup auf dem vServer starten
Verbinde dich per SSH und führe das Setup-Skript aus:
```bash
cd teamspeak-bot
./setup.sh
```

Das Skript:
1. Prüft Docker & Docker Compose (und installiert es bei Bedarf automatisch).
2. Fragt nach deiner **TeamSpeak Server-Adresse** (z. B. `ts.deinedomain.de:9987` oder `123.45.67.89:9987`).
3. Fragt nach dem optionalen Server-Passwort und Bot-Namen.
4. Baut den Docker-Container und startet den Bot automatisch im Hintergrund.

---

## 🌐 Web-Dashboard im Browser

Der Bot verfügt über ein eigenes, interaktives Web-Dashboard:
👉 **`http://<Deine-vServer-IP>:58913`**

Dort kannst du:
- Songtitel oder YouTube Music Links direkt in die Suchleiste eingeben und abspielen.
- Die Wiedergabe pausieren, fortsetzen oder überspringen.
- Die Lautstärke per Schieberegler in Echtzeit anpassen.
- Die Warteschlange einsehen, mischen oder einzelne Tracks entfernen.

---

## 💬 Chat-Befehle im TeamSpeak

Du kannst den Bot auch jederzeit direkt im TeamSpeak-Channel oder per privater Nachricht steuern:

| Befehl | Funktion | Beispiel |
| :--- | :--- | :--- |
| `!play <Titel/Link>` | Spielt einen Song oder eine Playlist ab | `!play https://music.youtube.com/watch?v=...` |
| `!play <Suchbegriff>` | Sucht automatisch auf YouTube Music | `!play Daft Punk One More Time` |
| `!pause` / `!resume` | Pausiert die Wiedergabe oder setzt sie fort | `!pause` |
| `!skip` oder `!next` | Springt zum nächsten Song in der Queue | `!skip` |
| `!prev` | Geht zum vorherigen Song zurück | `!prev` |
| `!volume <0-100>` | Passt die Lautstärke an | `!volume 35` |
| `!queue` | Zeigt die aktuelle Warteschlange an | `!queue` |
| `!np` | Zeigt Infos zum aktuell laufenden Song | `!np` |
| `!shuffle` | Mischt die Warteschlange zufällig | `!shuffle` |
| `!loop <track/queue/off>` | Wiederholt aktuellen Track oder Liste | `!loop track` |
| `!stop` | Stoppt die Musik und leert die Queue | `!stop` |
| `!help` | Zeigt alle verfügbaren Befehle an | `!help` |

---

## 🛠 Verwaltung auf dem vServer

- **Live-Logs ansehen:**
  ```bash
  docker compose logs -f
  ```
- **Bot neu starten:**
  ```bash
  docker compose restart
  ```
- **Bot stoppen:**
  ```bash
  docker compose down
  ```
- **YouTube-Downloader aktualisieren:**
  ```bash
  ./update-ytdlp.sh
  ```
