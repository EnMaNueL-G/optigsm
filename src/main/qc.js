'use strict';
/* Qualcomm (QCOM) operations via edl tool (Python).
 * Install: pip install edlclient   OR  git clone https://github.com/bkerler/edl
 * Device must be in EDL/9008 mode (Vol+ Vol- combo or test point). */

const { spawn } = require('child_process');
const fs = require('fs');

let PYTHON = 'python';
let EDL_CMD = 'edl';
let EDL_SCRIPT = '';

function setPython(p) { if (p) PYTHON = p; }
function setEdlScript(s) { if (s && fs.existsSync(s)) { EDL_SCRIPT = s; EDL_CMD = null; } }

function resolveEdl() {
  if (EDL_SCRIPT) return { bin: PYTHON, prefix: [EDL_SCRIPT] };
  return { bin: EDL_CMD, prefix: [] };
}

function runEdl(args, onData) {
  const { bin, prefix } = resolveEdl();
  const allArgs = [...prefix, ...args];
  return new Promise((resolve) => {
    const proc = spawn(bin, allArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const handler = (d) => { const s = d.toString(); out += s; if (onData) onData(s); };
    proc.stdout.on('data', handler);
    proc.stderr.on('data', handler);
    proc.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
    proc.on('error', (e) => resolve({ ok: false, out: 'edl no encontrado. Instala con: pip install edlclient\n' + e.message }));
  });
}

async function checkEdl() {
  const r = await runEdl(['--help']);
  return { available: r.ok || r.out.includes('usage') || r.out.includes('EDL'), out: r.out };
}

// Print partition table (GPT)
async function printGpt(onData) {
  return runEdl(['printgpt'], onData);
}

// Read full flash
async function readFlash(outputPath, onData) {
  return runEdl(['rf', outputPath], onData);
}

// Write full flash
async function writeFlash(imagePath, onData) {
  return runEdl(['wf', imagePath], onData);
}

// Read specific partition
async function readPartition(partitionName, outputPath, onData) {
  return runEdl(['r', partitionName, outputPath], onData);
}

// Write specific partition
async function writePartition(partitionName, imagePath, onData) {
  return runEdl(['w', partitionName, imagePath], onData);
}

// Erase partition
async function erasePartition(partitionName, onData) {
  return runEdl(['e', partitionName], onData);
}

// Reset FRP (erase frp, config partitions)
async function resetFrp(onData) {
  const r1 = await runEdl(['e', 'frp'], onData);
  const r2 = await runEdl(['e', 'config'], onData);
  return { ok: r1.ok || r2.ok, out: r1.out + '\n' + r2.out };
}

// Wipe userdata
async function wipeUserdata(onData) {
  return runEdl(['e', 'userdata'], onData);
}

// Read EFS (IMEI, modem config)
async function readEfs(outputPath, onData) {
  const r1 = await runEdl(['r', 'modemst1', outputPath + '_modemst1.bin'], onData);
  const r2 = await runEdl(['r', 'modemst2', outputPath + '_modemst2.bin'], onData);
  return { ok: r1.ok && r2.ok, out: r1.out + '\n' + r2.out };
}

// Write EFS
async function writeEfs(path1, path2, onData) {
  const r1 = await runEdl(['w', 'modemst1', path1], onData);
  const r2 = await runEdl(['w', 'modemst2', path2], onData);
  return { ok: r1.ok && r2.ok, out: r1.out + '\n' + r2.out };
}

// Read persist partition (camera calibration)
async function readPersist(outputPath, onData) {
  return runEdl(['r', 'persist', outputPath], onData);
}

// Read device info via QFPROM
async function readDeviceInfo(onData) {
  return runEdl(['qfp'], onData);
}

// Flash boot image
async function flashBoot(imagePath, onData) {
  return runEdl(['w', 'boot', imagePath], onData);
}

// Flash recovery image
async function flashRecovery(imagePath, onData) {
  return runEdl(['w', 'recovery', imagePath], onData);
}

// Flash system image
async function flashSystem(imagePath, onData) {
  return runEdl(['w', 'system', imagePath], onData);
}

// Reboot device
async function reboot(onData) {
  return runEdl(['reset'], onData);
}

// Reboot to EDL
async function rebootToEdl(onData) {
  return runEdl(['reset', '--resetmode', 'edl'], onData);
}

// Read QSEE (TrustZone) - read only for backup
async function readQsee(outputPath, onData) {
  return runEdl(['r', 'tz', outputPath], onData);
}

// Flash programmer (firehose)
async function loadProgrammer(programmerPath, onData) {
  return runEdl(['--loader', programmerPath, 'printgpt'], onData);
}

// Backup critical partitions
async function backupCritical(outputDir, onData) {
  const partitions = ['frp', 'persist', 'modemst1', 'modemst2', 'fsc', 'boot', 'recovery'];
  let allOk = true; let allOut = '';
  for (const p of partitions) {
    const out = require('path').join(outputDir, p + '.bin');
    const r = await runEdl(['r', p, out], onData);
    allOut += `[${p}] ${r.ok ? 'OK' : 'FAIL'}\n`;
    if (!r.ok) allOk = false;
  }
  return { ok: allOk, out: allOut };
}

module.exports = {
  setPython, setEdlScript, checkEdl,
  printGpt, readFlash, writeFlash,
  readPartition, writePartition, erasePartition,
  resetFrp, wipeUserdata,
  readEfs, writeEfs, readPersist,
  readDeviceInfo, flashBoot, flashRecovery, flashSystem,
  reboot, rebootToEdl, readQsee, loadProgrammer, backupCritical,
};
