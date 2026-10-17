#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Aktualisiere yt-dlp im Docker-Container...${NC}"
docker compose exec ts6-musicbot yt-dlp -U
echo -e "${GREEN}✔ yt-dlp erfolgreich aktualisiert!${NC}"
