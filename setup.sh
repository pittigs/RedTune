#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${GREEN}      RedTune – TeamSpeak 6 YouTube Music Setup     ${NC}"
echo -e "${BLUE}====================================================${NC}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Docker & Docker Compose prüfen
echo -e "${BLUE}[1/4] Überprüfe Systemvoraussetzungen...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker wurde nicht gefunden.${NC}"
    read -rp "Möchtest du Docker jetzt automatisch installieren? (j/N): " install_docker
    if [[ "$install_docker" =~ ^[jJyY]$ ]]; then
        echo -e "${BLUE}Installiere Docker...${NC}"
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker "$USER" || true
        echo -e "${GREEN}✔ Docker erfolgreich installiert!${NC}"
    else
        echo -e "${RED}Fehler: Docker wird für dieses Setup benötigt.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✔ Docker ist einsatzbereit.${NC}"
fi

if ! docker compose version &> /dev/null; then
    echo -e "${RED}Fehler: 'docker compose' (V2 Plugin) ist nicht verfügbar.${NC}"
    exit 1
fi

# 2. Konfiguration abfragen
echo -e "\n${BLUE}[2/4] Überprüfe Bot-Konfiguration...${NC}"
CONFIG_FILE="data/config.json"

if grep -q "DEINE_SERVER_IP_ODER_DOMAIN" "$CONFIG_FILE"; then
    echo -e "${YELLOW}Bitte gib die Verbindungsdaten für deinen TeamSpeak-Server ein:${NC}"
    read -rp "TeamSpeak Server-Adresse (IP oder Domain, z.B. ts.meinedomain.de:9987): " ts_address
    while [[ -z "$ts_address" ]]; do
        echo -e "${RED}Die Server-Adresse darf nicht leer sein!${NC}"
        read -rp "TeamSpeak Server-Adresse: " ts_address
    done

    read -rp "Server-Passwort (leer lassen, falls keines vorhanden): " ts_password
    read -rp "Bot-Name im TeamSpeak [RedTune]: " ts_name
    ts_name="${ts_name:-RedTune}"
    read -rp "Ziel-Channel (leer lassen für Standard-Eingang): " ts_channel

    # config.json anpassen
    sed -i "s|\"DEINE_SERVER_IP_ODER_DOMAIN\"|\"$ts_address\"|" "$CONFIG_FILE"
    if [[ -n "$ts_password" ]]; then
        sed -i "s|\"password\": \"\"|\"password\": \"$ts_password\"|" "$CONFIG_FILE"
    fi
    sed -i "s|\"nickname\": \"RedTune\"|\"nickname\": \"$ts_name\"|" "$CONFIG_FILE"
    if [[ -n "$ts_channel" ]]; then
        sed -i "s|\"channel\": \"\"|\"channel\": \"$ts_channel\"|" "$CONFIG_FILE"
    fi

    echo -e "${GREEN}✔ Server-Konfiguration in $CONFIG_FILE gespeichert.${NC}"
else
    echo -e "${GREEN}✔ Bestehende Konfiguration in $CONFIG_FILE erkannt.${NC}"
fi

# 3. Docker Container bauen und starten
echo -e "\n${BLUE}[3/4] Baue Custom Node.js/TypeScript Container...${NC}"
docker compose up -d --build

# 4. Status und Übersicht
echo -e "\n${BLUE}[4/4] Statusprüfung:${NC}"
sleep 3
docker compose ps

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}   TeamSpeak 6 YouTube Music Bot läuft erfolgreich! ${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "\n${BLUE}🌐 Web-Dashboard zur Steuerung im Browser:${NC}"
echo -e "  👉 ${YELLOW}http://<Deine-Server-IP>:58913${NC}"
echo -e "\n${BLUE}💬 Steuerung direkt im TeamSpeak-Chat:${NC}"
echo -e "  • ${YELLOW}!play <Link oder Titel>${NC} - YouTube Music Link oder Songname abspielen"
echo -e "  • ${YELLOW}!pause${NC} / ${YELLOW}!resume${NC}        - Wiedergabe pausieren / fortsetzen"
echo -e "  • ${YELLOW}!skip${NC}                 - Nächster Song in der Queue"
echo -e "  • ${YELLOW}!volume <0-100>${NC}        - Lautstärke einstellen (z.B. !volume 40)"
echo -e "  • ${YELLOW}!queue${NC}                - Warteschlange anzeigen"
echo -e "  • ${YELLOW}!stop${NC}                 - Musik anhalten und Liste leeren"
echo -e "\n${BLUE}🛠 Server-Befehle:${NC}"
echo -e "  • Live-Logs:   ${YELLOW}docker compose logs -f${NC}"
echo -e "  • Neustarten:  ${YELLOW}docker compose restart${NC}"
echo -e "  • Stoppen:     ${YELLOW}docker compose down${NC}"
echo -e "====================================================\n"
