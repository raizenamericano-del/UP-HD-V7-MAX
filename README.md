# 💧 JernihHD — Semua Video Jadi Jernih

**v7.1.0 · Dikembangkan oleh Rifky**

Aplikasi web untuk mengubah video biasa menjadi HD lalu mengirimnya ke **WhatsApp Status**,
atau mengolahnya agar **anti-pecah** saat diunggah ke **TikTok**, **IG Reels/Story**, dan
**YT Shorts**. Unggah dari browser, pilih target & kualitas, engine mengerjakan sisanya —
lalu kirim ke WA / unduh hasilnya. **Riwayat, thumbnail, dan file bersifat privat per perangkat.**

---

## ✨ Fitur

- **5 target platform** — WA Status, TikTok, IG Reels/Story, YT Shorts, dan Universal/unduh.
- **JernihHD Engine v7** — H.264 High 4.2 + AAC 192 kbps, 48 kHz:
  - **Anti-pecah sosial**: kanvas 1080×1920 untuk TikTok/IG/Shorts (mode `smart`/`fill`/`pad`),
    upscale `lanczos` + `unsharp` halus, bitrate tinggi dengan VBV cap (TikTok ≤ 20 Mbps)
    biar tidak dihancurkan kompressor platform.
  - **Loudness normal** — EBU R128 (`-14/-16 LUFS` per target) + true-peak limiter.
  - **HDR → SDR tonemap** otomatis (zscale + tonemap) kalau sumbernya HDR.
  - Ladder kualitas per target (1080p/720p/480p) dengan budget ukuran file.
- **Upload sampai 300 MB** (durasi maks. 30 menit) — `MAX_UPLOAD_MB` bisa di-override via env.
- **Koneksi WhatsApp** via **pairing code** (8 huruf, tanpa scan) atau QR; sesi persisten,
  auto-reconnect, dan pengaman anti-kode-silang antar nomor.
- **Privasi per perangkat (v7.1)** — riwayat, thumbnail, dan file unduhan hanya dapat
  diakses dari perangkat yang mengunggah (identitas acak + kunci akses individual).
  Tidak ada lagi riwayat global yang terlihat semua pengunjung.
- **Tahan file kamera HP (v7.1)** — probe toleran MOV/HEVC/4K/60fps/VFR/10-bit, flag
  decode aman (edit list, negative CTS), jalur hemat otomatis anti-OOM di server gratis.
- **Kirim multi-nomor** sekaligus + riwayat kiriman privat.
- **Mode unduh** — proses HD tanpa nomor WA, file dapat diunduh dari browser.
- **PWA** — ikon, splash, manifest; bisa di-install di HP.
- UI bertema **Glacier** (emerald → cyan → iris di atas navy dingin), desain baru v7.

## 🚀 Quick Start

```bash
npm install
cp .env.example .env        # opsional, semua punya default
npm run dev                 # server :3000 + vite dev (atau `npm start` untuk produksi setelah `npm run build`)
```

Buka `http://localhost:3000`, klik **Ambil Kode Pairing**, masukkan nomor WA (format internasional,
mis. `62812…`), lalu ketik kode 8 huruf di HP: *Perangkat tertaut → Tautkan perangkat → pakai kode*.

## ⚙️ Environment

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `3000` | Port server |
| `MAX_UPLOAD_MB` | `300` | Batas ukuran upload |
| `STATUS_MAX_MB` | `16` | Budget file WA Status |
| `STATUS_MAX_SEC` | `30` | Auto-trim WA Status |
| `MAX_SOCIAL_MB` | `150` | Budget file TikTok/IG/Shorts |
| `SOCIAL_FIT` | `smart` | Mode kanvas sosial: `smart`/`fill`/`pad` |
| `APP_KEY` | *(kosong)* | Jika diisi, semua request API wajib bawa header `X-App-Key` |
| `MOCK_SEND` | `false` | Simulasikan kirim WA (untuk uji tanpa nomor) |
| `LOG_LEVEL` | `info` | `debug` untuk log verbos |

## 🧪 Script

```bash
npm run smoke     # 50 uji end-to-end (encode, kirim mock, unduh, pairing) — butuh server :3999 bebas
npm run icons     # regenerate PNG ikon/OG/splash dari brand SVG (butuh sharp)
npm run build     # build client (vite) ke client/dist
npm start         # jalankan server produksi (menyajikan client/dist)
```

## 🐳 Deploy

- **Docker**: `docker build -t jernihhd . && docker run -p 3000:3000 jernihhd`
- **Railway / VPS / Fly.io**: sudah ada `Dockerfile`, `Procfile`, dan `railway.json`.
- Data sesi WA tersimpan di `data/` — mount sebagai volume agar tidak perlu pairing ulang.

## 📁 Struktur

```
server/    API + WhatsApp (Baileys) + engine video (ffmpeg)
client/    UI React + Vite + Tailwind (tema Glacier)
scripts/   smoke test
tools/     generator ikon/brand
docs/      dokumentasi tambahan & contoh env
samples/   contoh video uji
```

## ⚖️ Lisensi

MIT — bebas dipakai & dimodifikasi. Credit **Rifky** tetap dicantumkan ya 🙏

Gunakan dengan bijak: jangan spam, patuhi ToS WhatsApp/TikTok/Meta. Video yang diproses
adalah milik pengunggah; JernihHD hanya membantu membuatnya jernih.
