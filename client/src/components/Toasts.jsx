import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Info, XCircle } from 'lucide-react';

const STYLE = {
  success: { icon: <CheckCircle2 className="h-5 w-5" />, cls: 'border-accent/30 bg-accent/[0.08] text-accent', bar: 'bg-accent' },
  error: { icon: <XCircle className="h-5 w-5" />, cls: 'border-red-400/30 bg-red-400/[0.08] text-red-300', bar: 'bg-red-400' },
  warn: { icon: <AlertTriangle className="h-5 w-5" />, cls: 'border-amber-400/30 bg-amber-400/[0.08] text-amber-300', bar: 'bg-amber-400' },
  info: { icon: <Info className="h-5 w-5" />, cls: 'border-iris/30 bg-iris/[0.08] text-iris-400', bar: 'bg-iris' },
};

function DetailBox({ text }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) { /* noop */ }
  };
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-slate-300 transition-colors hover:bg-white/[0.08]"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Sembunyikan log' : 'Lihat log teknis'}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-white/[0.07] bg-black/40 p-2">
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[9.5px] leading-snug text-slate-400">{text}</pre>
          <button
            onClick={copy}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-300 hover:bg-white/[0.06]"
          >
            <Copy className="h-3 w-3" />{copied ? 'Kecopy!' : 'Copy log'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Toast notification (kanan atas) */
export default function Toasts({ toasts }) {
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 sm:right-4 sm:top-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const s = STYLE[t.type] || STYLE.info;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className={`pointer-events-auto relative overflow-hidden rounded-xl border bg-ink-850/95 p-3.5 shadow-card backdrop-blur-xl ${s.cls}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{s.icon}</div>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-white">{t.title}</div>
                  {t.message && <div className="mt-0.5 text-[11px] leading-relaxed text-slate-300/90">{t.message}</div>}
                  {t.hint && <div className="mt-1 text-[10px] leading-relaxed text-amber-300/90">💡 {t.hint}</div>}
                  {t.detail && <DetailBox text={t.detail} />}
                </div>
              </div>
              <motion.span
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: 6, ease: 'linear' }}
                className={`absolute bottom-0 left-0 h-0.5 ${s.bar}`}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
