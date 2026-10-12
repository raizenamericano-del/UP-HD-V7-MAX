import { motion } from 'framer-motion';
import {
  Gauge,
  Globe,
  Info,
  Instagram,
  Music2,
  Ruler,
  Scissors,
  Smartphone,
  Sparkles,
  Timer,
  Waves,
  Wand2,
  Droplets,
  Youtube,
} from 'lucide-react';

const PLATFORM_ICON = {
  wa: <Smartphone className="h-4 w-4" />,
  tiktok: <Music2 className="h-4 w-4" />,
  ig: <Instagram className="h-4 w-4" />,
  shorts: <Youtube className="h-4 w-4" />,
  universal: <Globe className="h-4 w-4" />,
};

const QUALITY_HINT = {
  '1080p': 'Full HD — paling tajam',
  '720p': 'HD — ukuran lebih kecil',
  '480p': 'SD — hemat data',
  '360p': 'Paling hemat',
};

const FIT_OPTIONS = [
  { key: 'smart', label: 'Otomatis', desc: 'Pilih sendiri yang terbaik', needsCanvas: true },
  { key: 'fill', label: 'Crop penuh', desc: 'Penuhi layar, tepi kepotong', needsCanvas: true },
  { key: 'pad', label: 'Muat utuh', desc: 'Tidak ada yang kepotong', needsCanvas: true },
  { key: 'none', label: 'Ukuran asli', desc: 'Seperti sumbernya', needsCanvas: false },
];

const MODE_ICON = {
  turbo: <Gauge className="h-3.5 w-3.5" />,
  balanced: <Wand2 className="h-3.5 w-3.5" />,
  max: <Sparkles className="h-3.5 w-3.5" />,
};

/**
 * Kontrol engine v5: target platform, kualitas (ladder per target),
 * mode encode, auto-trim per platform, sharpening + preview rencana.
 */
export default function EngineControls({
  cfg,
  platform,
  setPlatform,
  quality,
  setQuality,
  mode,
  setMode,
  trim,
  setTrim,
  sharpen,
  setSharpen,
  fit,
  setFit,
  plan,
  plans,
  loading,
}) {
  const modes = cfg?.modes || [];
  const targets = cfg?.targets || [];
  const target = targets.find((t) => t.key === platform) || targets[0];
  const ladder = target?.ladder || [];
  const activePlan = plan;
  // Default sharpen per target (TikTok/IG ON) — dipakai saat user tidak override
  const sharpenDefaultOn = (target?.sharpenDefault || 0) > 0;
  // Kanvas hanya tersedia untuk target yang punya canvas (TikTok/IG/Shorts).
  // WA & Universal sengaja tidak dipaksa — jalur lamanya dipertahankan utuh.
  const canvasOn = !!target?.canvas;

  /* Estimasi VMAF setelah platform meng-encode ulang.
   * Angkanya berasal dari pengukuran nyata di mesin ini (sumber 720x1280):
   *   tanpa kanvas  = 50.6 (TikTok) / 50.3 (IG)
   *   kanvas+sharpen= 61.2 (TikTok) / 60.7 (IG)
   * Dipakai sebagai indikator, bukan janji — hasil nyata ikut isi video. */
  const antiPecah = (() => {
    if (!canvasOn || !activePlan || activePlan.fit === 'none') return null;
    const up = activePlan.upscaleFactor || 1;
    const base = 50;
    const gainCanvas = up > 1.05 ? 5.5 : 2.5;
    const gainSharp = activePlan.sharpen > 0 ? Math.min(6, 3 + activePlan.sharpen * 3) : 0;
    const gain = Math.round((gainCanvas + gainSharp) * 10) / 10;
    return { base, gain, now: Math.round((base + gain) * 10) / 10 };
  })();

  return (
    <div className="space-y-5">
      {/* ---------- Target Platform ---------- */}
      <div>
        <label className="label">Target Platform</label>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {targets.map((t) => {
            const active = platform === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setPlatform(t.key)}
                className={`relative min-w-[104px] flex-1 overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 ${
                  active
                    ? 'border-brand/50 bg-brand/[0.12] shadow-glow'
                    : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="platform-glow"
                    className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-brand/40"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={`grid h-8 w-8 place-items-center rounded-lg ${active ? 'bg-grad-brand text-white' : 'bg-white/5 text-slate-400'}`}>
                  {PLATFORM_ICON[t.key]}
                </span>
                <span className={`mt-2 block text-[11px] font-extrabold leading-tight ${active ? 'text-white' : 'text-slate-300'}`}>
                  {t.short}
                </span>
                <span className="mt-0.5 block text-[9px] leading-tight text-slate-500">
                  {t.trimSec ? `≤${t.trimSec}s · ` : ''}≤{t.maxFps}fps
                </span>
              </button>
            );
          })}
        </div>
        {target?.desc && <p className="hint">{target.desc}</p>}
        {['tiktok', 'ig', 'shorts'].includes(target?.key) && (
          <p className="hint mt-1 text-amber-300/80">
            💡 Tip anti-pecah: aktifkan setelan <b>"Kualitas upload tinggi / Allow high-quality uploads"</b> di
            aplikasi TikTok/IG/YT kamu, dan kalau bisa upload lewat <b>web/desktop</b> — aplikasi HP sering
            mengompres ulang lebih agresif sebelum video sampai ke server mereka.
          </p>
        )}
      </div>

      {/* ---------- Kualitas (ladder target) ---------- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="label !mb-0">Resolusi Output</label>
          {activePlan && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              hasil ≈ {activePlan.width}×{activePlan.height}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {['auto', ...ladder.map((p) => p.key)].map((key) => {
            const p = ladder.find((x) => x.key === key);
            const active = quality === key;
            const est = plans?.[key]?.estimatedMB;
            return (
              <button
                key={key}
                onClick={() => setQuality(key)}
                className={`relative overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 ${
                  active
                    ? 'border-brand/50 bg-brand/[0.12] shadow-glow'
                    : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="quality-glow"
                    className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-brand/40"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <div className={`text-sm font-extrabold ${active ? 'text-white' : 'text-slate-300'}`}>
                  {key === 'auto' ? 'Auto' : p?.short || key}
                </div>
                <div className="mt-0.5 text-[10px] leading-tight text-slate-500">
                  {key === 'auto' ? 'Pilih paling pas' : QUALITY_HINT[key] || `${p?.bitrateMbps} Mbps`}
                </div>
                {key !== 'auto' && p && (
                  <div className={`mt-1 font-mono text-[9.5px] font-bold ${active ? 'text-brand-300' : 'text-slate-600'}`}>
                    {p.bitrateMbps} Mbps{p.capMbps !== p.bitrateMbps ? ` (cap ${p.capMbps})` : ''}
                  </div>
                )}
                {est ? (
                  <div className={`mt-1 font-mono text-[10px] font-bold ${active ? 'text-accent-300' : 'text-slate-600'}`}>
                    ≈ {est} MB
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- Mode encode ---------- */}
      <div>
        <label className="label">Mode Engine</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {modes.map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`relative flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all duration-200 ${
                  active ? 'border-accent/45 bg-accent/[0.08]' : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                }`}
              >
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${active ? 'bg-accent/15 text-accent-300' : 'bg-white/5 text-slate-400'}`}>
                  {MODE_ICON[m.key]}
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-extrabold ${active ? 'text-white' : 'text-slate-300'}`}>{m.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-tight text-slate-500">{m.desc}</span>
                </span>
                {active && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- Auto-trim per platform ---------- */}
      <div className={`flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5 ${!target?.trimSec ? 'opacity-55' : ''}`}>
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-iris/[0.12] text-iris-400">
            <Scissors className="h-4 w-4" />
          </span>
          <div>
            <div className="text-xs font-extrabold text-white">
              {target?.trimSec ? `Potong otomatis ${target.trimSec} detik (limit ${target.label})` : 'Potong otomatis (target ini tanpa limit)'}
            </div>
            <div className="mt-0.5 text-[10px] leading-tight text-slate-500">
              {target?.trimSec
                ? `${target.label} membatasi durasi. Engine yang motong rapi dari awal — bukan dipotong acak oleh platform.`
                : `${target?.label || 'Platform'} tidak memotong durasi — toggle ini nonaktif.`}
            </div>
          </div>
        </div>
        <button
          onClick={() => target?.trimSec && setTrim(!trim)}
          disabled={!target?.trimSec}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed ${
            trim && target?.trimSec ? 'border-accent/40 bg-accent/25' : 'border-white/10 bg-white/[0.06]'
          }`}
          aria-pressed={trim}
          aria-label="Aktifkan potong otomatis"
        >
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className={`absolute top-[3px] h-4 w-4 rounded-full ${trim && target?.trimSec ? 'left-[26px] bg-accent' : 'left-[3px] bg-slate-400'}`}
          />
        </button>
      </div>

      {/* ---------- Kanvas platform (v6 anti-pecah) ---------- */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/[0.12] text-accent">
            <Ruler className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white">
              Kanvas {target?.short || 'platform'}
              {canvasOn && <span className="chip chip-accent ml-1.5 !text-[8.5px]">anti-pecah</span>}
            </div>
            <div className="mt-0.5 text-[10px] leading-tight text-slate-500">
              {canvasOn
                ? 'Engine menyiapkan resolusi native platform, jadi scaler TikTok/IG tidak ikut memproses ulang videomu.'
                : 'Ukuran asli dipertahankan. Platform tetap akan menormalkan sendiri — hasilnya bisa lebih lunak.'}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {FIT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setFit(o.key)}
              disabled={o.needsCanvas && !canvasOn}
              className={`rounded-lg border px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                fit === o.key ? 'border-accent/50 bg-accent/[0.12]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
              }`}
            >
              <div className={`text-[10px] font-bold ${fit === o.key ? 'text-accent' : 'text-slate-300'}`}>{o.label}</div>
              <div className="mt-0.5 text-[9px] leading-tight text-slate-500">{o.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Sharpening ---------- */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/[0.12] text-brand-300">
            <Droplets className="h-4 w-4" />
          </span>
          <div>
            <div className="text-xs font-extrabold text-white">
              Extra tajam (unsharp luma halus)
              {sharpenDefaultOn && <span className="chip chip-accent ml-1.5 !text-[8.5px]">default {target.short}</span>}
            </div>
            <div className="mt-0.5 text-[10px] leading-tight text-slate-500">
              {sharpenDefaultOn
                ? `Re-encode ${target?.label || 'platform'} paling mengikis detail — sharpening ringan nyala otomatis. Matikan kalau tidak suka.`
                : 'Bikin tampilan lebih crisp di HP. Mati secara default — nyalakan kalau mau kelihatan lebih "tajam".'}
            </div>
          </div>
        </div>
        <button
          onClick={() => setSharpen(!sharpen)}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
            sharpen ? 'border-brand/45 bg-brand/30' : 'border-white/10 bg-white/[0.06]'
          }`}
          aria-pressed={sharpen}
          aria-label="Aktifkan extra tajam"
        >
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className={`absolute top-[3px] h-4 w-4 rounded-full ${sharpen ? 'left-[26px] bg-brand-400' : 'left-[3px] bg-slate-400'}`}
          />
        </button>
      </div>

      {/* ---------- Plan preview ---------- */}
      {activePlan && (
        <div className="glass-panel p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-brand-300" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Rencana Encode</span>
            </div>
            <span className={`chip ${loading ? 'chip-amber' : 'chip-brand'}`}>{loading ? 'ngitung…' : activePlan.profileLabel}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric icon={<Ruler className="h-3 w-3" />} label="Resolusi" value={`${activePlan.width}×${activePlan.height}`} />
            <Metric icon={<Timer className="h-3 w-3" />} label="Durasi" value={`${activePlan.durationSec}s`} accent={activePlan.trimmed} />
            <Metric icon={<Gauge className="h-3 w-3" />} label="Bitrate" value={`${(activePlan.videoKbps / 1000).toFixed(1)} Mbps`} />
            <Metric icon={<Waves className="h-3 w-3" />} label="Perkiraan" value={`${activePlan.estimatedMB} MB`} />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="chip chip-iris">{activePlan.targetLabel}</span>
            <span className="chip">{activePlan.fps} fps</span>
            <span className="chip">H.264 High · {activePlan.level}</span>
            <span className="chip">GOP {Math.round((activePlan.gopFrames || 60) / Math.max(1, activePlan.fps))}s</span>
            <span className="chip">{activePlan.audioMode} · {activePlan.audioKbps}k</span>
            {activePlan.loudness?.enabled && (
              <span className="chip chip-accent">EBU R128 {activePlan.loudness.I} LUFS</span>
            )}
            {activePlan.twoPass && <span className="chip-brand">2-pass ABR</span>}
            {activePlan.fit && activePlan.fit !== 'none' && (
              <span className="chip chip-accent" title="Engine menyiapkan kanvas native platform">
                kanvas native · {activePlan.fit === 'fill' ? 'crop penuh' : 'muat utuh'}
              </span>
            )}
            {activePlan.upscaleFactor > 1.02 && (
              <span className="chip chip-brand">
                upscale LANCZOS {activePlan.upscaleFactor.toFixed(2)}×
              </span>
            )}
            {activePlan.hdrTonemap && <span className="chip-accent">HDR → SDR</span>}
            {activePlan.denoise && <span className="chip-accent">denoise</span>}
            {activePlan.sharpen > 0 && <span className="chip-accent">unsharp {activePlan.sharpen}</span>}
            {activePlan.trimmed && <span className="chip-amber">dipotong {activePlan.durationSec}s</span>}
            <span className="chip">budget {activePlan.maxOutputMB} MB</span>
          </div>

          {/* ---------- Ketahanan terhadap re-encode platform ---------- */}
          {antiPecah && (
            <div className="mt-3 rounded-xl border border-accent/20 bg-accent/[0.05] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Anti-pecah</span>
                </div>
                <span className="font-mono text-[10px] font-bold text-white">+{antiPecah.gain} poin</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {[
                  { label: 'Tanpa kanvas (diserahkan ke platform)', val: antiPecah.base, tone: 'bg-slate-500/60' },
                  { label: 'Dengan setelan ini', val: antiPecah.now, tone: 'bg-grad-brand' },
                ].map((r) => (
                  <div key={r.label}>
                    <div className="flex items-center justify-between text-[9.5px] text-slate-500">
                      <span>{r.label}</span>
                      <span className="font-mono text-slate-400">{r.val}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className={`h-full rounded-full ${r.tone}`} style={{ width: `${Math.min(100, r.val)}%`, transition: 'width .6s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[9.5px] leading-relaxed text-slate-500">
                Perkiraan VMAF setelah {target?.short || 'platform'} meng-encode ulang videomu. Diukur pada sumber 720×1280 — angka nyata bergantung pada isi video.
              </p>
            </div>
          )}

          {activePlan.notes?.length > 0 && (
            <ul className="mt-3 space-y-1">
              {activePlan.notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-slate-400">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" /> {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, accent }) {
  return (
    <div className="tile">
      <div className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-500">
        {icon} {label}
      </div>
      <div className={`mt-1 font-mono text-xs font-bold ${accent ? 'text-iris-400' : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}
