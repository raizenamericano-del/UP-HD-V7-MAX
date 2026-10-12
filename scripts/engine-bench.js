'use strict';
/**
 * ============================================================================
 * JernihHD — Engine Benchmark v7 (by Rifky)
 * ============================================================================
 * Kenapa SSIM mentah menyesatkan?
 *   Video hasil kita BUKAN hasil akhir — platform (WhatsApp/TikTok/Instagram)
 *   akan meng-encode ulang videonya. Yang menentukan "tajam atau pecah" di
 *   feed/status adalah seberapa banyak detail yang MASIH TERSISA setelah
 *   re-encode platform itu.
 *
 * Metrik di script ini:
 *   1) Encode sumber pakai ENGINE LAMA (v4, parameter di-hardcode apa adanya)
 *      dan Engine v7 (JernihHD Engine, per target platform).
 *   2) Simulasi re-encode platform:
 *        WA-status-hd / WA-status-low  (transcode WhatsApp)
 *        tiktok-feed                   (transcode TikTok ±3 Mbps 1080p)
 *        ig-feed                       (transcode Instagram ±2.5 Mbps 1080p)
 *   3) Ukur SSIM + PSNR + VMAF hasil simulasi vs VIDEO SUMBER ASLI.
 *      → nilai lebih tinggi = detail lebih banyak yang bertahan = lebih tajam.
 *      VMAF dipakai kalau ffmpeg punya libvmaf (kalau tidak: "n/a", anggun).
 *      Jendela VMAF dibatasi (VMAF_SECONDS, default 6s) biar bench gak lama.
 *
 * Jalankan:
 *   node scripts/engine-bench.js                 (pakai file di /samples)
 *   node scripts/engine-bench.js video1.mp4 ...  (file sendiri)
 *   node scripts/engine-bench.js --hq            (+ sumber HQ sintetis 1080p 20Mbps)
 *   BENCH_QUICK=1 node scripts/engine-bench.js   (lewati VMAF, varian lebih sedikit)
 * ============================================================================
 */
process.env.FFMPEG_THREADS = process.env.FFMPEG_THREADS || '2';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const videoLib = require('../server/video');

const OUT = path.join(os.tmpdir(), 'hdjir_bench');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const BIN = videoLib.BIN;
const PROBE_BIN = videoLib.PROBE;
const THREADS = process.env.FFMPEG_THREADS || '2';
const QUICK = process.env.BENCH_QUICK === '1';
const VMAF_SECONDS = parseFloat(process.env.VMAF_SECONDS || '6');

/* ---------- parameter engine LAMA (v4, apa adanya dari implementasi v4) ----
 * v4: ladder WA (cap 8/5/2.8/1.8 Mbps), CRF 18, fps 30, gop 60,
 * loudnorm -16 dinamis 1-pass, AAC 128k, tanpa sharpen default,
 * x264: aq-mode3, psy-rd 1.0,0.15, trellis2, subme8, lookahead 60.        */
const V4 = {
  params: 'b-adapt=2:b-pyramid=normal:me=umh:me_range=24:subme=8:trellis=2:aq-mode=3:aq-strength=0.9:psy-rd=1.0,0.15:deblock=-1,-1:mixed-refs=1:weightp=2:direct=auto:scenecut=40:8x8dct=1:chroma-me=1:fast-pskip=1:mbtree=1:ref=4:bframes=3:rc-lookahead=60',
  profile: (dur) => (dur <= 60
    ? { key: '1080p', crf: 18, cap: 8, box: { w: 1920, h: 1080 } }
    : dur <= 120
      ? { key: '720p', crf: 18, cap: 5, box: { w: 1280, h: 720 } }
      : dur <= 240
        ? { key: '480p', crf: 19, cap: 2.8, box: { w: 854, h: 480 } }
        : { key: '360p', crf: 20, cap: 1.8, box: { w: 640, h: 360 } }),
};

/* ---------- simulasi re-encode platform ---------- */
const PLATFORM_SIMS = {
  'WA-status-hd': ['-vf', 'scale=-2:min(1280\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '2200k', '-bufsize', '4400k', '-r', '30', '-c:a', 'aac', '-b:a', '96k'],
  'WA-status-low': ['-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '31', '-maxrate', '1100k', '-bufsize', '2200k', '-r', '30', '-c:a', 'aac', '-b:a', '64k'],
  'tiktok-feed': ['-vf', 'scale=-2:min(1080\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-maxrate', '3000k', '-bufsize', '6000k', '-r', '30', '-c:a', 'aac', '-b:a', '128k'],
  'ig-feed': ['-vf', 'scale=-2:min(1080\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-maxrate', '2500k', '-bufsize', '5000k', '-r', '30', '-c:a', 'aac', '-b:a', '128k'],
};

/* simulasi yang dipakai per baris bench */
const SIM_FOR = {
  'v4-lama': ['WA-status-hd', 'WA-status-low'],
  'v5-wa': ['WA-status-hd', 'WA-status-low'],
  'v5-tiktok': ['tiktok-feed'],
  'v5-ig': ['ig-feed'],
};

/* ---------- helper ffmpeg ---------- */
function run(args, collect = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, args, { stdio: ['ignore', collect ? 'pipe' : 'ignore', 'pipe'] });
    let err = '';
    let out = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    if (collect) p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-3).join(' | ')))));
    p.on('error', reject);
  });
}

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;

function probeDims(file) {
  const r = spawnSync(PROBE_BIN, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  const [w, h] = (r.stdout || '').trim().split(',').map(Number);
  return w && h ? { w, h } : null;
}

/** SSIM + PSNR vs referensi (statistik ffmpeg ada di stderr; dimensi disamakan dulu) */
async function measure(ref, test, dims) {
  const d = dims || probeDims(test) || { w: 1280, h: 720 };
  const W = d.w - (d.w % 2);
  const H = d.h - (d.h % 2);
  const graph = (filter) =>
    `[0:v]scale=${W}:${H}:flags=bicubic[ref];[1:v]scale=${W}:${H}[t];[ref][t]${filter}`;

  const grab = (filter, re) =>
    new Promise((resolve) => {
      const p = spawn(BIN, ['-hide_banner', '-nostdin', '-i', ref, '-i', test, '-lavfi', graph(filter), '-f', 'null', '-'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buf = '';
      const onData = (x) => { buf += x.toString(); };
      p.stdout.on('data', onData);
      p.stderr.on('data', onData);
      p.on('close', () => {
        const m = [...buf.matchAll(re)].map((x) => parseFloat(x[1]));
        resolve(m.length ? m[m.length - 1] : null);
      });
      p.on('error', () => resolve(null));
    });

  const [ssim, psnr] = await Promise.all([
    grab('ssim', /All:([\d.]+)/g),
    grab('psnr', /average:([\d.]+)/g),
  ]);
  return { ssim, psnr, w: W, h: H };
}

/** VMAF vs referensi — jendela terbatas biar cepat; null kalau libvmaf tidak ada */
async function measureVmaf(ref, test, dims) {
  if (!videoLib.CAPS.libvmaf) return null;
  const d = dims || probeDims(test) || { w: 1280, h: 720 };
  const W = d.w - (d.w % 2);
  const H = d.h - (d.h % 2);
  return new Promise((resolve) => {
    const p = spawn(BIN, [
      '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info',
      '-t', String(VMAF_SECONDS), '-i', ref,
      '-t', String(VMAF_SECONDS), '-i', test,
      '-lavfi', `[0:v]scale=${W}:${H}:flags=bicubic[r];[1:v]scale=${W}:${H}[t];[r][t]libvmaf=n_threads=${THREADS}`,
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    p.stderr.on('data', (d) => { buf += d.toString(); });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) { /* noop */ } }, 300000);
    p.on('close', () => {
      clearTimeout(timer);
      const m = [...buf.matchAll(/VMAF score:\s*([\d.]+)/g)].map((x) => parseFloat(x[1]));
      resolve(m.length ? m[m.length - 1] : null);
    });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

/* ---------- engine LAMA (v4, direct ffmpeg) ---------- */
async function encodeV4(input, output, meta) {
  const pr = V4.profile(meta.durationSec);
  const portrait = meta.height >= meta.width;
  const box = portrait ? { w: pr.box.h, h: pr.box.w } : pr.box;
  const f = Math.min(box.w / meta.width, box.h / meta.height, 1);
  const w = Math.max(2, Math.round((meta.width * f) / 2) * 2);
  const h = Math.max(2, Math.round((meta.height * f) / 2) * 2);
  const started = Date.now();
  await run([
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input,
    '-map_metadata', '-1',
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-level', '4.2',
    '-pix_fmt', 'yuv420p',
    '-vf', `fps=30,scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int,setsar=1,format=yuv420p`,
    '-g', '60', '-keyint_min', '30',
    '-x264-params', V4.params,
    '-crf', String(pr.crf), '-maxrate', `${pr.cap}M`, '-bufsize', `${Math.round(pr.cap * 1.75)}M`,
    '-movflags', '+faststart',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-threads', THREADS,
    '-y', output,
  ]);
  return { ms: Date.now() - started, size: fs.statSync(output).size, w, h, label: 'v4 lama (engine lama)' };
}

/* ---------- engine BARU v5 (via library engine sungguhan) ---------- */
async function encodeV5(input, output, meta, targetKey, mode = 'balanced') {
  const started = Date.now();
  const handle = videoLib.compressVideo(input, output, meta, () => {}, { target: targetKey, mode, trim: 'none' });
  const r = await handle.promise;
  return { ms: Date.now() - started, size: r.sizeBytes, w: r.width, h: r.height, label: `v5 ${targetKey}` };
}

/* ---------- sumber HQ sintetis ---------- */
async function makeHqSource() {
  const out = path.join(OUT, 'source_hq_1080p.mp4');
  if (fs.existsSync(out)) return out;
  console.log('🎞️  Bikin sumber HQ sintetis (1080p · 20 Mbps · detail tinggi + noise + gerakan)…');
  await run([
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10',
    '-f', 'lavfi', '-i', 'sine=frequency=420:duration=10',
    '-vf', 'noise=alls=14:allf=t+u',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest',
    '-y', out,
  ]);
  return out;
}

/* ---------- jalankan benchmark 1 file ---------- */
async function bench(file) {
  const name = path.basename(file);
  const meta = videoLib.extractMeta(await videoLib.probe(file));
  console.log(`\n${'═'.repeat(104)}`);
  console.log(`📼 ${name} — ${meta.width}x${meta.height} · ${meta.durationSec.toFixed(1)}s · ${meta.fps}fps · ${meta.vCodec} · ${meta.srcBitrate ? (meta.srcBitrate / 1e6).toFixed(1) + ' Mbps' : '?'} · bpp ${meta.bpp}`);
  console.log('═'.repeat(104));

  const variants = [
    { key: 'v4-lama', run: () => encodeV4(file, path.join(OUT, `${name}.v4old.mp4`), meta) },
    { key: 'v5-wa', run: () => encodeV5(file, path.join(OUT, `${name}.v5wa.mp4`), meta, 'wa') },
    { key: 'v5-tiktok', run: () => encodeV5(file, path.join(OUT, `${name}.v5tiktok.mp4`), meta, 'tiktok') },
    { key: 'v5-ig', run: () => encodeV5(file, path.join(OUT, `${name}.v5ig.mp4`), meta, 'ig') },
  ];

  const rows = [];
  for (const v of variants) {
    const r = await v.run();
    rows.push({ ...r, key: v.key, sims: {} });
    process.stdout.write(`   ⟳ ${r.label.padEnd(20)} ${String(`${r.w}x${r.h}`).padEnd(12)} ${mb(r.size).padEnd(10)} ${secs(r.ms)}\n`);
  }

  // simulasi re-encode platform + metrik vs sumber asli
  console.log(`   ⟳ simulasi re-encode platform + ukur SSIM/PSNR${videoLib.CAPS.libvmaf && !QUICK ? '/VMAF' : ''} vs sumber asli…`);
  for (const r of rows) {
    const src = path.join(OUT, `${name}.${r.key === 'v4-lama' ? 'v4old' : r.key.replace('v5-', 'v5')}.mp4`);
    for (const simName of SIM_FOR[r.key]) {
      const simFile = path.join(OUT, `${name}.${r.key}.${simName}.mp4`);
      await run(['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', src, ...PLATFORM_SIMS[simName], '-movflags', '+faststart', '-y', simFile]);
      const m = await measure(file, simFile);
      let vmaf = null;
      if (!QUICK) vmaf = await measureVmaf(file, simFile, m);
      r.sims[simName] = { ...m, vmaf };
    }
  }

  // tabel hasil
  const pad = (s, n) => String(s).padEnd(n);
  const mainSim = (r) => r.sims[Object.keys(r.sims)[0]];
  console.log(`\n   ${pad('engine', 20)}${pad('res', 12)}${pad('ukuran', 10)}${pad('SSIM', 9)}${pad('PSNR', 9)}${pad('VMAF', 9)}${pad('simulasi', 16)}waktu`);
  console.log(`   ${'─'.repeat(98)}`);
  for (const r of rows) {
    let first = true;
    for (const [simName, m] of Object.entries(r.sims)) {
      console.log(
        `   ${pad(first ? r.label : '', 20)}${pad(first ? `${r.w}x${r.h}` : '', 12)}${pad(first ? mb(r.size) : '', 10)}` +
        `${pad(m.ssim?.toFixed(4) ?? 'n/a', 9)}${pad(m.psnr?.toFixed(2) ?? 'n/a', 9)}${pad(m.vmaf?.toFixed(1) ?? 'n/a', 9)}${pad(simName, 16)}${first ? secs(r.ms) : ''}`
      );
      first = false;
    }
  }

  const get = (key, sim, field) => rows.find((r) => r.key === key)?.sims[sim]?.[field] ?? null;
  console.log(`   ${'─'.repeat(98)}`);
  console.log(
    `   📈 Detail bertahan setelah re-encode WA-HD   : v4 ${fmt(get('v4-lama', 'WA-status-hd', 'ssim'))} → v5-wa ${fmt(get('v5-wa', 'WA-status-hd', 'ssim'))}` +
    ` · VMAF ${fmt(get('v4-lama', 'WA-status-hd', 'vmaf'))} → ${fmt(get('v5-wa', 'WA-status-hd', 'vmaf'))}`
  );
  console.log(
    `   📈 Tahan di bitrate rendah (WA-low)          : v4 ${fmt(get('v4-lama', 'WA-status-low', 'ssim'))} → v5-wa ${fmt(get('v5-wa', 'WA-status-low', 'ssim'))}`
  );
  console.log(
    `   📈 Setelah re-encode platform masing-masing  : tiktok ${fmt(get('v5-tiktok', 'tiktok-feed', 'ssim'))} (VMAF ${fmt(get('v5-tiktok', 'tiktok-feed', 'vmaf'))}) · ig ${fmt(get('v5-ig', 'ig-feed', 'ssim'))} (VMAF ${fmt(get('v5-ig', 'ig-feed', 'vmaf'))})`
  );

  return {
    file: name,
    v4: get('v4-lama', 'WA-status-hd', 'ssim'),
    v4vmaf: get('v4-lama', 'WA-status-hd', 'vmaf'),
    wa: get('v5-wa', 'WA-status-hd', 'ssim'),
    wavmaf: get('v5-wa', 'WA-status-hd', 'vmaf'),
    tiktok: get('v5-tiktok', 'tiktok-feed', 'ssim'),
    tiktokvmaf: get('v5-tiktok', 'tiktok-feed', 'vmaf'),
    ig: get('v5-ig', 'ig-feed', 'ssim'),
    igvmaf: get('v5-ig', 'ig-feed', 'vmaf'),
  };
}

const fmt = (v) => (v == null ? 'n/a' : typeof v === 'number' && v > 100 ? v.toFixed(1) : Number(v).toFixed(4));

(async () => {
  const args = process.argv.slice(2);
  const wantHq = args.includes('--hq');
  const files = args.filter((a) => !a.startsWith('--'));

  console.log(`\n🎬 JernihHD Engine Benchmark — ${videoLib.ENGINE.name} v${videoLib.ENGINE.version}`);
  console.log(`FFmpeg: ${BIN} · libvmaf=${videoLib.CAPS.libvmaf ? 'yes' : 'no'} · VMAF window=${VMAF_SECONDS}s${QUICK ? ' · QUICK (tanpa VMAF)' : ''}`);
  console.log('Metrik: SSIM/PSNR/VMAF hasil SIMULASI re-encode platform vs video sumber asli (makin tinggi = makin tajam di feed).');

  const list = files.length
    ? files
    : [
        ...(wantHq ? [await makeHqSource()] : []),
        ...fs.readdirSync(path.join(__dirname, '..', 'samples'))
          .filter((f) => /\.(mp4|mov|mkv)$/i.test(f))
          .map((f) => path.join(__dirname, '..', 'samples', f)),
      ];

  const summary = [];
  for (const f of list) {
    try { summary.push(await bench(f)); } catch (e) { console.error(`❌ Gagal: ${f} — ${e.message}`); }
  }

  console.log(`\n${'═'.repeat(104)}\nRINGKASAN — SSIM setelah re-encode platform (tinggi = lebih tajam)`);
  console.log('─'.repeat(104));
  console.log(`${'file'.padEnd(30)}${'v4→WA'.padEnd(11)}${'v5wa→WA'.padEnd(11)}${'v5tiktok→TT'.padEnd(14)}${'v5ig→IG'.padEnd(11)}${'Δ SSIM v5wa-v4'.padEnd(16)}VMAF v4→v5wa`);
  for (const s of summary) {
    const d = (s.wa || 0) - (s.v4 || 0);
    console.log(
      `${String(s.file).padEnd(30)}${fmt(s.v4).padEnd(11)}${fmt(s.wa).padEnd(11)}${fmt(s.tiktok).padEnd(14)}${fmt(s.ig).padEnd(11)}` +
      `${(d >= 0 ? '+' : '') + (d * 100).toFixed(2) + '% poin'.padEnd(10)}` +
      `${fmt(s.v4vmaf)} → ${fmt(s.wavmaf)}`
    );
  }
  console.log(`\nHasil encode lengkap ada di: ${OUT}\n`);

  // simpan ringkasan machine-readable buat ditempel ke README
  try {
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  } catch (_) { /* noop */ }
  process.exit(0);
})();
