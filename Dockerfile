FROM node:22-bookworm-slim

# ffmpeg, python3 (für yt-dlp), ca-certificates und curl installieren
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Neuestes yt-dlp für YouTube Music & YouTube herunterladen (Nightly Build für neueste YouTube-Fixes)
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

# EJS Challenge Solver vorab herunterladen und cachen
RUN /usr/local/bin/yt-dlp --remote-components ejs:github --js-runtimes node -f "ba/b" --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" || true

WORKDIR /app

# Abhängigkeiten kopieren und installieren
COPY package*.json tsconfig.json ./
RUN npm install

# Source Code kopieren und kompilieren
COPY src/ ./src/
RUN npm run build

# Web-Assets in den Build-Ordner kopieren
RUN mkdir -p dist/web/public && cp -r src/web/public/* dist/web/public/

# Volume für persistente Konfiguration und Identität
VOLUME ["/app/data"]

EXPOSE 58913

CMD ["node", "dist/index.js"]
