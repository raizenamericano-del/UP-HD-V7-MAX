# CHANGELOG v6.0.0 — UP-HD (HD Jir)

Rilis ini fokus pada tiga keluhan nyata: **video TikTok/IG pecah setelah di-upload**,
**pairing code yang tidak berfungsi**, dan **tampilan yang itu-itu saja**. Ketiganya
diperbaiki dengan bukti ukur, bukan sekadar diubah setelannya. Mulai v6 aplikasi
direbrand menjadi **UP-HD** dengan identitas visual baru ("Molten").

---

## 1. Anti-pecah TikTok & IG (inti rilis ini)

### Akar masalahnya

TikTok dan Instagram **selalu** menormalkan unggahan ke kanvas `1080x1920` lalu
meng-encode ulang videonya di bitrate yang jauh lebih rendah. Engine v5 punya aturan
"TIDAK pernah upscale", jadi sumber `720x1280` dikirim apa adanya sebagai `720x1280`.

Akibatnya ada **dua** degradasi bertumpuk:

1. Scaler TikTok/IG yang membesarkan video (bilinear, kualitas rendah).
2. Re-encode di jatah bitrate 1080p, padahal detail aslinya cuma 720p.

Ini persis yang diperbaiki aplikasi seperti Wink / Panda Compress — mereka menyiapkan
kanvas native sebelum upload.

### Yang berubah

| | v5.0.5 | v6.0.0 |
|---|---|---|
| Kanvas output TikTok/IG | ukuran sumber (mis. 720×1280) | **native 1080×1920** |
| Scaler | Lanczos milik platform | **Lanczos engine** (`accurate_rnd`, `full_chroma_int`) |
| Unsharp luma | 0.2 (matriks 5×5) | **0.9–1.4 (matriks 7×7)**, diskalakan menurut besar upscale |
| Cap bitrate TikTok 1080p | 12 Mbps | **20 Mbps** |
| Cap bitrate IG 1080p | 10 Mbps | **16 Mbps** |
| Budget ukuran sosial | 50 MB (memangkas bitrate video panjang) | **150 MB** |

### Mode kanvas (`fit`)

Bisa dipilih di UI, default `smart`:

- `smart` — crop penuh kalau aspect ratio sumber dekat dengan kanvas (≤18% area
  terpotong); kalau tidak, muat utuh dengan latar buram.
- `fill` — penuhi layar, tepi terpotong.
- `pad` — muat utuh, sisi kosong diisi **latar buram** dari video itu sendiri
  (bukan bar hitam). Pakai `filter_complex` + `split`.
- `none` — perilaku v5, tidak pernah upscale.

Sumber landscape tetap landscape (tidak dipaksa jadi portrait).

### Bukti ukur

Harness: `scripts/platform-bench.js`. Alurnya meniru kondisi nyata —
`sumber → engine → [simulasi re-encode platform] → VMAF vs sumber`.
Sumber uji `samples/sample_portrait_9x16.mp4` (720×1280).

| Target | v5.0.5 | v6.0.0 | Naik |
|---|---|---|---|
| TikTok | VMAF 50.64 | **61.17** | **+10.5** |
| IG | VMAF 50.25 | **60.74** | **+10.5** |

Sweep parameter yang menghasilkan angka itu (diukur satu per satu):

| Varian | VMAF setelah re-encode platform |
|---|---|
| 720p tanpa upscale (v5) | 50.48 |
| upscale 1080×1920 | 54.59 |
| upscale + unsharp 5:5 @0.9 | 59.79 |
| upscale + unsharp 5:5 @1.4 | 61.43 |
| **upscale + unsharp 7:7 @1.4** | **62.73** |
| upscale + `cas=1.0` | 62.97 (tapi file 2.3× lebih besar — ditolak) |

Dua temuan yang mengubah keputusan desain:

- **2-pass "Maksimal" hampir tidak membantu**: +0.28 VMAF dibanding Seimbang, tapi
  file 2.7× lebih besar dan waktu encode 2.3× lebih lama. Bottleneck-nya re-encode
  platform, bukan bitrate kita. Karena itu kanvas + sharpening yang diutamakan,
  bukan menaikkan bitrate setinggi-tingginya.
- **SSIM turun tipis** (0.9607 → 0.9528) karena sharpening menambah selisih terhadap
  referensi. VMAF (yang lebih dekat ke persepsi mata) naik 10 poin. Ini trade-off
  yang disengaja dan dicatat, bukan disembunyikan.

### Catatan metode

Benchmark pertama menghasilkan angka yang menyesatkan (50 vs 31 untuk kasus yang
sama). Penyebabnya: output engine bertag warna BT.709 sedangkan referensi tidak,
sehingga `libvmaf` melakukan konversi warna pada salah satu sisi dan VMAF anjlok
±19 poin. Itu **artefak pengukuran**, bukan kualitas. Referensi di harness sekarang
memakai tag warna yang sama.

---

## 2. Perbaikan pairing code

### Akar masalah UTAMA: kode mati dalam ±4 detik

Pengamatan langsung (`/tmp/pairwatch.js`) menunjukkan pola yang konsisten: kode
pairing **selalu** mati sekitar 4–7 detik setelah muncul, dengan socket jatuh ke
`logged_out`. Urutannya:

1. `requestPairingCode` dipanggil **tepat saat WebSocket terbuka**, sebelum
   noise handshake dengan server WhatsApp selesai.
2. WhatsApp menolak dengan **428** di detik ke-1.
3. Socket reconnect, kali ini kena **401** (session belum sah).
4. `_onClose` memanggil `clearSession()` → kode yang sudah tampil **dibuang**.

Padahal `_waitForHandshake()` sudah ada sejak v5 — **tapi tidak pernah dipanggil
sama sekali** (dead code). Perbaikannya: panggil `await this._waitForHandshake()`
sebelum `requestPairingCode`, tambah guard `pairingAlive` di `_onClose` supaya
sesi pairing tidak dibuang saat reconnect, dan naikkan `qrTimeout` ke ≥180 detik
di mode pairing. Hasil pengukuran setelah fix:

```
sebelum : kode mati @ ±7 dtk, state logged_out
sesudah : kode hidup penuh 120 dtk, state pairing, sock=ada, attempts=0
```

Regresi QR juga dicek: `panjang=257 state=qr` (tidak berubah, tetap normal).

### Bug-nya (race antar nomor)

`_requestPairingInternal` membagikan **satu** promise ke semua pemanggil tanpa
memeriksa nomornya:

```js
if (this._pairingBusy) return this._pairingBusy;   // ← tidak peduli nomornya siapa
```

Skenario yang bikin "kode gak fungsi":

1. User klik **Ambil Kode** untuk nomor A.
2. Sebelum selesai, user mengganti isian ke nomor B dan klik lagi.
3. Request B mendapat promise A → **API balas 200 berisi kode yang terdaftar
   untuk nomor A**.
4. Kode tampil di layar. Begitu diketik di HP nomor B, WhatsApp menolak.

Terlihat jalan, sebenarnya tidak. Direproduksi dan dikonfirmasi sebelum diperbaiki:

```
return A : {"number":"628111111111","code":"8SFCN8Q8"}
return B : {"number":"628111111111","code":"8SFCN8Q8"}   ← kode A dikasih ke B
SAMA?    : YA -> RACE
```

### Perbaikannya

1. **Single-flight sadar nomor** — berbagi promise hanya kalau nomornya sama
   (tetap anti double-klik). Nomor berbeda menaikkan "generasi"; run lama tetap
   menyelesaikan langkah socketnya (iq tidak bisa dibatalkan di tengah jalan)
   tapi hasilnya dibuang dan tidak pernah dipublikasikan.
2. **Run baru mengantre** di belakang run lama supaya socket tidak diperebutkan.
3. **Jaring pengaman di API** — endpoint menolak (409) kalau kode yang keluar
   terdaftar untuk nomor yang berbeda dari yang diminta.
4. **UI menampilkan nomor** yang terdaftar di samping kode, supaya user bisa
   memastikan sendiri.

Sesudah diperbaiki:

```
return A : {"number":"628111111111","code":null}          ← dibuang, tidak dipublikasikan
return B : {"number":"628222222222","code":"FD86VARW"}    ← kode B, untuk nomor B
```

Lewat HTTP: request lama balas `409 superseded`, request baru balas `200` dengan
kode yang benar.

### Bug UI ikutan

Field nomor pairing diisi otomatis dari `localStorage['hdjir_default_target']` —
padahal key itu isinya **nama platform** (`tiktok`/`wa`), bukan nomor. Jadi field
nomor tidak pernah menyimpan apa pun. Sekarang pakai `hdjir_pair_phone` dan
nomornya benar-benar diingat. Toast juga tidak lagi bilang "Pairing code siap!"
sebelum kodenya benar-benar ada.

---

## 3. WA Status — sengaja tidak diubah

Sesuai permintaan, jalur WhatsApp Status dibiarkan utuh. Ini **dibuktikan**, bukan
dianggap: engine lama dan baru dijalankan berdampingan pada 3 sumber × 3 mode
encode, lalu seluruh field plan dan filter chain dibandingkan.

```
== WA plan+filter: 9 identik / 0 beda (dari 9 kombinasi) ==
```

Target `wa` dan `universal` juga tidak diberi `canvas` (`fitDefault: 'none'`), jadi
tidak mungkin tersentuh fitur kanvas.

---

## 4. Bug yang ditemukan saat pengerjaan

Dua bug ini ada di kode yang baru ditulis dan ketahuan dari pengujian:

- **Orientasi kanvas terbalik.** `target.canvas` didefinisikan sebagai kanvas
  portrait (1080×1920), tapi ditukar dengan logika `rung.box` yang landscape.
  Sumber portrait jadi 1920×1080. Ketahuan dari tes, bukan dari asumsi.
- **`mkSpec` membuang metadata dims.** Spec hanya menyimpan `{width, height}` dan
  kehilangan `fit`/`canvas`/`fg`, sehingga filter jatuh ke scale polos — video
  **melar** setiap kali aspect ratio sumber ≠ kanvas. Diperbaiki dengan meneruskan
  objek dims lengkap.
- **Label `filter_complex` dipakai dua kali.** `[src]` dipakai di dua cabang tanpa
  `split`, ffmpeg menolak dengan `Invalid stream specifier: src`. Diperbaiki dengan
  `split=2[bgsrc][fgsrc]`.

---

## 5. Hasil pengujian

```
npm run smoke    → 50 lolos, 0 gagal
npm run build    → sukses (1952 modul)
```

Cakupan tambahan di smoke test v6:

- sumber 720×1280 → kanvas native 1080×1920 (TikTok & IG)
- sumber landscape tetap 1920×1080
- sumber 4:5 → pad di kanvas 1080×1920, foreground 1080×1350 (tidak melar)
- WA tidak dipaksa ke kanvas

Regresi manual:

- 24 kombinasi sumber × target × fit (9:16, 16:9, 4:5, 2.39:1) → 24 OK / 0 gagal
- 4K 3840×2160 → 1920×1080 High@4.2, BT.709
- HDR10 (PQ + BT.2020 10-bit) → SDR BT.709 yuv420p, tonemap mode `full`

---

## 6. Konfigurasi baru

```env
MAX_SOCIAL_MB=150   # budget TikTok/IG/Shorts (dulu ikut MAX_OUTPUT_MB=50)
SOCIAL_FIT=smart    # smart | fill | pad | none
```

---

## 7. Redesign UI v6 — "Molten"

Identitas visual lama (ungu→cyan, logo play+dalam-lingkaran, nama "ALL VD HD")
diganti total, bukan sekadar ditambah komponen:

- **Palet baru "Molten"**: emas `#FFC53D` → koral `#FF7A3D` → magenta `#F5397F`
  di atas latar obsidian hangat `#08070A`. Gradient brand, glow, ring, selection,
  dan seluruh token warna di-remap.
- **Logo mark baru**: panah naik yang menyatu dengan segitiga play (simbol
  "upload" + "video"), diverifikasi visual lewat render PNG.
- **Wordmark "UP-HD"** menggantikan "ALL VD HD" di navbar, splash, halaman
  koneksi/pengiriman, settings, dan success card.
- **Seluruh aset brand diregenerasi** (`npm run icons`): 11 PNG (icon, maskable,
  apple-touch, favicon, og-image, splash) + `manifest.webmanifest` (theme-color
  `#08070a`, nama UP-HD) + `index.html` (meta/OG).
- CSS hasil build diverifikasi: hex Molten hadir, **0 hex palet lama** tersisa.
