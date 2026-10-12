import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Cpu,
  Download,
  Gauge,
  HardDrive,
  LogOut,
  Phone,
  Save,
  Scissors,
  Settings as SettingsIcon,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { useApp } from '../App.jsx';
import { api } from '../lib/api.js';
import { store, fmtPhone } from '../lib/store.js';
import Logo from './Logo.jsx';

/** Modal Pengaturan — session, default tujuan, engine, bahaya, about */
export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen, conn, cfg, addToast } = useApp();
  const [target, setTarget] = useState(store.getTarget());
  const [platform, setPlatform] = useState(store.getPlatform());
  const [quality, setQuality] = useState(store.getQuality());
  const [mode, setMode] = useState(store.getMode());
  const [trim, setTrim] = useState(store.getTrim());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    setTarget(store.getTarget());
    setPlatform(store.getPlatform());
    setQuality(store.getQuality());
    setMode(store.getMode());
    setTrim(store.getTrim());
    setSaved(false);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e) => e.key === 'Escape' && setSettingsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  const saveAll = () => {
    store.setTarget(target.trim());
    store.setPlatform(platform);
    store.setQuality(quality);
    store.setMode(mode);
    store.setTrim(trim);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    addToast('success', 'Kesimpen', 'Preferensi default-nya udah diupdate.');
  };

  const doDisconnect = async () => {
    try {
      await api('/api/disconnect', { method: 'POST' });
      addToast('info', 'Udah diputus', 'Sesinya aman — bisa nyambung lagi kapan aja.');
    } catch (err) {
      addToast('error', 'Gagal', err.message);
    }
  };

  const doLogout = async () => {
    if (!window.confirm('Logout = sesi kehapus. Nanti harus scan/pairing ulang. Lanjut?')) return;
    try {
      await api('/api/logout', { method: 'POST' });
      addToast('success', 'Udah logout', 'Sesi WhatsApp-nya dihapus.');
    } catch (err) {
      addToast('error', 'Gagal', err.message);
    }
  };

  const engine = cfg?.engine;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3 backdrop-blur-sm"
        onClick={() => setSettingsOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="card max-h-[88vh] w-full max-w-md overflow-y-auto p-5 sm:p-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-iris-400" />
              <h2 className="font-display text-lg font-extrabold text-white">Pengaturan</h2>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="btn-icon !h-9 !w-9">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Session */}
          <div className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Session WhatsApp</div>
            <div className="mt-2 flex items-center gap-2.5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15 text-brand-400">
                <Phone className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate font-mono text-sm font-bold text-white">{conn?.phone ? fmtPhone(conn.phone) : '—'}</div>
                <div className="text-[11px] text-slate-500">
                  {conn?.state === 'connected' ? 'Nyambung · sesi kesimpen' : `Status: ${conn?.state}`}
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-ghost flex-1 !py-2 text-xs" onClick={doDisconnect} disabled={conn?.state !== 'connected'}>
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </button>
              <button className="btn-danger flex-1 !py-2 text-xs" onClick={doLogout} disabled={conn?.state !== 'connected'}>
                <LogOut className="h-3.5 w-3.5" /> Logout
              </button>
            </div>
          </div>

          {/* Default tujuan */}
          <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <label className="label !mb-0">Nomor Tujuan Default</label>
            <div className="mt-2 flex gap-2">
              <input
                className="input font-mono"
                placeholder="081234567890"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <p className="hint">Otomatis kepake di halaman Kirim (satu nomor atau pisahin pakai koma).</p>
          </div>

          {/* Default engine */}
          <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              <Cpu className="h-3.5 w-3.5" /> Default Engine
            </div>

            <div className="mt-3">
              <label className="label !mb-1">Target Platform</label>
              <div className="flex flex-wrap gap-1.5">
                {(cfg?.targets || []).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setPlatform(t.key)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                      platform === t.key ? 'border-brand/50 bg-brand/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <label className="label !mb-1">Resolusi</label>
              <div className="flex flex-wrap gap-1.5">
                {['auto', ...((cfg?.targets || []).find((t) => t.key === platform)?.ladder || []).map((p) => p.key)].map((k) => (
                  <button
                    key={k}
                    onClick={() => setQuality(k)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                      quality === k ? 'border-brand/50 bg-brand/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
                    }`}
                  >
                    {k === 'auto' ? 'Auto' : k}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <label className="label !mb-1">Mode Encode</label>
              <div className="flex flex-wrap gap-1.5">
                {(cfg?.modes || []).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                      mode === m.key ? 'border-accent/45 bg-accent/[0.12] text-white' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
                    }`}
                  >
                    <Gauge className="h-3 w-3" /> {m.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setTrim(!trim)}
              className={`mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[11px] font-bold transition ${
                trim ? 'border-iris/40 bg-iris/10 text-white' : 'border-white/10 bg-white/[0.03] text-slate-400'
              }`}
            >
              <span className="inline-flex items-center gap-1.5"><Scissors className="h-3.5 w-3.5" /> Potong otomatis (limit platform)</span>
              <span className={trim ? 'text-accent' : 'text-slate-500'}>{trim ? 'AKTIF' : 'MATI'}</span>
            </button>

            <button className="btn-primary mt-3 w-full !py-2.5 text-xs" onClick={saveAll}>
              <Save className="h-3.5 w-3.5" /> {saved ? 'Kesimpan!' : 'Simpan Pengaturan'}
            </button>
          </div>

          {/* Info engine */}
          <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              <HardDrive className="h-3.5 w-3.5" /> Info Engine
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-slate-400">
              <Row k="Engine" v={`${engine?.name || 'JernihHD Engine'}`} />
              <Row k="Codec" v={engine?.codec || 'H.264 High 4.2 + AAC 192k'} />
              <Row k="Target" v={(cfg?.targets || []).find((t) => t.key === platform)?.label || platform} />
              <Row k="FFmpeg" v={engine?.ffmpeg || '—'} />
              <Row k="HDR tonemap" v={engine?.hdrTonemap ? 'aktif' : 'nonaktif'} />
              <Row k="Normalisasi audio" v={engine?.audioNormalize ? 'aktif (EBU R128)' : 'nonaktif'} />
              <Row k="Batas upload" v={`${cfg?.maxUploadMB || 100} MB`} />
              <Row k="Batas output" v={`${cfg?.maxOutputMB || 50} MB`} />
            </div>
          </div>

          {/* Zona bahaya */}
          <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.04] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">Zona Bahaya</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-xs text-slate-400">Hapus semua riwayat kiriman</div>
              <button
                className="btn-danger !py-1.5 text-[11px]"
                onClick={async () => {
                  try {
                    await api('/api/history', { method: 'DELETE' });
                    addToast('info', 'Riwayat dikosongin', 'Daftar riwayatmu udah bersih.');
                  } catch (err) {
                    addToast('error', 'Gagal', err.message);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Hapus
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-xs text-slate-400">Reset preferensi lokal (browser ini)</div>
              <button
                className="btn-ghost !py-1.5 text-[11px]"
                onClick={() => {
                  store.clear();
                  addToast('success', 'Udah direset', 'Refresh halamannya biar bersih total.');
                }}
              >
                Reset
              </button>
            </div>
          </div>

          {/* About */}
          <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4">
            <Logo size={38} subtitle="oleh Rifky" />
            <div className="text-right text-[10px] leading-relaxed text-slate-500">
              JernihHD
              <br />
              <a className="inline-flex items-center gap-1 hover:text-slate-300" href="/api/engine" target="_blank" rel="noreferrer">
                <Download className="h-3 w-3" /> detail engine
              </a>
              {cfg?.mockSend && (
                <>
                  <br />
                  <span className="font-bold text-amber-400">MODE UJI AKTIF</span>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className="truncate font-mono text-slate-300">{v}</span>
    </div>
  );
}
