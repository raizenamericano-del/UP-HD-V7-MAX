'use strict';
/**
 * ============================================================================
 * JernihHD — Generator ikon & aset brand (by Rifky)
 * ============================================================================
 * Sumber aset (vector, tinggal edit kalau mau rebranding):
 *   client/public/brand/logo-mark.svg       → app icon (rounded, ada shine)
 *   client/public/brand/logo-mark-flat.svg  → maskable icon + favicon kecil
 *   client/public/brand/logo-mark-mono.svg  → versi mono (kalau butuh)
 *   client/public/brand/og-image.svg        → Open Graph 1200x630
 *   client/public/brand/splash.svg          → splash PWA/iOS 1080x1920
 *
 * Jalankan:  npm run icons
 *
 * Semua output di-render dari SVG di atas — tidak ada binary aset warisan.
 * Mesin render dipilih otomatis (urut prioritas):
 *   1. sharp          → sudah ada di devDependencies (paling praktis)
 *   2. python3+cairo  → pip install cairosvg
 *   3. ffmpeg         → kalau build-nya punya librsvg (decoder svg)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'client', 'public');
const BRAND = path.join(PUB, 'brand');

/* Target render: { src, out, w, h } — h null = persegi (w×w) */
const TARGETS = [
  // Ikon PWA (any)
  { src: 'logo-mark.svg', out: 'icons/icon-192.png', w: 192 },
  { src: 'logo-mark.svg', out: 'icons/icon-512.png', w: 512 },
  { src: 'logo-mark.svg', out: 'icons/icon-1024.png', w: 1024 },
  // Ikon maskable (safe-zone 80%, full-bleed)
  { src: 'logo-mark-flat.svg', out: 'icons/maskable-512.png', w: 512 },
  { src: 'logo-mark-flat.svg', out: 'icons/maskable-1024.png', w: 1024 },
  // iOS / favicon
  { src: 'logo-mark.svg', out: 'apple-touch-icon.png', w: 180 },
  { src: 'logo-mark.svg', out: 'favicon.png', w: 64 },
  { src: 'logo-mark.svg', out: 'favicon-48.png', w: 48 },
  { src: 'logo-mark-flat.svg', out: 'favicon-32.png', w: 32 },
  // Open Graph (1200x630) & splash (1080x1920)
  { src: 'og-image.svg', out: 'og-image.png', w: 1200, h: 630 },
  { src: 'splash.svg', out: 'splash.png', w: 1080, h: 1920 },
];

/* ---------------- mesin render ---------------- */

function hasSharp() {
  try { require.resolve('sharp'); return true; } catch { return false; }
}
function hasPythonCairo() {
  const r = spawnSync('python3', ['-c', 'import cairosvg'], { encoding: 'utf8' });
  return r.status === 0;
}
function hasFfmpegSvg() {
  const bin = process.env.FFMPEG_PATH || (() => { try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; } })();
  const r = spawnSync(bin, ['-hide_banner', '-decoders'], { encoding: 'utf8' });
  return r.status === 0 && /svg/.test(r.stdout || '');
}

async function renderSharp(svg, out, w, h) {
  const sharp = require('sharp');
  const size = h || w;
  const maxDim = Math.max(w, h || w);
  // Density tinggi = raster tajam, tapi sharp punya limit dimensi input
  // (±16383px). Cap density supaya sisi terpanjang raster ≤ 8000px.
  const wantDensity = Math.max(72, Math.round((size / 512) * 384));
  const density = Math.min(wantDensity, Math.floor((8000 * 72) / maxDim));
  await sharp(fs.readFileSync(svg), { density })
    .resize(w, h || w, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  return true;
}

function renderCairo(svg, out, w, h) {
  const py = `import cairosvg,sys
cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], output_width=int(sys.argv[3]), output_height=int(sys.argv[4]))`;
  const r = spawnSync('python3', ['-c', py, svg, out, String(w), String(h || w)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || 'cairosvg gagal').trim().split('\n').slice(-1)[0]);
  return true;
}

function renderFfmpeg(svg, out, w, h) {
  const bin = process.env.FFMPEG_PATH || (() => { try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; } })();
  const r = spawnSync(
    bin,
    ['-hide_banner', '-loglevel', 'error', '-i', svg, '-vf', `scale=${w}:${h || w}:flags=lanczos`, '-frames:v', '1', '-y', out],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error((r.stderr || 'ffmpeg gagal').trim().split('\n').slice(-1)[0]);
  return true;
}

/* ---------------- main ---------------- */
(async () => {
  const engine = hasSharp() ? 'sharp' : hasPythonCairo() ? 'python-cairosvg' : hasFfmpegSvg() ? 'ffmpeg(librsvg)' : null;
  if (!engine) {
    console.error(
      '❌ Gak ada mesin render SVG yang tersedia.\n' +
      '   Pilih salah satu:\n' +
      '     • npm i -D sharp            (rekomendasi — sudah ada di devDependencies)\n' +
      '     • pip install cairosvg\n' +
      '     • install ffmpeg dengan dukungan librsvg\n'
    );
    process.exit(1);
  }
  console.log(`🎨 JernihHD — render aset brand pakai: ${engine}\n`);

  let ok = 0;
  let fail = 0;
  for (const t of TARGETS) {
    const input = path.join(BRAND, t.src);
    const output = path.join(PUB, t.out);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (!fs.existsSync(input)) {
      console.log(`⚠  skip (SVG gak ada): ${t.src}`);
      fail += 1;
      continue;
    }
    try {
      if (engine === 'sharp') await renderSharp(input, output, t.w, t.h);
      else if (engine === 'python-cairosvg') renderCairo(input, output, t.w, t.h);
      else renderFfmpeg(input, output, t.w, t.h);
      const dim = t.h ? `${t.w}x${t.h}` : `${t.w}px`;
      console.log(`✅ ${t.out} — ${dim} · ${(fs.statSync(output).size / 1024).toFixed(1)} KB`);
      ok += 1;
    } catch (e) {
      console.log(`❌ ${t.out} — ${e.message}`);
      fail += 1;
    }
  }
  console.log(`\nSelesai: ${ok} dibuat, ${fail} gagal.`);
  process.exit(fail ? 1 : 0);
})();
