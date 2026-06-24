'use strict';
/* Spreadtrum/Unisoc operations via spd_research tool or ResearchDownload.
 * Tool: https://github.com/ThomasKing2014/android-firmware-qssi (unofficial)
 * Most Unisoc operations require Research Download Mode (Vol- + Power at boot). */

const { spawn } = require('child_process');
const { adbShell } = require('./adb');
const fs = require('fs');

let SPD_TOOL = 'spd_research'; // from PATH
let SPD_SCRIPT = ''; // local script

function setSpdTool(p) { if (p && fs.existsSync(p)) SPD_TOOL = p; }

function runSpd(args, onData) {
  return new Promise((resolve) => {
    const bin = SPD_SCRIPT || SPD_TOOL;
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const handler = (d) => { const s = d.toString(); out += s; if (onData) onData(s); };
    proc.stdout.on('data', handler);
    proc.stderr.on('data', handler);
    proc.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
    proc.on('error', (e) => resolve({
      ok: false,
      out: 'Herramienta Unisoc no encontrada.\nAlternativa: usa SPD Flash Tool (Windows GUI): https://spdflashtool.com\n' + e.message,
    }));
  });
}

async function checkSpd() {
  const r = await runSpd(['--help']);
  return { available: r.ok || r.out.includes('usage'), out: r.out };
}

// Read flash (Research Download mode)
async function readFlash(outputPath, onData) {
  return runSpd(['rf', outputPath], onData);
}

// Write flash
async function writeFlash(imagePath, onData) {
  return runSpd(['wf', imagePath], onData);
}

// Read NVRAM (for IMEI)
async function readNvram(outputPath, onData) {
  return runSpd(['rp', 'fixnv1', outputPath], onData);
}

// Erase userdata
async function wipeUserdata(onData) {
  return runSpd(['e', 'userdata'], onData);
}

// ADB-based info for Unisoc devices
async function unisocInfo(serial) {
  const props = ['ro.product.model', 'ro.product.brand', 'ro.build.version.release',
    'ro.hardware', 'ro.product.chipname', 'ro.serialno'];
  const info = {};
  for (const p of props) {
    const r = await adbShell(serial, `getprop ${p}`);
    info[p.split('.').pop()] = r.out.trim();
  }
  return info;
}

// FRP via ADB
async function frpBypass(serial) {
  const r1 = await adbShell(serial, 'pm clear com.google.android.gsf');
  const r2 = await adbShell(serial, 'pm clear com.google.android.gms');
  const r3 = await adbShell(serial, 'settings put global device_provisioned 1');
  return { ok: r1.ok || r2.ok || r3.ok, out: [r1.out, r2.out, r3.out].join('\n') };
}

// Instructions for SPD Flash Tool (Windows GUI alternative)
function getSpdFlashInstructions() {
  return [
    'SPD Flash Tool (GUI alternativa):',
    '1. Descarga SPD Flash Tool desde spdflashtool.com',
    '2. Apaga el dispositivo',
    '3. Abre SPD Flash Tool y carga el archivo PAC de firmware',
    '4. Conecta USB mientras mantienes Vol-',
    '5. El tool detectará el dispositivo y flasheará',
  ].join('\n');
}

module.exports = {
  setSpdTool, checkSpd,
  readFlash, writeFlash, readNvram, wipeUserdata,
  unisocInfo, frpBypass, getSpdFlashInstructions,
};
