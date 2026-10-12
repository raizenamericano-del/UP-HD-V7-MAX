# CHANGELOG v7.0.0 — JernihHD

Rebrand total dari basis kode v6 (UP-HD) menjadi **JernihHD** dengan identitas visual baru
("Glacier"), plus mesin sosial anti-pecah dan perbaikan pairing yang dipertahankan.
Pembuat: **Rifky**.

## 1. Rebrand & identitas visual "Glacier"

- Nama aplikasi **JernihHD**, slug "Jernih HD", tagline "Semua Video Jadi Jernih", kredit **Rifky**.
- Palet baru "Glacier": emerald `#34d399` → cyan `#22d3ee` → iris `#60a5fa` di atas navy dingin
  (`#04070d`–`#1f3049`) — sengaja kontras dengan palet v6 "Molten" (emas-koral-magenta)
  dan v5 (ungu-cyan).
- Logo baru: tetesan air gradien + segitiga play di dalam ripple ring (`brand/logo-mark*.svg`),
  wordmark "Jernih**HD**" di navbar/splash/footer.
- Seluruh aset brand diregenerate: ikon PWA (maskable + apple), OG image 1200×630,
  splash 1080×1920, manifest, theme-color, animasi `ripple`/`sheen`.
- README ditulis ulang untuk v7; CHANGELOG v6 dipertahankan sebagai arsip.

## 2. Engine sosial anti-pecah (TikTok / IG / Shorts)

- Target baru `tiktok`, `ig`, `shorts` (+ `universal`): kanvas portrait **1080×1920**,
  mode fit `smart`/`fill`/`pad` (`SOCIAL_FIT`).
- Bitrate dinaikkan drastis vs budget WA: TikTok 1080p ≈ 14–16 Mbps dengan VBV cap 20 Mbps,
  IG ≈ 16 Mbps — karena file diunduh lalu diunggah manual, bukan dikirim lewat WA.
  Budget kecil = bitrate dipangkas = hasil pecah; `MAX_SOCIAL_MB` default 150.
- `lanczos` + `unsharp` halus sebagai sharpen anti-pecah, fps ≤ 60, loudness `-14 LUFS`.

## 3. Pairing (dipertahankan dari v6)

- Pairing code 8 huruf stabil: nama browser kanonikal, satu permintaan aktif per sesi
  (`mintaSekali`), guard `superseded`, refresh = clear session + mulai baru,
  QR timeout ≥ 180 d. Terverifikasi live: kode terbit dan result di-ack server.

## 4. Batas & lain-lain

- `MAX_UPLOAD_MB` default **300** (sebelumnya 500 di v6) — tetap bisa di-override env.
- Engine version string **7.0.0**, nama "JernihHD Engine"; smoke test diperbarui
  (50 uji lolos, termasuk asserts brand baru).
- package `jernihhd@7.0.0`.
