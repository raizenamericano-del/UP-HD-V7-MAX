# CHANGELOG v7.1.0 — JernihHD (Privasi + Stabilitas Kamera)

Tanggal: 12 Oktober 2026 · Pengembang: **Rifky**

Fokus rilis ini: **(1)** menutup kebocoran privasi riwayat global,
**(2)** memperbaiki kegagalan video langsung dari kamera HP tanpa edit,
**(3)** bahasa & tampilan yang lebih profesional + branding pengembang,
**(4)** transparansi server gratis + donasi QRIS.

---

## 1. Privasi per perangkat (perbaikan utama)

Masalah: halaman riwayat + thumbnail + tautan unduhan bersifat **global** —
semua pengunjung dapat melihat dan mengunduh video milik orang lain.

Perbaikan:
- Setiap browser mendapat `ownerToken` acak (tersimpan di `localStorage`,
  dibuat sekali via WebCrypto). Dikirim sebagai header `x-owner-token`
  pada REST + auth socket.io.
- `server/history.js` ditulis ulang: setiap entri terikat `ownerToken` dan
  memiliki `accessToken` individual. `list(owner)` hanya mengembalikan milik
  pemanggil; entri legacy (tanpa pemilik) disembunyikan dari semua orang.
- REST `GET /api/history`, `DELETE /api/history[/:id]` kini terisolasi per
  pemilik. `GET /api/thumb/:id` dan `GET /api/download/:id` mewajibkan
  `?key=<accessToken>` atau header pemilik yang cocok, dengan header
  `X-Robots-Tag: noindex` + `Cache-Control: private`.
- Socket: setiap koneksi masuk ke room `owner:<token>`; event
  `history:update` hanya dikirim ke pemilik terkait (sebelumnya `io.emit`
  global). Pembatalan proses hanya oleh pemilik job berjalan.
- Client: `HistoryPanel` memakai URL berkunci (`withKey`), menampilkan lencana
  "Privat" + penjelasan, serta status kosong yang informatif. `SuccessCard`
  memakai `downloadUrl` berkunci dari server.
- `sweep()` memakai daftar internal semua pemilik + retensi
  `KEEP_VIDEOS` **per pemilik** agar file yatim tetap dibersihkan tanpa
  membocorkan data silang.

## 2. Stabilitas video kamera HP (MOV/HEVC/4K/60fps/VFR/10-bit)

Masalah: video yang direkam langsung dari kamera smartphone tanpa edit sering
gagal (`Server kehabisan RAM`, `ENOENT`, probe gagal) karena:
HEVC 4K rakus RAM-CPU, metadata durasi kosong, edit list + negative CTS,
rotasi displaymatrix, VFR, trek thumbnail ganda, audio multichannel/PCM.

Perbaikan (`server/video.js` + `server/index.js`):
- `probe()` baru: timeout 45 dtk + `-analyzeduration 20M -probesize 20M` +
  fallback `probeDirect()` via spawn ffprobe langsung bila fluent-ffmpeg gagal.
- `extractMeta()`: pilih trek video beresolusi terbesar; durasi dicoba dari
  stream → format → estimasi `nb_frames/fps`; fallback FPS berlapis
  (avg → r_frame → time_base → 30); flag baru `isHEVC/is4K/is10bit/
  isHighFps/isCameraRaw/durationUnknown`.
- `plan()`: asumsi durasi aman 60 dtk bila metadata kosong; `heavy` diperluas;
  penurunan otomatis 1080p→720p untuk 4K/HEVC/10-bit (bahkan saat RAM cukup);
  preset `veryfast` untuk file kamera 1-pass; `bframes` 2 saat lean; catatan
  UI khusus kamera + tips mode Turbo.
- `runFfmpeg()`: flag input toleran kamera selalu aktif —
  `-err_detect ignore_err -fflags +genpts+igndts -avoid_negative_ts make_zero
  -analyzeduration 20M -probesize 20M` + `-max_muxing_queue_size 9999`.
- `extractThumbnail()`: fallback accurate-seek bila fast-seek gagal (edit list);
  detik ke-1 bila durasi tak diketahui.
- `audioOptions()`: selalu normalisasi ke AAC stereo 48 kHz (kamera 5.1/PCM).
- `compressVideo()`: validasi preflight (file ada, ukuran > 0, metadata valid)
  dengan pesan ramah gantinya error `ENOENT` misterius.
- `POST /api/upload`: filter format kamera diperluas (`.mov .mts .m2ts .hevc
  .3gpp .3g2` + mimetype generik Android); tolak file 0-byte; pesan profesional.
- Pesan error (`friendlyError`) ditulis ulang profesional + kode baru
  `FORBIDDEN / TOO_LONG / NOT_FOUND` + petunjuk server gratis.

## 3. Bahasa profesional + branding Rifky

- Seluruh teks pengguna (server + client) ditulis ulang ke Bahasa Indonesia
  formal yang ramah: tanpa "bro/jir/lu/gas/nyambung/nunggu".
- Branding konsisten: "Dikembangkan oleh **Rifky**" di footer, logo subtitle,
  splash, README, `/api/config.developer`, dan log startup.
- Judul tahap proses, status navbar ("Terhubung", "Menghubungkan…"),
  kartu statistik, panduan forward WA, dan peringatan ban — semuanya formal.
- Versi `7.1.0` di `package.json` (root + client), fallback UI, dan README.

## 4. Transparansi server gratis + donasi QRIS

- `config.SERVER_NOTICE` + `config.DONATE` diekspos via `/api/config`.
- Komponen baru `ServerNotice.jsx`: banner "Mohon maaf atas ketidaknyamanan —
  proses unggah dan encode terkadang lama / sesekali gagal karena server gratis…",
  dapat ditutup, dengan panel QRIS donasi lipat.
- Komponen baru `DonateCard.jsx` di halaman Kirim: "Dukung Pengembangan
  JernihHD — donasi seikhlasnya…" + langkah pindai QRIS.
- Berkas `client/public/qris.jpg` (ditampilkan di UI) + arsip `qris-donasi.jpg`.
- Footer memuat ajakan donasi + catatan privasi per perangkat.

## 5. Catatan migrasi

- Riwayat lama (v7.0 ke bawah, tanpa `ownerToken`) otomatis disembunyikan demi
  privasi. File yatimnya dibersihkan oleh `sweep()` berkala. Tidak ada tindakan
  manual yang diperlukan.
- Pengguna yang menginginkan "identitas baru" dapat memakai
  `store.resetOwnerToken()` (console) — riwayat lama menjadi tidak dapat diakses.
- Tidak ada perubahan skema env. Deploy ulang seperti biasa
  (`npm run build && npm start`, atau via Dockerfile).

---

*JernihHD v7.1.0 — privasi dijaga, kamera HP didukung, bahasa profesional.
Dikembangkan oleh Rifky.*

---

## v7.1.1 — Rebrand "Ember" + teks natural + versi disembunyikan

- Identitas visual baru **"Ember"**: gradien amber → orange → rose di atas
  charcoal hangat (sebelumnya "Glacier": emerald → cyan → blue). Token warna
  `brand`/`iris`/`accent` diganti nilainya, seluruh komponen ikut berubah.
- **Logo baru**: tombol play gradien ember + cincin orbit (sebelumnya tetesan
  air). Seluruh PNG (ikon PWA, maskable, favicon, apple-touch, OG, splash)
  di-render ulang dari SVG via `npm run icons`.
- Seluruh teks UI ditulis ulang dengan Bahasa Indonesia natural/santai
  (tidak kaku, tidak seperti buatan AI). Banner server & donasi memakai
  kalimat admin sendiri.
- **Nomor versi dihapus dari semua tampilan** (footer, navbar, splash,
  pengaturan, badge engine, OG/splash image, manifest). Versi hanya tercatat
  di `package.json`/API internal.
- Kualitas encode TIDAK berubah sama sekali (bitrate, CRF, ladder, filter).
