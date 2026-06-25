'use strict';
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRODUCT = 'optigsm';
const GUMROAD_PRODUCT = 'optigsm'; // product permalink en Gumroad
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const GRACE_DAYS = 7; // días de prueba sin licencia

let _userData = null;
function cacheFile() {
  if (!_userData) {
    try { _userData = require('electron').app.getPath('userData'); } catch (_) { _userData = __dirname; }
  }
  return path.join(_userData, 'optigsm.lic');
}

/* ---- Local cache R/W ---- */
function readCache() {
  try {
    const raw = fs.readFileSync(cacheFile(), 'utf8');
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch (_) { return null; }
}

function writeCache(data) {
  try {
    fs.writeFileSync(cacheFile(), Buffer.from(JSON.stringify(data)).toString('base64'), 'utf8');
  } catch (_) {}
}

function clearCache() {
  try { fs.unlinkSync(cacheFile()); } catch (_) {}
}

/* ---- Install date (for grace period) ---- */
function installFile() { return path.join(_userData || __dirname, 'optigsm.install'); }
function getInstallDate() {
  try {
    const d = fs.readFileSync(installFile(), 'utf8').trim();
    return parseInt(d);
  } catch (_) {
    const now = Date.now();
    try { fs.writeFileSync(installFile(), String(now)); } catch (_) {}
    return now;
  }
}

/* ---- Gumroad validation ---- */
function verifyGumroad(key) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      product_permalink: GUMROAD_PRODUCT,
      license_key: key.trim().toUpperCase(),
      increment_uses_count: false,
    });
    const req = https.request({
      hostname: 'api.gumroad.com',
      path: '/v2/licenses/verify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.success) {
            const purchase = j.purchase || {};
            const expiryStr = purchase.subscription_ended_at || purchase.end_date || null;
            const expiry = expiryStr ? new Date(expiryStr).getTime() : (Date.now() + 31 * 86400 * 1000);
            resolve({ ok: true, key, expiry, email: purchase.email || '', plan: purchase.product_name || 'PRO' });
          } else {
            resolve({ ok: false, out: j.message || 'Licencia inválida o no encontrada' });
          }
        } catch (_) {
          resolve({ ok: false, out: 'Error en respuesta de Gumroad' });
        }
      });
    });
    req.on('error', () => resolve({ ok: false, out: 'Sin conexión. Se usará caché local.' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, out: 'Timeout validando licencia.' }); });
    req.write(body);
    req.end();
  });
}

/* ---- Public API ---- */
async function activateLicense(key) {
  const result = await verifyGumroad(key);
  if (result.ok) {
    writeCache({ ...result, cachedAt: Date.now() });
  }
  return result;
}

function checkLicense() {
  const cached = readCache();
  if (!cached) return { status: 'none' };

  // Key exists in cache
  const now = Date.now();

  // Cache still fresh (validated in last 24h)?
  if (cached.cachedAt && now - cached.cachedAt < CACHE_TTL_MS) {
    // Check expiry
    if (cached.expiry && now > cached.expiry) {
      return { status: 'expired', email: cached.email || '', key: cached.key };
    }
    return { status: 'active', email: cached.email || '', plan: cached.plan || 'PRO', key: cached.key, expiry: cached.expiry };
  }

  // Cache stale — return cached but mark as stale (will re-validate next launch)
  if (cached.expiry && now > cached.expiry) {
    return { status: 'expired', email: cached.email || '', key: cached.key };
  }
  return { status: 'active', email: cached.email || '', plan: cached.plan || 'PRO', key: cached.key, expiry: cached.expiry, stale: true };
}

function deactivateLicense() {
  clearCache();
  return { ok: true };
}

function graceStatus() {
  const installed = getInstallDate();
  const remaining = Math.ceil((installed + GRACE_DAYS * 86400 * 1000 - Date.now()) / 86400000);
  return { inGrace: remaining > 0, remainingDays: Math.max(0, remaining) };
}

async function revalidateIfStale() {
  const cached = readCache();
  if (!cached || !cached.key) return;
  if (cached.cachedAt && Date.now() - cached.cachedAt < CACHE_TTL_MS) return;
  const result = await verifyGumroad(cached.key);
  if (result.ok) writeCache({ ...result, cachedAt: Date.now() });
}

module.exports = { activateLicense, checkLicense, deactivateLicense, graceStatus, revalidateIfStale };
