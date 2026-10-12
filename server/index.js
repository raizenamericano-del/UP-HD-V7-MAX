'use strict';
/**
 * ============================================================================
 *  JernihHD — Server utama (Express + Socket.io)  ·  v7.1  ·  by Rifky
 * ============================================================================
 *  REST:
 *   GET    /api/health                  → healthcheck cepat (Railway)
 *   GET    /api/config                  → konfigurasi publik + target platform + engine
 *   GET    /api/engine                  → info mesin video (JernihHD Engine v7) + capabilities
 *   GET    /api/status                  → status koneksi WhatsApp
 *   POST   /api/connect/qr              → mulai socket & minta QR
 *   POST   /api/connect/pairing         → minta pairing code 8 char (Crockford uppercase)
 *   POST   /api/connect/pairing/refresh → kode baru / kode kedaluwarsa
 *   POST   /api/connect/pairing/cancel  → batal pairing, balik ke QR
 *   POST   /api/disconnect              → putus koneksi (session disimpan)
 *   POST   /api/logout                  → logout + hapus session
 *   POST   /api/upload                  → upload video (multipart) + plan per target
 *   POST   /api/plan                    → preview rencana encode (resolusi, bitrate, estimasi ukuran)
 *   GET    /api/history                 → riwayat PRIVAT milik perangkat ini saja
 *   DELETE /api/history/:id             → hapus entri riwayat (milik sendiri)
 *   DELETE /api/history                 → hapus semua riwayat (milik sendiri)
 *   GET    /api/thumb/:id?key=...       → thumbnail (wajib kunci akses privat)
 *   GET    /api/download/:id?key=...    → unduh video HD (wajib kunci akses privat)
 *
 *  PRIVASI v7.1: setiap browser punya ownerToken acak (localStorage).
 *  Riwayat, thumbnail, dan file unduhan HANYA bisa diakses pemiliknya.
 *  Tidak ada lagi riwayat global yang terlihat semua pengunjung.
 *
 *  Socket (client → server): video:process, video:resend, video:cancel,
 *                            history:get, history:delete
 *  Socket (server → client): conn:update, pairing:code, job:start,
 *                            compress:start, compress:progress, compress:done,
 *                            send:start, send:ack, send:done, send:error,
 *                            history:update, notice
 * ============================================================================
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');
const config = require('./config');
const { log } = require('./logger');
const historyStore = require('./history');
const WhatsAppManager = require('./whatsapp');
const videoLib = require('./video');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: 2e6,
  cors: { origin: true, credentials: true },
  // Encode video berat bisa membuat client idle lama; timeout dinaikkan agar
  // koneksi tidak dianggap mati di tengah proses.
  pingTimeout: 90000,
  pingInterval: 25000,
});

app.use(express.json({ limit: '1mb' }));

/* ============================================================
 * Header keamanan dasar
 * ============================================================ */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Jangan index file hasil / thumb oleh mesin pencari
  if (req.path.startsWith('/api/thumb') || req.path.startsWith('/api/download')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'private, max-age=3600');
  }
  next();
});

/* ============================================================
 * Auth opsional (APP_KEY)
 * ============================================================ */
function authOk(req) {
  return !config.APP_KEY || req.get('x-app-key') === config.APP_KEY;
}
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next(); // healthcheck selalu terbuka
  if (!authOk(req)) return res.status(401).json({ error: 'App key salah atau tidak tersedia.' });
  next();
});
io.use((socket, next) => {
  if (!config.APP_KEY || socket.handshake.auth?.key === config.APP_KEY) return next();
  next(new Error('unauthorized'));
});

/* ============================================================
 * PRIVASI v7.1 — Identitas pemilik per-perangkat
 * ============================================================
 * Client mengirim `x-owner-token` (string acak 32+ char, disimpan di
 * localStorage). Server TIDAK PERNAH mengembalikan data milik orang lain.
 */
function getOwnerToken(req) {
  const t =
    req.get?.('x-owner-token') ||
    req.query?.ot ||
    req.body?.ownerToken ||
    '';
  return historyStore.isValidOwner(t) ? t : null;
}
function getAccessKey(req) {
  const k = req.query?.key || req.get?.('x-access-key') || '';
  return typeof k === 'string' && /^[a-f0-9]{16,64}$/i.test(k) ? k : null;
}
function ownerRoom(ownerToken) {
  return `owner:${ownerToken}`;
}
/** Kirim daftar riwayat privat ke SATU pemilik saja (bukan broadcast global). */
function emitHistoryToOwner(ownerToken) {
  if (!historyStore.isValidOwner(ownerToken)) return;
  try {
    io.to(ownerRoom(ownerToken)).emit('history:update', historyStore.list(ownerToken));
  } catch (_) { /* noop */ }
}
/** Token terpotong untuk log (jangan pernah log token utuh). */
function shortToken(t) {
  return t ? `${String(t).slice(0, 4)}…${String(t).slice(-4)}` : '—';
}

/* ============================================================
 * WhatsApp manager
 * ============================================================ */
const wa = new WhatsAppManager(io);

/* ============================================================
 * Upload (multer) — file sementara di DATA_DIR/uploads
 * ============================================================ */
const uploads = new Map(); // uploadId → meta (+ ownerToken)

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (_req, _file, cb) => cb(null, `up_${crypto.randomBytes(8).toString('hex')}.upload`),
});

// v7.1: izinkan format kamera HP modern (MOV/HEVC/M4V/3GP + mimetype terkait).
// Beberapa browser Android mengirim mimetype generik untuk file kamera.
const VIDEO_EXT_RE = /\.(mp4|mov|mkv|avi|webm|3gp|3gpp|m4v|mpeg|mpg|wmv|flv|ts|mts|m2ts|hevc|h265|3g2)$/i;
function isVideoFile(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  const name = String(file?.originalname || '');
  if (mime.startsWith('video/')) return true;
  if (mime === 'application/octet-stream' && VIDEO_EXT_RE.test(name)) return true;
  if (/quicktime|mp4|3gpp/.test(mime)) return true;
  return VIDEO_EXT_RE.test(name);
}

const uploadMw = multer({
  storage,
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = isVideoFile(file);
    cb(
      ok ? null : new Error('File tersebut bukan video yang didukung. Gunakan MP4, MOV, MKV, AVI, WebM, M4V, atau 3GP.'),
      ok
    );
  },
}).single('video');

/* ============================================================
 * Pipeline: proses video (compress → send) dengan single-flight
 * ============================================================ */
const activeJob = { running: false, cancel: null, uploadId: null, startedAt: null, ownerToken: null };

function emitTo(socket, event, data) {
  try { socket.emit(event, data); } catch (_) { /* noop */ }
}

/** Normalisasi nomor tujuan: 0812… → 62812…, +62 → 62, dst */
function normalizeNumber(input) {
  let n = String(input || '').replace(/[^\d]/g, '');
  if (!n) throw new Error('Nomor tujuan masih kosong.');
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  if (n.startsWith('8')) n = `62${n}`;
  if (!/^\d{9,15}$/.test(n)) throw new Error('Nomor tujuan tidak valid. Contoh format yang benar: 6281234567890');
  return n;
}

function friendlyError(err) {
  const msg = (err && err.message) || 'Terjadi kesalahan. Silakan coba lagi.';
  if (/dibatalkan/i.test(msg)) return { code: 'CANCELED', message: 'Proses dibatalkan.' };
  if (/belum nyambung|tidak terhubung|belum terhubung/i.test(msg)) return { code: 'NOT_CONNECTED', message: msg };
  if (/gak ke-registrasi|tidak terdaftar|tidak terdaftar di WA/i.test(msg)) return { code: 'NOT_REGISTERED', message: msg };
  if (/bukan milik Anda|akses ditolak|tidak berhak/i.test(msg)) return { code: 'FORBIDDEN', message: 'Akses ditolak. File atau riwayat tersebut bukan milik perangkat Anda.' };
  if (/403|forbidden|banned|restrict/i.test(msg)) {
    return { code: 'BANNED', message: 'WhatsApp menolak pengiriman video (kemungkinan nomor sedang dibatasi). Coba lagi nanti atau gunakan nomor lain.' };
  }
  if (/413|too large|kegedean|melebihi/i.test(msg)) {
    return { code: 'TOO_LARGE', message: `Ukuran video melebihi batas. Coba mode Maksimal, aktifkan potong otomatis, atau pilih resolusi lebih kecil (720p). Batas unggah: ${config.MAX_UPLOAD_MB} MB.` };
  }
  if (/durasi maksimal|duration/i.test(msg) && /30 menit|menit/i.test(msg)) {
    return { code: 'TOO_LONG', message: msg };
  }
  if (/ffmpeg|codec|invalid data|moov|stream|gagal \(exit/i.test(msg)) {
    if (err && err.oom) {
      return {
        code: 'OOM',
        message: 'Server kehabisan memori saat memproses video ini (biasanya karena resolusi, frame rate, atau codec kamera yang berat seperti 4K / 60fps / HEVC). Silakan coba mode Turbo, potong durasi, atau pilih resolusi 720p.',
        hint: 'Catatan: layanan ini berjalan di server gratis dengan RAM terbatas, sehingga video besar dari kamera HP terkadang membutuhkan beberapa kali percobaan. Terima kasih atas pengertiannya.',
        detail: err.detail || msg,
      };
    }
    if (/DPB size|level limit|opening encoder/i.test(msg)) {
      return {
        code: 'ENCODER_INIT',
        message: 'Encoder menolak pengaturan untuk dimensi video ini. Engine akan mencoba ulang otomatis dengan pengaturan yang lebih aman.',
        detail: err.detail || msg,
      };
    }
    return {
      code: 'COMPRESS_FAILED',
      message: 'Gagal memproses video. Pastikan format didukung (MP4, MOV, MKV, AVI, WebM, M4V, 3GP) dan file tidak rusak. Untuk video langsung dari kamera (4K/60fps), coba mode Turbo terlebih dahulu.',
      detail: (err && err.detail) || msg,
    };
  }
  if (/ENOSPC|no space/i.test(msg)) {
    return { code: 'NO_SPACE', message: 'Penyimpanan server penuh. Silakan hapus riwayat Anda terlebih dahulu, lalu coba lagi.' };
  }
  if (/ENOENT|no such file|ilang di server|tidak ditemukan|kedaluwarsa/i.test(msg)) {
    return { code: 'NOT_FOUND', message: 'File tidak ditemukan di server (kemungkinan sesi kedaluwarsa atau server baru saja dimulai ulang). Silakan unggah ulang video Anda.' };
  }
  return { code: 'UNKNOWN', message: msg };
}

async function probeUpload(uploadId, ownerToken) {
  const meta = uploads.get(uploadId);
  if (!meta) throw new Error('File tidak ditemukan di server (sesi kedaluwarsa). Silakan unggah ulang.');
  // v7.1 strict: unggahan berpemilik HANYA boleh diakses pemiliknya.
  // Tanpa ownerToken yang cocok → tolak (mencegah tebakan uploadId anonim).
  if (meta.ownerToken && meta.ownerToken !== 'anon') {
    if (!ownerToken || meta.ownerToken !== ownerToken) {
      throw new Error('Akses ditolak. File tersebut bukan milik perangkat Anda.');
    }
  }
  if (!fs.existsSync(meta.file)) {
    uploads.delete(uploadId);
    throw new Error('File tidak ditemukan di server (sesi kedaluwarsa). Silakan unggah ulang.');
  }
  const st = fs.statSync(meta.file);
  if (!st || st.size <= 0) {
    uploads.delete(uploadId);
    try { fs.rmSync(meta.file, { force: true }); } catch (_) { /* noop */ }
    throw new Error('File unggahan rusak (ukuran 0 byte). Silakan unggah ulang dengan koneksi yang stabil.');
  }
  return meta;
}

/** Normalisasi opsi engine dari payload client */
function engineOptions(p = {}) {
  const target = videoLib.getTarget(p.target || config.DEFAULT_TARGET).key;
  let trim = 'auto';
  if (p.trim === false || p.trim === 'none' || p.trim === '0') trim = 'none';
  else if (p.trim === true || p.trim === 'auto30') trim = 'auto30';
  else if (p.trim === 'auto') trim = 'auto';
  else if (Number(p.trim) > 0) trim = Number(p.trim);
  if (trim === 'auto' && !config.AUTO_TRIM) trim = 'none';
  return {
    target,
    quality: p.quality || 'auto',
    mode: p.mode || config.ENGINE_MODE,
    trim,
    trimStartSec: Number(p.trimStartSec) || 0,
    sharpen: p.sharpen === true || p.sharpen === 'true' ? true : p.sharpen === false || p.sharpen === 'false' ? false : undefined,
    denoise: p.denoise === true ? true : p.denoise === false ? false : undefined,
    fit: ['smart', 'fill', 'pad', 'none'].includes(p.fit) ? p.fit : undefined,
  };
}

/**
 * Proses utama: kompres + kirim.
 * @param {object} socket socket.io client
 * @param {object} p { uploadId?, resendId?, target(s), caption?, quality?, mode?, trim? }
 */
async function runProcess(socket, p) {
  const ownerToken = socket?.data?.ownerToken || null;

  if (activeJob.running) {
    emitTo(socket, 'send:error', {
      code: 'BUSY',
      message: 'Server sedang memproses video lain. Mohon tunggu hingga selesai (atau batalkan proses berjalan). Server gratis hanya dapat menangani satu antrean dalam satu waktu.',
    });
    return;
  }

  activeJob.running = true;
  activeJob.startedAt = Date.now();
  activeJob.ownerToken = ownerToken;
  const jobStartedAt = activeJob.startedAt;
  let uploadMeta = null;
  let isResend = false;
  let resendEntry = null;
  const toDelete = [];
  const opts = engineOptions(p);

  try {
    emitTo(socket, 'job:start', { uploadId: p.uploadId || null, resendId: p.resendId || null, options: opts });

    /* 1) Sumber video */
    if (p.resendId) {
      const entry = historyStore.get(p.resendId, ownerToken, null);
      resendEntry = entry;
      if (!entry || entry.status !== 'success' || !entry.videoFile) {
        throw new Error('Riwayat atau file tersebut sudah tidak tersedia. Silakan unggah ulang video Anda.');
      }
      const vfile = path.join(config.VIDEOS_DIR, entry.videoFile);
      if (!fs.existsSync(vfile)) throw new Error('File video lama sudah terhapus dari server. Silakan unggah ulang.');
      let ffMeta;
      try {
        ffMeta = await videoLib.probe(vfile);
      } catch (e) {
        throw new Error('File video lama tidak dapat dibaca (kemungkinan rusak atau terhapus sebagian). Silakan unggah ulang.');
      }
      uploadMeta = {
        file: vfile,
        originalName: entry.originalName,
        ...videoLib.extractMeta(ffMeta),
      };
      isResend = true;
    } else {
      uploadMeta = await probeUpload(p.uploadId, ownerToken);
    }

    /* 2) Nomor tujuan */
    if (!p.target && resendEntry?.platform) opts.target = resendEntry.platform;
    const platformKey = String(opts.target || 'wa');
    const rawTargets = String(p.targets || (resendEntry ? (resendEntry.targets || []).join(',') : ''))
      .split(/[,;\s]+/)
      .filter(Boolean);
    let targets = [];
    if (platformKey === 'wa' || rawTargets.length) {
      if (!rawTargets.length) {
        throw new Error('Nomor tujuan masih kosong. Untuk target WA Status, video dikirim ke nomor WhatsApp Anda sendiri.');
      }
      targets = rawTargets.map(normalizeNumber);
      if (targets.length > 5) throw new Error('Maksimal 5 nomor tujuan dalam satu proses.');
      for (const t of targets) {
        const exists = await wa.isOnWhatsApp(t);
        if (!exists) throw new Error(`Nomor ${t} tidak terdaftar di WhatsApp. Mohon periksa kembali.`);
      }
    }
    const downloadOnly = targets.length === 0;

    /* 3) Kompres (kecuali resend — file sudah terkompres) */
    let result;
    if (!isResend) {
      const jobPlan = videoLib.plan(uploadMeta, opts);
      emitTo(socket, 'compress:start', { uploadId: p.uploadId, plan: jobPlan });

      const outFile = path.join(config.VIDEOS_DIR, `${p.uploadId}.mp4`);
      const thumbFile = path.join(config.VIDEOS_DIR, `${p.uploadId}.jpg`);
      const handle = videoLib.compressVideo(
        uploadMeta.file,
        outFile,
        uploadMeta,
        (prog) => {
          activeJob.lastProgressAt = Date.now();
          emitTo(socket, 'compress:progress', { uploadId: p.uploadId, ...prog });
        },
        opts
      );
      activeJob.cancel = () => handle.cancel();
      activeJob.uploadId = p.uploadId;

      activeJob.lastProgressAt = Date.now();
      activeJob.heartbeat = setInterval(() => {
        const idle = Date.now() - (activeJob.lastProgressAt || Date.now());
        emitTo(socket, 'compress:progress', {
          uploadId: p.uploadId,
          percent: null,
          heartbeat: true,
          idleSec: Math.round(idle / 1000),
          elapsedSec: Math.round((Date.now() - jobStartedAt) / 1000),
          note: idle > 12000 ? 'Server masih memproses video (video berat membutuhkan waktu lebih lama)…' : null,
        });
      }, 5000);

      try {
        result = await handle.promise;
      } finally {
        clearInterval(activeJob.heartbeat);
        activeJob.heartbeat = null;
      }

      await videoLib.extractThumbnail(uploadMeta.file, thumbFile, {
        durationSec: uploadMeta.durationSec,
        startSec: jobPlan.trimStartSec,
      });

      emitTo(socket, 'compress:done', {
        uploadId: p.uploadId,
        sizeMB: result.sizeMB,
        width: result.width,
        height: result.height,
        profileLabel: result.profileLabel,
        mode: result.mode,
        engine: result.engine,
        trimmed: result.trimmed,
        fellBack: result.fellBack || null,
        plan: result.plan,
      });
    } else {
      const ffMeta = await videoLib.probe(uploadMeta.file);
      const m = videoLib.extractMeta(ffMeta);
      result = {
        file: uploadMeta.file,
        sizeBytes: fs.statSync(uploadMeta.file).size,
        sizeMB: +(fs.statSync(uploadMeta.file).size / 1048576).toFixed(2),
        width: m.width,
        height: m.height,
        durationSec: m.durationSec,
        profileLabel: 'Tersimpan (HD)',
        profileKey: 'saved',
        mode: 'resend',
        modeLabel: 'Versi tersimpan',
        engine: historyStore.getInternal(p.resendId)?.engine || 'JernihHD Engine',
        videoKbps: 0,
      };
    }

    /* 4) Kirim via WhatsApp — dilewati bila mode unduh */
    const sent = [];
    if (downloadOnly) {
      emitTo(socket, 'send:start', { targets: [], downloadOnly: true });
    } else {
      emitTo(socket, 'send:start', { targets });
      for (const t of targets) {
        sent.push(
          await wa.sendVideo(t, result.file, p.caption || undefined, {
            width: result.width,
            height: result.height,
            durationSec: result.durationSec,
            fileName: (uploadMeta.originalName || 'video').replace(/\.[^.]+$/, '') + '-HD.mp4',
          })
        );
      }
    }

    /* 5) Catat riwayat PRIVAT milik pemilik ini */
    const thumbName = isResend ? null : `${p.uploadId}.jpg`;
    const entry = historyStore.add({
      ownerToken: ownerToken || 'anon',
      targets,
      target: targets[0] || null,
      count: targets.length,
      downloadOnly,
      platform: result.target || opts.target,
      platformLabel: result.targetLabel || videoLib.getTarget(opts.target).label,
      quality: result.profileKey || p.quality || 'auto',
      mode: result.mode || opts.mode,
      engine: result.engine || `${videoLib.ENGINE.name} v${videoLib.ENGINE.version}`,
      originalName: uploadMeta.originalName || 'video.mp4',
      durationSec: Math.round(result.durationSec * 10) / 10,
      width: result.width,
      height: result.height,
      resolution: `${result.width}x${result.height}`,
      sizeMB: result.sizeMB,
      profileLabel: result.profileLabel,
      videoKbps: result.videoKbps || 0,
      trimmed: !!result.trimmed,
      status: 'success',
      source: isResend ? 'resend' : 'upload',
      messageIds: sent.map((s) => s.messageId).filter(Boolean),
      videoFile: path.basename(result.file),
      thumbFile: thumbName,
      userCaption: (p.caption || '').slice(0, 200) || null,
    });
    emitHistoryToOwner(ownerToken);

    /* 6) Bersihkan upload sementara (hasil kompres DIPERTAHANKAN utk resend/unduh) */
    if (!isResend) toDelete.push(uploadMeta.file);
    log.info(
      `Selesai [${shortToken(ownerToken)}]: ${entry.originalName} → ${downloadOnly ? 'UNDUH (mode unduh, tanpa WA)' : targets.join(', ')} ` +
      `(${entry.sizeMB} MB · ${entry.resolution} · ${entry.mode} · ${((Date.now() - activeJob.startedAt) / 1000).toFixed(1)}s)`
    );

    emitTo(socket, 'send:done', {
      uploadId: p.uploadId,
      resendId: p.resendId || null,
      messageIds: sent.map((s) => s.messageId),
      targets,
      target: targets[0] || null,
      entryId: entry.id,
      accessToken: entry.accessToken,
      downloadOnly,
      downloadUrl: `/api/download/${entry.id}?key=${entry.accessToken}`,
      meta: {
        sizeMB: entry.sizeMB ?? result.sizeMB ?? null,
        durationSec: entry.durationSec,
        resolution: entry.resolution,
        profileLabel: entry.profileLabel,
        mode: entry.mode,
        engine: entry.engine,
        trimmed: entry.trimmed,
        videoKbps: entry.videoKbps,
        platform: entry.platform || null,
        platformLabel: entry.platformLabel || null,
        downloadOnly,
        downloadUrl: `/api/download/${entry.id}?key=${entry.accessToken}`,
      },
    });
  } catch (err) {
    const f = friendlyError(err);
    log.error(`Proses video gagal [${shortToken(ownerToken)}]:`, err.message);
    if (err && err.detail) log.error('Detail ffmpeg:', String(err.detail).slice(0, 500));
    if (uploadMeta) {
      historyStore.add({
        ownerToken: ownerToken || 'anon',
        target: p.target || null,
        originalName: uploadMeta.originalName || 'video.mp4',
        status: 'failed',
        error: f.message,
        errorCode: f.code,
        errorDetail: (f.detail || '').slice(0, 600),
        source: isResend ? 'resend' : 'upload',
        mode: opts.mode,
      });
      emitHistoryToOwner(ownerToken);
    }
    emitTo(socket, 'send:error', f);
  } finally {
    toDelete.forEach((f) => videoLib.rm(f));
    if (!isResend && p.uploadId) uploads.delete(p.uploadId);
    activeJob.running = false;
    activeJob.cancel = null;
    activeJob.uploadId = null;
    activeJob.startedAt = null;
    activeJob.ownerToken = null;
  }
}

/* ============================================================
 * REST API
 * ============================================================ */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: config.APP_NAME,
    version: config.VERSION,
    engine: `${videoLib.ENGINE.name} v${videoLib.ENGINE.version}`,
    waState: wa.state,
    waConnected: wa.state === 'connected',
    uptimeSec: Math.round(process.uptime()),
    busy: activeJob.running,
    mock: config.MOCK_SEND,
    mem: { limitMB: config.MEM.limitMB, from: config.MEM.fromCgroup ? 'cgroup' : 'host', lowMem: config.LOW_MEM },
    ffmpegThreads: config.FFMPEG_THREADS,
    ts: new Date().toISOString(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    appName: config.APP_NAME,
    brand: config.BRAND,
    slug: config.SLUG,
    tagline: config.TAGLINE,
    version: config.VERSION,
    developer: config.DEVELOPER,
    maxUploadMB: config.MAX_UPLOAD_MB,
    maxOutputMB: config.MAX_OUTPUT_MB,
    statusMaxMB: config.STATUS_MAX_MB,
    statusMaxSec: config.STATUS_MAX_SEC,
    mockSend: config.MOCK_SEND,
    appKeyRequired: !!config.APP_KEY,
    privacy: {
      mode: 'private-per-device',
      note: 'Riwayat, thumbnail, dan file hasil hanya dapat diakses dari perangkat yang mengunggah.',
    },
    serverNotice: config.SERVER_NOTICE,
    donate: config.DONATE,
    engine: {
      name: videoLib.ENGINE.name,
      version: videoLib.ENGINE.version,
      audioBitrateKbps: videoLib.ENGINE.audioBitrateKbps,
      audioNormalize: config.AUDIO_NORMALIZE,
      codec: 'H.264 High 4.2 + AAC 192k',
      hdrTonemap: !!(videoLib.CAPS.zscale && videoLib.CAPS.tonemap) || !!videoLib.CAPS.tonemap,
      ffmpeg: videoLib.CAPS.version,
      defaultMode: config.ENGINE_MODE,
      defaultTarget: config.DEFAULT_TARGET,
      autoTrimDefault: config.AUTO_TRIM,
    },
    targets: Object.values(videoLib.TARGETS).map((t) => ({
      key: t.key,
      label: t.label,
      short: t.short,
      desc: t.desc,
      maxFps: t.maxFps,
      trimSec: t.trimSec,
      maxMB: videoLib.targetMaxMB(t),
      loudness: t.loudness,
      sharpenDefault: t.sharpenDefault,
      canvas: t.canvas || null,
      fitDefault: t.fitDefault || 'none',
      ladder: t.ladder.map(({ key, label, short, mbps, capMbps, crf }) => ({
        key, label, short, bitrateMbps: mbps, capMbps, crf,
      })),
    })),
    modes: Object.values(videoLib.MODES).map(({ key, label, desc, twoPass }) => ({ key, label, desc, twoPass })),
  });
});

app.get('/api/engine', (_req, res) => {
  res.json({
    engine: videoLib.ENGINE,
    caps: videoLib.CAPS,
    targets: Object.values(videoLib.TARGETS).map((t) => ({
      ...t,
      maxMB: videoLib.targetMaxMB(t),
      autoQuality: undefined,
    })),
    modes: Object.values(videoLib.MODES),
    limits: {
      maxUploadMB: config.MAX_UPLOAD_MB,
      maxOutputMB: config.MAX_OUTPUT_MB,
      statusMaxMB: config.STATUS_MAX_MB,
      statusMaxSec: config.STATUS_MAX_SEC,
    },
    mem: { limitMB: config.MEM.limitMB, lowMem: config.LOW_MEM },
  });
});

app.get('/api/status', (_req, res) => res.json(wa.status()));

app.post('/api/connect/qr', async (_req, res) => {
  try {
    res.json(await wa.requestQR());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connect/pairing', async (req, res) => {
  try {
    const info = await wa.requestPairing(req.body?.number);
    if (info?.superseded) return res.status(409).json({ error: info.lastError || 'Permintaan kode digantikan oleh permintaan lain.', superseded: true });
    const diminta = normalizeNumber(req.body?.number);
    if (info?.code && info.number !== diminta) {
      return res.status(409).json({
        error: `Kode yang diterbitkan terdaftar untuk ${info.number}, bukan ${diminta}. Silakan klik "Ambil Kode" sekali lagi.`,
        mismatch: true,
      });
    }
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/connect/pairing/refresh', async (req, res) => {
  try {
    const number = req.body?.number || wa.pairingNumber;
    if (!number) throw new Error('Nomor WhatsApp belum diisi.');
    const info = await wa.requestPairing(number, { refresh: true });
    if (info?.superseded) return res.status(409).json({ error: info.lastError || 'Permintaan kode digantikan oleh permintaan lain.', superseded: true });
    const diminta = normalizeNumber(number);
    if (info?.code && info.number !== diminta) {
      return res.status(409).json({
        error: `Kode yang diterbitkan terdaftar untuk ${info.number}, bukan ${diminta}. Silakan coba sekali lagi.`,
        mismatch: true,
      });
    }
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/connect/pairing/cancel', async (_req, res) => {
  try {
    wa.cancelPairing();
    wa.setState('idle');
    await wa.requestQR();
    res.json({ ok: true, ...wa.status() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/disconnect', async (_req, res) => {
  await wa.disconnect();
  res.json({ ok: true });
});

app.post('/api/logout', async (_req, res) => {
  await wa.logout();
  res.json({ ok: true });
});

app.post('/api/upload', (req, res) => {
  const ownerToken = getOwnerToken(req);
  uploadMw(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Ukuran video melebihi batas ${config.MAX_UPLOAD_MB} MB.`
        : err.message || 'Unggahan gagal.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Belum ada file yang diunggah.' });
    if (!req.file.size || req.file.size <= 0) {
      videoLib.rm(req.file.path);
      return res.status(400).json({ error: 'File unggahan rusak (ukuran 0 byte). Silakan unggah ulang dengan koneksi yang stabil.' });
    }

    try {
      let ffMeta;
      try {
        ffMeta = await videoLib.probe(req.file.path);
      } catch (e) {
        videoLib.rm(req.file.path);
        log.warn(`Probe gagal untuk ${req.file.originalname}: ${e.message}`);
        return res.status(400).json({ error: 'File tidak dapat dibaca sebagai video. Pastikan file tidak rusak dan gunakan format MP4, MOV, MKV, AVI, WebM, M4V, atau 3GP.' });
      }
      const meta = videoLib.extractMeta(ffMeta);
      if (!meta.width || !meta.height) {
        videoLib.rm(req.file.path);
        return res.status(400).json({ error: 'File tidak memiliki trek video yang valid. Gunakan MP4, MOV, MKV, AVI, WebM, M4V, atau 3GP.' });
      }
      // Durasi 0 (metadata kamera kadang kosong) → izinkan, engine akan menangani.
      if (meta.durationSec > 60 * 30 + 1) {
        videoLib.rm(req.file.path);
        return res.status(400).json({ error: 'Durasi video maksimal 30 menit.' });
      }
      const uploadId = crypto.randomBytes(8).toString('hex');
      uploads.set(uploadId, {
        file: req.file.path,
        originalName: req.file.originalname || 'video.mp4',
        sizeBytes: req.file.size,
        uploadedAt: Date.now(),
        ownerToken: ownerToken || 'anon',
        ...meta,
      });

      const target = videoLib.getTarget(req.body?.target || config.DEFAULT_TARGET);
      const baseOpts = engineOptions({ target: target.key, mode: config.ENGINE_MODE });
      const plans = {};
      for (const rung of target.ladder) {
        plans[rung.key] = videoLib.plan(meta, { ...baseOpts, quality: rung.key });
      }
      res.json({
        uploadId,
        plan: videoLib.plan(meta, baseOpts),
        plans,
        target: target.key,
        targets: Object.values(videoLib.TARGETS).map((t) => ({ key: t.key, label: t.label, short: t.short })),
        meta: {
          originalName: req.file.originalname,
          sizeMB: +(req.file.size / 1048576).toFixed(2),
          durationSec: Math.round(meta.durationSec * 10) / 10,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          isHDR: meta.isHDR,
          isVFR: meta.isVFR,
          codec: meta.vCodec,
        },
      });
    } catch (e) {
      videoLib.rm(req.file.path);
      log.warn('Upload gagal diproses:', e.message);
      res.status(400).json({ error: 'File tidak valid sebagai video. Silakan coba file lain.' });
    }
  });
});

/**
 * Preview rencana encode sesuai pilihan pengguna — resolusi, bitrate,
 * estimasi ukuran, filter, loudness — per TARGET PLATFORM.
 */
app.post('/api/plan', express.json(), async (req, res) => {
  try {
    const ownerToken = getOwnerToken(req);
    const { uploadId, target, quality, mode, trim, trimStartSec, sharpen, denoise, fit } = req.body || {};
    const meta = await probeUpload(uploadId, ownerToken);
    const opts = engineOptions({ target, quality, mode, trim, trimStartSec, sharpen, denoise, fit });
    const tgt = videoLib.getTarget(opts.target);
    const plans = {};
    for (const rung of tgt.ladder) {
      plans[rung.key] = videoLib.plan(meta, { ...opts, quality: rung.key });
    }
    const plan = videoLib.plan(meta, opts);
    res.json({ plan, plans, target: tgt.key, targets: Object.values(videoLib.TARGETS).map((t) => ({ key: t.key, label: t.label, short: t.short })) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ---------- Riwayat PRIVAT ---------- */
app.get('/api/history', (_req, res) => {
  const ownerToken = getOwnerToken(_req);
  res.json(historyStore.list(ownerToken));
});

app.delete('/api/history/:id', (req, res) => {
  const ownerToken = getOwnerToken(req);
  const ok = historyStore.remove(req.params.id, ownerToken);
  if (!ok) {
    log.warn(`Hapus riwayat ditolak [${shortToken(ownerToken)}] id=${req.params.id}`);
    return res.status(403).json({ error: 'Akses ditolak. Riwayat tersebut bukan milik perangkat Anda.' });
  }
  emitHistoryToOwner(ownerToken);
  res.json({ ok: true });
});

app.delete('/api/history', (req, res) => {
  const ownerToken = getOwnerToken(req);
  historyStore.clearOwner(ownerToken);
  emitHistoryToOwner(ownerToken);
  res.json({ ok: true });
});

/** Otorisasi thumb/unduh: owner cocok ATAU kunci akses cocok. */
function authorizeFileAccess(req, entryId) {
  const ownerToken = getOwnerToken(req);
  const accessKey = getAccessKey(req);
  // Header socket-less clients (img/a) mengirim kunci via query ?key=
  const keyFromOtQuery = null;
  const entry = historyStore.get(entryId, ownerToken, accessKey || keyFromOtQuery);
  return { entry, ownerToken };
}

app.get('/api/thumb/:id', (req, res) => {
  const { entry } = authorizeFileAccess(req, req.params.id);
  if (!entry || !entry.thumbFile) return res.status(404).end();
  const f = path.join(config.VIDEOS_DIR, entry.thumbFile);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});

/** Unduh video hasil kompres (HD) — privat, wajib kunci akses */
app.get('/api/download/:id', (req, res) => {
  const { entry } = authorizeFileAccess(req, req.params.id);
  if (!entry || !entry.videoFile) {
    // Jangan bocorkan apakah ID ada atau tidak — balas 404 generik.
    return res.status(404).json({ error: 'File tidak ditemukan atau Anda tidak memiliki akses. Riwayat bersifat privat per perangkat.' });
  }
  const f = path.join(config.VIDEOS_DIR, entry.videoFile);
  if (!fs.existsSync(f)) {
    log.warn(`Download miss: file ${entry.videoFile} tidak ada di ${config.VIDEOS_DIR}.`);
    return res.status(404).json({ error: 'File video sudah tidak tersedia di penyimpanan server (penyimpanan sementara telah dibersihkan). Silakan proses ulang video Anda.' });
  }
  const base = String(entry.originalName || 'video').replace(/\.[^.]+$/, '').replace(/[^\w\-. ]+/g, '');
  const name = `${base || 'video'}-${entry.resolution || 'HD'}-HD.mp4`;
  res.download(f, name);
});

/* ============================================================
 * Socket.io
 * ============================================================ */
io.on('connection', (socket) => {
  // Identitas privat dari handshake
  const hsOwner = socket.handshake.auth?.ownerToken || socket.handshake.query?.ot || null;
  const ownerToken = historyStore.isValidOwner(hsOwner) ? hsOwner : null;
  socket.data.ownerToken = ownerToken;
  if (ownerToken) {
    try { socket.join(ownerRoom(ownerToken)); } catch (_) { /* noop */ }
  }
  log.info(`Client terhubung: ${socket.id} [${shortToken(ownerToken)}]`);
  socket.emit('conn:update', wa.status());
  socket.emit('history:update', historyStore.list(ownerToken));
  if (wa.pairingInfo()?.active) socket.emit('pairing:code', wa.pairingInfo());

  socket.on('video:process', (p) => runProcess(socket, p || {}));
  socket.on('video:resend', (p) => runProcess(socket, { ...(p || {}), resendId: p?.id || p?.resendId }));
  socket.on('video:cancel', () => {
    // Hanya pemilik job berjalan yang boleh membatalkan
    if (activeJob.running && activeJob.ownerToken && ownerToken && activeJob.ownerToken !== ownerToken) {
      emitTo(socket, 'send:error', { code: 'FORBIDDEN', message: 'Tidak dapat membatalkan proses milik pengguna lain.' });
      return;
    }
    try { if (activeJob.cancel) activeJob.cancel(); } catch (_) { /* noop */ }
  });
  socket.on('history:get', () => socket.emit('history:update', historyStore.list(ownerToken)));
  socket.on('history:delete', (id) => {
    historyStore.remove(id, ownerToken);
    emitHistoryToOwner(ownerToken);
  });
  socket.on('disconnect', () => log.info(`Client terputus: ${socket.id}`));
});

/* ============================================================
 * Static frontend (production) + SPA fallback
 * ============================================================ */
const DIST = path.join(config.ROOT, 'client', 'dist');
if (fs.existsSync(DIST)) {
  app.use(
    express.static(DIST, {
      setHeaders: (res, filePath) => {
        if (/\/assets\//.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (/manifest|\.png|\.svg|\.ico/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

/* ============================================================
 * Cleanup berkala: file upload basi & prune video lama
 * ============================================================ */
function sweep() {
  const now = Date.now();
  for (const [id, m] of uploads) {
    if (now - m.uploadedAt > config.UPLOAD_TTL_MS) {
      videoLib.rm(m.file);
      uploads.delete(id);
    }
  }
  // Prune memakai daftar INTERNAL (semua pemilik) agar file yatim tetap bersih.
  const list = historyStore.listAllInternal();
  const kept = new Set();
  // Urutkan terbaru dulu, pertahankan KEEP_VIDEOS terakhir per pemilik
  const perOwner = new Map();
  for (const e of list) {
    if (e.status !== 'success' || !e.videoFile) continue;
    const k = e.ownerToken || 'anon';
    const n = perOwner.get(k) || 0;
    if (n < config.KEEP_VIDEOS) {
      perOwner.set(k, n + 1);
      kept.add(e.videoFile);
      if (e.thumbFile) kept.add(e.thumbFile);
    }
  }
  try {
    for (const f of fs.readdirSync(config.VIDEOS_DIR)) {
      if (!kept.has(f)) videoLib.rm(path.join(config.VIDEOS_DIR, f));
    }
  } catch (_) { /* noop */ }
  try {
    for (const f of fs.readdirSync(config.UPLOAD_DIR)) {
      const p = path.join(config.UPLOAD_DIR, f);
      const st = fs.statSync(p);
      if (now - st.mtimeMs > config.UPLOAD_TTL_MS) videoLib.rm(p);
    }
  } catch (_) { /* noop */ }
}
setInterval(sweep, 10 * 60 * 1000).unref?.();
setInterval(() => {
  // Jaga koneksi WA tetap hidup walau idle lama (penting di Railway)
  if (wa.state === 'idle' && !config.MOCK_SEND) wa.start().catch(() => {});
}, 15 * 60 * 1000).unref?.();

/* ============================================================
 * Startup & shutdown
 * ============================================================ */
async function start() {
  return new Promise((resolve) => {
    httpServer.listen(config.PORT, '0.0.0.0', () => {
      log.info(`⚡ ${config.APP_NAME} v${config.VERSION} (oleh ${config.DEVELOPER.name}) berjalan di port :${config.PORT}`);
      log.info(`   Data dir : ${config.DATA_DIR}`);
      log.info(`   Engine   : ${videoLib.ENGINE.name} v${videoLib.ENGINE.version} · mode default ${config.ENGINE_MODE}`);
      log.info('   Privasi  : riwayat per-perangkat AKTIF (tidak ada riwayat global)');
      if (config.MOCK_SEND) log.warn('   ⚠ MOCK_SEND aktif — koneksi WhatsApp disimulasikan!');
      if (config.APP_KEY) log.info('   App Key  : aktif');
      resolve();
    });
    setTimeout(() => wa.start().catch((e) => log.error('Start WhatsApp gagal:', e.message)), 300);
    sweep();
  });
}

function shutdown(signal) {
  log.warn(`${signal} diterima — shutdown bersih...`);
  wa.shutdown().finally(() => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => log.error('Uncaught exception:', e?.message || e));

if (require.main === module) {
  start();
}

module.exports = { app, httpServer, io, start, wa, runProcess };
