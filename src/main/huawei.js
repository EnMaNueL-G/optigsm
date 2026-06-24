'use strict';
/* Huawei / Honor operations via ADB + hdc (Huawei Device Connector). */

const { adbShell, adbPull } = require('./adb');
const { spawn } = require('child_process');
const fs = require('fs');

let HDC = 'hdc'; // Huawei Device Connector

function setHdc(p) { if (p && fs.existsSync(p)) HDC = p; }

function runHdc(args, onData) {
  return new Promise((resolve) => {
    const proc = spawn(HDC, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const handler = (d) => { const s = d.toString(); out += s; if (onData) onData(s); };
    proc.stdout.on('data', handler);
    proc.stderr.on('data', handler);
    proc.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
    proc.on('error', () => resolve({ ok: false, out: 'hdc no encontrado (Huawei Device Connector). ADB puede funcionar.' }));
  });
}

async function huaweiInfo(serial) {
  const props = [
    'ro.product.model', 'ro.product.brand', 'ro.build.version.release',
    'ro.hardware', 'ro.product.name', 'ro.serialno',
    'ro.build.display.id', 'ro.miui.ui.version.code',
  ];
  const info = {};
  for (const p of props) {
    const r = await adbShell(serial, `getprop ${p}`);
    info[p.replace('ro.', '')] = r.out.trim();
  }
  // Huawei-specific
  const r2 = await adbShell(serial, 'getprop ro.build.hw_emui_api_level');
  info['emui_api'] = r2.out.trim();
  return info;
}

// Unlock bootloader (requires unlockcode from Huawei - they stopped providing in 2018)
async function unlockBootloader(serial, unlockCode) {
  if (unlockCode) {
    return adbShell(serial, `fastboot oem unlock ${unlockCode}`);
  }
  return {
    ok: false,
    out: 'Huawei dejó de dar códigos de desbloqueo en mayo 2018.\n' +
      'Alternativas:\n' +
      '1. Usa DC-Unlocker o similar si tienes el código\n' +
      '2. En EMUI 9.0-: Ajustes > Acerca del teléfono > tocado 7 veces > Opciones desarrollo > Desbloqueo OEM\n' +
      '3. Modelos Kirin 65x y algunos Honor: exploit vía BootROM (DCUnlocker Premium)',
  };
}

// Read RPMB / partition (via ADB with root)
async function readPartition(serial, partName, outputPath) {
  return adbShell(serial, `dd if=/dev/block/by-name/${partName} of=/sdcard/${partName}.bin bs=512 2>/dev/null`).then(async (r) => {
    if (r.ok) return adbPull(serial, `/sdcard/${partName}.bin`, outputPath);
    return { ok: false, out: 'Root requerido para leer particiones' };
  });
}

// Backup NVM (IMEI data)
async function backupNvm(serial, outputPath) {
  return readPartition(serial, 'nvme', outputPath);
}

// Get EMUI version
async function getEmuiVersion(serial) {
  const r = await adbShell(serial, 'getprop ro.build.version.emui');
  if (r.out.trim()) return r.out.trim();
  const r2 = await adbShell(serial, 'getprop ro.build.display.id');
  return r2.out.trim();
}

// Check if Kirin chipset
async function getChipset(serial) {
  const r = await adbShell(serial, 'getprop ro.hardware');
  return r.out.trim();
}

// Enable developer options
async function enableDevOptions(serial) {
  const r = await adbShell(serial, [
    'settings put global development_settings_enabled 1',
    'settings put global adb_enabled 1',
  ].join(' && '));
  return r;
}

// FRP bypass (ADB method)
async function frpBypass(serial) {
  const r1 = await adbShell(serial, 'pm clear com.huawei.hwid');
  const r2 = await adbShell(serial, 'pm clear com.huawei.appmarket');
  const r3 = await adbShell(serial, 'settings put global device_provisioned 1');
  return { ok: r1.ok || r2.ok || r3.ok, out: [r1.out, r2.out, r3.out].join('\n') };
}

module.exports = {
  setHdc, runHdc, huaweiInfo,
  unlockBootloader, readPartition, backupNvm,
  getEmuiVersion, getChipset, enableDevOptions, frpBypass,
};
