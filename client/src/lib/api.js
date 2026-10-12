// Helper API — semua request ke backend (same-origin; di dev di-proxy Vite)
// JernihHD v7.1 — Dikembangkan oleh Rifky

const KEY = () => {
  try { return localStorage.getItem('hdjir_key') || ''; } catch { return ''; }
};
const OWNER = () => {
  try { return localStorage.getItem('hdjir_owner_token') || ''; } catch { return ''; }
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const key = KEY();
  if (key) headers['x-app-key'] = key;
  const owner = OWNER();
  if (owner) headers['x-owner-token'] = owner;
  const res = await fetch(path, { cache: 'no-store', ...opts, headers });
  if (res.status === 401) throw new ApiError(401, 'App key salah');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Terjadi kesalahan');
  return data;
}

/** Upload video dengan progress (XHR). `target` = platform (wa/tiktok/ig/shorts/universal) */
export function uploadVideo(file, onProgress, target) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    const key = KEY();
    if (key) xhr.setRequestHeader('x-app-key', key);
    const owner = OWNER();
    if (owner) xhr.setRequestHeader('x-owner-token', owner);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data.error || 'Unggahan gagal'));
      } catch {
        reject(new Error('Unggahan gagal (respons server tidak valid)'));
      }
    };
    xhr.onerror = () => reject(new Error('Unggahan gagal — mohon periksa koneksi internet Anda'));
    xhr.ontimeout = () => reject(new Error('Unggahan melebihi batas waktu (timeout)'));
    xhr.timeout = 15 * 60 * 1000;
    const form = new FormData();
    form.append('video', file);
    if (target) form.append('target', target);
    xhr.send(form);
  });
}

/**
 * Unduh via fetch agar error server (JSON) dapat DITAMPILKAN sebagai pesan,
 * bukan tersimpan sebagai file .json misterius.
 */
export async function downloadVideo(url, fallbackName = 'video-HD.mp4') {
  const headers = {};
  const key = KEY();
  if (key) headers['x-app-key'] = key;
  const owner = OWNER();
  if (owner) headers['x-owner-token'] = owner;
  const res = await fetch(url, { cache: 'no-store', headers });
  const ctype = res.headers.get('content-type') || '';
  if (!res.ok || ctype.includes('json')) {
    let msg = `Unduhan gagal (HTTP ${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* noop */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') || '';
  const m = disp.match(/filename="?([^";]+)"?/);
  const name = m?.[1] || fallbackName;
  const obj = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = obj;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 5000);
  return name;
}

/** URL privat dengan kunci akses (thumbnail & unduhan v7.1). */
export function withKey(baseUrl, accessToken) {
  if (!accessToken) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}key=${encodeURIComponent(accessToken)}`;
}
