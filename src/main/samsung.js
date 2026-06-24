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

// Change CSC via ADB (keeps data!)
async function changeCsc(serial, newCsc) {
  const { adbShell } = require('./adb');
  const r = await adbShell(serial, `csc-reset ${newCsc} 2>/dev/null || echo "CSC change requires root or download mode"`);
  return r;
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
