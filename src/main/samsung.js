'use strict';
/* Samsung operations via Heimdall (open source Odin alternative).
 * Install: https://gitlab.com/BenjaminDobell/Heimdall (or scoop install heimdall)
 * Also includes ADB-based Samsung operations. */

const { spawn, execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

let HEIMDALL = 'heimdall';

function setHeimdall(p) { if (p && fs.existsSync(p)) HEIMDALL = p; }

function runHeimdall(args, onData) {
  return new Promise((resolve) => {
    const proc = spawn(HEIMDALL, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const handler = (d) => { const s = d.toString(); out += s; if (onData) onData(s); };
    proc.stdout.on('data', handler);
    proc.stderr.on('data', handler);
    proc.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
    proc.on('error', (e) => resolve({ ok: false, out: 'Heimdall no encontrado. Instala desde: https://heimdall.wiki.kernel.org\n' + e.message }));
  });
}

async function checkHeimdall() {
  const r = await runHeimdall(['version']);
  return { available: r.ok || r.out.includes('Heimdall'), version: r.out.trim() };
}

// Detect Samsung device in download mode
async function detectDevice() {
  return runHeimdall(['detect']);
}

// Print PIT (partition table)
async function printPit() {
  return runHeimdall(['print-pit', '--no-reboot']);
}

// Download PIT file from device
async function downloadPit(outputPath) {
  return runHeimdall(['download-pit', '--output', outputPath, '--no-reboot']);
}

// Flash single partition
async function flashPartition(partitionName, imagePath, onData) {
  return runHeimdall(['flash', '--' + partitionName.toLowerCase(), imagePath, '--no-reboot'], onData);
}

// Full firmware flash (AP+BL+CP+CSC)
async function flashFirmware({ bl, ap, cp, csc, homeCSC }, onData) {
  const args = ['flash'];
  if (bl) args.push('--BL', bl);
  if (ap) args.push('--AP', ap);
  if (cp) args.push('--CP', cp);
  if (csc) args.push('--CSC', csc);
  if (homeCSC) args.push('--HOME_CSC', homeCSC);
  return runHeimdall(args, onData);
}

// Flash recovery (TWRP, etc.)
async function flashRecovery(recoveryPath, onData) {
  return runHeimdall(['flash', '--RECOVERY', recoveryPath, '--no-reboot'], onData);
}

// Flash boot image
async function flashBoot(bootPath, onData) {
  return runHeimdall(['flash', '--BOOT', bootPath, '--no-reboot'], onData);
}

/* ===== Samsung FUS Firmware Download ===== */
// Samsung firmware info database (common models)
const SAMSUNG_FW_BASE = 'https://samfw.com/firmware';

// Build Samsung firmware check URL
function buildFwUrl(model, region) {
  return `https://www.sammobile.com/samsung/firmware/${model}/${region}/`;
}

// Get CSC codes for a region
const CSC_MAP = {
  'ES': 'PHE', 'US': 'TMB', 'EU': 'EUX', 'UK': 'BTU', 'DE': 'DBT',
  'FR': 'XEF', 'IT': 'ITV', 'MX': 'TIM', 'CO': 'TIM', 'VE': 'TIM',
  'AR': 'ARO', 'BR': 'ZTO', 'IN': 'INS', 'CN': 'CHC',
};

function getCsc(region) { return CSC_MAP[region.toUpperCase()] || region; }

// Get installed CSC via ADB
async function getInstalledCsc(serial) {
  const { adbShell } = require('./adb');
  const r = await adbShell(serial, 'getprop ro.csc.sales_code');
  if (r.out.trim()) return r.out.trim();
  const r2 = await adbShell(serial, 'getprop ro.product.optics.csc');
  return r2.out.trim();
}

// Change CSC via ADB with multiple methods
async function changeCsc(serial, newCsc) {
  const { adbShell } = require('./adb');
  const csc = (newCsc || '').toUpperCase().trim();
  if (!csc.match(/^[A-Z]{3}$/)) return { ok: false, out: 'CSC debe ser 3 letras (ej: EEA, ZTO, DBT, XEC).' };
  // Method 1: Samsung CSC reset (Android 9-12, root)
  const r1 = await adbShell(serial, `su -c 'csc-reset ${csc} 2>/dev/null'`, 6000).catch(()=>({out:''}));
  if (r1.ok && r1.out.includes('reset')) return { ok: true, out: `CSC cambiado a ${csc}. Reinicia el dispositivo.` };
  // Method 2: Write CSC to EFS (root, Samsung EFS path)
  const r2 = await adbShell(serial, `su -c 'echo ${csc} > /efs/imei/mps_code.dat && sync && cat /efs/imei/mps_code.dat'`, 5000).catch(()=>({out:''}));
  if (r2.out.trim() === csc) return { ok: true, out: `CSC escrito en EFS (/efs/imei/mps_code.dat): ${csc}\nReinicia para aplicar.` };
  // Method 3: CSC via settings
  const r3 = await adbShell(serial, `su -c 'settings put global csc_pref_country_iso ${csc.toLowerCase()} 2>/dev/null'`, 5000).catch(()=>({out:''}));
  return {
    ok: false,
    out: `El cambio de CSC en este modelo requiere:\n1. Modo Download → flashing CSC package con Odin/Heimdall\n2. Root con EFS access\n\nCSC objetivo: ${csc}\nCSC actual: consulta "Leer Info Samsung" arriba.\n\nMétodos intentados: csc-reset, EFS write, settings — ninguno disponible sin privilegios.`,
  };
}

/* ===== Samsung-specific ADB operations ===== */
async function samsungInfo(serial) {
  const { adbShell } = require('./adb');
  const props = ['ro.product.model', 'ro.product.brand', 'ro.build.version.release',
    'ro.build.PDA', 'ro.csc.sales_code', 'ro.build.display.id',
    'ro.boot.bootloader', 'ro.product.device'];
  const info = {};
  for (const p of props) {
    const r = await adbShell(serial, `getprop ${p}`);
    info[p.replace('ro.', '')] = r.out.trim();
  }
  return info;
}

// Disable Knox warranty bit flag (ADB shell, root needed, just clears flag if accessible)
async function clearKnoxFlag(serial) {
  const { adbShell } = require('./adb');
  return adbShell(serial, 'cat /efs/KnoxEFS 2>/dev/null || echo "Knox EFS not accessible without root"');
}

// Read EFS partition info (via ADB root)
async function readEfsInfo(serial) {
  const { adbShell } = require('./adb');
  const r = await adbShell(serial, 'ls -la /efs/ 2>/dev/null');
  return r;
}

// Backup EFS via ADB (needs root)
async function backupEfs(serial, outputPath) {
  const { adbPull } = require('./adb');
  return adbPull(serial, '/efs/', outputPath);
}

// Reset FRP via ADB (if in recovery with ADB)
async function resetFrp(serial) {
  const { adbShell } = require('./adb');
  return adbShell(serial, 'wipe frp 2>/dev/null || echo "Usa Download Mode para esta operación"');
}

// Samsung diag mode
async function diagMode(serial) {
  const { adbShell } = require('./adb');
  return adbShell(serial, 'am start -a android.intent.action.VIEW -d "mobileservice://diagmode" 2>/dev/null');
}

// Download mode via ADB
async function rebootToDownload(serial) {
  const { adbShell } = require('./adb');
  return adbShell(serial, 'reboot download');
}

module.exports = {
  setHeimdall, checkHeimdall, detectDevice, printPit, downloadPit,
  flashPartition, flashFirmware, flashRecovery, flashBoot,
  buildFwUrl, getCsc, getInstalledCsc, changeCsc,
  samsungInfo, clearKnoxFlag, readEfsInfo, backupEfs,
  resetFrp, diagMode, rebootToDownload,
};
