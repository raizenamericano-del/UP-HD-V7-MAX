import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Clock, Download, History, Loader2, Lock, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useApp } from '../App.jsx';
import { api, downloadVideo, withKey } from '../lib/api.js';
import { fmtDate, fmtDuration } from '../lib/store.js';

/**
 * Riwayat PRIVAT per perangkat (v7.1) — hanya terlihat oleh perangkat yang
 * mengunggah. Setiap thumbnail & unduhan dilindungi kunci akses individual.
 */
export default function HistoryPanel({ onResend, busy }) {
  const { history, addToast } = useApp();
  const [resendingId, setResendingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [filter, setFilter] = useState('all');

  const filtered = (history || []).filter((h) => (filter === 'all' ? true : h.status === filter));

  const handleResend = (entry) => {
    if (busy) {
      addToast('warn', 'Bentar', 'Masih ada proses yang jalan. Tunggu beres dulu.');
      return;
    }
    setResendingId(entry.id);
    setTimeout(() => {
      setResendingId(null);
      onResend(entry);
    }, 500);
  };

  const handleDownload = async (entry) => {
    setDownloadingId(entry.id);
    try {
      const url = withKey(`/api/download/${entry.id}`, entry.accessToken);
      const name = await downloadVideo(url, `${entry.originalName || 'video'}-HD.mp4`);
      addToast('success', 'Lagi didownload', `Nyiapin ${name}`);
    } catch (err) {
      addToast('error', 'Download gagal', err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api(`/api/history/${id}`, { method: 'DELETE' });
      addToast('info', 'Udah dihapus', 'Riwayatnya udah dibuang.');
    } catch (err) {
      addToast('error', 'Gagal hapus', err.message);
    }
  };

  const handleClearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    try {
      await api('/api/history', { method: 'DELETE' });
      addToast('info', 'Riwayat dibersihin', 'Daftar riwayatmu udah kosong.');
    } catch (err) {
      addToast('error', 'Gagal bersihin', err.message);
    }
  };

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-iris-400" />
          <h3 className="text-sm font-extrabold text-white">Riwayat Kamu</h3>
          <span className="chip">{(history || []).length}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/[0.07] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-300">
            <Lock className="h-2.5 w-2.5" /> Cuma kamu
          </span>
        </div>
        {(history || []).length > 0 && (
          <div className="flex items-center gap-2">
            <div className="seg !p-0.5">
              {[
                { id: 'all', label: 'Semua' },
                { id: 'success', label: 'Berhasil' },
                { id: 'failed', label: 'Gagal' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
                    filter === f.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button onClick={handleClearAll} className="text-[11px] font-semibold text-slate-500 transition hover:text-red-400">
              {confirmClear ? 'Yakin? Klik lagi' : 'Hapus Semua'}
            </button>
          </div>
        )}
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
        Isi daftar ini cuma kesimpen & keliatan di perangkat kamu. Orang lain buka web ini pun punyamu tetep aman, ga bakal keliatan.
      </p>

      {(history || []).length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] p-8 text-center">
          <Clock className="mx-auto h-6 w-6 text-slate-600" />
          <div className="mt-2 text-xs font-bold text-slate-400">Belum ada apa-apa</div>
          <div className="mt-1 text-[11px] text-slate-600">
            Video yang kamu proses bakal kecatat di sini — privat, cuma di perangkat ini.
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          <AnimatePresence initial={false}>
            {filtered.map((h) => (
              <motion.div
                key={h.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -26 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 transition-colors hover:border-brand/25"
              >
                {/* thumb (privat: wajib kunci akses) */}
                {h.thumbFile ? (
                  <img
                    src={withKey(`/api/thumb/${h.id}`, h.accessToken)}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-slate-600">
                    <Clock className="h-5 w-5" />
                  </div>
                )}

                {/* info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-bold text-white">{h.originalName}</span>
                    {h.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                    {h.source === 'resend' && <span className="chip chip-brand shrink-0">kirim ulang</span>}
                    {h.platformLabel && <span className="chip chip-iris shrink-0">{h.platformLabel}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                    <span className="font-mono text-accent/90">
                      → {h.target || (h.downloadOnly ? 'download' : '—')}{h.targets?.length > 1 ? ` +${h.targets.length - 1}` : ''}
                    </span>
                    {h.status === 'success' && (
                      <>
                        <span>·</span><span>{h.resolution}</span>
                        <span>·</span><span>{fmtDuration(h.durationSec)}</span>
                        <span>·</span><span>{h.sizeMB} MB</span>
                        {h.mode && <><span>·</span><span className="uppercase">{h.mode}</span></>}
                        {h.trimmed && <><span>·</span><span className="text-amber-400">dipotong</span></>}
                      </>
                    )}
                    <span>·</span><span>{fmtDate(h.createdAt)}</span>
                  </div>
                  {h.status === 'failed' && h.error && <div className="mt-0.5 truncate text-[10px] text-red-400/80">{h.error}</div>}
                </div>

                {/* aksi */}
                <div className="flex shrink-0 items-center gap-1">
                  {h.status === 'success' && (
                    <>
                      <button
                        className="btn-ghost !px-2.5 !py-1.5 text-[11px]"
                        onClick={() => handleDownload(h)}
                        disabled={downloadingId === h.id}
                        title="Unduh versi HD"
                      >
                        {downloadingId === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => handleResend(h)}
                        disabled={busy || resendingId === h.id}
                        className="btn-ghost !px-2.5 !py-1.5 text-[11px]"
                        title="Kirim ulang video ini"
                      >
                        {resendingId === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        <span className="hidden sm:inline">Ulangi</span>
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(h.id)}
                    className="rounded-lg p-2 text-slate-500 transition hover:bg-red-400/10 hover:text-red-400"
                    title="Hapus riwayat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {(history || []).length > 0 && filtered.length === 0 && (
        <div className="py-6 text-center text-xs text-slate-500">Ga ada riwayat di filter ini.</div>
      )}
    </div>
  );
}
