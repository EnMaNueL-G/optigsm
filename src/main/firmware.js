'use strict';
/* Firmware search and download management.
 * Uses public firmware APIs and direct links — no third-party paid services. */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/* ===== SAMSUNG (SamFW) ===== */
async function searchSamsungFw(model, region) {
  // Public SamFW search — returns HTML, parse relevant data
  const url = `https://samfw.com/firmware/${encodeURIComponent(model)}/${encodeURIComponent(region)}`;
  return { url, brand: 'Samsung', model, region, note: 'Abre la URL para descargar manualmente o usa Frija/Bifrost para descarga directa.' };
}

/* ===== XIAOMI (MIUI/HyperOS) ===== */
const MIUI_STABLE_API = 'https://update.miui.com/updates/miotaV01.php';

async function searchMiuiFw(model, region = 'EEA') {
  const payload = JSON.stringify({
    d: model, b: 'N', r: region, l: 'es_ES', ov: '12.0', n: '0',
  });
  return new Promise((resolve) => {
    const options = {
      hostname: 'update.miui.com',
      path: '/updates/miotaV01.php',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (_) { resolve({ ok: false, out: data }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, out: e.message }));
    req.write(payload);
    req.end();
  });
}

// Xiaomi firmware direct download links
const XIAOMI_REGIONS = ['EEA', 'Global', 'China', 'India', 'Russia', 'Taiwan'];

/* ===== ONEPLUS / OPPO / REALME (ColorOS) ===== */
async function searchColorOsFw(model) {
  return {
    note: 'OPPO/OnePlus/Realme: busca en https://service.oppo.com/software o https://www.realme.com/in/support/kw/doc/2016305',
    model,
    urls: [
      `https://service.oppo.com/software/type/B/${model}`,
      `https://www.oneplus.com/support/softwareupgrade`,
    ],
  };
}

/* ===== MOTOROLA ===== */
async function searchMotoFw(model) {
  return {
    note: 'Motorola: firmware disponible en https://mirrors.lolinet.com/firmware/motorola/',
    model,
    url: `https://mirrors.lolinet.com/firmware/motorola/${model.toUpperCase()}/`,
  };
}

/* ===== HUAWEI ===== */
async function searchHuaweiFw(model) {
  return {
    note: 'Huawei: firmware oficial en https://consumer.huawei.com/en/support/firmwaredownload',
    model,
    url: 'https://consumer.huawei.com/en/support/firmwaredownload',
  };
}

/* ===== GENERIC (Google Pixels, AOSP devices) ===== */
async function searchGoogleFw(model) {
  const urls = {
    'Pixel': 'https://developers.google.com/android/images',
    'OTA': 'https://developers.google.com/android/ota',
  };
  return { model, ...urls };
}

/* ===== DOWNLOAD ENGINE ===== */
class DownloadJob extends EventEmitter {
  constructor(url, destPath) {
    super();
    this.url = url;
    this.destPath = destPath;
    this.cancelled = false;
    this.proc = null;
  }

  start() {
    const parsed = new URL(this.url);
    const proto = parsed.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(this.destPath);
    const req = proto.get(this.url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(this.destPath, () => {});
        this.url = res.headers.location;
        return this.start();
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', (chunk) => {
        if (this.cancelled) { req.destroy(); file.close(); return; }
        received += chunk.length;
        file.write(chunk);
        if (total > 0) this.emit('progress', { received, total, pct: Math.round(received * 100 / total) });
      });
      res.on('end', () => {
        file.end();
        if (!this.cancelled) this.emit('done', { path: this.destPath, size: received });
      });
      res.on('error', (e) => { file.close(); this.emit('error', e); });
    });
    req.on('error', (e) => { file.close(); this.emit('error', e); });
    this.req = req;
    return this;
  }

  cancel() {
    this.cancelled = true;
    try { if (this.req) this.req.destroy(); } catch (_) {}
    try { fs.unlink(this.destPath, () => {}); } catch (_) {}
    this.emit('cancelled');
  }
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const job = new DownloadJob(url, destPath);
    if (onProgress) job.on('progress', onProgress);
    job.on('done', resolve);
    job.on('error', reject);
    job.on('cancelled', () => reject(new Error('Descarga cancelada')));
    job.start();
  });
}

/* ===== FIRMWARE CATALOG ===== */
const BRAND_HANDLERS = {
  samsung: searchSamsungFw,
  xiaomi: searchMiuiFw,
  redmi: searchMiuiFw,
  poco: searchMiuiFw,
  oneplus: searchColorOsFw,
  oppo: searchColorOsFw,
  realme: searchColorOsFw,
  motorola: searchMotoFw,
  moto: searchMotoFw,
  huawei: searchHuaweiFw,
  honor: searchHuaweiFw,
  pixel: searchGoogleFw,
  google: searchGoogleFw,
};

async function searchFirmware(brand, model, region = 'EEA') {
  const handler = BRAND_HANDLERS[(brand || '').toLowerCase()];
  if (!handler) {
    return {
      note: 'Marca no reconocida. Búsqueda manual recomendada.',
      urls: [
        'https://samfw.com',
        'https://miuirom.org',
        'https://mirrors.lolinet.com/firmware',
        'https://firmware.mobi',
      ],
    };
  }
  return handler(model, region);
}

/* ===== ZIP EXTRACTION ===== */
async function extractZip(zipPath, destDir) {
  const extractZip = require('extract-zip');
  await extractZip(zipPath, { dir: destDir });
  return { ok: true, out: `Extraído en ${destDir}` };
}

/* ===== MD5 VERIFY ===== */
function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = {
  searchSamsungFw, searchMiuiFw, searchColorOsFw,
  searchMotoFw, searchHuaweiFw, searchGoogleFw,
  searchFirmware, downloadFile, extractZip, md5File,
  XIAOMI_REGIONS,
};
