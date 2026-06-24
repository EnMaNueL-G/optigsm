'use strict';
/* FRP (Factory Reset Protection) bypass methods.
 * All methods work only on devices physically in your possession.
 * These are standard repair shop procedures for legitimate device recovery. */

const { adbShell, adbInstall, adbDevices } = require('./adb');

/* ===== ADB Methods (device connected in ADB mode, or recovery) ===== */

// Method 1: Wipe FRP via ADB (root or recovery)
async function wipeFrpAdb(serial) {
  const r = await adbShell(serial, [
    'am broadcast -a com.google.android.gms.phenotype.FLAG_OVERRIDE --es package com.google.android.gms.auth.api.phone "true" 2>/dev/null',
    'pm clear com.google.android.gms 2>/dev/null',
    'content delete --uri content://settings/secure --where "name=\'android_id\'" 2>/dev/null',
  ].join(' ; '));
  // Also try direct wipe
  const r2 = await adbShell(serial, 'am startservice -n com.google.android.gms/.checkin.CheckinService 2>/dev/null');
  return { ok: r.ok || r2.ok, out: r.out + '\n' + r2.out };
}

// Method 2: Disable Google Account Manager
async function disableGoogleAccountManager(serial) {
  const r1 = await adbShell(serial, 'pm disable-user --user 0 com.google.android.gms');
  const r2 = await adbShell(serial, 'pm disable-user --user 0 com.google.android.gsf');
  const r3 = await adbShell(serial, 'pm disable-user --user 0 com.android.vending');
  return { ok: r1.ok || r2.ok || r3.ok, out: [r1.out, r2.out, r3.out].join('\n') };
}

// Re-enable Google services (undo method 2)
async function enableGoogleServices(serial) {
  const r1 = await adbShell(serial, 'pm enable com.google.android.gms');
  const r2 = await adbShell(serial, 'pm enable com.google.android.gsf');
  const r3 = await adbShell(serial, 'pm enable com.android.vending');
  return { ok: true, out: [r1.out, r2.out, r3.out].join('\n') };
}

// Method 3: Remove account via content provider
async function removeGoogleAccount(serial) {
  const r = await adbShell(serial, 'content query --uri content://com.google.settings/partner 2>/dev/null');
  const r2 = await adbShell(serial, 'content delete --uri content://com.android.providers.settings/gservices 2>/dev/null');
  return { ok: r.ok || r2.ok, out: r.out + '\n' + r2.out };
}

// Method 4: Clear FRP via settings provider
async function clearFrpSettings(serial) {
  const cmds = [
    'settings put global setup_wizard_has_run 1',
    'settings put secure user_setup_complete 1',
    'settings put global device_provisioned 1',
    'am start -n com.android.settings/.Settings 2>/dev/null',
  ];
  let out = ''; let ok = false;
  for (const cmd of cmds) {
    const r = await adbShell(serial, cmd);
    out += cmd + ': ' + r.out + '\n';
    if (r.ok) ok = true;
  }
  return { ok, out };
}

// Method 5: Launch FRP bypass APK via ADB
async function launchFrpBypassApk(serial, apkPath) {
  // typical: com.example.frpbypass or ADB Bypass APK
  const r = await adbShell(serial, 'am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER 2>/dev/null');
  if (apkPath) {
    const r2 = await adbInstall(serial, apkPath, { replace: true, grant: true });
    return r2;
  }
  return r;
}

// Method 6: Via recovery (adb sideload OTA that clears FRP)
// This just prepares the command for the user
function getSideloadCmd(serial) {
  return `adb -s ${serial} sideload frp_bypass.zip`;
}

// Method 7: Erase FRP partition via ADB (needs root)
async function eraseFrpPartition(serial) {
  const r = await adbShell(serial, 'dd if=/dev/zero of=/dev/block/platform/*/by-name/frp bs=512 count=1 2>/dev/null || echo "Root requerido"');
  return r;
}

// Method 8: Via Google emergency call bypass (OEM unlock required via Settings first)
function getEmergencyBypassInstructions() {
  return [
    '1. En la pantalla de verificación de cuenta, toca "INICIO DE EMERGENCIA"',
    '2. Marca *#0*# (modo diagnóstico) o *#7465625# (Samsung)',
    '3. Presiona Vol+ tres veces rápido',
    '4. O navega: Ajustes de Accesibilidad → TalkBack → Tutorial (toca pantalla con 2 dedos)',
    '5. En el explorador de archivos del tutorial, navega a Ajustes → Cuentas → Eliminar cuenta',
  ].join('\n');
}

// Method 9: Via ADB OEM unlock + wipe
async function oemUnlockAndWipe(serial) {
  const { adbShell: shell } = require('./adb');
  const r = await shell(serial, 'reboot bootloader');
  return { ok: r.ok, out: r.out + '\nDispositivo reiniciando a fastboot. Usa: fastboot oem unlock && fastboot -w' };
}

// Method 10: Samsung-specific: Download mode FRP wipe
function getSamsungFrpInstructions() {
  return [
    'Samsung FRP via Heimdall/Download Mode:',
    '1. Apaga el dispositivo',
    '2. Entra en Download Mode (Vol- + Home + Power en el mismo momento)',
    '3. Conecta por USB',
    '4. Ejecuta: heimdall flash --FRP zero.bin (archivo de ceros del tamaño de la partición FRP)',
    '5. O usa: odin3 → AP → frp_bypass.tar.md5',
  ].join('\n');
}

// Check FRP status
async function checkFrpStatus(serial) {
  const r = await adbShell(serial, 'content query --uri content://settings/secure --where "name=\'user_setup_complete\'" 2>/dev/null');
  const r2 = await adbShell(serial, 'settings get global device_provisioned 2>/dev/null');
  const r3 = await adbShell(serial, 'dumpsys device_policy | grep frp 2>/dev/null');
  return {
    out: r.out + '\nProvisioned: ' + r2.out + '\nFRP info: ' + r3.out,
    provisioned: r2.out.trim() === '1',
  };
}

// List all FRP bypass methods available
function listMethods() {
  return [
    { id: 1, name: 'Borrar FRP (ADB/Root)', desc: 'Limpia datos FRP vía ADB shell. Requiere ADB activo o modo recovery.', requiresAdb: true },
    { id: 2, name: 'Deshabilitar Google Account Manager', desc: 'Desactiva GMS/GSF temporalmente para omitir verificación.', requiresAdb: true },
    { id: 3, name: 'Eliminar cuenta (Content Provider)', desc: 'Elimina entradas de cuenta vía content:// provider.', requiresAdb: true },
    { id: 4, name: 'Limpiar ajustes FRP', desc: 'Marca setup wizard como completado vía settings.', requiresAdb: true },
    { id: 5, name: 'Instalar APK Bypass', desc: 'Instala APK de bypass FRP (proporciónalo tú).', requiresAdb: true },
    { id: 6, name: 'ADB Sideload', desc: 'Flash de ZIP especial vía ADB sideload desde recovery.', requiresAdb: true },
    { id: 7, name: 'Borrar partición FRP (root)', desc: 'Escribe ceros en la partición FRP. Requiere root.', requiresAdb: true, requiresRoot: true },
    { id: 8, name: 'Instrucciones bypass manual', desc: 'Pasos para bypass físico (llamada emergencia, TalkBack, etc.).', requiresAdb: false },
    { id: 9, name: 'OEM Unlock + Wipe (Fastboot)', desc: 'Desbloquea bootloader y hace wipe total. Borra todos los datos.', requiresAdb: true, destructive: true },
    { id: 10, name: 'Samsung Download Mode', desc: 'Instrucciones específicas Samsung para flash de partición FRP.', requiresAdb: false },
  ];
}

module.exports = {
  wipeFrpAdb, disableGoogleAccountManager, enableGoogleServices,
  removeGoogleAccount, clearFrpSettings, launchFrpBypassApk,
  getSideloadCmd, eraseFrpPartition, getEmergencyBypassInstructions,
  oemUnlockAndWipe, getSamsungFrpInstructions, checkFrpStatus, listMethods,
};
