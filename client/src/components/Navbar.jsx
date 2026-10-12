import { motion } from 'framer-motion';
import { Link2, Send, Settings as SettingsIcon, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../App.jsx';
import Logo from './Logo.jsx';

const PILL = {
  connected: { cls: 'border-accent/30 bg-accent/10 text-accent', text: 'Terhubung', live: true },
  reconnecting: { cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300', text: 'Menghubungkan ulang…' },
  logged_out: { cls: 'border-red-400/30 bg-red-400/10 text-red-300', text: 'Keluar' },
  qr: { cls: 'border-iris/30 bg-iris/10 text-iris-400', text: 'Scan QR' },
  pairing: { cls: 'border-iris/30 bg-iris/10 text-iris-400', text: 'Kode Pairing' },
  starting: { cls: 'border-white/10 bg-white/5 text-slate-400', text: 'Memulai…' },
  connecting: { cls: 'border-white/10 bg-white/5 text-slate-300', text: 'Menghubungkan…' },
  disconnected: { cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300', text: 'Terputus' },
  idle: { cls: 'border-white/10 bg-white/5 text-slate-400', text: 'Belum Terhubung' },
};

export default function Navbar() {
  const { conn, page, setPage, setSettingsOpen, cfg, socketReady } = useApp();
  const state = conn?.state || 'idle';
  const pill = PILL[state] || PILL.idle;
  const connected = state === 'connected';

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-2xl">
      <div className="mx-auto flex h-[70px] w-full max-w-5xl items-center justify-between gap-2 px-3 sm:px-6">
        <button onClick={() => setPage(connected ? 'send' : 'connect')} className="transition-opacity hover:opacity-85">
          <Logo size={40} />
        </button>

        <div className="flex items-center gap-2">
          {/* Tab segmented */}
          <nav className="seg !p-1">
            <TabBtn active={page === 'connect'} onClick={() => setPage('connect')} icon={<Link2 className="h-4 w-4" />} label="Koneksi" alert={!connected} />
            <TabBtn active={page === 'send'} onClick={() => setPage('send')} icon={<Send className="h-4 w-4" />} label="Kirim" />
          </nav>

          {/* Status koneksi */}
          <motion.span
            layout
            className={`hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold md:inline-flex ${pill.cls}`}
            title={`Status WhatsApp: ${state}`}
          >
            <span className="relative flex h-2 w-2">
              {pill.live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  connected
                    ? 'bg-accent'
                    : ['reconnecting', 'connecting', 'starting'].includes(state)
                    ? 'animate-pulse bg-amber-400'
                    : 'bg-slate-500'
                }`}
              />
            </span>
            {pill.text}
            {cfg?.mockSend && (
              <span className="rounded bg-amber-400/20 px-1 py-0.5 text-[9px] font-black text-amber-300">UJI</span>
            )}
          </motion.span>

          <button
            onClick={() => setSettingsOpen(true)}
            className="btn-icon"
            title="Pengaturan"
            aria-label="Pengaturan"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* baris status tipis: socket + koneksi */}
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600 sm:px-6">
        <span className={`inline-flex items-center gap-1 ${socketReady ? 'text-accent/80' : 'text-amber-400/80'}`}>
          {socketReady ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {socketReady ? 'Server nyambung' : 'Nyambungin ke server…'}
        </span>
        <span className="hidden items-center gap-1 sm:inline-flex">
          <ShieldCheck className="h-3 w-3" /> {cfg?.engine?.name || 'JernihHD Engine'}
        </span>
        <span className="ml-auto hidden sm:inline-flex">{cfg?.tagline || 'Semua Video Jadi Jernih'}</span>
      </div>

      {!socketReady && (
        <div className="h-0.5 w-full overflow-hidden">
          <div className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-brand to-transparent bg-[length:200%_100%]" />
        </div>
      )}
    </header>
  );
}

function TabBtn({ active, onClick, icon, label, alert }) {
  return (
    <button
      onClick={onClick}
      className={`seg-item ${active ? 'text-ink-950' : 'text-slate-400 hover:text-white'}`}
    >
      {active && (
        <motion.span
          layoutId="nav-pill"
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-brand via-iris to-accent shadow-glow"
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {icon}
        <span className="hidden sm:inline">{label}</span>
        {alert && !active && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
      </span>
    </button>
  );
}
