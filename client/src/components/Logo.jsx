import { motion } from 'framer-motion';

/**
 * Logo JernihHD — tombol play gradien ember di atas charcoal hangat.
 * oleh Rifky.
 * Aset SVG ada di /public/brand (vector, tetap tajam di semua ukuran).
 */
export default function Logo({ size = 44, showText = true, glow = true, subtitle = 'JernihHD · oleh Rifky' }) {
  return (
    <div className="flex select-none items-center gap-3">
      <motion.div
        whileHover={{ rotate: -5, scale: 1.06 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18 }}
        className="relative shrink-0"
        style={{ width: size, height: size }}
      >
        {glow && (
          <motion.span
            aria-hidden
            className="absolute -inset-1.5 rounded-[28%] bg-gradient-to-br from-brand/60 via-iris/40 to-accent/50 blur-[8px]"
            animate={{ opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <img
          src="/brand/logo-mark.svg"
          alt="JernihHD"
          draggable={false}
          className="relative h-full w-full rounded-[26%] shadow-card"
        />
      </motion.div>

      {showText && (
        <div className="leading-tight">
          <div className="font-display text-[18px] font-black tracking-tight text-white">
            Jernih<span className="grad-text">HD</span>
          </div>
          {subtitle && (
            <div className="text-[9.5px] font-bold uppercase tracking-[0.24em] text-slate-500">{subtitle}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Badge kompak nama engine */
export function EngineBadge({ className = '' }) {
  return (
    <span className={`pill border-accent/25 bg-accent/[0.07] text-accent-300 ${className}`}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      JernihHD Engine
    </span>
  );
}
