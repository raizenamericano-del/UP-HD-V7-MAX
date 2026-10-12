import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Cpu, Film, Loader2, Send, Sparkles, UploadCloud, X } from 'lucide-react';

const STAGES = [
  { id: 'upload', label: 'Upload', icon: <UploadCloud className="h-4 w-4" /> },
  { id: 'compress', label: 'Encode HD', icon: <Cpu className="h-4 w-4" /> },
  { id: 'send', label: 'Kirim', icon: <Send className="h-4 w-4" /> },
  { id: 'done', label: 'Beres', icon: <Check className="h-4 w-4" /> },
];

const MSGS = [
  'Nyiapin file & metadata…',
  'Scaling LANCZOS biar tetep tajem…',
  'Normalisasi warna (BT.709)…',
  'Nyetel bitrate & GOP…',
  'Anti-banding buat scene gelap…',
  'Beresin audio (EBU R128)…',
  'Lagi diproses ke HD…',
  'Dikit lagi…',
];

/** Panel proses: upload → encode → kirim dengan progress dan log live */
export default function ProcessPanel({ stage = 0, progress = {}, plan, targets = 1, logs = [], onCancel }) {
  const twoPass = !!plan?.twoPass;
  const [msgIdx, setMsgIdx] = useState(0);
  const percent = Math.round(progress.percent || 0);
  const indeterminate = percent <= 0 || stage === 2;

  useEffect(() => {
    if (stage !== 1) return;
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % MSGS.length), 2400);
    return () => clearInterval(t);
  }, [stage]);

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="card p-6 sm:p-8">
      {/* judul */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
          </span>
          <h3 className="font-display text-base font-extrabold text-white">
            {stage === 0 && 'Nyiapin proses…'}
            {stage === 1 && 'Lagi encode HD'}
            {stage === 2 && 'Lagi ngirim ke WhatsApp'}
            {stage === 3 && 'Beres!'}
          </h3>
        </div>
        {plan && <span className="chip chip-brand">{plan.profileLabel}</span>}
      </div>

      {/* ring + metrik */}
      <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-center sm:gap-10">
        <div className="relative" style={{ width: 168, height: 168 }}>
          <span className="absolute inset-0 rounded-full bg-brand/15" style={{ animation: 'wave-pulse 1.9s ease-out infinite' }} />
          <span className="absolute inset-0 rounded-full bg-iris/[0.12]" style={{ animation: 'wave-pulse 1.9s ease-out 0.65s infinite' }} />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from -90deg, #34D399 0deg, #22D3EE ${percent * 1.2}deg, #60A5FA ${percent * 2.6}deg, #34D399 ${percent * 3.6}deg, rgba(255,255,255,0.06) ${percent * 3.6}deg)`,
              WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 14px), black calc(100% - 13px))',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 14px), black calc(100% - 13px))',
              transition: 'background 0.4s linear',
            }}
          />
          <div className="absolute inset-[14px] grid place-items-center rounded-full bg-ink-900/95 shadow-inset">
            {indeterminate ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-7 w-7 animate-spin text-brand" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {stage === 2 ? 'Upload media' : 'Siapin'}
                </span>
              </div>
            ) : (
              <div className="text-center">
                <div className="font-display text-3xl font-black text-white">{percent}<span className="text-lg text-slate-500">%</span></div>
                {twoPass ? (
                  <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                    pass {progress.pass || 1}/2
                  </div>
                ) : (
                  <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {plan?.modeLabel || 'encode'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid w-full max-w-xs grid-cols-2 gap-2 sm:w-auto">
          <Stat label="Kecepatan" value={progress.speed ? `${progress.speed}×` : '—'} />
          <Stat label="FPS" value={progress.fps || '—'} />
          <Stat label="Sisa waktu" value={fmtEta(progress.etaSec)} />
          <Stat label="Tujuan" value={`${targets} nomor`} />
        </div>
      </div>

      {/* pesan berjalan */}
      <div className="mt-6 text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={msgIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28 }}
            className="text-xs font-semibold text-slate-300"
          >
            {stage === 1 ? MSGS[msgIdx] : stage === 2 ? 'Ngupload media ke server WhatsApp…' : 'Nyiapin…'}
          </motion.div>
        </AnimatePresence>
        {progress.note && <div className="mt-1 text-[11px] text-amber-300">{progress.note}</div>}

        {/* Retry otomatis: engine ulang dengan setting lebih hemat */}
        {progress.retry && (
          <div className="mx-auto mt-2 max-w-md rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-2.5 text-left">
            <div className="text-[11px] font-extrabold text-amber-300">
              🔁 Coba ulang otomatis — percobaan {progress.retry.attempt}/{progress.retry.total} ({progress.retry.name})
            </div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
              Pengaturan utama tidak cocok untuk video ini, engine beralih ke pengaturan yang lebih hemat
              {progress.retry.width ? ` (${progress.retry.width}×${progress.retry.height})` : ''} —
              hasilnya tetap HD, cuma prosesnya beda. Jangan tutup halaman ya.
            </div>
          </div>
        )}

        {/* Heartbeat: video berat butuh waktu, kasih tanda server masih hidup */}
        {progress.heartbeat && !progress.retry && progress.idleSec >= 10 && (
          <div className="mt-1 text-[11px] text-slate-400">
            ⏳ Server masih ng-encode ({progress.idleSec}s tanpa frame baru) — video berat memang butuh waktu.
          </div>
        )}
      </div>

      {/* stage tracker */}
      <div className="mt-6 flex items-center gap-1.5">
        {STAGES.map((s, i) => {
          const done = i < stage;
          const active = i === stage;
          return (
            <div key={s.id} className="flex flex-1 items-center gap-1.5">
              <div
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  done
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : active
                    ? 'border-brand/45 bg-brand/[0.12] text-white'
                    : 'border-white/[0.07] bg-white/[0.02] text-slate-600'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s.icon}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* log live */}
      {logs?.length > 0 && (
        <div className="mt-5 max-h-28 overflow-hidden rounded-xl border border-white/[0.07] bg-ink-950/70 p-3 font-mono text-[10px] leading-relaxed text-slate-500">
          {logs.slice(-5).map((l, i) => (
            <div key={i} className={i === logs.slice(-5).length - 1 ? 'text-slate-300' : ''}>
              <span className="text-brand-400">›</span> {l}
            </div>
          ))}
        </div>
      )}

      <button className="btn-danger mt-6 w-full" onClick={onCancel}>
        <X className="h-4 w-4" /> Batalin aja
      </button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[10px] text-slate-500">
        <Sparkles className="h-3 w-3 text-accent" /> Mohon jangan menutup tab ini agar proses tidak terputus.
      </p>
    </motion.div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="tile text-center">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-xs font-bold text-slate-100">{value}</div>
    </div>
  );
}

function fmtEta(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  if (sec < 60) return `${Math.ceil(sec)} dtk`;
  return `${Math.floor(sec / 60)} mnt ${Math.ceil(sec % 60)} dtk`;
}
