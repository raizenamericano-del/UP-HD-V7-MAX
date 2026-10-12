/**
 * verify-encodes.js — uji encode NYATA mesin v5 untuk sampel sulit.
 *
 * Matriks: sumber portrait 9:16 / 4K UHD / HDR10 (PQ + BT.2020 10-bit)
 *          × target TikTok & IG Reels (+ satu run 2-pass "Maksimal").
 *
 * Setiap hasil dibuktikan dengan:
 *   - ffprobe stream lengkap (profile/level/pix_fmt/res/fps/tag warna)
 *   - pengukuran loudness EBU R128 (ebur128) dari hasil encode
 *   - ringkasan plan engine (bitrate, trim, sharpen, loudness target)
 * Bukti disimpan ke docs/verification/ffprobe-<case>.txt + encodes.json.
 *
 * Pakai:  node scripts/verify-encodes.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const video = require('../server/video');
const { log: logger } = require('../server/logger');
const config = require('../server/config');

const FFPROBE = process.env.FFPROBE_PATH || require('ffprobe-static').path;
const FFMPEG = process.env.FFMPEG_PATH || require('ffmpeg-static');
const OUTDIR = path.join(__dirname, '..', 'docs', 'verification');
const TMPDIR = '/tmp/v5ver';

const CASES = [
  { src: path.join(__dirname, '..', 'samples', 'sample_portrait_9x16.mp4'), target: 'tiktok', mode: 'balanced', name: 'portrait-tiktok' },
  { src: path.join(__dirname, '..', 'samples', 'sample_portrait_9x16.mp4'), target: 'ig', mode: 'balanced', name: 'portrait-ig' },
  { src: '/tmp/v5test/src_4k.mp4', target: 'tiktok', mode: 'balanced', name: '4k-tiktok' },
  { src: '/tmp/v5test/src_4k.mp4', target: 'ig', mode: 'balanced', name: '4k-ig' },
  { src: '/tmp/v5test/src_hdr10.mp4', target: 'tiktok', mode: 'balanced', name: 'hdr10-tiktok' },
  { src: '/tmp/v5test/src_hdr10.mp4', target: 'ig', mode: 'balanced', name: 'hdr10-ig' },
  { src: '/tmp/v5test/src_4k.mp4', target: 'tiktok', mode: 'max', name: '4k-tiktok-2pass' },
];

function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,codec_type,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,color_space,color_transfer,color_primaries,bit_rate,sample_rate,channels',
      '-show_entries', 'format=size,duration,format_name',
      '-of', 'default=noprint_wrappers=1', file,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(err))));
  });
}

function loudness(file) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let b = '';
    p.stderr.on('data', (d) => { b += d; });
    p.on('close', () => {
      const iAll = [...b.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)];
      const tpAll = [...b.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)];
      // ambil nilai Summary akhir (match TERAKHIR), bukan frame pertama
      resolve({ i: iAll.length ? iAll[iAll.length - 1][1] : null, tp: tpAll.length ? tpAll[tpAll.length - 1][1] : null });
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.mkdirSync(TMPDIR, { recursive: true });
  const results = [];

  for (const c of CASES) {
    if (!fs.existsSync(c.src)) { logger.warn(`skip ${c.name}: sumber ${c.src} tidak ada`); continue; }
    const out = path.join(TMPDIR, `${c.name}.mp4`);
    logger.info(`▶ encode ${c.name} (${c.target}/${c.mode}) dari ${path.basename(c.src)}…`);
    const t0 = Date.now();
    const srcMeta = video.extractMeta(await video.probe(c.src));
    const rung = video.getTarget(c.target).ladder.find((x) => x.key === '1080p') || video.getTarget(c.target).ladder[0];
    const ladderCap = `${rung.capMbps} Mbps`;
    const ladderMbps = `${rung.mbps} Mbps`;
    const ln = meta2 => meta2; // noop

    const handle = video.compressVideo(c.src, out, srcMeta, () => {}, { target: c.target, quality: 'auto', mode: c.mode });
    const meta = await handle.promise;
    await sleep(120);

    const probeTxt = await probe(out);
    const loud = await loudness(out);
    const lo = meta.plan.loudness || {};
    const loudTarget = `${lo.I ?? '-'} LUFS / TP ${lo.TP ?? '-'} dBFS`;
    const planLine = [
      `sumber      : ${c.src}`,
      `target/mode : ${c.target} / ${c.mode}`,
      `resolusi    : ${meta.width}x${meta.height} @ ${meta.fps}fps`,
      `bitrate     : video ${Math.round((meta.videoKbps || 0) / 100) / 10} Mbps (${meta.mode === 'max' ? '2-pass ABR' : 'perkiraan CRF'}; cap ${ladderCap} / target 2-pass ${ladderMbps}) · audio ${meta.audioKbps}k`,
      `loudness    : target ${loudTarget} · terukur I=${loud.i} LUFS / TP ${loud.tp} dBFS`,
      `trim        : ${meta.trimmed ? `ya → ${Math.round(meta.durationSec)}s` : 'tidak'}`,
      `hdr tonemap : ${meta.hdrTonemap ? 'ya' : 'tidak'}`,
      `sharpen     : ${meta.plan.sharpen || 'mati'}`,
      `mode aktual : ${meta.modeLabel} (${meta.mode})${meta.fellBack ? ` · fallback: ${meta.fellBack}` : ''} · engine ${meta.engine}`,
      `ukuran      : ${meta.sizeMB} MB (budget ${video.targetMaxMB(video.getTarget(c.target))} MB) · ${(Math.round((Date.now() - t0) / 100) / 10)}s`,
      `catatan     : ${(meta.plan.notes || []).join('; ') || '-'}`,
    ].join('\n');

    const doc = [
      `=== JernihHD Engine v7 — bukti encode nyata: ${c.name} ===`,
      '',
      planLine,
      '',
      '--- ffprobe hasil encode ---',
      probeTxt.trim(),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUTDIR, `ffprobe-${c.name}.txt`), doc);
    results.push({ case: c.name, target: c.target, mode: c.mode, meta, loud });
    logger.info(`   ✓ ${c.name}: ${meta.width}x${meta.height} · ${meta.sizeMB}MB · ${Math.round((meta.videoKbps || 0) / 1000)}Mbps · loud I=${loud.i} LUFS`);
  }

  fs.writeFileSync(path.join(OUTDIR, 'encodes.json'), JSON.stringify(results, null, 2));
  logger.info(`selesai: ${results.length} kasus → ${OUTDIR}`);
})().catch((e) => { logger.error('verify-encodes gagal:', e); process.exit(1); });
