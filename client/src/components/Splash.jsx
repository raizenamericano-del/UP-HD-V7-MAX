import { motion } from 'framer-motion';

const STEPS = ['Nyiapin engine', 'Nyiapin pipeline', 'Ngecek koneksi'];

/** Splash screen v6 — logo JernihHD + aurora glacier + progress bertahap */
export default function Splash() {
  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center overflow-hidden bg-ink-950"
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
    >
      {/* aurora */}
      <motion.div
        className="pointer-events-none absolute -top-1/3 left-1/2 h-[46rem] w-[46rem] -translate-x-1/2 rounded-full bg-brand/20 blur-[130px]"
        animate={{ scale: [1, 1.25, 1], opacity: [0.45, 0.85, 0.45] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute bottom-[-25%] right-[-10%] h-[30rem] w-[30rem] rounded-full bg-accent/15 blur-[120px]"
        animate={{ scale: [1.1, 1, 1.1], opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* grid */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(ellipse 58% 52% at 50% 50%, black, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse 58% 52% at 50% 50%, black, transparent 76%)',
        }}
      />

      <div className="relative flex w-[17rem] flex-col items-center gap-6">
        <div className="relative">
          <motion.span
            aria-hidden
            className="absolute -inset-4 rounded-[32%] bg-gradient-to-br from-brand/50 via-iris/40 to-accent/50 blur-2xl"
            animate={{ opacity: [0.4, 0.95, 0.4], scale: [0.94, 1.06, 0.94] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.img
            src="/brand/logo-mark.svg"
            alt="JernihHD"
            draggable={false}
            initial={{ scale: 0.5, opacity: 0, filter: 'blur(16px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
            transition={{ type: 'spring', stiffness: 190, damping: 15 }}
            className="relative h-24 w-24 rounded-[26%] shadow-glow"
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="text-center"
        >
          <div className="font-display text-[26px] font-extrabold tracking-tight text-white">
            Jernih<span className="grad-text">HD</span>
          </div>
          <div className="mt-1 text-[9.5px] font-bold uppercase tracking-[0.32em] text-slate-500">
            JernihHD · oleh Rifky
          </div>
        </motion.div>

        <div className="w-full">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-brand via-iris to-accent"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.35, ease: 'easeInOut' }}
            />
          </div>
          <div className="mt-3 flex items-center justify-center gap-3">
            {STEPS.map((s, i) => (
              <motion.span
                key={s}
                initial={{ opacity: 0.3 }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.28 }}
                className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500"
              >
                {s}
              </motion.span>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-600"
        >
          Semua Video Jadi Jernih
        </motion.div>
      </div>
    </motion.div>
  );
}
