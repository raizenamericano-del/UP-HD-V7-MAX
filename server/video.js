'use strict';
/**
 * ============================================================================
 *  JernihHD — Jernih HD Engine v5  (by Rifky)
 * ============================================================================
 *  Mesin kompresi video multi-platform. Fokus: TETAP TAJAM setelah platform
 *  (WhatsApp / TikTok / Instagram / YouTube) meng-encode ulang videonya.
 *
 *  Yang baru di v5 (vs engine v4):
 *   1. TARGET PLATFORM: wa (Status) · tiktok · ig (Reels/Story) · shorts
 *      (YT Shorts) · universal — masing-masing punya ladder bitrate, cap fps,
 *      auto-trim, target loudness, dan default sharpening sendiri.
 *   2. Bitrate ladder per platform (angka dari publikasi resmi platform):
 *        TikTok  1080p = 10 Mbps (cap 12), fps ≤ 60 · 720p = 6 Mbps
 *        IG      1080x1920 = 8 Mbps (cap 10), fps ≤ 30
 *        Shorts  1080p = 12 Mbps
 *        WA      ladder lama (1080p cap 8 / 720p cap 5 / 480p 2.8 / 360p 1.8)
 *                + auto-trim 30s + budget 16 MB
 *   3. Loudness EBU R128 dua-langkah: pass pengukuran (print_format=json) lalu
 *      apply `linear=true` pakai nilai terukur — normalisasi akurat, bukan
 *      dynamic guessing. Target: -14 LUFS / TP -1.0 (TikTok/IG/Shorts),
 *      -16 LUFS / TP -1.5 (WA/Universal). Fallback anggun ke 1-pass dynamic.
 *   4. Audio AAC 48 kHz 192 kbps (naik dari 128k).
 *   5. H.264 High · level 4.2 untuk ≤1080p (naik otomatis ke 5.x kalau frame
 *      lebih besar, mis. 4K) · yuv420p · tag BT.709 · +faststart.
 *   6. GOP dinamis = 2 detik × fps output (v4: hardcode 60).
 *   7. Unsharp luma ringan DEFAULT ON untuk TikTok & IG (platform ini
 *      re-encode-nya paling mengikis detail), tetap opsi buat user.
 *   8. HDR→SDR tonemap dengan fallback chain: zscale+tonemap → tonemap saja
 *      → skip (dengan catatan), jadi tetap jalan di ffmpeg minimalis.
 *   9. rc-lookahead 40–60 (60 normal, 40 sumber berat, 20 mode hemat/LOW_MEM).
 *  10. Trim otomatis per target: WA 30s · IG 90s (Reels; Story dipotong IG
 *      ke 60s) · Shorts 180s · TikTok/Universal tanpa batas.
 *
 *  Dipertahankan dari v4 (hasil tuning benchmark):
 *   - scale LANCZOS + full_chroma_int, dimensi genap, TIDAK pernah upscale
 *   - fps via filter (CFR) — bukan -r yang bikin frame dobel/drop
 *   - x264: aq-mode 3, psy-rd 1.0:0.15, trellis 2, bframes 3, deblock -1:-1
 *   - 3 mode: turbo (1-pass cepat) / balanced (CRF+VBV) / max (2-pass ABR)
 *   - retry ladder kalau encoder gagal (hemat → turun resolusi)
 *   - progress mesin via -progress pipe:2 (persen/ETA/speed akurat)
 *   - deteksi RAM container (LOW_MEM) → mode hemat otomatis
 * ============================================================================
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const config = require('./config');
const { log } = require('./logger');

/* ffmpeg-static / ffprobe-static bersifat OPSIONAL (di Docker kita pakai
 * ffmpeg sistem). Require-nya dibungkus try/catch biar tidak crash kalau
 * package-nya tidak terpasang (mis. install dengan --ignore-scripts). */
let ffmpegStatic = null;
let ffprobeStatic = null;
try { ffmpegStatic = require('ffmpeg-static'); } catch (_) { /* tidak ada */ }
try { ffprobeStatic = require('ffprobe-static'); } catch (_) { /* tidak ada */ }

/* ------------------------------------------------------------------ *
 * Binary ffmpeg/ffprobe
 * ------------------------------------------------------------------ */
const BIN =
  config.FFMPEG_PATH ||
  (typeof ffmpegStatic === 'string' ? ffmpegStatic : 'ffmpeg');
const PROBE =
  config.FFPROBE_PATH ||
  (typeof ffprobeStatic?.path === 'string' ? ffprobeStatic.path : 'ffprobe');
ffmpeg.setFfmpegPath(BIN);
ffmpeg.setFfprobePath(PROBE);
log.info(`FFmpeg : ${BIN}`);
log.info(`FFprobe: ${PROBE}`);

/* ------------------------------------------------------------------ *
 * Identitas engine
 * ------------------------------------------------------------------ */
const ENGINE = {
  name: 'JernihHD Engine',
  version: '7.0.0',
  audioSampleRate: 48000,
  audioBitrateKbps: config.AUDIO_BITRATE_KBPS, // 192k (spec v5)
  gopSeconds: 2, // GOP 2 detik × fps output
};

/* ------------------------------------------------------------------ *
 * TARGET PLATFORM (inti baru v5)
 * ------------------------------------------------------------------
 * mbps    = target bitrate video utk 2-pass ABR (mode Maksimal / resize)
 * capMbps = plafon VBV maxrate utk mode CRF
 * Angka bitrate mengikuti rekomendasi publikasi resmi tiap platform.   */
const TARGETS = {
  wa: {
    key: 'wa',
    label: 'WA Status',
    short: 'WA',
    desc: 'WhatsApp Status — ladder hemat, auto-trim 30 detik, budget 16 MB.',
    maxFps: 30,
    trimSec: 30,
    maxMBField: 'STATUS_MAX_MB', // → config.STATUS_MAX_MB (16)
    loudness: { I: -16, TP: -1.5, LRA: 11 },
    sharpenDefault: 0, // unsharp tetap opt-in utk WA (seperti v4)
    ladder: [
      { key: '1080p', label: 'Full HD 1080p', short: '1080p', box: { w: 1920, h: 1080 }, mbps: 6.2, capMbps: 8, crf: 18 },
      { key: '720p', label: 'HD 720p', short: '720p', box: { w: 1280, h: 720 }, mbps: 4, capMbps: 5, crf: 18 },
      { key: '480p', label: 'SD 480p', short: '480p', box: { w: 854, h: 480 }, mbps: 2.2, capMbps: 2.8, crf: 19 },
      { key: '360p', label: 'Hemat 360p', short: '360p', box: { w: 640, h: 360 }, mbps: 1.4, capMbps: 1.8, crf: 20 },
    ],
    autoQuality: (dur) => (dur <= 60 ? '1080p' : dur <= 120 ? '720p' : dur <= 240 ? '480p' : '360p'),
  },
  tiktok: {
    key: 'tiktok',
    label: 'TikTok',
    short: 'TikTok',
    desc: 'TikTok — kanvas 1080x1920, 1080p 16 Mbps (cap 20), fps ≤ 60, sharpen anti-pecah ON, -14 LUFS.',
    maxFps: 60,
    trimSec: null, // TikTok sampai 10 menit — tidak dipotong
    maxMBField: 'MAX_SOCIAL_MB',
    loudness: { I: -14, TP: -1.0, LRA: 11 },
    sharpenDefault: 1.0, // unsharp luma kuat (tuned: VMAF +12 setelah re-encode platform)
    /* v6 ANTI-PECAH: TikTok SELALU menormalkan unggahan ke 1080x1920.
     * Kalau kita kirim 720x1280, scaler TikTok-lah yang membesarkan (jelek)
     * lalu encode ulang di bitrate jatah 1080p → detail hancur. Jadi kita
     * yang siapkan kanvasnya di resolusi native platform. */
    canvas: { w: 1080, h: 1920 },
    fitDefault: config.SOCIAL_FIT,
    ladder: [
      { key: '1080p', label: 'Full HD 1080p', short: '1080p', box: { w: 1920, h: 1080 }, mbps: 16, capMbps: 20, crf: 18 },
      { key: '720p', label: 'HD 720p', short: '720p', box: { w: 1280, h: 720 }, mbps: 8, capMbps: 10, crf: 18 },
      { key: '480p', label: 'SD 480p', short: '480p', box: { w: 854, h: 480 }, mbps: 3.6, capMbps: 4.5, crf: 19 },
    ],
    autoQuality: (dur) => (dur <= 180 ? '1080p' : '720p'),
  },
  ig: {
    key: 'ig',
    label: 'IG Reels / Story',
    short: 'Instagram',
    desc: 'Instagram Reels & Story — kanvas 1080x1920, 12 Mbps (cap 16), fps ≤ 30, auto-trim 90s.',
    maxFps: 30,
    trimSec: 90, // Reels 90s; Story tetap dipotong IG ke 60s
    maxMBField: 'MAX_SOCIAL_MB',
    loudness: { I: -14, TP: -1.0, LRA: 11 },
    sharpenDefault: 0.9,
    /* IG re-encode-nya paling agresif dari semua platform. Kanvas native
     * 1080x1920 + bitrate di atas spec publikasi (8 Mbps) = detail bertahan. */
    canvas: { w: 1080, h: 1920 },
    fitDefault: config.SOCIAL_FIT,
    ladder: [
      { key: '1080p', label: 'Full HD 1080p', short: '1080p', box: { w: 1920, h: 1080 }, mbps: 12, capMbps: 16, crf: 18 },
      { key: '720p', label: 'HD 720p', short: '720p', box: { w: 1280, h: 720 }, mbps: 6.5, capMbps: 8, crf: 18 },
      { key: '480p', label: 'SD 480p', short: '480p', box: { w: 854, h: 480 }, mbps: 3.4, capMbps: 4.2, crf: 19 },
    ],
    autoQuality: () => '1080p',
  },
  shorts: {
    key: 'shorts',
    label: 'YT Shorts',
    short: 'Shorts',
    desc: 'YouTube Shorts — 1080p 12 Mbps, fps ≤ 60, auto-trim 180s, -14 LUFS.',
    maxFps: 60,
    trimSec: 180,
    maxMBField: 'MAX_SOCIAL_MB',
    loudness: { I: -14, TP: -1.0, LRA: 11 },
    sharpenDefault: 0.4,
    canvas: { w: 1080, h: 1920 },
    fitDefault: config.SOCIAL_FIT,
    ladder: [
      { key: '1080p', label: 'Full HD 1080p', short: '1080p', box: { w: 1920, h: 1080 }, mbps: 12, capMbps: 15, crf: 18 },
      { key: '720p', label: 'HD 720p', short: '720p', box: { w: 1280, h: 720 }, mbps: 8, capMbps: 10, crf: 18 },
      { key: '480p', label: 'SD 480p', short: '480p', box: { w: 854, h: 480 }, mbps: 4, capMbps: 5, crf: 19 },
    ],
    autoQuality: () => '1080p',
  },
  universal: {
    key: 'universal',
    label: 'Universal',
    short: 'Universal',
    desc: 'Netral — aman untuk semua platform. 1080p 10 Mbps (cap 12), fps ≤ 60.',
    maxFps: 60,
    trimSec: null,
    maxMBField: 'MAX_OUTPUT_MB',
    loudness: { I: -16, TP: -1.5, LRA: 11 },
    sharpenDefault: 0,
    ladder: [
      { key: '1080p', label: 'Full HD 1080p', short: '1080p', box: { w: 1920, h: 1080 }, mbps: 10, capMbps: 12, crf: 18 },
      { key: '720p', label: 'HD 720p', short: '720p', box: { w: 1280, h: 720 }, mbps: 6, capMbps: 7.5, crf: 18 },
      { key: '480p', label: 'SD 480p', short: '480p', box: { w: 854, h: 480 }, mbps: 3, capMbps: 3.8, crf: 19 },
      { key: '360p', label: 'Hemat 360p', short: '360p', box: { w: 640, h: 360 }, mbps: 1.8, capMbps: 2.2, crf: 20 },
    ],
    autoQuality: (dur) => (dur <= 120 ? '1080p' : dur <= 300 ? '720p' : '480p'),
  },
};

function getTarget(key) {
  return TARGETS[key] || TARGETS[config.DEFAULT_TARGET] || TARGETS.wa;
}

/** Budget ukuran output (MB) untuk sebuah target */
function targetMaxMB(target) {
  return config[target.maxMBField] || config.MAX_OUTPUT_MB;
}

/* ------------------------------------------------------------------ *
 * Tuning x264 + level H.264
 * ------------------------------------------------------------------
 * Level dihitung dari ukuran frame + DPB, bukan hardcode — x264 menolak
 * membuka encoder kalau DPB melewati batas level ("DPB size ... > level
 * limit"), bikin video portrait 1080p gagal total di v3 dulu.
 * Spec v5: High profile level 4.2 untuk ≤1080p; frame lebih besar
 * (1440p/4K) otomatis naik ke 5.0/5.1/5.2 — itu batas fisik standar.    */
const X264_BASE = {
  'b-adapt': 2,
  'b-pyramid': 'normal',
  me: 'umh',
  me_range: 24,
  subme: 8,
  trellis: 2,
  'aq-mode': 3,
  'aq-strength': 0.9,
  'psy-rd': '1.0,0.15', // psy-rd 1.0 : psy-trellis 0.15
  deblock: '-1,-1',
  'mixed-refs': 1,
  weightp: 2,
  direct: 'auto',
  scenecut: 40,
  '8x8dct': 1,
  'chroma-me': 1,
  'fast-pskip': 1,
  mbtree: 1,
};

// maxMBs = batas macroblock/frame; dpb = batas DPB dalam macroblock
const LEVELS = [
  { level: '4.2', maxMBs: 8704, dpb: 34816 },
  { level: '5.0', maxMBs: 22080, dpb: 110400 },
  { level: '5.1', maxMBs: 36864, dpb: 184320 },
  { level: '5.2', maxMBs: 36864, dpb: 184320 },
];

const macroblocks = (w, h) => Math.ceil(w / 16) * Math.ceil(h / 16);

/** Pilih level terkecil yang masih cukup buat frame + DPB (mulai 4.2). */
function chooseLevel(width, height, dpbFrames) {
  const mbs = macroblocks(width, height);
  for (const l of LEVELS) {
    if (mbs <= l.maxMBs && mbs * dpbFrames <= l.dpb) return l.level;
  }
  return null; // null = biarkan x264 auto (video ekstrem >4K)
}

/**
 * Racik -x264-params. Mode "lean" dipakai kalau sumber berat (2K/4K, >60fps,
 * HEVC) atau RAM kecil — ref & rc-lookahead penyumbang RAM terbesar di x264.
 */
function buildX264Params({ refs = 4, bframes = 3, lookahead = 60, lean = false } = {}) {
  const p = {
    ...X264_BASE,
    ref: lean ? Math.min(refs, 2) : refs,
    bframes: lean ? Math.min(bframes, 2) : bframes,
    // spec v5: rc-lookahead 40–60; lean turun ke 20 (hemat RAM, documented)
    'rc-lookahead': lean ? Math.min(lookahead, 20) : lookahead,
  };
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join(':');
}

/* Mode encode ------------------------------------------------------- */
const MODES = {
  turbo: {
    key: 'turbo',
    label: 'Turbo',
    desc: 'Paling cepat — hasil tetap bagus buat klip pendek.',
    crfBump: 1,
    preset: config.FFMPEG_PRESET_FAST,
    twoPass: false,
  },
  balanced: {
    key: 'balanced',
    label: 'Seimbang',
    desc: 'Default. Kualitas HD, waktu encode wajar.',
    crfBump: 0,
    preset: config.FFMPEG_PRESET,
    twoPass: false,
  },
  max: {
    key: 'max',
    label: 'Maksimal',
    desc: '2-pass — paling bersih & ukuran pasti aman.',
    crfBump: -1,
    preset: config.FFMPEG_PRESET_SLOW,
    twoPass: true,
  },
};

function pickMode(mode) {
  return MODES[mode] || MODES.balanced;
}

/* ------------------------------------------------------------------ *
 * Capability detection (sekali saat boot, dipakai UI + engine + bench)
 * ------------------------------------------------------------------ */
function detectCapabilities() {
  const out = {
    libx264: false, libx265: false, aac: true,
    zscale: false, tonemap: false, libvmaf: false,
    version: null,
  };
  const { execFileSync } = require('child_process');
  for (let attempt = 0; attempt < 2 && !out.libx264; attempt++) {
    try {
      const enc = execFileSync(BIN, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 20000 });
      out.libx264 = /libx264/.test(enc);
      out.libx265 = /libx265/.test(enc);
    } catch (_) { /* noop */ }
  }
  if (!out.libx264) {
    try {
      const h = execFileSync(BIN, ['-hide_banner', '-h', 'encoder=libx264'], { encoding: 'utf8', timeout: 20000 });
      out.libx264 = /Encoder libx264|libx264/i.test(h);
    } catch (_) { /* noop */ }
  }
  try {
    const fil = execFileSync(BIN, ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 15000 });
    out.zscale = /\bzscale\b/.test(fil);
    out.tonemap = /\btonemap\b/.test(fil);
    out.libvmaf = /\blibvmaf\b/.test(fil);
  } catch (_) { /* noop */ }
  try {
    const v = execFileSync(BIN, ['-version'], { encoding: 'utf8', timeout: 15000 });
    out.version = (v.split('\n')[0] || '').replace('ffmpeg version ', '').split(' ')[0];
  } catch (_) { /* noop */ }
  return out;
}
const CAPS = detectCapabilities();
log.info(
  `Engine  : ${ENGINE.name} v${ENGINE.version} · x264=${CAPS.libx264 ? 'yes' : 'no'} · ` +
  `hdr=${CAPS.zscale && CAPS.tonemap ? 'full' : CAPS.tonemap ? 'fallback' : 'no'} · ` +
  `vmaf=${CAPS.libvmaf ? 'yes' : 'no'} · ffmpeg=${CAPS.version || '?'}`
);
if (!CAPS.libx264) {
  log.warn(
    '⚠️  libx264 TIDAK terdeteksi di ffmpeg ini — engine terpaksa pakai encoder cadangan ' +
    '(mpeg4) yang kualitasnya jauh lebih rendah. Cek FFMPEG_PATH / instalasi ffmpeg.'
  );
}

const CODEC = CAPS.libx264 ? 'libx264' : 'mpeg4';

/* ------------------------------------------------------------------ *
 * Probe & metadata
 * ------------------------------------------------------------------ */
/**
 * Probe video yang tahan terhadap file kamera HP (MOV/MP4 langsung tanpa edit).
 * v7.1: timeout 45 detik + analyseduration/probesize besar + fallback ffprobe
 * langsung bila fluent-ffmpeg gagal membaca (edit list, moov di akhir, dsb).
 */
function probe(file, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        probeDirect(file).then(resolve).catch(() => reject(new Error('ffprobe timeout: file video tidak merespons (kemungkinan file rusak atau format tidak umum).')));
      }
    }, timeoutMs);
    try {
      ffmpeg.ffprobe(
        file,
        ['-analyzeduration', '20M', '-probesize', '20M'],
        (err, meta) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) {
            // Fallback: panggil ffprobe biner langsung (lebih toleran)
            probeDirect(file).then(resolve).catch(() => reject(err));
          } else {
            resolve(meta);
          }
        }
      );
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probeDirect(file).then(resolve).catch(() => reject(err));
    }
  });
}

/** Fallback probe via spawn ffprobe langsung (toleran terhadap file kamera). */
function probeDirect(file) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-analyzeduration', '20M',
      '-probesize', '20M',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      file,
    ];
    let out = '';
    let errBuf = '';
    let proc;
    try {
      proc = spawn(PROBE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) { /* noop */ } }, 45000);
    proc.stdout.on('data', (d) => { out += d.toString(); if (out.length > 512000) out = out.slice(-256000); });
    proc.stderr.on('data', (d) => { errBuf += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe gagal (exit ${code}): ${errBuf.slice(0, 300)}`));
      try {
        const j = JSON.parse(out);
        resolve({ streams: j.streams || [], format: j.format || {} });
      } catch (e) {
        reject(new Error('ffprobe mengembalikan data yang tidak valid.'));
      }
    });
  });
}

function ratioToFps(str) {
  if (!str) return 0;
  const [a, b] = String(str).split('/').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

const roundEven = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Metadata lengkap — dipakai engine buat mutusin filter & strategi encode. */
function extractMeta(ffMeta) {
  const streams = (ffMeta && ffMeta.streams) || [];
  // Pilih trek video dengan resolusi terbesar (file kamera kadang punya
  // trek thumbnail kecil yang menyesatkan bila diambil yang pertama).
  const videoStreams = streams.filter((s) => s.codec_type === 'video');
  const v = videoStreams.sort((x, y) => ((y.width || 0) * (y.height || 0)) - ((x.width || 0) * (x.height || 0)))[0] || {};
  const a = streams.find((s) => s.codec_type === 'audio') || null;
  const fmt = (ffMeta && ffMeta.format) || {};

  // Durasi: coba semua sumber yang ada (file kamera tanpa edit sering
  // menyimpan durasi hanya di container, bukan di stream).
  const durationCandidates = [
    parseFloat(v.duration || 0),
    parseFloat(fmt.duration || 0),
    // Estimasi dari nb_frames / fps bila durasi kosong
    (() => {
      try {
        const nb = parseInt(v.nb_frames || 0, 10);
        const f = ratioToFps(v.avg_frame_rate) || ratioToFps(v.r_frame_rate) || 0;
        return nb > 0 && f > 0 ? nb / f : 0;
      } catch (_) { return 0; }
    })(),
  ];
  const duration = durationCandidates.find((d) => Number.isFinite(d) && d > 0) || 0;

  const rot = Math.abs((parseInt(v.tags?.rotate ?? v.tags?.rotation ?? 0, 10) || 0) % 360);
  const rotation = rot === 90 || rot === 180 || rot === 270 ? rot : 0;
  // side data displaymatrix (container modern) — rotasi tidak selalu di tags
  let displayRotation = 0;
  try {
    const sd = (v.side_data_list || []).find((x) => x.rotation != null);
    if (sd) displayRotation = Math.abs(Math.round(sd.rotation) % 360);
  } catch (_) { /* noop */ }
  const effRot = rotation || displayRotation;

  // FPS: file kamera VFR kadang avg_frame_rate = 0/0 → pakai r_frame_rate,
  // lalu time_base, terakhir default 30.
  let fps = ratioToFps(v.avg_frame_rate) || ratioToFps(v.r_frame_rate) || 0;
  if (!fps || !Number.isFinite(fps) || fps <= 0 || fps > 240) {
    try {
      const tb = String(v.time_base || '').split('/').map(Number);
      if (tb.length === 2 && tb[0] > 0 && tb[1] > 0) {
        const tbf = tb[1] / tb[0];
        if (tbf > 0 && tbf <= 240) fps = tbf;
      }
    } catch (_) { /* noop */ }
  }
  if (!fps || !Number.isFinite(fps) || fps <= 0 || fps > 240) fps = 30;
  const rFps = ratioToFps(v.r_frame_rate) || fps;

  const pixFmt = String(v.pix_fmt || 'yuv420p');
  const transfer = String(v.color_transfer || v.color_trc || '').toLowerCase();
  const primaries = String(v.color_primaries || '').toLowerCase();
  const isHDR =
    (/10le|12le|10be|12be/.test(pixFmt) &&
      (/smpte2084|arib-std-b67|bt2020/.test(transfer) || /bt2020/.test(primaries))) ||
    /smpte2084|arib-std-b67/.test(transfer);

  const portraitRot = effRot === 90 || effRot === 270;
  const postW = portraitRot ? (v.height || 0) : (v.width || 0);
  const postH = portraitRot ? (v.width || 0) : (v.height || 0);

  const srcBitrate = parseInt(v.bit_rate || fmt.bit_rate || 0, 10) || 0;
  const px = Math.max(1, postW * postH);
  const bpp = (srcBitrate / Math.max(fps, 1) / px) || 0;

  // Flag beban kamera (v7.1): dipakai plan() untuk memilih jalur hemat otomatis
  const vCodecName = String(v.codec_name || '').toLowerCase();
  const isHEVC = /hevc|h265/.test(vCodecName);
  const is10bit = /10le|10be|12le|12be|p010|p016/.test(pixFmt);
  const is4K = px > 3840 * 2160 * 0.75; // ≥ ~6,2 MP dianggap setara 4K
  const isHighFps = fps > 60.5;
  const pixFmtNeedsConvert = !/yuv420p/.test(pixFmt);
  // Heuristik "langsung dari kamera tanpa edit": codec kamera + fps tinggi /
  // resolusi besar / pix_fmt non-standar / ada rotation / VFR.
  const isCameraRaw = Boolean(
    (isHEVC || /h264|avc/.test(vCodecName)) &&
    (is4K || isHighFps || is10bit || pixFmtNeedsConvert || effRot !== 0 || Math.abs(fps - rFps) > 0.6)
  );

  return {
    durationSec: Math.max(0, duration),
    durationUnknown: !(duration > 0),
    width: postW,
    height: postH,
    srcWidth: v.width || 0,
    srcHeight: v.height || 0,
    hasAudio: !!a,
    audioChannels: a ? Math.min(a.channels || 2, 8) : 0,
    audioSampleRate: a ? parseInt(a.sample_rate || 0, 10) || 48000 : 0,
    rotation: effRot,
    fps: Math.round(fps * 100) / 100,
    rFps: Math.round(rFps * 100) / 100,
    isVFR: Math.abs(fps - rFps) > 0.6,
    pixFmt,
    isHDR,
    isHEVC,
    is10bit,
    is4K,
    isHighFps,
    isCameraRaw,
    srcBitrate,
    bpp: Math.round(bpp * 1000) / 1000,
    vCodec: v.codec_name || '',
    aCodec: a?.codec_name || '',
    sizeBytes: parseInt(fmt.size || 0, 10) || 0,
  };
}

/* ------------------------------------------------------------------ *
 * Perencanaan (plan) — dipakai UI + endpoint /api/plan sebelum encode
 * ------------------------------------------------------------------ */
function pickRung(target, durationSec, quality) {
  if (quality && quality !== 'auto') {
    const p = target.ladder.find((x) => x.key === quality);
    if (p) return p;
  }
  const key = target.autoQuality(durationSec);
  return target.ladder.find((x) => x.key === key) || target.ladder[0];
}

/** Dimensi output + cara sumber diletakkan di kanvas.
 *
 *  fit:
 *   'smart' → 'fill' kalau AR sumber dekat dengan AR kanvas (crop ≤18%),
 *             selain itu 'pad' (latar buram) — default TikTok/IG/Shorts
 *   'fill'  → penuhi kanvas, sebagian tepi terpotong (tanpa bar)
 *   'pad'   → muat utuh di dalam kanvas, sisi kosong diisi latar buram
 *   'none'  → pertahankan AR & dimensi sumber, TIDAK pernah upscale (v5)
 *
 *  Kenapa kanvas penting: TikTok/IG SELALU menormalkan unggahan ke
 *  1080x1920. Kirim 720x1280 = scaler platform yang membesarkan (bilinear,
 *  jelek) lalu encode ulang di jatah bitrate 1080p → hasilnya pecah.
 *  Mengukur sendiri (VMAF setelah simulasi re-encode platform):
 *  720x1280 = 50.48  vs  1080x1920 + sharpen = 62.73.
 */
function targetDims(rung, meta, opts = {}) {
  const portrait = (meta.height || 0) >= (meta.width || 0);
  const box = portrait ? { w: rung.box.h, h: rung.box.w } : rung.box;
  const srcW = meta.width || box.w;
  const srcH = meta.height || box.h;
  const canvasIn = opts.canvas || null;
  const fitIn = opts.fit || 'none';

  /* --- mode legacy: tidak pernah upscale --- */
  if (fitIn === 'none' || !canvasIn) {
    const factor = Math.min(box.w / srcW, box.h / srcH, 1);
    return {
      width: roundEven(srcW * factor),
      height: roundEven(srcH * factor),
      upscaled: factor >= 1,
      box,
      fit: 'none',
      canvas: null,
      upscaleFactor: 1,
      cropLoss: 0,
    };
  }

  /* `target.canvas` didefinisikan sebagai kanvas PORTRAIT (1080x1920).
   * Sumber landscape → kanvas ditukar jadi 1920x1080. (Kebalikan dari `box`
   * di ladder, karena box didefinisikan landscape lalu ditukar utk portrait.) */
  const canvas = portrait
    ? { w: roundEven(canvasIn.w), h: roundEven(canvasIn.h) }
    : { w: roundEven(canvasIn.h), h: roundEven(canvasIn.w) };

  const cover = Math.max(canvas.w / srcW, canvas.h / srcH); // skala 'fill'
  const contain = Math.min(canvas.w / srcW, canvas.h / srcH); // skala 'pad'
  const scaledW = srcW * cover;
  const scaledH = srcH * cover;
  const cropLoss = Math.max(0, 1 - (canvas.w * canvas.h) / (scaledW * scaledH));

  let mode = fitIn;
  if (fitIn === 'smart') mode = cropLoss <= 0.18 ? 'fill' : 'pad';

  // Dimensi 'foreground' untuk mode pad (muat utuh, genap, ≤ kanvas)
  const fg = {
    width: Math.min(canvas.w, roundEven(srcW * contain)),
    height: Math.min(canvas.h, roundEven(srcH * contain)),
  };
  const effScale = mode === 'fill' ? cover : contain;

  return {
    width: canvas.w,
    height: canvas.h,
    upscaled: effScale > 1.001,
    box,
    fit: mode,
    canvas,
    fg,
    upscaleFactor: Math.round(effScale * 1000) / 1000,
    cropLoss: Math.round(cropLoss * 1000) / 1000,
  };
}

/** Rantai tonemap HDR→SDR sesuai kemampuan ffmpeg (fallback anggun). */
function tonemapChain() {
  if (CAPS.zscale && CAPS.tonemap) {
    return {
      mode: 'full',
      filters: [
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'zscale=p=bt709',
        'tonemap=tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv',
        'format=yuv420p',
      ],
    };
  }
  if (CAPS.tonemap) {
    // Tanpa zscale: konversi ke float RGB lalu tonemap. Primaries tidak
    // dikonversi seakurat zscale, tapi jauh lebih baik daripada skip.
    return {
      mode: 'fallback',
      filters: [
        'format=gbrpf32le',
        'tonemap=tonemap=hable:desat=0',
        'format=yuv420p',
      ],
    };
  }
  return { mode: 'none', filters: [] };
}

/** Filter chain lengkap sesuai karakter sumber + target */
function buildFilters(meta, dims, opts = {}) {
  const g = buildFilterGraph(meta, dims, opts);
  return g.args.join(' ');
}

/**
 * Bangun filter graph video.
 * Mengembalikan `{ args, label, complex, text }`:
 *   complex=false → args = ['-vf', '...']            (jalur linear, murah)
 *   complex=true  → args = ['-filter_complex', '...'] (butuh label output)
 *
 * Jalur complex dipakai untuk mode 'pad' berlatar buram — hasil jauh lebih
 * enak dilihat di TikTok/IG daripada bar hitam, dan tetap 1 kanvas native.
 */
function buildFilterGraph(meta, dims, opts = {}) {
  const fps = opts.fps || 30;
  const sharpen = opts.sharpen ?? 0;
  const fit = dims.fit || 'none';

  /* Detail pemulihan: matriks luma diperbesar 5x5 → 7x7 saat di-upscale.
   * Hasil ukur: unsharp 7:7 @1.4 = VMAF 62.73 vs 5:5 @1.4 = 61.43. */
  const lumaM = sharpen > 0 && (dims.upscaleFactor || 1) > 1.05 ? 7 : 5;
  const tail = [];
  if (opts.denoise) tail.push('hqdn3d=2:1.5:6:6');
  if (sharpen > 0) tail.push(`unsharp=${lumaM}:${lumaM}:${sharpen}:5:5:0.0`);
  tail.push('setsar=1');
  tail.push('format=yuv420p');

  const hdr = meta.isHDR ? tonemapChain().filters : [];
  const lanczos = 'flags=lanczos+accurate_rnd+full_chroma_int:sws_dither=none';

  /* ---------- jalur linear (none / fill / pad warna solid) ---------- */
  if (fit !== 'pad' || opts.padStyle === 'solid') {
    const parts = [`fps=${fps}`];
    if (fit === 'fill' && dims.canvas) {
      parts.push(`scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase:${lanczos}`);
      parts.push(`crop=${dims.width}:${dims.height}`);
    } else if (fit === 'pad' && dims.canvas) {
      parts.push(`scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease:${lanczos}`);
      parts.push(`pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2:color=black`);
    } else {
      parts.push(`scale=${dims.width}:${dims.height}:${lanczos}`);
    }
    parts.push('setsar=1', ...hdr, ...tail.filter((t) => t !== 'setsar=1' && t !== 'format=yuv420p'), 'format=yuv420p');
    const text = parts.join(',');
    return { args: ['-vf', text], label: null, complex: false, text };
  }

  /* ---------- jalur complex: pad berlatar buram ---------- */
  const cw = dims.width;
  const ch = dims.height;
  const fw = dims.fg ? dims.fg.width : cw;
  const fh = dims.fg ? dims.fg.height : ch;
  /* CATATAN: di filter_complex satu label hanya boleh dikonsumsi SEKALI.
   * Sumber dipakai dua cabang (latar + subjek), jadi wajib di-`split` dulu.
   * Tanpa split, ffmpeg menolak: "Invalid stream specifier: src". */
  const graph = [
    `[0:v]fps=${fps},split=2[bgsrc][fgsrc]`,
    // latar: isi kanvas lalu buramkan + sedikit digelapkan biar subjek menonjol
    `[bgsrc]scale=${cw}:${ch}:force_original_aspect_ratio=increase:${lanczos},crop=${cw}:${ch}` +
      `${hdr.length ? ',' + hdr.join(',') : ''},gblur=sigma=${opts.blurSigma || 22},eq=brightness=-0.07:saturation=1.08[bg]`,
    // foreground: muat utuh, tetap tajam
    `[fgsrc]scale=${fw}:${fh}:force_original_aspect_ratio=decrease:${lanczos}${hdr.length ? ',' + hdr.join(',') : ''}[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,${tail.join(',')}[vout]`,
  ].join(';');
  return { args: ['-filter_complex', graph], label: 'vout', complex: true, text: graph };
}


/**
 * Rencana encode (ditampilkan ke user + dipakai engine).
 * @param {object} meta hasil extractMeta()
 * @param {object} options { target, quality, mode, trim, trimStartSec, sharpen, denoise, targetMB }
 */
function plan(meta, options = {}) {
  const opts = typeof options === 'string' ? { quality: options } : options || {};
  const target = getTarget(opts.target);
  const mode = pickMode(opts.mode);
  // v7.1: durasi tak terbaca (metadata kamera kosong) → asumsi aman 60 detik
  // untuk perencanaan bitrate; durasi riil tetap dibaca ulang setelah encode.
  const sourceDur = meta.durationSec > 0 ? meta.durationSec : 60;
  const durationAssumed = !(meta.durationSec > 0);

  /* --- Trim otomatis per target (WA 30s · IG 90s · Shorts 180s) --- */
  // trim: 'auto' (default) → pakai limit target · 'none' → mati
  //       'auto30' (kompat v4) → 30 detik · angka → detik eksplisit
  let trimLimit = null;
  if (opts.trim === 'none' || opts.trim === false) trimLimit = null;
  else if (opts.trim === 'auto30' || opts.trim === true) trimLimit = 30;
  else if (typeof opts.trim === 'number' && opts.trim > 0) trimLimit = opts.trim;
  else trimLimit = target.trimSec; // 'auto' / undefined → limit target

  const startSec = Math.max(0, Math.min(parseFloat(opts.trimStartSec) || 0, Math.max(0, sourceDur - 1)));
  const remaining = Math.max(1, sourceDur - startSec);
  const wantTrim = !!trimLimit && trimLimit > 0;
  const durationSec = wantTrim ? Math.min(remaining, trimLimit) : remaining;
  const trimmed = wantTrim && durationSec < sourceDur - 0.05;

  /* --- Kualitas / ladder --- */
  let rung = pickRung(target, durationSec, opts.quality);
  const autoQuality = !opts.quality || opts.quality === 'auto';
  const fps = Math.min(target.maxFps, Math.round(meta.fps || 30) || 30);
  const gopFrames = Math.max(2, Math.round(fps * ENGINE.gopSeconds)); // GOP 2 detik

  const srcPx = (meta.width || 0) * (meta.height || 0);
  const heavy =
    srcPx > 2073600 ||
    (meta.fps || 0) > 60 ||
    /hevc|h265/.test(meta.vCodec || '') ||
    !!meta.is4K || !!meta.is10bit || !!meta.isCameraRaw;
  // v7.1 — jalur hemat diperluas untuk file kamera langsung tanpa edit:
  //  - RAM kecil (LOW_MEM) + video berat → turun 1080p → 720p (auto)
  //  - 4K / HEVC / 10-bit / fps tinggi di server gratis → turun ke 720p walau
  //    RAM terdeteksi cukup, karena decode HEVC 4K rakus RAM + CPU.
  const cameraHeavy = !!meta.is4K || !!meta.isHEVC || (meta.isCameraRaw && srcPx > 2073600);
  const ecoDownscale =
    autoQuality && rung.key === '1080p' && (config.LOW_MEM ? heavy : cameraHeavy);
  if (ecoDownscale) rung = target.ladder[Math.min(1, target.ladder.length - 1)];
  // 4K mentah di mode Turbo/Seimbang: kunci ke 720p bila user tidak memilih
  // manual — 4K→1080p di server 512MB–1GB hampir pasti OOM.
  const force720for4K = !!meta.is4K && autoQuality && rung.key === '1080p';
  if (force720for4K) rung = target.ladder[Math.min(1, target.ladder.length - 1)];

  /* --- Kanvas platform + cara sumber diletakkan (fit) ---
   * 'none' = perilaku v5 (tidak pernah upscale). Selain itu engine menyiapkan
   * kanvas native platform supaya scaler TikTok/IG tidak ikut campur.        */
  const fitMode =
    opts.fit === undefined || opts.fit === null || opts.fit === 'auto'
      ? (target.fitDefault || 'none')
      : opts.fit;
  const dims = targetDims(rung, meta, { canvas: target.canvas || null, fit: fitMode });
  const audioKbps = meta.hasAudio ? ENGINE.audioBitrateKbps : 0;

  /* --- Budget ukuran (MB) per target --- */
  const maxMB = Math.min(opts.targetMB || Infinity, targetMaxMB(target));
  const sizeBudgetKbps = Math.floor((maxMB * 1024 * 8) / Math.max(1, durationSec));

  /* --- Estimasi bitrate video ---
   * 2-pass → isi sampai target mbps (dibatasi budget ukuran).
   * CRF    → perkiraan hasil CRF (≈62% cap), dibatasi target mbps.          */
  const capKbps = Math.round(rung.capMbps * 1000);
  const targetKbps = Math.round(rung.mbps * 1000);
  /* v5.0.2 "anti-pecah":
   *  - Maksimal (2-pass) isi sampai CAP platform (batas tertinggi yang masih
   *    diterima TikTok/IG/Shorts) — makin tinggi bitrate sumber, makin banyak
   *    detail yang bertahan setelah re-encode platform.
   *  - Seimbang (CRF) untuk target sosial pakai faktor 0.72×cap (lebih padat
   *    detail dari 0.62×cap di v5.0.0) tapi tetap ≤ target spec. */
  const crfFactor = ['tiktok', 'ig', 'shorts'].includes(target.key) ? 0.72 : 0.62;
  const qualityKbps = mode.twoPass
    ? (mode.key === 'max' ? capKbps : targetKbps)
    : Math.min(Math.round(capKbps * crfFactor), targetKbps);

  let videoKbps = Math.min(qualityKbps, capKbps);
  videoKbps = Math.min(videoKbps, Math.max(300, sizeBudgetKbps - audioKbps));
  videoKbps = Math.max(280, Math.round(videoKbps));

  // VBV maxrate efektif utk pass CRF: jangan sampai hasil melewati budget
  // ukuran (kalau lewat, tetap ada jaring 2-pass re-encode di belakang).
  const vbvMaxKbps = Math.max(300, Math.min(capKbps, Math.round(sizeBudgetKbps * 1.05) - audioKbps));

  const estimatedMB = Math.max(
    0.5,
    Math.round(((videoKbps + audioKbps) * durationSec) / 8192 * 10) / 10
  );

  /* --- Beban encoder & level H.264 --- */
  const lowMem = !!config.LOW_MEM;
  const lean = heavy || lowMem || config.FFMPEG_THREADS <= 2;
  const refs = lean ? 2 : 4; // 4 = aman utk level 4.2 di 1080p (DPB 4 frame)
  const bframes = lean ? 2 : 3; // v7.1: lean turun ke 2 (hemat DPB/RAM utk HEVC 4K)
  // rc-lookahead spec 40–60: normal 60, sumber berat 40, lean 20 (hemat RAM)
  const lookahead = lean ? 20 : heavy ? 40 : 60;
  const dpbFrames = Math.max(refs, bframes + 1);
  const level = chooseLevel(dims.width, dims.height, dpbFrames);
  // v7.1: file kamera mentah (HEVC/4K/VFR/10-bit) selalu veryfast bila 1-pass —
  // medium/slow di 4K HEVC bisa OOM di server 512MB–1GB.
  const preset =
    lowMem && heavy ? 'veryfast'
      : meta.isCameraRaw && !mode.twoPass ? 'veryfast'
      : heavy && !mode.twoPass ? 'fast'
      : mode.preset;
  const encThreads = Math.max(1, Math.min(lean ? 2 : config.FFMPEG_THREADS, 12));

  /* --- Loudness EBU R128 per target --- */
  const ln = target.loudness;
  const loudness = { I: ln.I, TP: ln.TP, LRA: ln.LRA, enabled: !!config.AUDIO_NORMALIZE && meta.hasAudio };

  /* --- Sharpen default per target (TikTok/IG ON) --- */
  let sharpen =
    typeof opts.sharpen === 'number' ? opts.sharpen
      : opts.sharpen === true ? (target.sharpenDefault || 0.2)
        : opts.sharpen === false ? 0
          : target.sharpenDefault;

  /* Skala sharpening mengikuti besar upscale. Interpolasi lanczos melembutkan
   * tepi, jadi makin besar upscale makin butuh pemulihan — tapi di atas ~2.2x
   * yang diperkuat cuma noise, maka dinaikkan secukupnya lalu dijepit. */
  const upF = dims.upscaleFactor || 1;
  if (sharpen > 0 && upF > 1.05) {
    const gain = Math.min(1.4, 0.85 + 0.28 * (upF - 1));
    sharpen = Math.min(1.6, +(sharpen * gain).toFixed(2));
  }

  const denoise = opts.denoise === false ? false : (opts.denoise === true || !!(meta.bpp && meta.bpp < 0.03));

  /* --- Catatan buat UI --- */
  if (mode.key === 'max' && sharpen > 0) {
    sharpen = +(sharpen + 0.05).toFixed(2);   // Maksimal: unsharp sedikit lebih nendang
  }

  const notes = [];
  notes.push(
    `Target ${target.label}: maks ${target.maxFps} fps · loudness ${ln.I} LUFS (TP ${ln.TP}) · ` +
    (target.trimSec ? `auto-trim ${target.trimSec}s · ` : '') + `budget ${maxMB} MB.`
  );
  if (lowMem && heavy) {
    notes.push(
      `Server ini RAM-nya ${config.MEM.limitMB} MB — engine otomatis pakai mode hemat ` +
      `(target ${rung.short}${ecoDownscale ? ' karena video berat' : ''}, lookahead ${lookahead}, ${encThreads} thread). ` +
      'Hasilnya tetap HD dan aman dari gagal proses.'
    );
  }
  if (heavy) {
    notes.push(
      `Sumber ${meta.width}x${meta.height} @ ${Math.round(meta.fps)}fps${/hevc/i.test(meta.vCodec || '') ? ' (HEVC)' : ''} — ` +
      `beban berat, engine pakai setting hemat (level ${level || 'auto'}, preset ${preset}).`
    );
  }
  // v7.1: penjelasan khusus file kamera langsung tanpa edit
  if (meta.isCameraRaw) {
    const feats = [];
    if (meta.is4K) feats.push('4K');
    if (meta.isHEVC) feats.push('HEVC/H.265');
    if (meta.is10bit) feats.push('10-bit');
    if (meta.isHighFps) feats.push(`${Math.round(meta.fps)}fps`);
    if (meta.isVFR) feats.push('VFR');
    if (meta.rotation) feats.push(`rotasi ${meta.rotation}°`);
    notes.push(
      `Terdeteksi video langsung dari kamera${feats.length ? ` (${feats.join(' · ')})` : ''} — ` +
      'engine menormalisasi otomatis (rotasi, frame rate, warna) dan memakai jalur hemat agar tidak gagal di server gratis. ' +
      'Tips: mode Turbo paling aman untuk file kamera besar.'
    );
  }
  if (durationAssumed) {
    notes.push('Durasi tidak terbaca dari metadata (umum pada file kamera) — engine memakai asumsi aman untuk perencanaan dan mengukur ulang durasi riil setelah encode.');
  }
  if (mode.key === 'max' && ['tiktok', 'ig', 'shorts'].includes(target.key)) {
    notes.push(`Mode Maksimal: 2-pass di ${rung.capMbps} Mbps (cap platform) + unsharp ${sharpen} — sumber paling tahan re-encode ${target.label}.`);
  }
  if (trimmed) notes.push(`Dipangkas otomatis ke ${Math.round(durationSec)} detik (limit ${target.label}) — sisa ${Math.round(sourceDur)} dtk diabaikan.`);
  if (target.key === 'ig' && durationSec > 60) notes.push('IG Story memotong sendiri ke 60 detik — Reels aman sampai 90 detik.');
  /* --- Catatan kanvas / anti-pecah (v6) --- */
  if (dims.fit && dims.fit !== 'none') {
    const srcSmaller = meta.width < dims.width || meta.height < dims.height;
    notes.push(
      `Kanvas native ${target.label} ${dims.width}x${dims.height} (${dims.fit === 'fill' ? 'crop penuh' : 'muat utuh + latar buram'}) ` +
      `— ${srcSmaller ? `sumber ${meta.width}x${meta.height} diperbesar ${upF.toFixed(2)}x pakai LANCZOS oleh engine` : 'sumber dikecilkan'} ` +
      'supaya scaler platform tidak ikut memproses ulang.'
    );
    if (dims.fit === 'fill' && dims.cropLoss > 0.01) {
      notes.push(`Mode crop penuh: ±${Math.round(dims.cropLoss * 100)}% area tepi terpotong. Ganti ke "Muat utuh" kalau ada bagian penting yang kepotong.`);
    }
    if (upF > 2.2) notes.push(`Upscale ${upF.toFixed(2)}x itu besar — hasil tetap lebih baik daripada diserahkan ke platform, tapi sumber aslinya memang kecil.`);
  } else if (!dims.upscaled && dims.width < rung.box.w && dims.height < rung.box.h && meta.width <= rung.box.w && meta.height <= rung.box.h) {
    notes.push('Ukuran asli lebih kecil dari target — tidak di-upscale biar gak makin pecah.');
  }
  if (meta.isVFR) notes.push('Framerate sumber tidak stabil (VFR) — dinormalisasi ke CFR.');
  if (meta.isHDR) {
    const tm = tonemapChain();
    notes.push(
      tm.mode === 'full' ? 'Sumber HDR/10-bit — dikonversi ke SDR BT.709 (zscale+tonemap) biar warna normal.'
        : tm.mode === 'fallback' ? 'Sumber HDR — tonemap mode fallback (ffmpeg tanpa zscale); warna aman, konversi primaries sederhana.'
          : 'Sumber HDR tapi ffmpeg tidak punya tonemap — hasil bisa terlihat pucat.'
    );
  }
  if (meta.bpp && meta.bpp < 0.03) notes.push('Sumber bitrate-nya tipis — denoise ringan dipakai biar noise berkurang.');
  if (sharpen > 0) notes.push(`Unsharp luma ${sharpen} aktif${target.sharpenDefault > 0 && opts.sharpen === undefined ? ' (default target ini — bikin detail bertahan setelah re-encode platform)' : ''}.`);
  if (target.key === 'wa' && !wantTrim && sourceDur > 30.5) notes.push('Video >30 dtk bakal kepotong otomatis sama WA saat di-post ke Status.');

  return {
    engine: { name: ENGINE.name, version: ENGINE.version },
    target: target.key,
    targetLabel: target.label,
    mode: mode.key,
    modeLabel: mode.label,
    modeDesc: mode.desc,
    profileKey: rung.key,
    profileLabel: rung.label,
    quality: rung.key,
    width: dims.width,
    height: dims.height,
    portrait: dims.height > dims.width,
    fit: dims.fit,
    canvas: dims.canvas || null,
    fg: dims.fg || null,
    upscaleFactor: dims.upscaleFactor || 1,
    cropLoss: dims.cropLoss || 0,
    fps,
    gopFrames,
    level: level || 'auto',
    durationSec: Math.round(durationSec * 10) / 10,
    sourceDurationSec: Math.round(sourceDur * 10) / 10,
    trimmed,
    trimStartSec: Math.round(startSec * 10) / 10,
    videoKbps,
    vbvMaxKbps,
    audioKbps,
    audioMode: meta.hasAudio ? (meta.audioChannels === 1 ? 'mono 48kHz' : 'stereo 48kHz') : 'tanpa audio',
    loudness,
    estimatedMB,
    maxOutputMB: maxMB,
    twoPass: mode.twoPass,
    enc: { refs, bframes, lookahead, level, preset, lean, heavy, lowMem, threads: encThreads },
    mem: { limitMB: config.MEM.limitMB, lowMem },
    denoise,
    sharpen,
    hdrTonemap: !!(meta.isHDR && tonemapChain().mode !== 'none'),
    camera: {
      isCameraRaw: !!meta.isCameraRaw,
      is4K: !!meta.is4K,
      isHEVC: !!meta.isHEVC,
      is10bit: !!meta.is10bit,
      isHighFps: !!meta.isHighFps,
      durationAssumed: !!durationAssumed,
    },
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * Util ffmpeg
 * ------------------------------------------------------------------ */
const killTree = (proc) => {
  if (!proc) return;
  try { proc.kill('SIGKILL'); } catch (_) { /* noop */ }
};

/**
 * Jalanin ffmpeg sekali (satu pass) dengan progress + stderr ringkas.
 * Progress mesin dibaca dari `-progress pipe:2` (bukan parsing -stats).
 * @returns {{promise: Promise<void>, cancel: Function}}
 */
function runFfmpeg(input, output, outputOptions, durationSec, onProgress, opts = {}) {
  let canceled = false;
  let proc = null;
  const startedAt = Date.now();
  const stderrTail = [];

  // v7.1 — flag toleran file kamera (edit list, negative CTS, moov di akhir):
  // +genpts (regenerasi timestamp), avoid_negative_ts, err_detect ignore_err,
  // analyseduration/probesize besar, dan max_muxing_queue_size untuk MOV padat.
  const cameraSafeInput = [
    '-err_detect', 'ignore_err',
    '-fflags', '+genpts+igndts',
    '-avoid_negative_ts', 'make_zero',
    '-analyzeduration', '20M',
    '-probesize', '20M',
  ];
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel', 'warning',
    '-stats_period', '0.4',
    '-progress', 'pipe:2',
    ...cameraSafeInput,
    ...(opts.inputOptions || []),
    '-i', input,
    '-max_muxing_queue_size', '9999',
    ...outputOptions,
    '-y', output,
  ];

  const promise = new Promise((resolve, reject) => {
    proc = spawn(BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const total = durationSec || 0;

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail.push(text);
      if (stderrTail.length > 40) stderrTail.shift();
      if (canceled || !onProgress) return;
      const usMatch = text.match(/out_time_us=(\d+)/) || text.match(/out_time_ms=(\d+)/);
      const timeMatch = text.match(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      let outSec = null;
      if (usMatch) outSec = parseInt(usMatch[1], 10) / 1e6;
      else if (timeMatch) outSec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3]);
      else {
        const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) outSec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
      }
      if (outSec == null || !Number.isFinite(outSec)) return;

      const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
      const speedMatch = text.match(/speed=\s*([\d.]+)x/);
      const fpsMatch = text.match(/(?:^|\n)fps=([-\d.]+)/) || text.match(/fps=\s*([-\d.]+)/);
      const speed = speedMatch ? parseFloat(speedMatch[1]) : outSec / elapsed;
      const phaseDur = opts.passDuration || total;
      const pct = phaseDur ? Math.min(99.5, (outSec / phaseDur) * 100) : 0;
      try {
        onProgress({
          percent: Math.max(0, Math.round(pct * 10) / 10),
          outSec: Math.round(outSec * 10) / 10,
          speed: speed > 0 && Number.isFinite(speed) ? Math.round(speed * 100) / 100 : null,
          fps: fpsMatch ? Math.round(parseFloat(fpsMatch[1])) : null,
          etaSec: speed > 0 && phaseDur ? Math.max(0, (phaseDur - outSec) / speed) : null,
          pass: opts.pass || null,
        });
      } catch (_) { /* noop */ }
    });

    proc.on('error', (err) => reject(canceled ? new Error('Proses dibatalkan') : err));
    proc.on('close', (code, signal) => {
      if (canceled) return reject(new Error('Proses dibatalkan'));
      if (code === 0) return resolve();

      const meaningful = stderrTail
        .join('')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^(frame|fps|stream_\d|bitrate|total_size|out_time|dup_frames|drop_frames|speed|progress)=/.test(l))
        .slice(-8);
      const tail = meaningful.join(' | ').slice(0, 600) || 'tanpa detail';

      const err = new Error(
        `ffmpeg gagal (exit ${code == null ? 'kill' : code}${signal ? `/${signal}` : ''}): ${tail}`
      );
      err.exitCode = code;
      err.signal = signal || null;
      err.detail = tail;
      err.oom =
        code === 137 || code === 9 || signal === 'SIGKILL' || signal === 'SIGABRT' ||
        code == null ||
        /cannot allocate memory|out of memory|killed/i.test(tail);
      return reject(err);
    });
  });

  return {
    promise,
    cancel: () => { canceled = true; killTree(proc); },
  };
}

/* ------------------------------------------------------------------ *
 * Loudness EBU R128 — 2 langkah (ukur dulu, baru apply linear)
 * ------------------------------------------------------------------
 * Single-pass loudnorm bersifat dinamis (bisa pumping). Dengan nilai
 * terukur + linear=true, gain-nya konstan → kualitas audio maksimal.
 * Gagal mengukur → fallback anggun ke loudnorm dinamis 1-pass.        */
function measureLoudness(input, ln, { startSec = 0, durationSec = 0 } = {}) {
  return new Promise((resolve) => {
    // loglevel 'info' WAJIB — ringkasan JSON loudnorm dicetak lewat log info
    // di stderr. -nostats biar tidak banjir baris progress.
    const args = ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info'];
    if (startSec > 0) args.push('-ss', String(startSec));
    if (durationSec > 0) args.push('-t', String(durationSec));
    args.push(
      '-i', input,
      '-map', '0:a:0',
      '-af', `loudnorm=I=${ln.I}:TP=${ln.TP}:LRA=${ln.LRA}:print_format=json`,
      '-f', 'null', '-'
    );
    let buf = '';
    let proc;
    try {
      proc = spawn(BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (_) { return resolve(null); }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) { /* noop */ } }, 60000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      if (buf.length > 64000) buf = buf.slice(-32000); // jaga memori
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const jsonStr = buf.slice(buf.lastIndexOf('{'), buf.lastIndexOf('}') + 1);
        const j = JSON.parse(jsonStr);
        const m = {
          measured_I: j.input_i,
          measured_TP: j.input_tp,
          measured_LRA: j.input_lra,
          measured_thresh: j.input_thresh,
          offset: j.target_offset,
        };
        const vals = Object.values(m);
        if (vals.some((v) => v == null || v === '-inf' || Number.isNaN(parseFloat(v)))) return resolve(null);
        resolve(m);
      } catch (_) {
        resolve(null);
      }
    });
  });
}

function loudnormFilter(ln, measured) {
  const base = `loudnorm=I=${ln.I}:TP=${ln.TP}:LRA=${ln.LRA}`;
  if (!measured) return base; // fallback dinamis 1-pass
  return (
    `${base}:measured_I=${measured.measured_I}:measured_TP=${measured.measured_TP}` +
    `:measured_LRA=${measured.measured_LRA}:measured_thresh=${measured.measured_thresh}` +
    `:offset=${measured.offset}:linear=true`
  );
}

/** Opsi audio konsisten (AAC 48 kHz 192 kbps + loudnorm terukur) */
function audioOptions({ hasAudio, channels, normalize, ln, measured }) {
  if (!hasAudio) return ['-an'];
  // v7.1: kamera modern bisa merekam 5.1 / float / PCM — selalu normalisasi
  // ke AAC stereo 48kHz agar kompatibel di semua platform + hemat bitrate.
  const outCh = channels === 1 ? 1 : 2;
  const opts = [
    '-c:a', 'aac',
    '-b:a', `${ENGINE.audioBitrateKbps}k`,
    '-ar', String(ENGINE.audioSampleRate),
    '-ac', String(outCh),
  ];
  if (normalize) opts.push('-af', loudnormFilter(ln, measured));
  return opts;
}

/** Opsi video output (x264 High · BT.709 · faststart).
 *  `filter` = hasil buildFilterGraph(): { args, label }.
 *  Kalau label ada (filter_complex), video di-map dari label itu, bukan 0:v:0. */
function videoOptions({ filter, crf, bitrateKbps, vbvMaxKbps, preset, enc = {}, gopFrames }) {
  const x264 = buildX264Params({
    refs: enc.refs ?? 4,
    bframes: enc.bframes ?? 3,
    lookahead: enc.lookahead ?? 60,
    lean: !!enc.lean,
  });
  const x264Only = CODEC === 'libx264';
  const fg = filter || { args: [], label: null };
  const opts = [
    ...(fg.args || []),
    ...(fg.label ? ['-map', `[${fg.label}]`] : ['-map', '0:v:0']),
    '-c:v', CODEC,
    ...(x264Only ? ['-preset', preset, '-profile:v', 'high', '-x264-params', x264, '-sc_threshold', '40'] : []),
    '-pix_fmt', 'yuv420p',
    '-g', String(gopFrames),
    ...(x264Only ? ['-keyint_min', String(Math.max(1, Math.round(gopFrames / 2)))] : []),
    '-movflags', '+faststart',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-map_metadata', '-1',
    '-threads', String(enc.threads || config.FFMPEG_THREADS),
  ];
  if (enc.level && x264Only) opts.push('-level', enc.level);
  if (crf != null) {
    // CRF + VBV cap: kualitas maksimal, bitrate gak ngebut ke angkasa
    opts.push('-crf', String(crf));
    if (vbvMaxKbps) {
      opts.push('-maxrate', `${Math.round(vbvMaxKbps)}k`, '-bufsize', `${Math.round(vbvMaxKbps * 1.75)}k`);
    }
  } else {
    // ABR 2-pass: ukuran file terjamin
    opts.push(
      '-b:v', `${Math.round(bitrateKbps)}k`,
      '-maxrate', `${Math.round(bitrateKbps * 1.15)}k`,
      '-bufsize', `${Math.round(bitrateKbps * 1.75)}k`
    );
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Kompresi utama
 * ------------------------------------------------------------------ */
/**
 * @param {string} input  path file sumber
 * @param {string} output path output (.mp4)
 * @param {object} meta   hasil extractMeta()
 * @param {Function} onProgress ({percent, etaSec, speed, pass})
 * @param {object|string} options { target, quality, mode, trim, trimStartSec, sharpen, denoise, targetMB }
 * @returns {{promise: Promise<object>, cancel: Function}}
 */
function compressVideo(input, output, meta, onProgress, options = {}) {
  const opts = typeof options === 'string' ? { quality: options } : options || {};
  // v7.1: validasi preflight — cegah ENOENT misterius & file 0-byte dari
  // unggahan kamera yang terputus di tengah jalan.
  if (!input || !fs.existsSync(input)) {
    const e = new Error('File sumber tidak ditemukan di server (ENOENT). Silakan unggah ulang video Anda.');
    return { promise: Promise.reject(e), cancel: () => {} };
  }
  try {
    const st = fs.statSync(input);
    if (!st || st.size <= 0) {
      const e = new Error('File sumber rusak (ukuran 0 byte). Silakan unggah ulang dengan koneksi yang stabil.');
      return { promise: Promise.reject(e), cancel: () => {} };
    }
  } catch (_) {
    const e = new Error('File sumber tidak dapat dibaca (ENOENT). Silakan unggah ulang video Anda.');
    return { promise: Promise.reject(e), cancel: () => {} };
  }
  if (!meta || !meta.width || !meta.height) {
    const e = new Error('Metadata video tidak valid. Pastikan file adalah video yang didukung (MP4/MOV/MKV/AVI/WebM/M4V/3GP).');
    return { promise: Promise.reject(e), cancel: () => {} };
  }
  const p = plan(meta, opts);
  const target = getTarget(p.target);

  const rung = target.ladder.find((x) => x.key === p.profileKey) || target.ladder[0];
  const mode = pickMode(p.mode);
  /* Objek dims LENGKAP (bukan cuma width/height) — buildFilterGraph butuh
   * `fit`, `canvas`, `fg`, dan `upscaleFactor`. Kalau field ini hilang, filter
   * jatuh ke scale polos dan video MELAR saat AR sumber ≠ AR kanvas. */
  const dims = targetDims(rung, meta, {
    canvas: target.canvas || null,
    fit: p.fit || 'none',
  });
  const gopFrames = p.gopFrames;

  const maxBytes = (opts.targetMB ? Math.min(opts.targetMB, targetMaxMB(target)) : targetMaxMB(target)) * 1024 * 1024;
  const passlog = path.join(os.tmpdir(), `hdjir_${crypto.randomBytes(6).toString('hex')}`);
  const cleanupPasslog = () => {
    for (const suffix of ['-0.log', '-0.log.mbtree', '.log', '.log.mbtree']) {
      try { fs.rmSync(passlog + suffix, { force: true }); } catch (_) { /* noop */ }
    }
  };

  let activeRun = null;
  let cancelRequested = false;

  // Cancel bisa datang SEBELUM proses ffmpeg pertama spawn (mis. saat fase
  // ukur loudness). Flag disimpan dan ditegakkan begitu run dimulai / fase berikutnya.
  const checkCancel = () => {
    if (cancelRequested) throw new Error('Proses dibatalkan');
  };

  const report = (payload) => {
    try { onProgress && onProgress(payload); } catch (_) { /* noop */ }
  };

  /** Satu percobaan encode (dipakai retry ladder di bawah) */
  const mkSpec = (over = {}) => {
    const rg = over.rung || rung;
    // over.dims harus objek dims LENGKAP (lihat catatan di atas). Untuk rung
    // utama pakai `dims` hasil plan; untuk rung lebih rendah hitung ulang.
    const dm = over.dims || dims;
    const enc = { ...(p.enc || {}), ...(over.enc || {}) };
    return {
      name: over.name || 'utama',
      rung: rg,
      mode: over.mode || mode,
      dims: dm,
      enc: { ...enc, threads: enc.threads || config.FFMPEG_THREADS },
      preset: over.preset || enc.preset || mode.preset,
      denoise: over.denoise !== undefined ? over.denoise : p.denoise,
      sharpen: over.sharpen !== undefined ? over.sharpen : p.sharpen,
    };
  };

  const filtersFor = (spec) =>
    buildFilterGraph(meta, spec.dims, { fps: p.fps, denoise: spec.denoise, sharpen: spec.sharpen });

  const decodeThreads = () => {
    const t = config.FFMPEG_THREADS;
    return (p.enc?.lean || p.enc?.heavy) ? Math.max(1, Math.min(2, t)) : Math.max(1, Math.min(4, t));
  };

  const trimIn = trimInputOptions(p);

  /* Loudness terukur (EBU R128 linear) — sekali per job, sebelum encode.
   * Mode turbo skip pengukuran biar tetap paling cepat (fallback dinamis). */
  const loudnessPromise = (meta.hasAudio && config.AUDIO_NORMALIZE && mode.key !== 'turbo')
    ? measureLoudness(input, p.loudness, { startSec: p.trimStartSec, durationSec: p.trimmed ? p.durationSec : 0 })
    : Promise.resolve(null);

  /** Encode 1-pass CRF (turbo/balanced) */
  const encodeCrf = async (spec, measured) => {
    const fg = filtersFor(spec);
    if (spec.name === 'utama') log.debug(`Filter${fg.complex ? ' (complex)' : ''}: ${fg.text}`);
    const crf = Math.max(12, Math.min(32, spec.rung.crf + spec.mode.crfBump));
    const run = runFfmpeg(
      input,
      output,
      [
        ...videoOptions({
          filter: fg,
          crf,
          vbvMaxKbps: p.vbvMaxKbps,
          preset: spec.preset,
          enc: spec.enc,
          gopFrames,
        }),
        '-map', '0:a:0?',
        ...audioOptions({
          hasAudio: meta.hasAudio,
          channels: meta.audioChannels,
          normalize: config.AUDIO_NORMALIZE,
          ln: p.loudness,
          measured,
        }),
      ],
      p.durationSec,
      report,
      {
        inputOptions: [...trimIn, '-threads', String(decodeThreads())],
        pass: 1,
        passDuration: p.durationSec,
      }
    );
    activeRun = run;
    if (cancelRequested) activeRun.cancel();
    await run.promise;
  };

  /** Encode 2-pass ABR target-size (mode max / fallback ukuran) */
  const encodeTwoPass = async (videoKbps, onPhase, spec, measured) => {
    const fg = filtersFor(spec);
    if (spec.name === 'utama') log.debug(`Filter${fg.complex ? ' (complex)' : ''}: ${fg.text}`);
    const pass1 = runFfmpeg(
      input,
      process.platform === 'win32' ? 'NUL' : '/dev/null',
      [
        ...(fg.args || []),
        ...(fg.label ? ['-map', `[${fg.label}]`] : ['-map', '0:v:0']),
        '-c:v', CODEC,
        ...(CODEC === 'libx264'
          ? [
              '-preset', spec.preset,
              '-profile:v', 'high',
              ...(spec.enc.level ? ['-level', spec.enc.level] : []),
              '-x264-params', buildX264Params({
                refs: spec.enc.refs, bframes: spec.enc.bframes, lookahead: spec.enc.lookahead, lean: spec.enc.lean,
              }),
            ]
          : []),
        '-pix_fmt', 'yuv420p',
        '-g', String(gopFrames),
        '-b:v', `${Math.round(videoKbps)}k`,
        '-pass', '1',
        '-passlogfile', passlog,
        '-an',
        '-f', 'null',
      ],
      p.durationSec,
      (prog) => onPhase && onPhase({ ...prog, percent: prog.percent * 0.45, pass: 1 }),
      {
        inputOptions: [...trimIn, '-threads', String(decodeThreads())],
        pass: 1,
        passDuration: p.durationSec,
      }
    );
    activeRun = pass1;
    if (cancelRequested) activeRun.cancel();
    await pass1.promise;

    const pass2 = runFfmpeg(
      input,
      output,
      [
        ...videoOptions({ filter: fg, crf: null, bitrateKbps: videoKbps, preset: spec.preset, enc: spec.enc, gopFrames }),
        '-map', '0:a:0?',
        ...audioOptions({
          hasAudio: meta.hasAudio,
          channels: meta.audioChannels,
          normalize: config.AUDIO_NORMALIZE,
          ln: p.loudness,
          measured,
        }),
        '-pass', '2',
        '-passlogfile', passlog,
      ],
      p.durationSec,
      (prog) => onPhase && onPhase({ ...prog, percent: 45 + prog.percent * 0.53, pass: 2 }),
      {
        inputOptions: [...trimIn, '-threads', String(decodeThreads())],
        pass: 2,
        passDuration: p.durationSec,
        startPercent: 45,
      }
    );
    activeRun = pass2;
    if (cancelRequested) activeRun.cancel();
    await pass2.promise;
  };

  /**
   * Retry ladder — bikin video "susah" tetap jadi.
   * 1: setting utama · 2: setting hemat · 3: turun satu tingkat resolusi.
   * Error tanpa harapan (file rusak, disk penuh, dibatalkan) tidak diulang.
   */
  const noRetry = (err) =>
    /dibatalkan|cancel/i.test(err.message) ||
    /invalid data|moov atom|could not find codec|decoder|no such file|permission denied|ENOSPC|no space/i.test(err.message);

  const runLadder = async (measured) => {
    const lowerIdx = Math.min(target.ladder.indexOf(rung) + 1, target.ladder.length - 1);
    const lowerRung = target.ladder[lowerIdx];
    const leanEnc = { refs: 2, bframes: 2, lookahead: 20, level: null, lean: true };

    const specs = [mkSpec({ name: 'utama' })];
    specs.push(mkSpec({
      name: 'hemat',
      preset: 'veryfast',
      enc: leanEnc,
      denoise: false,
      sharpen: 0,
    }));
    if (lowerRung && lowerRung.key !== rung.key) {
      specs.push(mkSpec({
        name: 'aman',
        rung: lowerRung,
        dims: targetDims(lowerRung, meta, { canvas: target.canvas || null, fit: dims.fit || 'none' }),
        preset: 'veryfast',
        enc: leanEnc,
        denoise: false,
        sharpen: 0,
      }));
    }

    let lastErr = null;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      checkCancel();
      try {
        if (i > 0) {
          log.warn(`Percobaan ${i + 1} (${spec.name}): ${spec.dims.width}x${spec.dims.height} preset ${spec.preset} — sebab: ${((lastErr && lastErr.message) || '').slice(0, 200)}`);
          report({
            percent: 0, etaSec: null, speed: null,
            pass: mode.twoPass ? 1 : null,
            phase: `ulang-${spec.name}`,
            retry: {
              attempt: i + 1,
              total: specs.length,
              name: spec.name,
              width: spec.dims.width,
              height: spec.dims.height,
              reason: (lastErr && lastErr.detail) || (lastErr && lastErr.message) || '',
            },
          });
          fs.rmSync(output, { force: true });
        }
        if (spec.mode.twoPass) await encodeTwoPass(p.videoKbps, report, spec, measured);
        else await encodeCrf(spec, measured);
        if (i > 0) log.info(`Berhasil di percobaan ${i + 1} (${spec.name}) — ${spec.dims.width}x${spec.dims.height}`);
        return spec;
      } catch (err) {
        lastErr = err;
        if (noRetry(err)) throw err;
        if (i === specs.length - 1) throw err;
      }
    }
    throw lastErr || new Error('Encode gagal');
  };

  const final = (async () => {
    try {
      checkCancel();
      const measured = await loudnessPromise;
      checkCancel();
      if (meta.hasAudio && config.AUDIO_NORMALIZE) {
        log.debug(measured ? `Loudness terukur: I=${measured.measured_I} TP=${measured.measured_TP} → linear ke ${p.loudness.I} LUFS` : 'Loudnorm fallback dinamis');
      }
      const usedSpec = await runLadder(measured);

      let size = fs.existsSync(output) ? fs.statSync(output).size : 0;

      // Ukuran masih kegedean → ulang 2-pass ABR biar PASTI masuk budget target
      if (size > maxBytes) {
        const audioKbps = meta.hasAudio ? ENGINE.audioBitrateKbps : 0;
        const budgetKbps = Math.floor((maxBytes * 8 * 0.97) / Math.max(1, p.durationSec)) - audioKbps;
        const abrKbps = Math.max(280, Math.min(Math.round(budgetKbps), Math.round(usedSpec.rung.mbps * 1000)));
        log.warn(`Hasil ${(size / 1048576).toFixed(1)}MB > budget ${(maxBytes / 1048576).toFixed(0)}MB (${target.label}) — re-encode 2-pass @ ${abrKbps}k`);
        report({ percent: 0, etaSec: null, speed: null, pass: 0, note: `Optimasi ukuran ke budget ${target.label}…` });
        fs.rmSync(output, { force: true });
        await encodeTwoPass(abrKbps, report, usedSpec, measured);
        size = fs.existsSync(output) ? fs.statSync(output).size : 0;
      }

      // Baca ulang metadata hasil akhir (realita, bukan estimasi)
      let outMeta = null;
      try { outMeta = extractMeta(await probe(output)); } catch (_) { /* noop */ }

      return {
        file: output,
        sizeBytes: size,
        sizeMB: +(size / 1048576).toFixed(2),
        width: outMeta?.width || usedSpec.dims.width,
        height: outMeta?.height || usedSpec.dims.height,
        durationSec: outMeta?.durationSec || p.durationSec,
        fps: outMeta?.fps || p.fps,
        target: target.key,
        targetLabel: target.label,
        profileKey: usedSpec.rung.key,
        profileLabel: usedSpec.rung.label,
        fellBack: usedSpec.name !== 'utama' ? usedSpec.name : null,
        mode: mode.key,
        modeLabel: mode.label,
        engine: `${ENGINE.name} v${ENGINE.version}`,
        videoKbps: p.videoKbps,
        audioKbps: p.audioKbps,
        trimmed: p.trimmed,
        hdrTonemap: p.hdrTonemap,
        estimatedMB: p.estimatedMB,
        plan: p,
      };
    } catch (err) {
      fs.rmSync(output, { force: true });
      throw err;
    } finally {
      cleanupPasslog();
    }
  })();

  return {
    promise: final,
    cancel: () => {
      cancelRequested = true;
      try { activeRun && activeRun.cancel(); } catch (_) { /* noop */ }
    },
  };
}

/** Opsi input untuk trim (kalau plan memangkas durasi) */
function trimInputOptions(p) {
  if (!p.trimmed) return [];
  const args = ['-ss', String(p.trimStartSec || 0)];
  if (p.durationSec) args.push('-t', String(p.durationSec));
  return args;
}

/* ------------------------------------------------------------------ *
 * Thumbnail (buat riwayat) — square crop biar rapi di UI
 * ------------------------------------------------------------------ */
function extractThumbnail(input, outFile, opts = {}) {
  const durationSec = typeof opts === 'number' ? opts : opts.durationSec || 0;
  const startSec = typeof opts === 'object' && opts.startSec ? opts.startSec : 0;
  // v7.1: durasi tak diketahui (file kamera) -> ambil frame detik ke-1
  const at = durationSec > 0
    ? Math.min(Math.max(0.5, startSec + Math.min(durationSec * 0.15, 6)), Math.max(0.5, durationSec - 0.1))
    : 1;
  const vf = 'scale=360:-2:flags=lanczos,crop=min(360\\,iw):min(360\\,ih)';
  const runOnce = (accurate) => new Promise((resolve) => {
    // Percobaan 1: fast seek (-ss sebelum -i). Bila gagal (file kamera dgn
    // edit list), percobaan 2: accurate seek (-ss setelah -i).
    const args = accurate
      ? ['-hide_banner', '-nostdin', '-loglevel', 'error', '-err_detect', 'ignore_err',
        '-i', input, '-ss', String(at), '-frames:v', '1', '-vf', vf, '-q:v', '3', '-y', outFile]
      : ['-hide_banner', '-nostdin', '-loglevel', 'error', '-err_detect', 'ignore_err',
        '-ss', String(at), '-i', input, '-frames:v', '1', '-vf', vf, '-q:v', '3', '-y', outFile];
    const proc = spawn(BIN, args, { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && fs.existsSync(outFile)));
  });
  return (async () => {
    if (await runOnce(false)) return true;
    return runOnce(true);
  })();
}

/** Ekstrak 1 frame penuh (buat preview/compare) */
function extractFrame(input, outFile, atSec) {
  return new Promise((resolve) => {
    const proc = spawn(
      BIN,
      ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(atSec), '-i', input, '-frames:v', '1', '-y', outFile],
      { stdio: 'ignore' }
    );
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && fs.existsSync(outFile)));
  });
}

/** SSIM output vs sumber (buat QA kualitas) */
function ssim(reference, test) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner', '-nostdin',
      '-i', reference, '-i', test,
      '-lavfi', 'ssim=stats_file=-',
      '-f', 'null', '-',
    ];
    const proc = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    proc.stdout.on('data', (d) => { buf += d.toString(); });
    proc.stderr.on('data', (d) => { buf += d.toString(); });
    proc.on('close', () => {
      const all = buf.match(/All:([\d.]+)/g);
      if (!all || !all.length) return resolve(null);
      const last = all[all.length - 1].split(':')[1];
      return resolve(parseFloat(last));
    });
    proc.on('error', () => resolve(null));
  });
}

function rm(file) {
  try { fs.rmSync(file, { force: true }); } catch (_) { /* noop */ }
}

module.exports = {
  BIN,
  PROBE,
  ENGINE,
  CAPS,
  TARGETS,
  MODES,
  getTarget,
  targetMaxMB,
  pickRung,
  pickMode,
  probe,
  probeDirect,
  extractMeta,
  plan,
  targetDims,
  buildFilterGraph,
  buildFilters,
  tonemapChain,
  measureLoudness,
  compressVideo,
  extractThumbnail,
  extractFrame,
  ssim,
  rm,
};
