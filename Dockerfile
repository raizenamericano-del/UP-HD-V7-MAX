# ============================================================================
# JernihHD v7 — Docker image (Railway / VPS / Fly.io)
# JernihHD Engine v7 by Rifky
# ============================================================================
FROM node:20-bookworm-slim

# ffmpeg + ffprobe sistem (lebih cepat & hemat RAM daripada binary static)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

# ⚠️ PENTING: NODE_ENV=production JANGAN dipasang sebelum install dependencies.
# Kalau NODE_ENV=production aktif, npm otomatis buang devDependencies —
# padahal `vite` (buat build frontend) itu devDependency → error "vite: not found".
# Makanya di sini cuma set flag lain, NODE_ENV di-set nanti setelah build.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
WORKDIR /app

# ---------- 1) Dependencies (layer cache kepake) ----------
# Copy manifest dulu biar cache tidak batal tiap ganti source
COPY package.json package-lock.json* ./
COPY client/package.json client/package.json

# --include=dev WAJIB: build client butuh vite/tailwind/postcss.
# Pakai `npm ci` (reproducible, ikut lockfile); kalau lockfile drift, fallback ke install.
# NODE_ENV=development dipaksa di sini biar tetap aman walaupun Railway/kamu
# menyetel NODE_ENV=production sebagai env saat build (flag --include=dev juga mengunci ini).
RUN NODE_ENV=development npm ci --include=dev --no-audit --no-fund \
  || NODE_ENV=development npm install --include=dev --no-audit --no-fund

# ---------- 2) Source & build frontend ----------
COPY . .

RUN npm run build \
  && test -f client/dist/index.html \
  && echo "✅ Build client OK (client/dist/index.html ada)"

# ---------- 3) Rapikan: buang devDependencies (image lebih kecil & deploy lebih cepat) ----------
# Aman dipanggil di sini karena client/dist sudah jadi. Dipisah jadi layer sendiri
# dengan `|| true` biar kegagalan prune tidak menggagalkan deploy.
RUN npm prune --omit=dev --no-audit --no-fund || true

# ---------- 4) Runtime ----------
# NODE_ENV baru di-set di sini (setelah install & build selesai)
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
# Railway: pasang Volume dengan mount path /data biar session WhatsApp gak hilang
RUN mkdir -p /data
EXPOSE 3000

# tini = init process biar signal SIGTERM (Railway) diteruskan dengan benar
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
