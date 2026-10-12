import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound } from 'lucide-react';
import { useApp } from '../App.jsx';
import { store } from '../lib/store.js';
import Logo from './Logo.jsx';

/** Pintu masuk jika APP_KEY diaktifkan di server */
export default function KeyGate() {
  const { cfg, gateError, setGateError } = useApp();
  const [val, setVal] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const v = val.trim();
    if (!v) return;
    // Verifikasi langsung ke server
    const res = await fetch('/api/config', { headers: { 'x-app-key': v } });
    if (res.ok) {
      store.setKey(v);
      setGateError(null);
      window.location.reload();
    } else {
      setGateError('Key-nya salah, coba lagi.');
    }
  };

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center gap-4">
          <Logo size={56} showText={false} />
          <div className="text-center">
            <h1 className="text-lg font-extrabold text-white">Butuh Kunci</h1>
            <p className="mt-1 text-xs text-slate-400">
              Web ini dikunci pakai App Key. Minta kuncinya ke pemilik server ({cfg?.brand}).
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="password"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="App Key"
              className="input pl-10"
              autoFocus
            />
          </div>
          {gateError && <p className="text-xs text-red-400">{gateError}</p>}
          <button type="submit" className="btn-primary w-full">
            Masuk
          </button>
        </form>
      </motion.div>
    </div>
  );
}
