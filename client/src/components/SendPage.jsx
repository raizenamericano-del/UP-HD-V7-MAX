import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Camera,
  FileVideo,
  Film,
  Gauge,
  Hash,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
  UploadCloud,
  Users,
  X,
  XCircle,
  Zap,
  Download,
} from 'lucide-react';
import { useApp } from '../App.jsx';
import { api, uploadVideo } from '../lib/api.js';
import { store } from '../lib/store.js';
import EngineControls from './EngineControls.jsx';
import ProcessPanel from './ProcessPanel.jsx';
import SuccessCard from './SuccessCard.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import DonateCard from './DonateCard.jsx';

const ACCEPT = '.mp4,.mov,.mkv,.avi,.webm,.3gp,.3gpp,.m4v,.mpeg,.mpg,.mts,.m2ts,.hevc';

export default function SendPage() {
  const { conn, socket, addToast, setPage, effectiveConnected, cfg } = useApp();

  /* ---------- state file & upload ---------- */
  const [file, setFile] = useState(null);
  const [upPhase, setUpPhase] = useState('idle'); // idle|uploading|ready
  const [upPercent, setUpPercent] = useState(0);
  const [up, setUp] = useState(null);              // { uploadId, meta, plans }
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  /* ---------- opsi engine ---------- */
  const [platform, setPlatformState] = useState(store.getPlatform());
  const [quality, setQuality] = useState(store.getQuality());
  const [mode, setMode] = useState(store.getMode());
  const [trim, setTrim] = useState(store.getTrim());
  const [sharpen, setSharpen] = useState(store.getSharpen());
  // Cara meletakkan video di kanvas platform (v6 anti-pecah):
  // smart = otomatis · fill = crop penuh · pad = muat utuh + latar buram · none = ukuran asli
  const [fit, setFit] = useState(store.getFit());
  const [caption, setCaption] = useState(store.getCaption());
  const [plan, setPlan] = useState(null);
  const [plans, setPlans] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);

  // Sekali saat cfg siap: default sharpen mengikuti target (TikTok/IG ON)
  const sharpenInitRef = useRef(false);
  useEffect(() => {
    if (sharpenInitRef.current || !cfg?.targets) return;
    sharpenInitRef.current = true;
    const t = cfg.targets.find((x) => x.key === platform);
    try {
      if (t && localStorage.getItem('hdjir_sharpen') == null) setSharpen((t.sharpenDefault || 0) > 0);
    } catch { /* noop */ }
  }, [cfg, platform]);

  const setPlatform = useCallback((key) => {
    setPlatformState(key);
    store.setPlatform(key);
    const t = (cfg?.targets || []).find((x) => x.key === key);
    if (t) {
      if (quality !== 'auto' && !t.ladder.some((r) => r.key === quality)) setQuality('auto');
      setSharpen((t.sharpenDefault || 0) > 0);
    }
  }, [cfg, quality]);

  /* ---------- tujuan ---------- */
  const [target, setTarget] = useState(store.getTarget());

  /* ---------- proses ---------- */
  const [phase, setPhase] = useState('idle'); // idle|processing|success|error
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState({ percent: 0, etaSec: null, speed: null, pass: null, fps: null, note: null });
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const confettiFired = useRef(false);

  const connected = effectiveConnected;
  const targetList = useMemo(
    () => target.split(/[,;\s]+/).map((t) => t.replace(/[^\d]/g, '')).filter((t) => t.length >= 9).slice(0, 5),
    [target]
  );

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const pushLog = useCallback((line) => {
    setLogs((l) => [...l.slice(-24), `${new Date().toLocaleTimeString('id-ID', { hour12: false })} ${line}`]);
  }, []);

  /* ---------- Socket ---------- */
  useEffect(() => {
    if (!socket) return;
    const onJobStart = () => {
      confettiFired.current = false;
      setPhase('processing');
      setStage(0);
      setProgress({ percent: 0, etaSec: null, speed: null, pass: null, fps: null, note: null });
      setError(null);
      setResult(null);
      setLogs([]);
      pushLog('Mulai — ngecek nomor tujuan…');
    };
    const onCompressStart = (d) => {
      setStage(1);
      if (d?.plan) { setPlan(d.plan); pushLog(`Encode jalan · ${d.plan.width}x${d.plan.height} · ${(d.plan.videoKbps / 1000).toFixed(1)} Mbps · ${d.plan.modeLabel}`); }
    };
    const onCompressProgress = (d) => {
      setStage(1);
      setProgress((prev) => ({
        // heartbeat bawa percent=null → jangan turunin progress yang sudah jalan
        percent: d.percent == null ? (prev.percent || 0) : d.percent,
        etaSec: d.etaSec ?? prev.etaSec,
        speed: d.speed ?? prev.speed,
        pass: d.pass ?? prev.pass,
        fps: d.fps ?? prev.fps,
        note: d.note || null,
        heartbeat: !!d.heartbeat,
        idleSec: d.idleSec || 0,
        retry: d.retry || prev.retry || null,
      }));
      if (d.pass === 2 && (d.percent | 0) < 2) pushLog('Pass 2/2 — finishing…');
      if (d.note) pushLog(d.note);
    };
    const onCompressDone = (d) => {
      setStage(2);
      setProgress((p) => ({ ...p, percent: 100 }));
      pushLog(`Encode selesai · ${d.sizeMB} MB · ${d.width}x${d.height} · ${d.profileLabel}`);
    };
    const onSendStart = (d) => {
      setStage(2);
      setProgress({ percent: 100, etaSec: null, speed: null, pass: null, fps: null, note: null });
      pushLog(`Ngupload ke WhatsApp → ${d?.targets?.length || 1} tujuan…`);
    };
    const onSendAck = (d) => pushLog(`Centang dari ${d?.target || 'tujuan'} (status ${d?.status})`);
    const onSendDone = (d) => {
      setStage(3);
      setPhase('success');
      setResult(d);
      pushLog(`Kekirim ke ${d?.targets?.join(', ') || d?.target || 'download'}`);
      fireConfetti();
    };
    const onSendError = (e) => {
      if (e?.code === 'CANCELED') {
        setPhase('idle');
        setStage(0);
        addToast('info', 'Batal', 'Prosesnya dibatalin.');
        pushLog('Dibatalin sendiri');
      } else {
        setPhase('error');
        setError(e?.message || 'Ada yang error, coba lagi.');
        pushLog(`ERROR: ${e?.message || 'unknown'}`);
      }
    };

    socket.on('job:start', onJobStart);
    socket.on('compress:start', onCompressStart);
    socket.on('compress:progress', onCompressProgress);
    socket.on('compress:done', onCompressDone);
    socket.on('send:start', onSendStart);
    socket.on('send:ack', onSendAck);
    socket.on('send:done', onSendDone);
    socket.on('send:error', onSendError);
    return () => {
      socket.off('job:start', onJobStart);
      socket.off('compress:start', onCompressStart);
      socket.off('compress:progress', onCompressProgress);
      socket.off('compress:done', onCompressDone);
      socket.off('send:start', onSendStart);
      socket.off('send:ack', onSendAck);
      socket.off('send:done', onSendDone);
      socket.off('send:error', onSendError);
    };
  }, [socket, addToast, pushLog]);

  /* ---------- Judul tab ---------- */
  useEffect(() => {
    const base = 'JernihHD';
    if (phase === 'processing') {
      if (stage === 1) document.title = `${Math.round(progress.percent || 0)}% Encode HD… | ${base}`;
      else if (stage === 2) document.title = `Ngupload ke WA… | ${base}`;
      else document.title = `Nyiapin… | ${base}`;
    } else {
      document.title = base;
    }
    return () => { document.title = base; };
  }, [phase, stage, progress.percent]);

  /* ---------- Simpan preferensi ---------- */
  useEffect(() => { store.setPlatform(platform); }, [platform]);
  useEffect(() => { store.setQuality(quality); }, [quality]);
  useEffect(() => { store.setMode(mode); }, [mode]);
  useEffect(() => { store.setTrim(trim); }, [trim]);
  useEffect(() => { store.setSharpen(sharpen); }, [sharpen]);
  useEffect(() => { store.setFit(fit); }, [fit]);
  useEffect(() => { store.setCaption(caption); }, [caption]);
  useEffect(() => { store.setTarget(target); }, [target]);

  /* ---------- Ambil plan dari server tiap opsi berubah ---------- */
  useEffect(() => {
    if (!up?.uploadId) return;
    let alive = true;
    setPlanLoading(true);
    const t = setTimeout(() => {
      api('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: up.uploadId, target: platform, quality, mode, trim: trim ? 'auto' : 'none', sharpen, fit }),
      })
        .then((res) => {
          if (!alive) return;
          setPlan(res.plan);
          setPlans(res.plans);
        })
        .catch(() => { /* biarkan pakai plan lama */ })
        .finally(() => alive && setPlanLoading(false));
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [up?.uploadId, platform, quality, mode, trim, sharpen, fit]);

  /* ---------- Confetti ---------- */
  const fireConfetti = () => {
    if (confettiFired.current) return;
    confettiFired.current = true;
    const colors = ['#34D399', '#22D3EE', '#60A5FA', '#ffffff'];
    confetti({ particleCount: 130, spread: 82, origin: { y: 0.62 }, colors });
    setTimeout(() => confetti({ particleCount: 60, spread: 120, origin: { y: 0.5 }, colors, shapes: ['star'], scalar: 1.1, startVelocity: 42 }), 250);
    setTimeout(() => confetti({ particleCount: 45, spread: 100, origin: { y: 0.72 }, colors, scalar: 0.8 }), 520);
  };

  /* ---------- Upload ---------- */
  const handleFile = async (f) => {
    if (!f || phase === 'processing') return;
    const maxMB = cfg?.maxUploadMB || 500;
    if (f.size > maxMB * 1024 * 1024) {
      addToast('error', 'Kegedean', `Maksimal ${maxMB} MB per video.`);
      return;
    }
    const okType = (f.type || '').startsWith('video/') || /\.(mp4|mov|mkv|avi|webm|3gp|3gpp|m4v|mpeg|mpg|mts|m2ts|hevc)$/i.test(f.name);
    if (!okType) {
      addToast('error', 'Bukan video', 'Pilih file video (MP4, MOV, MKV, AVI, WebM, M4V, 3GP).');
      return;
    }
    setFile(f);
    setUpPhase('uploading');
    setUpPercent(0);
    setUp(null);
    setPlan(null);
    setPlans(null);
    setPhase('idle');
    setError(null);
    setResult(null);
    try {
      const res = await uploadVideo(f, setUpPercent, platform);
      setUp(res);
      setUpPhase('ready');
      setPlan(res.plan);
      setPlans(res.plans);
      const m = res.meta || {};
      addToast(
        'success',
        'Video siap',
        `${m.width}×${m.height} · ${Math.round(m.durationSec)}s · ${m.isHDR ? 'HDR → SDR' : m.codec}`
      );
    } catch (err) {
      setUpPhase('idle');
      setFile(null);
      addToast('error', 'Upload gagal', err.message);
    }
  };

  const resetAll = () => {
    setFile(null);
    setUp(null);
    setPlans(null);
    setPlan(null);
    setUpPhase('idle');
    setPhase('idle');
    setStage(0);
    setProgress({ percent: 0, etaSec: null, speed: null, pass: null, fps: null, note: null });
    setLogs([]);
    setError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* ---------- Jalankan proses ---------- */
  const startProcess = () => {
    if (!socket || !up?.uploadId || phase === 'processing') return;
    // pastikan panel proses langsung punya info mode (2-pass / bukan)
    setPlan((prev) => prev || plans?.[quality] || up?.plan || null);
    const needsNumber = platform === 'wa';
    if (needsNumber && !targetList.length) {
      addToast('error', 'Nomornya kosong', 'Isi nomor WA dulu (contoh: 081234567890).');
      return;
    }
    socket.emit('video:process', {
      uploadId: up.uploadId,
      targets: targetList.join(',') || undefined,
      caption: caption.trim(),
      target: platform,
      quality,
      mode,
      trim: trim ? 'auto' : 'none',
      sharpen,
      fit,
    });
  };

  const cancelProcess = () => socket?.emit('video:cancel');

  const handleResend = useCallback(
    (id) => {
      if (!socket || phase === 'processing') return;
      socket.emit('video:resend', { id, targets: targetList.join(',') || undefined, caption: caption.trim() });
    },
    [socket, phase, targetList, caption]
  );

  /* ---------- Belum nyambung ---------- */
  if (!connected) {
    return (
      <div className="space-y-4">
        <StatsRow />
        <div className="card p-10 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -18 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-400/[0.12] text-amber-300"
          >
            <Zap className="h-6 w-6" />
          </motion.div>
          <h2 className="font-display mt-4 text-2xl font-bold text-white">WA-nya belum nyambung</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
            Sambungin dulu nomor WhatsApp kamu (scan QR atau kode pairing), baru bisa kirim video HD.
          </p>
          <button className="btn-primary mt-5" onClick={() => setPage('connect')}>
            Ke Halaman Koneksi <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const busy = phase === 'processing';

  return (
    <div className="space-y-4">
      <StatsRow />

      {/* ============ 1. PILIH VIDEO ============ */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }} className="card p-5 sm:p-7">
        <SectionTitle
          step={1}
          title="Pilih Video"
          subtitle={`Maks ${cfg?.maxUploadMB || 500} MB · MP4 / MOV / MKV / AVI / WebM / 3GP · privat, cuma kamu yang bisa liat`}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <AnimatePresence mode="wait">
          {upPhase === 'idle' && (
            <motion.div
              key="drop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-4 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 sm:p-14 ${
                dragOver
                  ? 'scale-[1.01] border-brand/70 bg-brand/10 shadow-glow'
                  : 'border-white/[0.12] bg-white/[0.02] hover:border-brand/40 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <motion.div
                  animate={dragOver ? { y: [0, -12, 0], rotate: [0, -5, 5, 0] } : { y: [0, -8, 0] }}
                  transition={{ duration: dragOver ? 0.9 : 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-brand/25 via-iris/20 to-accent/20 text-brand shadow-glow"
                >
                  <UploadCloud className="h-10 w-10" />
                </motion.div>
                <div>
                  <div className="font-display text-lg font-bold text-white">Taruh videonya di sini</div>
                  <div className="mt-1 text-xs text-slate-500">atau klik buat cari file</div>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                  <span className="chip chip-accent">HDR → SDR otomatis</span>
                  <span className="chip chip-brand">Anti pecah</span>
                  <span className="chip">Maks 30 menit</span>
                </div>
              </div>
            </motion.div>
          )}

          {upPhase === 'uploading' && (
            <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
              <div className="flex flex-col items-center gap-4">
                <div className="relative grid h-24 w-24 place-items-center">
                  <span className="absolute inset-0 rounded-full bg-brand/20" style={{ animation: 'wave-pulse 1.9s ease-out infinite' }} />
                  <Loader2 className="relative h-9 w-9 animate-spin text-brand" />
                </div>
                <div className="w-full max-w-sm">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <span>Lagi upload ke server</span>
                    <span className="font-mono text-slate-300">{upPercent}%</span>
                  </div>
                  <div className="track mt-1.5"><div className="track-fill" style={{ width: `${upPercent}%` }} /></div>
                </div>
                <p className="text-xs text-slate-500">{file?.name}</p>
              </div>
            </motion.div>
          )}

          {upPhase === 'ready' && up && (
            <motion.div key="ready" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
              <div className="flex flex-col gap-4 sm:flex-row">
                {/* preview */}
                <div className="relative mx-auto w-full max-w-[220px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-card sm:mx-0">
                  <video
                    src={previewUrl}
                    className="h-full max-h-[280px] w-full object-cover"
                    muted
                    loop
                    autoPlay
                    playsInline
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8 text-[10px] font-bold text-white">
                    <span className="inline-flex items-center gap-1"><Film className="h-3 w-3" /> {Math.round(up.meta?.durationSec || 0)}s</span>
                    <span className="font-mono">{up.meta?.width}×{up.meta?.height}</span>
                  </div>
                  <span className="absolute left-2 top-2 chip chip-accent !bg-black/60">SIAP</span>
                </div>

                {/* meta + aksi */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-white">{file?.name}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {up.meta?.sizeMB} MB · {up.meta?.codec?.toUpperCase()} · {up.meta?.fps} fps
                      </div>
                    </div>
                    <button
                      className="btn-icon !h-8 !w-8 shrink-0"
                      onClick={() => { setFile(null); setUp(null); setUpPhase('idle'); setPlan(null); }}
                      title="Ganti video"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="chip chip-brand">{up.meta?.width}×{up.meta?.height}</span>
                    {up.meta?.isHDR && <span className="chip chip-accent"><Sparkles className="h-3 w-3" /> HDR terdeteksi</span>}
                    {up.meta?.isVFR && <span className="chip chip-amber">VFR → CFR</span>}
                    {(up.meta?.durationSec || 0) > 30.5 && <span className="chip chip-amber">&gt;30s</span>}
                  </div>

                  <span
                    role="button"
                    tabIndex={0}
                    className="btn-ghost mt-3 !py-2 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
                  >
                    <Camera className="h-3.5 w-3.5" /> Ganti video lain
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ============ 2. ENGINE ============ */}
      {upPhase === 'ready' && !busy && phase !== 'success' && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-7">
          <SectionTitle step={2} title="Atur Mesin" subtitle="Pilih videonya mau buat platform apa" />
          <div className="mt-4">
            <EngineControls
              cfg={cfg}
              uploadId={up?.uploadId}
              platform={platform}
              setPlatform={setPlatform}
              quality={quality}
              setQuality={setQuality}
              mode={mode}
              setMode={setMode}
              trim={trim}
              setTrim={setTrim}
              sharpen={sharpen}
              setSharpen={setSharpen}
              fit={fit}
              setFit={setFit}
              plan={plan}
              plans={plans}
              loading={planLoading}
            />
          </div>
        </motion.div>
      )}

      {/* ============ 3. TUJUAN & KIRIM ============ */}
      {(upPhase === 'ready' || busy) && phase !== 'success' && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-7">
          <SectionTitle
            step={3}
            title={platform === 'wa' ? 'Kirim ke Nomor' : 'Proses & Download HD'}
            subtitle={
              platform === 'wa'
                ? 'Kirim ke nomor WA kamu sendiri (maks 5 nomor)'
                : 'Ga perlu nomor — habis encode langsung download, terus upload manual ke platform tujuan'
            }
          />

          <div className="mt-4 space-y-4">
            <div>
              <label className="label">
                {platform === 'wa' ? 'Nomor WA Tujuan' : 'Kirim juga ke WA (boleh kosong)'}
              </label>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  className="input pl-10 font-mono tracking-wide"
                  placeholder="081234567890, 6281234567891"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {targetList.map((t) => (
                  <span key={t} className="chip chip-accent font-mono">
                    <BadgeCheck className="h-3 w-3" /> {t}
                  </span>
                ))}
                {targetList.length === 0 && (
                  <span className="text-[11px] text-slate-500">
                    {platform === 'wa'
                      ? 'Bisa banyak nomor sekaligus, pisahin pakai koma. 08xxx atau 628xxx bebas.'
                      : 'Kosongin aja kalau cuma mau download file HD-nya. Kalau diisi, videonya sekalian dikirim ke WA.'}
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="label">Caption (boleh kosong)</label>
              <div className="relative">
                <MessageSquareText className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
                <textarea
                  className="input min-h-[76px] resize-y pl-10"
                  placeholder="Tulis caption videonya di sini…"
                  maxLength={300}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="mt-1 text-right text-[10px] text-slate-600">{caption.length}/300</div>
            </div>

            {error && phase === 'error' && (
              <div className="flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/10 p-4">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                <div>
                  <div className="text-sm font-bold text-red-300">Yah, gagal</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-red-200/85">{error}</div>
                </div>
              </div>
            )}

            {!busy && (
              <button
                className="btn-primary w-full !py-4 text-base"
                onClick={startProcess}
                disabled={upPhase !== 'ready' || (platform === 'wa' && !targetList.length)}
              >
                {phase === 'error' ? (
                  <><RefreshCw className="h-5 w-5" /> Coba Lagi</>
                ) : platform === 'wa' ? (
                  <><Send className="h-5 w-5" /> Proses HD &amp; Kirim</>
                ) : targetList.length ? (
                  <><Send className="h-5 w-5" /> Proses HD, Kirim + Download</>
                ) : (
                  <><Download className="h-5 w-5" /> Proses &amp; Download HD</>
                )}
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* ============ PANEL PROSES ============ */}
      <AnimatePresence>
        {busy && (
          <ProcessPanel
            stage={stage}
            progress={progress}
            plan={plan}
            targets={targetList.length || 1}
            logs={logs}
            onCancel={cancelProcess}
          />
        )}
      </AnimatePresence>

      {/* ============ SUKSES ============ */}
      <AnimatePresence>
        {phase === 'success' && result && (
          <SuccessCard
            result={result}
            onReset={resetAll}
            onResend={(id) => handleResend(id)}
          />
        )}
      </AnimatePresence>

      {/* ============ RIWAYAT ============ */}
      <HistoryPanel onResend={handleResend} busy={busy} />

      {/* ============ DONASI ============ */}
      <DonateCard />
    </div>
  );
}

/* ==================== Kartu statistik ==================== */
function StatsRow() {
  const { history } = useApp();
  const success = history.filter((h) => h.status === 'success');
  const totalMB = success.reduce((a, h) => a + (h.sizeMB || 0), 0);
  const uniqueTargets = new Set(success.flatMap((h) => h.targets || [h.target])).size;
  const hdCount = success.filter((h) => (h.height || 0) >= 720).length;

  const cards = [
    { icon: <BarChart3 className="h-4 w-4" />, label: 'Video Terkirim', value: success.length, color: 'text-brand-400' },
    { icon: <Gauge className="h-4 w-4" />, label: 'Kualitas HD', value: hdCount, color: 'text-accent' },
    { icon: <Film className="h-4 w-4" />, label: 'Total Data', value: `${totalMB.toFixed(0)}`, suffix: 'MB', color: 'text-iris' },
    { icon: <Users className="h-4 w-4" />, label: 'Nomor Tujuan', value: uniqueTargets, color: 'text-iris-400' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="card !rounded-xl p-3 sm:p-4"
        >
          <div className="flex items-center gap-2">
            <span className={`grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] ${c.color}`}>{c.icon}</span>
            <div className="min-w-0">
              <div className="font-display text-base font-extrabold leading-none text-white sm:text-lg">
                {c.value}{c.suffix && <span className="ml-0.5 text-[10px] font-bold text-slate-500">{c.suffix}</span>}
              </div>
              <div className="truncate text-[9.5px] font-bold uppercase tracking-wider text-slate-500">{c.label}</div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/* ==================== Judul seksi ==================== */
function SectionTitle({ step, title, subtitle }) {
  return (
    <div className="flex items-center gap-3">
      <motion.div
        whileHover={{ rotate: 8, scale: 1.08 }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand via-iris to-accent text-sm font-black text-ink-950 shadow-glow"
      >
        {step}
      </motion.div>
      <div className="min-w-0">
        <h3 className="font-display text-base font-bold text-white">{title}</h3>
        <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
      </div>
      <div className="ml-auto hidden items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 sm:flex">
        <FileVideo className="h-3 w-3" /> step {step}/3
      </div>
    </div>
  );
}
