import { Heart } from 'lucide-react';
import { useApp } from '../App.jsx';
import Logo from './Logo.jsx';

export default function Footer() {
  const { cfg } = useApp();
  const developer = cfg?.developer?.name || 'Rifky';
  return (
    <footer className="relative z-10 border-t border-line py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-3 px-4 text-center sm:px-6">
        <Logo size={34} showText={false} />
        <div className="font-display text-sm font-bold text-white">
          Jernih<span className="grad-text">HD</span>
        </div>
        <div className="text-xs text-slate-500">
          Dibuat oleh <span className="font-semibold text-slate-200">{developer}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/[0.07] px-3 py-1 text-[10px] font-semibold text-slate-400">
          <Heart className="h-3 w-3 text-brand-300" />
          Donasi seikhlasnya via QRIS biar servernya tetep hidup
        </div>
        <div className="max-w-xl text-[10px] leading-relaxed text-slate-600">
          Saran: pakai nomor cadangan aja, jangan nomor utama — library yang dipakai (Baileys)
          bukan resmi, jadi nomor bisa kena limit sewaktu-waktu. Dipakainya yang wajar ya.
          Semua video di sini milik masing-masing yang upload, dan cuma bisa dibuka dari
          perangkatnya sendiri.
        </div>
      </div>
    </footer>
  );
}
