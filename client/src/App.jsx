import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { io } from 'socket.io-client';
import { api } from './lib/api';
import { store } from './lib/store';
import Splash from './components/Splash.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ConnectPage from './components/ConnectPage.jsx';
import SendPage from './components/SendPage.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import Toasts from './components/Toasts.jsx';
import KeyGate from './components/KeyGate.jsx';
import ServerNotice from './components/ServerNotice.jsx';

// Konteks global: toast + socket + conn + history + cfg
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Partikel bintang (generated sekali, tetap)
const PARTICLES = Array.from({ length: 30 }, () => ({
  left: Math.random() * 100,
  top: Math.random() * 100,
  size: 1 + Math.random() * 2,
  delay: Math.random() * 9,
  dur: 6 + Math.random() * 9,
  opacity: 0.12 + Math.random() * 0.35,
}));

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [conn, setConn] = useState(null);
  const [history, setHistory] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [splash, setSplash] = useState(true);
  // Halaman awal: param URL (?page=send — dipakai shortcut manifest PWA)
  // menang atas preferensi localStorage.
  const [page, setPageState] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('page');
      if (q === 'send' || q === 'connect') return q;
    } catch { /* noop */ }
    return store.getPage() || 'connect';
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gateError, setGateError] = useState(null);
  const socketRef = useRef(null);
  const [socketReady, setSocketReady] = useState(false);

  const setPage = useCallback((p) => {
    setPageState(p);
    store.setPage(p);
  }, []);

  /* ---------- Toast ---------- */
  const addToast = useCallback((type, title, message, extra = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-4), { id, type, title, message, ...extra }]);
    // Error dengan detail teknis dibiarkan lebih lama biar bisa dibaca/dicopy
    const ttl = extra.detail ? 20000 : 6000;
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  /* ---------- Config + gate ---------- */
  useEffect(() => {
    api('/api/config')
      .then((c) => {
        setCfg(c);
        window.CONFIG = c; // dipakai komponen lain kalau perlu
      })
      .catch(() => {
        if (store.getKey()) {
          store.setKey('');
          setGateError('Key-nya salah, coba lagi.');
          window.location.reload();
        } else {
          setGateError('Ga nyambung ke server. Coba refresh halamannya.');
        }
      });
  }, []);

  const keyRequired = cfg?.appKeyRequired && !store.getKey();

  /* ---------- Socket ---------- */
  useEffect(() => {
    if (!cfg || keyRequired) return;
    const sock = io('/', {
      transports: ['websocket', 'polling'],
      auth: { key: store.getKey(), ownerToken: store.getOwnerToken() },
      reconnectionDelayMax: 5000,
    });
    socketRef.current = sock;

    sock.on('connect', () => setSocketReady(true));
    sock.on('disconnect', () => setSocketReady(false));
    sock.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        store.setKey('');
        setGateError('Key-nya salah, coba lagi.');
        window.location.reload();
      }
    });

    sock.on('conn:update', (st) => setConn(st));
    sock.on('history:update', (h) => setHistory(h || []));
    sock.on('notice', (n) => addToast(n.type || 'info', n.title || '', n.message || ''));
    sock.on('send:error', (e) => {
      if (e?.code === 'CANCELED') return;
      const title = e?.code === 'OOM' ? 'RAM Server Habis' : e?.code === 'ENCODER_INIT' ? 'Encoder Gagal Start' : e?.code === 'BUSY' ? 'Lagi Sibuk' : e?.code === 'FORBIDDEN' ? 'Bukan Punya Kamu' : 'Gagal';
      addToast('error', title, e?.message || 'Ada yang error, coba lagi.', {
        detail: e?.detail || null,
        hint: e?.hint || null,
      });
    });

    // Sinkron status awal
    api('/api/status').then(setConn).catch(() => {});
    return () => {
      sock.removeAllListeners();
      sock.close();
      socketRef.current = null;
      setSocketReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, keyRequired]);

  // Auto-pindah ke halaman Kirim SEKALI saat transisi ke connected
  const prevConnState = useRef(null);
  useEffect(() => {
    const prev = prevConnState.current;
    prevConnState.current = conn?.state;
    if (conn?.state === 'connected' && prev !== 'connected' && page === 'connect') {
      setPage('send');
    }
  }, [conn?.state, page, setPage]);

  // Splash
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1700);
    return () => clearTimeout(t);
  }, []);

  const effectiveConnected = !!cfg?.mockSend || conn?.state === 'connected';

  const ctx = {
    cfg,
    conn,
    effectiveConnected,
    history,
    setHistory,
    socket: socketRef.current,
    socketReady,
    addToast,
    page,
    setPage,
    settingsOpen,
    setSettingsOpen,
    gateError,
    setGateError,
  };

  return (
    <Ctx.Provider value={ctx}>
      <AnimatePresence>{splash && <Splash key="splash" />}</AnimatePresence>

      <div className="relative flex min-h-screen flex-col">
        {/* Aurora + partikel background */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -top-40 left-1/2 h-[32rem] w-[36rem] -translate-x-1/2 rounded-full bg-brand/[0.18] blur-[140px]" style={{ animation: 'aurora 18s ease-in-out infinite' }} />
          <div className="absolute bottom-[-22%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-iris/[0.12] blur-[130px]" style={{ animation: 'aurora 22s ease-in-out 2s infinite' }} />
          <div className="absolute left-[-12%] top-[32%] h-80 w-80 rounded-full bg-accent/10 blur-[120px]" style={{ animation: 'aurora 20s ease-in-out 4s infinite' }} />
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: p.size,
                height: p.size,
                animation: `blink-soft ${p.dur}s ease-in-out ${p.delay}s infinite`,
                opacity: p.opacity,
              }}
            />
          ))}
        </div>

        {keyRequired ? (
          <KeyGate />
        ) : (
          <>
            <Navbar />
            <ServerNotice />
            <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-3 pb-16 pt-6 sm:px-6 sm:pt-8">
              {page === 'connect' ? (
                <motion.div key="connect" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <ConnectPage />
                </motion.div>
              ) : (
                <motion.div key="send" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <SendPage />
                </motion.div>
              )}
            </main>
            <Footer />
          </>
        )}

        <SettingsModal />
        <Toasts toasts={toasts} />
      </div>
    </Ctx.Provider>
  );
}
