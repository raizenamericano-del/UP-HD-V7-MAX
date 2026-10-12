/**
 * platform-bench.js — ukur kualitas SETELAH platform meng-encode ulang.
 *
 * Alur (meniru perilaku nyata TikTok / IG):
 *   sumber → engine app → [simulasi re-encode platform] → ukur VMAF/SSIM vs sumber
 *
 * Platform TIDAK pernah menayangkan file kita apa adanya; mereka scale ke
 * kanvas 1080x1920 lalu encode ulang di bitrate jauh lebih rendah. Karena itu
 * angka VMAF yang relevan adalah VMAF *setelah* tahap platform, bukan sebelumnya.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const video = require('../server/video');

const FF = video.BIN;
const FP = video.PROBE;
const OUT = process.env.BENCH_OUT || '/tmp/bench';
fs.mkdirSync(OUT, { recursive: true });

function run(args, label) {
  return new Promise((res, rej) => {
    const p = spawn(FF, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let e = '';
    p.stderr.on('data', d => { e += d; });
    p.on('close', c => c === 0 ? res() : rej(new Error(`${label} exit ${c}: ${e.slice(0, 400)}`)));
  });
}
function probeSize(f) { try { return fs.statSync(f).size; } catch { return 0; } }

/** VMAF dari test vs ref (keduanya di kanvas yang sama) */
async function vmafOf(ref, test) {
  const out = path.join(OUT, 'vmaf.json');
  try { fs.rmSync(out, { force: true }); } catch {}
  await run([
    '-i', test, '-i', ref,
    '-lavfi', `libvmaf=model=version=vmaf_v0.6.1:log_path=${out}:log_fmt=json`,
    '-f', 'null', '-',
  ], 'vmaf');
  try { return +JSON.parse(fs.readFileSync(out, 'utf8')).pooled_metrics.vmaf.mean.toFixed(2); }
  catch { return null; }
}
function ssimOf(ref, test) {
  return new Promise((resolve) => {
    const p = spawn(FF, ['-hide_banner', '-nostdin', '-i', test, '-i', ref, '-lavfi', 'ssim', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let b = ''; p.stderr.on('data', d => { b += d; });
    p.on('close', () => {
      const m = [...b.matchAll(/All:([\d.]+)/g)];
      resolve(m.length ? +parseFloat(m[m.length - 1][1]).toFixed(4) : null);
    });
  });
}

/**
 * Simulasi re-encode platform.
 * TikTok/IG menormalkan ke 1080x1920 lalu encode ulang di bitrate "hemat".
 * Angka bitrate diambil dari observasi umum hasil re-encode kedua platform.
 */
const PLATFORM_SIM = {
  tiktok: { w: 1080, h: 1920, mbps: 3.2, fps: 30, preset: 'veryfast' },
  ig:     { w: 1080, h: 1920, mbps: 2.4, fps: 30, preset: 'veryfast' },
};

async function simulatePlatform(input, output, platform) {
  const s = PLATFORM_SIM[platform];
  const vb = Math.round(s.mbps * 1000);
  await run([
    '-i', input,
    '-vf', `scale=${s.w}:${s.h}:flags=bilinear:force_original_aspect_ratio=decrease,pad=${s.w}:${s.h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    '-r', String(s.fps),
    '-c:v', 'libx264', '-preset', s.preset, '-profile:v', 'main',
    '-b:v', `${vb}k`, '-maxrate', `${Math.round(vb * 1.3)}k`, '-bufsize', `${Math.round(vb * 2)}k`,
    '-g', String(s.fps * 2), '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    output,
  ], 'platform-sim');
  return probeSize(output);
}

async function main() {
  const src = process.argv[2] || path.join(__dirname, '..', 'samples', 'sample_portrait_9x16.mp4');
  const targets = (process.argv[3] || 'tiktok,ig').split(',');
  const variants = (process.argv[4] || 'current').split(',');

  const meta = video.extractMeta(await video.probe(src));
  console.log(`\nSumber: ${path.basename(src)} ${meta.width}x${meta.height} @${meta.fps}fps\n`);

  // Referensi: sumber di kanvas platform (ini "kualitas terbaik yang mungkin")
  const refFile = path.join(OUT, 'ref.mp4');
  // PENTING: ref harus pakai tag warna yang sama dengan output engine (BT.709).
  // Kalau tidak, libvmaf melakukan konversi warna pada salah satu sisi dan
  // VMAF anjlok ~19 poin karena artefak pengukuran, bukan karena kualitas.
  await run(['-i', src, '-vf', `scale=1080:1920:flags=lanczos:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-frames:v', '90', refFile], 'ref');

  for (const target of targets) {
    for (const variant of variants) {
      const appOut = path.join(OUT, `app_${target}_${variant}.mp4`);
      const platOut = path.join(OUT, `plat_${target}_${variant}.mp4`);
      const opts = { target, mode: 'balanced' };
      if (variant === 'max') opts.mode = 'max';
      if (variant === 'legacy') { opts.fit = 'none'; opts.sharpen = 0.2; }   // perilaku v5.0.5
      if (variant === 'fill') opts.fit = 'fill';
      if (variant === 'pad') opts.fit = 'pad';

      let t0 = Date.now();
      let res;
      try {
        res = await video.compressVideo(src, appOut, meta, null, opts).promise;
      } catch (e) {
        console.log(`  ${target}/${variant}: ENCODE GAGAL — ${e.message.slice(0, 160)}`);
        continue;
      }
      const encSec = ((Date.now() - t0) / 1000).toFixed(1);

      const platBytes = await simulatePlatform(appOut, platOut, target);
      const vm = await vmafOf(refFile, platOut);
      const s = await ssimOf(refFile, platOut);
      const appMB = (res.sizeBytes / 1048576).toFixed(2);

      console.log(
        `  ${target.padEnd(7)} ${variant.padEnd(8)} | app ${res.width}x${res.height} ${String(appMB).padStart(6)}MB ${String(res.videoKbps).padStart(5)}k ` +
        `| platform ${(platBytes / 1048576).toFixed(2)}MB | VMAF ${String(vm).padStart(6)} | SSIM ${String(s).padStart(6)} | ${encSec}s`
      );
    }
  }
  console.log('');
}
main().catch(e => { console.error('BENCH ERROR:', e.message); process.exit(1); });
