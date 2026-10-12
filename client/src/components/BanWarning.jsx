import { AlertTriangle } from 'lucide-react';

/** Peringatan risiko pembatasan — selalu tampil di halaman koneksi */
export default function BanWarning() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
      <div className="text-xs leading-relaxed text-amber-200/90">
        <span className="font-bold text-amber-300">Penting.</span> Gunakan nomor WhatsApp{' '}
        <span className="font-bold">cadangan</span>, bukan nomor utama. Pustaka yang digunakan{' '}
        bersifat <span className="font-bold">tidak resmi</span> (Baileys) sehingga terdapat risiko
        nomor dibatasi. Gunakan layanan ini dengan bijak dan hindari pengiriman berulang (spam).
      </div>
    </div>
  );
}
