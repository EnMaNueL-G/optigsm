'use strict';
/*
 * OptiGSM — validación de licencias Ed25519 (offline).
 * Las claves se generan con OptiSuite-Licencias.exe / keygen.js.
 * La clave privada NUNCA sale del equipo del vendedor.
 */
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

/* ── Clave pública Ed25519 (hardcoded, no hay secreto aquí) ─────────────── */
const PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVtoYS3g960UouqzjZJQXi1hN2MNIjRSJ29VROloFKOg=
-----END PUBLIC KEY-----`;
const PUB_KEY = crypto.createPublicKey(PUBLIC_PEM);

const GRACE_DAYS   = 7;   // días de uso sin licencia tras la primera instalación
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/* ── Paths de caché ─────────────────────────────────────────────────────── */
let _userData = null;
function ud() {
  if (!_userData) {
    try { _userData = require('electron').app.getPath('userData'); } catch (_) { _userData = __dirname; }
  }
  return _userData;
}
const licFile     = () => path.join(ud(), 'optigsm.lic');
const installFile = () => path.join(ud(), 'optigsm.install');

/* ── Caché local ─────────────────────────────────────────────────────────── */
function readCache() {
  try { return JSON.parse(Buffer.from(fs.readFileSync(licFile(), 'utf8'), 'base64').toString('utf8')); }
  catch (_) { return null; }
}
function writeCache(data) {
  try { fs.writeFileSync(licFile(), Buffer.from(JSON.stringify(data)).toString('base64'), 'utf8'); }
  catch (_) {}
}
function clearCache() { try { fs.unlinkSync(licFile()); } catch (_) {} }

/* ── Fecha de instalación (gracia) ──────────────────────────────────────── */
function getInstallDate() {
  try { return parseInt(fs.readFileSync(installFile(), 'utf8').trim()); }
  catch (_) {
    const now = Date.now();
    try { fs.writeFileSync(installFile(), String(now)); } catch (_) {}
    return now;
  }
}

/* ── Base32 (mismo alfabeto que el keygen) ──────────────────────────────── */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32decode(s) {
  const clean = s.replace(/[^0-9A-HJKMNP-TV-Z]/gi, '').toUpperCase();
  const bytes = [];
  let bits = 0, val = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((val >>> bits) & 0xff); }
  }
  return Buffer.from(bytes);
}

/* ── Verificación de clave ──────────────────────────────────────────────── */
function verifyKey(raw) {
  try {
    const key  = raw.replace(/[-\s]/g, '').toUpperCase();
    const buf  = b32decode(key);

    // Ed25519: sig = 64 bytes al final; payload = todo lo anterior
    if (buf.length < 64 + 9) return { ok: false, out: 'Clave demasiado corta.' };
    const payload = buf.slice(0, buf.length - 64);
    const sig     = buf.slice(buf.length - 64);

    if (!crypto.verify(null, payload, PUB_KEY, sig))
      return { ok: false, out: 'Firma inválida. Clave incorrecta o modificada.' };

    const version  = payload[0];
    const plus     = (version & 0x0f) === 0x02;
    const plan     = plus ? 'PRO+' : 'PRO';
    const expDays  = payload.readUInt16LE(7);   // 0 = perpetua
    const today    = Math.floor(Date.now() / 86400000);
    const expiry   = expDays ? expDays * 86400000 : 0;   // ms (0 = sin caducidad)

    if (expDays && today > expDays)
      return { ok: false, out: `Licencia caducada (expiró el ${new Date(expiry).toLocaleDateString()}).` };

    return { ok: true, key: raw.trim(), plan, expiry, expDays };
  } catch (e) {
    return { ok: false, out: `Error al verificar la clave: ${e.message}` };
  }
}

/* ── API pública ─────────────────────────────────────────────────────────── */
async function activateLicense(raw) {
  const r = verifyKey(raw);
  if (r.ok) writeCache({ ...r, cachedAt: Date.now() });
  return r;
}

function checkLicense() {
  const c = readCache();
  if (!c) return { status: 'none' };
  const now = Date.now();
  if (c.expiry && now > c.expiry) return { status: 'expired', plan: c.plan, key: c.key };
  return { status: 'active', plan: c.plan || 'PRO', key: c.key, expiry: c.expiry || 0 };
}

function deactivateLicense() {
  clearCache();
  return { ok: true };
}

function graceStatus() {
  const installed  = getInstallDate();
  const remaining  = Math.ceil((installed + GRACE_DAYS * 86400000 - Date.now()) / 86400000);
  return { inGrace: remaining > 0, remainingDays: Math.max(0, remaining) };
}

/* revalidateIfStale no aplica (validación offline): no-op por compatibilidad */
async function revalidateIfStale() {}

module.exports = { activateLicense, checkLicense, deactivateLicense, graceStatus, revalidateIfStale };
