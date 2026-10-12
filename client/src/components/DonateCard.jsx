import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, HeartHandshake } from 'lucide-react';
import { useApp } from '../App.jsx';

/** Kartu donasi QRIS di halaman Kirim. */
export default function DonateCard() {
  const { cfg } = useApp();
  const [open, setOpen] = useState(false);
  const donate = cfg?.donate;
  if (!donate) return null;

  return (
    <div className="card overflow-hidden p-5 sm:p-6">
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand/25 via-iris/20 to-accent/20 text-brand-300">
          <HeartHandshake className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-white">{donate.title}</span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
            Donasi seikhlasnya via QRIS — buat bantu biaya server
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <img
                src={donate.qrisImage || '/qris.jpg'}
                alt="QRIS donasi"
                className="w-52 shrink-0 rounded-2xl border border-white/10 object-cover shadow-card"
                loading="lazy"
              />
              <div className="min-w-0 text-center sm:text-left">
                <p className="text-xs leading-relaxed text-slate-400">{donate.message}</p>
                <div className="mt-3 space-y-1 text-[11px] text-slate-500">
                  <div>a.n. <span className="font-bold text-slate-300">{donate.merchantName || 'JernihHD'}</span></div>
                  <div>1. Buka e-wallet / m-banking kamu</div>
                  <div>2. Scan QRIS di samping</div>
                  <div>3. Isi nominal seikhlasnya, bayar. Beres!</div>
                </div>
                <p className="mt-3 text-[11px] italic text-slate-500">
                  Berapapun nominalnya ngebantu banget biar web ini tetep jalan. Makasih 🙏
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
