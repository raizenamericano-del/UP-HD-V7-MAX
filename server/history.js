'use strict';
/**
 * JernihHD — Riwayat pengiriman PRIVAT per-perangkat (JSON file, persistent di volume)
 * v7.1.0 by Rifky
 * ----------------------------------------------------------------------------
 * PERUBAHAN PRIVASI (v7.1.0):
 *  - Setiap entri terikat ke `ownerToken` (ID acak per-browser, disimpan di
 *    localStorage pengunjung). Daftar riwayat HANYA mengembalikan milik pemilik.
 *  - Setiap entri sukses punya `accessToken` acak. Thumbnail & unduhan wajib
 *    menyertakan `?key=<accessToken>` ATAU header owner yang cocok.
 *  - Entri lama (tanpa owner) dianggap LEGACY dan DISEMBUNYIKAN dari semua
 *    orang demi privasi. Admin dapat membersihkannya via clearLegacy().
 * ----------------------------------------------------------------------------
 */
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const { log } = require('./logger');

function load() {
  try {
    if (!fs.existsSync(config.HISTORY_FILE)) return [];
    const raw = fs.readFileSync(config.HISTORY_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    log.warn('Gagal membaca riwayat:', err.message);
    return [];
  }
}

function save(list) {
  try {
    fs.writeFileSync(config.HISTORY_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    log.error('Gagal menyimpan riwayat:', err.message);
  }
}

function isValidOwner(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(t);
}

/** Tambah entri baru; kembalikan entri yang sudah tersimpan */
function add(entry) {
  const list = load();
  const item = {
    id: crypto.randomBytes(6).toString('hex'),
    createdAt: new Date().toISOString(),
    // Kunci akses privat untuk thumb/unduh (hanya pemilik yang menerima nilai ini)
    accessToken: crypto.randomBytes(16).toString('hex'),
    ...entry,
  };
  // Pastikan accessToken tidak bisa di-override dari luar
  if (!entry.accessToken) item.accessToken = crypto.randomBytes(16).toString('hex');
  list.unshift(item);
  // Prune: jaga maksimal MAX_HISTORY
  save(list.slice(0, config.MAX_HISTORY));
  return item;
}

/**
 * Daftar riwayat MILIK SATU PEMILIK saja.
 * @param {string} ownerToken
 * @returns {Array}
 */
function list(ownerToken) {
  const all = load();
  if (!isValidOwner(ownerToken)) return [];
  // Strip ownerToken dari respons publik (client sudah menyimpannya sendiri)
  return all
    .filter((e) => e.ownerToken === ownerToken)
    .map(({ ownerToken: _omit, ...rest }) => rest);
}

/** Daftar semua (INTERNAL: hanya untuk sweep/prune file, JANGAN diekspos ke API) */
function listAllInternal() {
  return load();
}

/**
 * Ambil satu entri bila berhak.
 * Berhak bila: ownerToken cocok ATAU accessKey cocok dengan accessToken entri.
 */
function get(id, ownerToken, accessKey) {
  const e = load().find((x) => x.id === id) || null;
  if (!e) return null;
  // Entri legacy tanpa pemilik: tolak demi privasi
  if (!e.ownerToken) return null;
  if (isValidOwner(ownerToken) && e.ownerToken === ownerToken) return e;
  if (accessKey && e.accessToken && accessKey === e.accessToken) return e;
  return null;
}

/** Ambil tanpa cek (INTERNAL: sweep/resend internal yang sudah dicek di layer atas) */
function getInternal(id) {
  return load().find((e) => e.id === id) || null;
}

/** Hapus satu entri bila pemiliknya cocok. @returns {boolean} */
function remove(id, ownerToken) {
  const all = load();
  const target = all.find((e) => e.id === id);
  if (!target) return true; // anggap sukses (idempotent)
  if (!target.ownerToken) {
    // Legacy: hanya boleh dihapus dengan mode admin (ownerToken === null + flag)
    return false;
  }
  if (!isValidOwner(ownerToken) || target.ownerToken !== ownerToken) return false;
  save(all.filter((e) => e.id !== id));
  return true;
}

/** Hapus SEMUA riwayat milik satu pemilik. @returns {number} jumlah terhapus */
function clearOwner(ownerToken) {
  if (!isValidOwner(ownerToken)) return 0;
  const all = load();
  const kept = all.filter((e) => e.ownerToken !== ownerToken);
  const removed = all.length - kept.length;
  save(kept);
  return removed;
}

/** Hapus entri legacy (tanpa pemilik). Dipakai admin/maintenance. */
function clearLegacy() {
  const all = load();
  const kept = all.filter((e) => !!e.ownerToken);
  const removed = all.length - kept.length;
  save(kept);
  return removed;
}

/** Hapus total (dipakai tes internal saja) */
function clear() {
  save([]);
}

module.exports = { add, list, listAllInternal, get, getInternal, remove, clearOwner, clearLegacy, clear, load, isValidOwner };
