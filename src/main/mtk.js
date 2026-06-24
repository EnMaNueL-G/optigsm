'use strict';
/* MTK (MediaTek) operations via mtkclient (Python).
 * Install: pip install mtkclient   OR  git clone https://github.com/bkerler/mtkclient
 * All operations require device in BROM/Preloader mode (power off + Vol- while connecting USB). */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let PYTHON = 'python';
let MTK_CMD = 'mtk'; // after 'pip install mtkclient'
let MTK_SCRIPT = ''; // path to mtk.py if using git version

function setPython(p) { if (p) PYTHON = p; }
function setMtkScript(s) { if (s && fs.existsSync(s)) { MTK_SCRIPT = s; MTK_CMD = null; } }

function resolveMtk() {
  if (MTK_SCRIPT) return { bin: PYTHON, prefix: [MTK_SCRIPT] };
  return { bin: MTK_CMD, prefix: [] };
}

function runMtk(args, onData) {
  const { bin, prefix } = resolveMtk();
  const allArgs = [...prefix, ...args];
  return new Promise((resolve) => {
    const proc = spawn(bin, allArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const handler = (d) => { const s = d.toString(); out += s; if (onData) onData(s); };
    proc.stdout.on('data', handler);
    proc.stderr.on('data', handler);
    proc.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
    proc.on('error', (e) => resolve({ ok: false, out: 'mtkclient no encontrado. Instala con: pip install mtkclient\n' + e.message }));
  });
}

// Check if mtkclient is available
async function checkMtk() {
  const r = await runMtk(['--help']);
  return { available: r.ok || r.out.includes('usage'), out: r.out };
}

// Read device info in BROM mode
async function readInfo(onData) {
  return runMtk(['printgpt'], onData);
}

// Read full flash dump
async function readFlash(outputPath, onData) {
  return runMtk(['rf', outputPath, '--crash'], onData);
}

// Write full flash image
async function writeFlash(imagePath, onData) {
  return runMtk(['wf', imagePath, '--crash'], onData);
}

// Read specific partition
async function readPartition(partitionName, outputPath, onData) {
  return runMtk(['rp', partitionName, outputPath], onData);
}

// Write specific partition
async function writePartition(partitionName, imagePath, onData) {
  return runMtk(['wp', partitionName, imagePath], onData);
}

// Flash engineering preloader (bypass vbmeta/dm-verity)
async function flashEngPreloader(preloaderPath, onData) {
  return runMtk(['payload', '--metamode', 'FASTBOOT', '--preloader', preloaderPath], onData);
}

// Erase partition
async function erasePartition(partitionName, onData) {
  return runMtk(['ep', partitionName, '0x0'], onData);
}

// Reset FRP (erase frp partition)
async function resetFrp(onData) {
  return runMtk(['ep', 'frp', '0x0'], onData);
}

// Read NVRAM (network/IMEI data)
async function readNvram(outputPath, onData) {
  return runMtk(['rbp', 'nvram', outputPath], onData);
}

// Write NVRAM
async function writeNvram(imagePath, onData) {
  return runMtk(['wbp', 'nvram', imagePath], onData);
}

// Wipe userdata
async function wipeUserdata(onData) {
  return runMtk(['e', 'userdata'], onData);
}

// Print GPT partition table
async function printGpt(onData) {
  return runMtk(['printgpt'], onData);
}

// Boot to meta mode
async function bootMeta(onData) {
  return runMtk(['payload', '--metamode', 'META'], onData);
}

// Unlock bootloader (erase lk_a/lk_b or set boot-unlock flag)
async function unlockBootloader(onData) {
  return runMtk(['da', 'seccfg', 'unlock'], onData);
}

// Read partition list
async function listPartitions(onData) {
  return runMtk(['printgpt', '--json'], onData);
}

// Flash scatter file (SP Flash Tool format)
async function flashScatter(scatterPath, onData) {
  return runMtk(['scatter', scatterPath], onData);
}

// Bypass SLA/DAA authentication (advanced - needs proper auth bypass)
async function bypassAuth(onData) {
  return runMtk(['--crash', 'printgpt'], onData);
}

// Read PROINFO partition
async function readProinfo(outputPath, onData) {
  return runMtk(['rp', 'proinfo', outputPath], onData);
}

// Write PROINFO partition
async function writeProinfo(imagePath, onData) {
  return runMtk(['wp', 'proinfo', imagePath], onData);
}

module.exports = {
  setPython, setMtkScript, checkMtk,
  readInfo, readFlash, writeFlash,
  readPartition, writePartition,
  flashEngPreloader, erasePartition,
  resetFrp, readNvram, writeNvram,
  wipeUserdata, printGpt, bootMeta,
  unlockBootloader, listPartitions,
  flashScatter, bypassAuth,
  readProinfo, writeProinfo,
};
