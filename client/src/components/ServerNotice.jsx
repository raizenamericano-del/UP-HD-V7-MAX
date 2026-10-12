import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, Info, X } from 'lucide-react';
import { useApp } from '../App.jsx';

/**
 * Banner info server + donasi. Bisa ditutup, muncul lagi pas refresh.
 */
export default function ServerNotice() {
  const { cfg } = useApp();
  const [dismissed, setDismissed] = useState(false);
  const [showDonate, setShowDonate] = useState(false);

  const notice = cfg?.serverNotice;
  const donate = cfg?.donate;

  if (dismissed || !notice) return null;

  return (
    <div className="relative z-10 mx-auto w-full max-w-5xl px-3 sm:px-6">
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="mt-4 overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-r from-amber-400/[0.08] via-white/[0.03] to-brand/[0.06]"
        >
          <div className="flex items-start gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-300">
              <Info className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-extrabold text-white">
                {notice.title || 'Info'}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {notice.message}
              </p>
              {donate && (
                <button
                  onClick={() => setShowDonate((s) => !s)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-[11px] font-bold text-brand-300 transition hover:bg-brand/20"
                >
                  <Heart className="h-3.5 w-3.5" />
                  {showDonate ? 'Tutup QRIS' : 'Donasi seikhlasnya (QRIS)'}
                </button>
              )}
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
              title="Tutup"
              aria-label="Tutup"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <AnimatePresence>
            {showDonate && donate && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col items-center gap-3 border-t border-white/[0.07] bg-black/20 p-4 sm:flex-row sm:items-start">
                  <img
                    src={donate.qrisImage || '/qris.jpg'}
                    alt="QRIS donasi"
                    className="w-48 shrink-0 rounded-xl border border-white/10 object-cover shadow-card"
                    loading="lazy"
                  />
                  <div className="min-w-0 text-center sm:text-left">
                    <div className="text-sm font-extrabold text-white">{donate.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{donate.message}</p>
                    <div className="mt-2 text-[11px] text-slate-500">
                      a.n. <span className="font-bold text-slate-300">{donate.merchantName || 'JernihHD'}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Scan aja pakai e-wallet / m-banking apa aja, nominalnya bebas seikhlasnya.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
