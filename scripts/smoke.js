'use strict';
/**
 * JernihHD v7 — Smoke test end-to-end (tanpa WhatsApp asli) (by Rifky)
 *
 * Jalankan:  MOCK_SEND=true npm run smoke   (atau: npm run smoke)
 *
 * Menguji:
 *  1. Server boot + /api/config (brand + 5 target platform) + /api/status
 *  2. Unit pairing: normalisasi nomor (0812/+62/812 → 62812) & kode 8 char lowercase
 *  3. Engine v5: plan per target (WA/TikTok/IG), trim per platform, budget 16MB WA
 *  4. Endpoint /api/plan (preview resolusi, bitrate, estimasi ukuran)
 *  5. Kompresi nyata target tiktok & ig (fitur v5: loudness terukur, sharpen default)
 *  6. Pipeline lengkap via socket: upload → kompres → kirim mock → riwayat → resend
 */
process.env.MOCK_SEND = 'true';
process.env.PORT = '3999';
process.env.DATA_DIR = '/tmp/hdjir_smoke';
process.env.FFMPEG_THREADS = process.env.FFMPEG_THREADS || '2';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { io: socketClient } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
fs.rmSync('/tmp/hdjir_smoke', { recursive: true, force: true });

const videoLib = require(path.join(ROOT, 'server', 'video'));
const waLib = require(path.join(ROOT, 'server', 'whatsapp'));
const server = require(path.join(ROOT, 'server', 'index'));

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

/** Buat video uji via ffmpeg (testsrc + sine audio), dengan retry */
function makeTestVideo(out, seconds, size) {
  const args = [
    '-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${size}:rate=30`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-c:a', 'aac', '-shortest', out,
  ];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const r = spawnSync(videoLib.BIN, args, { encoding: 'utf8', maxBuffer: 1e6 });
    if (r.status === 0) return out;
    console.log(`     (retry ${attempt}/3 membuat video uji)`);
  }
  throw new Error('Gagal membuat video uji');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n=== 1. Server boot & branding ===');
  await server.start();
  await sleep(1200);

  const cfgRes = await fetch('http://localhost:3999/api/config');
  const cfg = await cfgRes.json();
  ok('GET /api/config', cfgRes.ok && cfg.appName === 'JernihHD', `v${cfg.version}`);
  ok('slug & credit', cfg.slug === 'Jernih HD' && cfg.brand === 'Rifky', `${cfg.slug} · ${cfg.brand}`);
  ok('engine terdeteksi', cfg.engine?.name === 'JernihHD Engine' && /^\d+\.\d+\.\d+/.test(cfg.engine?.version || ''), `${cfg.engine?.name} v${cfg.engine?.version}`);
  ok('codec H.264 High 4.2 + AAC 192k', /High 4\.2/.test(cfg.engine?.codec || '') && cfg.engine?.audioBitrateKbps === 192, cfg.engine?.codec);
  ok('5 target platform', Array.isArray(cfg.targets) && cfg.targets.length === 5, cfg.targets.map((t) => t.key).join('/'));
  ok('3 mode encode', Array.isArray(cfg.modes) && cfg.modes.length === 3, cfg.modes.map((m) => m.key).join('/'));
  ok('tidak ada jejak brand lama', !JSON.stringify(cfg).match(/kyy|purehd/i));

  const healthRes = await fetch('http://localhost:3999/api/health');
  const health = await healthRes.json();
  ok('GET /api/health (cepat)', healthRes.ok && health.ok === true, `engine ${health.engine}`);

  const stRes = await fetch('http://localhost:3999/api/status');
  const st = await stRes.json();
  ok('GET /api/status (flag mock)', st.mock === true && st.realSession === false, `state=${st.state}`);

  console.log('\n=== 2. Unit: pairing code (FIX v5) ===');
  const nn = waLib.normalizeWaNumber;
  ok('normalisasi 0812… → 62812…', nn('081234567890') === '6281234567890', nn('081234567890'));
  ok('normalisasi +62… → 62…', nn('+62 812-3456-7890') === '6281234567890', nn('+6281234567890'));
  ok('normalisasi 812… → 62812…', nn('81234567890') === '6281234567890');
  let threw = false;
  try { nn('12345'); } catch (_) { threw = true; }
  ok('nomor invalid ditolak', threw);
  const mgr = new (require(path.join(ROOT, 'server', 'whatsapp')))(server.io);
  ok('kode diformat 8 char CROCKFORD UPPERCASE', mgr._formatCode('abcd-1234xyz') === 'ABCD1234', mgr._formatCode('abcd-1234xyz'));
  // Dead-listener `sock.ev.on('pairing.code')` harus benar-benar hilang dari
  // KODE (baris komentar/dokumentasi diabaikan).
  const waSrc = fs.readFileSync(path.join(ROOT, 'server', 'whatsapp.js'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .join('\n');
  ok('tidak ada listener pairing.code di Baileys', !waSrc.includes("ev.on('pairing.code')"));

  console.log('\n=== 3. Engine v5: plan per target ===');
  const v30 = makeTestVideo('/tmp/hdjir_smoke/v30.mp4', 15, '1920x1080');
  const vLong = makeTestVideo('/tmp/hdjir_smoke/vlong.mp4', 12, '1280x720');
  const m30 = videoLib.extractMeta(await videoLib.probe(v30));
  const mLong = { ...videoLib.extractMeta(await videoLib.probe(vLong)), durationSec: 200 };

  const pWa = videoLib.plan(m30, { target: 'wa' });
  const pTk = videoLib.plan(m30, { target: 'tiktok' });
  const pIg = videoLib.plan(m30, { target: 'ig' });
  const pSh = videoLib.plan(m30, { target: 'shorts' });
  ok('target wa: fps ≤30, loudness -16/-1.5', pWa.fps <= 30 && pWa.loudness.I === -16 && pWa.loudness.TP === -1.5, `${pWa.fps}fps ${pWa.loudness.I}LUFS`);
  ok('target tiktok: fps ≤60, loudness -14/-1.0, sharpen ON', pTk.loudness.I === -14 && pTk.loudness.TP === -1 && pTk.sharpen > 0, `sharp=${pTk.sharpen}`);
  ok('target ig: fps ≤30, sharpen ON', pIg.fps <= 30 && pIg.sharpen > 0, `sharp=${pIg.sharpen}`);
  ok('H.264 level 4.2 utk ≤1080p', pTk.level === '4.2' && pWa.level === '4.2', `level=${pTk.level}`);
  ok('GOP 2 detik', pTk.gopFrames === pTk.fps * 2, `${pTk.gopFrames} frame @${pTk.fps}fps`);
  ok('audio AAC 192k', pTk.audioKbps === 192, `${pTk.audioKbps}k`);

  const pTrimWa = videoLib.plan(mLong, { target: 'wa', trim: 'auto' });
  const pTrimIg = videoLib.plan(mLong, { target: 'ig', trim: 'auto' });
  const pTrimSh = videoLib.plan(mLong, { target: 'shorts', trim: 'auto' });
  const pTrimTk = videoLib.plan(mLong, { target: 'tiktok', trim: 'auto' });
  ok('auto-trim WA 30s', pTrimWa.trimmed && pTrimWa.durationSec === 30, `${pTrimWa.durationSec}s`);
  ok('auto-trim IG 90s', pTrimIg.trimmed && pTrimIg.durationSec === 90, `${pTrimIg.durationSec}s`);
  ok('auto-trim Shorts 180s', pTrimSh.trimmed && pTrimSh.durationSec === 180, `${pTrimSh.durationSec}s`);
  ok('TikTok tanpa trim', !pTrimTk.trimmed && pTrimTk.durationSec === 200, `${pTrimTk.durationSec}s`);

  const pWaMax = videoLib.plan({ ...m30, durationSec: 30 }, { target: 'wa', mode: 'max' });
  ok('budget WA ≤16MB dihormati plan', pWaMax.maxOutputMB === 16 && pWaMax.estimatedMB <= 16, `est ${pWaMax.estimatedMB}MB / ${pWaMax.maxOutputMB}MB`);
  // Cap dibaca dari konfigurasi target, bukan angka tetap — biar assertion
  // tidak rusak tiap kali ladder bitrate disetel ulang.
  const tkRung = videoLib.getTarget('tiktok').ladder.find((x) => x.key === '1080p');
  const igRung = videoLib.getTarget('ig').ladder.find((x) => x.key === '1080p');
  const pTkMax = videoLib.plan(m30, { target: 'tiktok', mode: 'max', quality: '1080p' });
  ok('TikTok 1080p 2-pass Maksimal = cap platform', pTkMax.videoKbps === Math.round(tkRung.capMbps * 1000) && pTkMax.twoPass, `${pTkMax.videoKbps}k (cap ${tkRung.capMbps} Mbps)`);
  const pIgCap = videoLib.plan(m30, { target: 'ig', mode: 'max', quality: '1080p' });
  ok('IG 1080p 2-pass Maksimal = cap platform', pIgCap.videoKbps === Math.round(igRung.capMbps * 1000), `${pIgCap.videoKbps}k (cap ${igRung.capMbps} Mbps)`);

  // v6: TikTok/IG harus menyiapkan kanvas native platform (anti-pecah).
  // Sumber portrait 720x1280 → wajib jadi 1080x1920, bukan dibiarkan 720x1280
  // lalu diserahkan ke scaler TikTok/IG.
  const vPort = makeTestVideo('/tmp/hdjir_smoke/vport.mp4', 6, '720x1280');
  const mPort = videoLib.extractMeta(await videoLib.probe(vPort));
  const pTkPort = videoLib.plan(mPort, { target: 'tiktok' });
  const pIgPort = videoLib.plan(mPort, { target: 'ig' });
  ok('TikTok: sumber 720x1280 → kanvas native 1080x1920', pTkPort.width === 1080 && pTkPort.height === 1920 && pTkPort.fit !== 'none' && pTkPort.upscaleFactor > 1, `${pTkPort.width}x${pTkPort.height} fit=${pTkPort.fit} upscale=${pTkPort.upscaleFactor}x`);
  ok('IG: sumber 720x1280 → kanvas native 1080x1920', pIgPort.width === 1080 && pIgPort.height === 1920 && pIgPort.fit !== 'none', `${pIgPort.width}x${pIgPort.height} fit=${pIgPort.fit}`);
  // Sumber landscape tetap landscape (tidak dipaksa jadi portrait)
  ok('TikTok: sumber landscape tetap 1920x1080', pTkMax.width === 1920 && pTkMax.height === 1080, `${pTkMax.width}x${pTkMax.height}`);
  // AR tidak cocok (4:5) harus di-pad, bukan di-stretch
  const m45 = { ...mPort, width: 1080, height: 1350 };
  const p45 = videoLib.plan(m45, { target: 'tiktok', fit: 'pad' });
  ok('Sumber 4:5 → pad di kanvas 1080x1920 (tidak melar)', p45.width === 1080 && p45.height === 1920 && p45.fit === 'pad' && p45.fg?.width === 1080 && p45.fg?.height === 1350, `fg=${p45.fg?.width}x${p45.fg?.height}`);
  const pWaCanv = videoLib.plan({ ...mPort, durationSec: 15 }, { target: 'wa' });
  ok('WA TIDAK dipaksa ke kanvas (jalur lama utuh)', pWaCanv.fit === 'none' && pWaCanv.upscaleFactor === 1 && pWaCanv.width === 720, `${pWaCanv.width}x${pWaCanv.height} fit=${pWaCanv.fit}`);

  console.log('\n=== 4. Endpoint /api/plan (preview) ===');
  const form0 = new FormData();
  form0.append('video', new Blob([fs.readFileSync(v30)], { type: 'video/mp4' }), 'plan_test.mp4');
  form0.append('target', 'tiktok');
  const up0 = await (await fetch('http://localhost:3999/api/upload', { method: 'POST', body: form0 })).json();
  ok('upload dengan field target', up0.uploadId && up0.target === 'tiktok', `target=${up0.target}`);
  const planRes = await fetch('http://localhost:3999/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId: up0.uploadId, target: 'ig', mode: 'max' }),
  });
  const planJson = await planRes.json();
  ok(
    '/api/plan preview resolusi+bitrate+ukuran',
    planRes.ok && planJson.plan?.width > 0 && planJson.plan?.videoKbps > 0 && planJson.plan?.estimatedMB > 0,
    `${planJson.plan.width}x${planJson.plan.height} · ${(planJson.plan.videoKbps / 1000).toFixed(1)}Mbps · ≈${planJson.plan.estimatedMB}MB`
  );
  ok('/api/plan ikut target', planJson.plan.target === 'ig' && planJson.plans['1080p']?.videoKbps === Math.round(igRung.capMbps * 1000), `ig cap ${igRung.capMbps} Mbps`);

  console.log('\n=== 5. Kompresi nyata target TikTok & IG ===');
  const outTk = '/tmp/hdjir_smoke/out_tiktok.mp4';
  const rTk = await videoLib.compressVideo(v30, outTk, m30, () => {}, { target: 'tiktok', mode: 'turbo' }).promise;
  ok('encode target tiktok', fs.existsSync(outTk) && rTk.target === 'tiktok', `${rTk.width}x${rTk.height} · ${rTk.sizeMB}MB`);
  const outIg = '/tmp/hdjir_smoke/out_ig.mp4';
  const rIg = await videoLib.compressVideo(v30, outIg, m30, () => {}, { target: 'ig', mode: 'balanced' }).promise;
  ok('encode target ig', fs.existsSync(outIg) && rIg.target === 'ig', `${rIg.width}x${rIg.height} · ${rIg.sizeMB}MB`);

  // Cancel test
  const cCanc = videoLib.compressVideo(v30, '/tmp/hdjir_smoke/out_cancel.mp4', m30, () => {}, { target: 'universal', mode: 'max' });
  setTimeout(() => cCanc.cancel(), 400);
  let canceled = false;
  try { await cCanc.promise; } catch (e) { canceled = /dibatalkan/i.test(e.message); }
  ok('pembatalan kompresi berfungsi', canceled);

  console.log('\n=== 6. Pipeline lengkap via socket (upload → kompres → kirim mock) ===');
  const sock = socketClient('http://localhost:3999', { transports: ['websocket'] });
  await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); });

  const form = new FormData();
  form.append('video', new Blob([fs.readFileSync(v30)], { type: 'video/mp4' }), 'uji_30s.mp4');
  const up = await (await fetch('http://localhost:3999/api/upload', { method: 'POST', body: form })).json();
  ok('upload sukses', up.uploadId, `plan: ${up.plan.profileLabel}, ${up.plan.width}x${up.plan.height}`);

  const events = [];
  sock.on('compress:start', (d) => events.push(['compress:start', d]));
  sock.on('compress:progress', (d) => events.push(['compress:progress', d.percent]));
  sock.on('compress:done', (d) => events.push(['compress:done', d]));
  sock.on('send:start', (d) => events.push(['send:start', d.target]));
  sock.on('send:done', (d) => events.push(['send:done', d]));
  sock.on('send:error', (d) => events.push(['send:error', d]));
  sock.on('history:update', (h) => events.push(['history:update', h.length]));

  sock.emit('video:process', { uploadId: up.uploadId, target: 'wa', targetList: undefined, targets: '081234567890', caption: 'Tes JernihHD' });

  const done = await new Promise((res) => {
    const t = setTimeout(() => res(null), 120000);
    const check = () => {
      const e = events.find(([n]) => n === 'send:done' || n === 'send:error');
      if (e) { clearTimeout(t); res(e); }
      else setTimeout(check, 200);
    };
    check();
  });

  ok('job selesai', !!done, done ? (done[0] === 'send:done' ? `ke ${done[1].target}` : done[1].message) : 'timeout');
  ok('events compress:start & progress & done', events.some(([n]) => n === 'compress:start') && events.some(([n]) => n === 'compress:progress') && events.some(([n]) => n === 'compress:done'));
  ok('events send:start', events.some(([n]) => n === 'send:start'));
  ok('history ter-update', events.some(([n]) => n === 'history:update'));

  const histRes = await fetch('http://localhost:3999/api/history');
  const hist = await histRes.json();
  ok('riwayat tersimpan + platform tercatat', hist[0]?.status === 'success' && hist[0]?.platform === 'wa', `${hist[0]?.originalName} → ${hist[0]?.target} (${hist[0]?.platformLabel})`);
  ok('video hasil kompres disimpan utk resend', fs.existsSync(path.join(process.env.DATA_DIR, 'videos', hist[0]?.videoFile || '__none__')));

  // Kirim ulang (resend)
  const ev2 = [];
  sock.on('send:done', (d) => ev2.push(d));
  sock.emit('video:resend', { id: hist[0].id });
  const r2 = await new Promise((res) => {
    const t = setTimeout(() => res(null), 30000);
    const check = () => {
      if (ev2.length) { clearTimeout(t); res(ev2[ev2.length - 1]); } else setTimeout(check, 200);
    };
    check();
  });
  ok('kirim ulang (resend) sukses', !!r2 && r2.resendId === hist[0].id);

  // Kirim multi-target
  const form2 = new FormData();
  form2.append('video', new Blob([fs.readFileSync(v30)], { type: 'video/mp4' }), 'uji_multi.mp4');
  const up2 = await (await fetch('http://localhost:3999/api/upload', { method: 'POST', body: form2 })).json();
  const ev3 = [];
  sock.on('send:done', (d) => ev3.push(d));
  sock.emit('video:process', { uploadId: up2.uploadId, target: 'wa', targets: '6281111111111, 6282222222222' });
  const r3 = await new Promise((res) => {
    const t = setTimeout(() => res(null), 60000);
    const check = () => {
      if (ev3.length) { clearTimeout(t); res(ev3[ev3.length - 1]); } else setTimeout(check, 200);
    };
    check();
  });
  ok('kirim multi-target (2 nomor)', !!r3 && r3.targets?.length === 2, r3 ? r3.targets.join(', ') : 'timeout');

  // Mode unduh: target TikTok TANPA nomor → tidak kirim WA, hasilnya bisa diunduh
  const form3 = new FormData();
  form3.append('video', new Blob([fs.readFileSync(v30)], { type: 'video/mp4' }), 'uji_unduh.mp4');
  form3.append('target', 'tiktok');
  const up3 = await (await fetch('http://localhost:3999/api/upload', { method: 'POST', body: form3 })).json();
  const ev4 = [];
  sock.on('send:done', (d) => ev4.push(d));
  sock.emit('video:process', { uploadId: up3.uploadId, target: 'tiktok', mode: 'turbo' });
  const r4 = await new Promise((res) => {
    const t = setTimeout(() => res(null), 90000);
    const check = () => {
      if (ev4.length) { clearTimeout(t); res(ev4[ev4.length - 1]); } else setTimeout(check, 200);
    };
    check();
  });
  ok('mode unduh: proses jalan tanpa nomor tujuan', !!r4 && r4.downloadOnly === true && (r4.targets || []).length === 0, r4 ? `downloadOnly=${r4.downloadOnly} · ${r4.meta?.platformLabel}` : 'timeout');
  let dlOk = false;
  let dlBytes = 0;
  if (r4?.downloadUrl) {
    const dr = await fetch(`http://localhost:3999${r4.downloadUrl}`);
    const buf = Buffer.from(await dr.arrayBuffer());
    dlOk = dr.status === 200 && buf.length > 10000;
    dlBytes = buf.length;
  }
  ok('mode unduh: file HD bisa diunduh via /api/download', dlOk, `${(dlBytes / 1048576).toFixed(2)} MB`);

  sock.close();
  server.httpServer.close();
  console.log(`\n=== HASIL: ${pass} lolos, ${fail} gagal ===`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crash:', e);
  process.exit(1);
});
