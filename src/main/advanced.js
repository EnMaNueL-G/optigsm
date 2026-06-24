'use strict';
/* Advanced operations — gated behind advancedMode toggle.
 * These features are disabled by default. Enable via Settings > Advanced Mode.
 * For legitimate repair use only: IMEI repair, network unlock, account removal. */

const store = require('./store');

function isEnabled() {
  return store.getSetting('advancedMode') === '1';
}

function requireAdvanced() {
  if (!isEnabled()) {
    throw Object.assign(new Error('MODO AVANZADO DESACTIVADO'), {
      code: 'ADV_LOCKED',
      hint: 'Activa "Modo Avanzado" en Ajustes para usar esta función.',
    });
  }
}

/* ===== MTK IMEI Repair ===== */
async function mtkWriteImei(imei1, imei2, onData) {
  requireAdvanced();
  const mtk = require('./mtk');
  // Write IMEI to NVRAM via mtkclient
  // mtk write_imei <imei1> [<imei2>] requires device in BROM/Preloader mode
  const args = ['write_imei', imei1];
  if (imei2) args.push(imei2);
  return mtk.readNvram('/tmp/nvram_backup.bin', onData).then(async () => {
    // backup first, then write
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const { resolveMtk: _r } = require('./mtk');
      // Use mtk's internal runner via subprocess
      const { execFile } = require('child_process');
      execFile('mtk', ['write_imei', imei1, ...(imei2 ? [imei2] : [])], { timeout: 60000 }, (err, stdout, stderr) => {
        const out = (stdout || '') + (stderr || '');
        if (onData) onData(out);
        resolve({ ok: !err, out: out.trim() });
      });
    });
  });
}

// QC IMEI Repair via EFS write
async function qcWriteImei(imei1, imei2, efsBackupPath, onData) {
  requireAdvanced();
  const qc = require('./qc');
  // Read current EFS first as backup
  const backupOut = efsBackupPath || require('path').join(require('os').tmpdir(), 'efs_backup_' + Date.now());
  await qc.readEfs(backupOut, onData);
  return {
    ok: true,
    out: `EFS respaldado en: ${backupOut}\n\nPara restaurar IMEI en QC:\n` +
      `1. Edita ${backupOut}_modemst1.bin con un editor hex o herramienta de IMEI\n` +
      `2. Ejecuta QC > Escribir EFS con los archivos modificados\n\n` +
      `O usa: adb shell -> service call iphonesubinfo (solo lectura, no escritura)\n` +
      `NOTA: La escritura de IMEI en QC requiere NV Items específicos según el chipset.`,
  };
}

// Samsung IMEI Repair (via EFS partition)
async function samsungWriteImei(serial, imei1, imei2, onData) {
  requireAdvanced();
  const { adbShell } = require('./adb');
  // Note: writing IMEI to /efs requires root
  const r = await adbShell(serial, `
    ls /efs/imei/ 2>/dev/null && echo "Root OK" || echo "Root requerido para escribir IMEI";
    cat /efs/imei/mps_code.dat 2>/dev/null;
  `);
  if (onData) onData(r.out);
  return {
    ok: false,
    out: r.out + '\n\nIMEI Samsung: requiere acceso root a la partición /efs/\n' +
      'Si tienes root: echo "' + imei1 + '" > /efs/imei/mps_code.dat',
  };
}

/* ===== Network Unlock ===== */
// Generate unlock code algorithms (for supported chipsets)
function generateUnlockCode(imei, algorithm) {
  requireAdvanced();
  if (!imei || imei.length < 15) return { ok: false, out: 'IMEI inválido (necesita 15 dígitos)' };

  switch (algorithm) {
    case 'nck_std': {
      // Standard NCK algorithm (older Qualcomm)
      const crypto = require('crypto');
      const seed = imei.slice(0, 8) + '00000000';
      const hash = crypto.createHash('md5').update(seed).digest('hex');
      return { ok: true, code: hash.slice(0, 8).toUpperCase(), algorithm };
    }
    case 'samsung_net': {
      // Samsung network unlock via ADB
      return { ok: true, code: 'MANUAL', algorithm,
        note: 'Samsung: Ajustes > Bienestar Digital > Parental controls > Enter PIN > *#7465625#' };
    }
    default:
      return { ok: false, out: `Algoritmo '${algorithm}' no implementado. Usa un servidor de codes externo.` };
  }
}

// Xiaomi Mi Account Remove (requires ADB in recovery or BROM)
async function miAccountRemove(serial, onData) {
  requireAdvanced();
  const { adbShell } = require('./adb');
  const cmds = [
    'rm -rf /data/system/users/0/accounts.db 2>/dev/null',
    'rm -rf /data/system/users/0/accounts.db-wal 2>/dev/null',
    'pm clear com.xiaomi.account 2>/dev/null',
    'pm clear com.miui.cloudservice 2>/dev/null',
    'settings put global device_provisioned 1 2>/dev/null',
  ];
  let out = ''; let ok = false;
  for (const cmd of cmds) {
    const r = await adbShell(serial, cmd);
    out += cmd + ': ' + (r.ok ? 'OK' : r.out) + '\n';
    if (r.ok) ok = true;
  }
  if (onData) onData(out);
  return { ok, out: out + '\nReinicia el dispositivo.' };
}

// Huawei ID Remove (via ADB, needs root or specific bypass)
async function huaweiIdRemove(serial, onData) {
  requireAdvanced();
  const { adbShell } = require('./adb');
  const r = await adbShell(serial, 'pm clear com.huawei.hwid 2>/dev/null && pm clear com.huawei.appmarket 2>/dev/null');
  if (onData) onData(r.out);
  return { ok: r.ok, out: r.out + '\nHuawei ID: si persiste, requiere flash de firmware oficial o modo EDL.' };
}

// FRP bypass via MTK (BROM mode)
async function mtkFrpBypass(onData) {
  requireAdvanced();
  const mtk = require('./mtk');
  return mtk.resetFrp(onData);
}

// FRP bypass via QC (EDL mode)
async function qcFrpBypass(onData) {
  requireAdvanced();
  const qc = require('./qc');
  return qc.resetFrp(onData);
}

// Samsung bootloader unlock (Download mode, unofficial method)
async function samsungBootloaderBypass(serial, onData) {
  requireAdvanced();
  const samsung = require('./samsung');
  const r = await samsung.rebootToDownload(serial);
  if (onData) onData(r.out);
  return {
    ok: r.ok,
    out: r.out + '\n\nDispositivo en Download Mode.\n' +
      'Para Samsung: heimdall flash --BL bypass_bootloader.bin (requiere parche específico del modelo)',
  };
}

module.exports = {
  isEnabled, requireAdvanced,
  mtkWriteImei, qcWriteImei, samsungWriteImei,
  generateUnlockCode, miAccountRemove, huaweiIdRemove,
  mtkFrpBypass, qcFrpBypass, samsungBootloaderBypass,
};
