'use strict';
const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

let ADB = 'adb';
function setAdb(p) { if (p) ADB = p; }

function sh(serial, cmd, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(ADB, ['-s', serial, 'shell', cmd], { timeout }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(err);
      resolve((stdout || '').trim());
    });
  });
}
function run(args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { timeout }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(err);
      resolve((stdout || '').trim());
    });
  });
}

/* ── 1. LIMPIEZA ──────────────────────────────────────────────────────────── */

async function clearSystemLogs(serial) {
  await sh(serial, 'logcat -c');
  return { ok: true, msg: 'Logs del sistema eliminados.' };
}

async function clearTempFiles(serial) {
  await sh(serial, 'rm -rf /data/local/tmp/*');
  return { ok: true, msg: 'Archivos temporales eliminados.' };
}

async function resetBatteryStats(serial) {
  await sh(serial, 'dumpsys batterystats --reset');
  return { ok: true, msg: 'Estadísticas de batería reiniciadas.' };
}

async function clearAppCache(serial, pkg) {
  const out = await sh(serial, `pm clear --cache-only ${pkg} 2>/dev/null || pm clear ${pkg}`);
  return { ok: true, pkg, msg: out || 'Caché limpiada.' };
}

async function clearAllUserCache(serial) {
  const pkgsRaw = await sh(serial, 'pm list packages -3');
  const pkgs = pkgsRaw.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean);
  const results = [];
  for (const pkg of pkgs) {
    try {
      await sh(serial, `pm clear --cache-only ${pkg} 2>/dev/null`);
      results.push(pkg);
    } catch (_) { }
  }
  return { ok: true, count: results.length, msg: `Caché limpiada en ${results.length} aplicaciones.` };
}

async function clearDalvikCache(serial) {
  // Intento con root; si falla reportamos
  try {
    await sh(serial, 'su -c "rm -rf /data/dalvik-cache/* /data/app-lib/* 2>/dev/null"');
    return { ok: true, msg: 'Caché Dalvik/ART eliminada. Reinicia el dispositivo.' };
  } catch (_) {
    return { ok: false, msg: 'Se necesita root para limpiar la caché Dalvik/ART.' };
  }
}

/* ── 2. GESTIÓN DE APPS / BLOATWARE ─────────────────────────────────────── */

async function listSystemApps(serial) {
  const [sysRaw, disRaw] = await Promise.all([
    sh(serial, 'pm list packages -s'),
    sh(serial, 'pm list packages -d'),
  ]);
  const sys = sysRaw.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean);
  const dis = new Set(disRaw.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean));
  return sys.map(pkg => ({ pkg, disabled: dis.has(pkg) }));
}

async function listUserApps(serial) {
  const raw = await sh(serial, 'pm list packages -3 -f');
  return raw.split('\n')
    .filter(Boolean)
    .map(l => {
      const m = l.match(/package:(.+?)=(.+)/);
      return m ? { apk: m[1], pkg: m[2].trim() } : null;
    })
    .filter(Boolean);
}

async function disableApp(serial, pkg) {
  const out = await sh(serial, `pm disable-user --user 0 ${pkg}`);
  return { ok: true, pkg, msg: out };
}

async function enableApp(serial, pkg) {
  const out = await sh(serial, `pm enable ${pkg}`);
  return { ok: true, pkg, msg: out };
}

async function batchDisable(serial, pkgs) {
  const results = [];
  for (const pkg of pkgs) {
    try {
      await sh(serial, `pm disable-user --user 0 ${pkg}`);
      results.push({ pkg, ok: true });
    } catch (e) {
      results.push({ pkg, ok: false, err: e.message });
    }
  }
  const ok = results.filter(r => r.ok).length;
  return { ok: true, results, msg: `${ok}/${pkgs.length} apps desactivadas.` };
}

async function batchUninstall(serial, pkgs) {
  const results = [];
  for (const pkg of pkgs) {
    try {
      await run(['-s', serial, 'uninstall', pkg]);
      results.push({ pkg, ok: true });
    } catch (e) {
      results.push({ pkg, ok: false, err: e.message });
    }
  }
  const ok = results.filter(r => r.ok).length;
  return { ok: true, results, msg: `${ok}/${pkgs.length} apps desinstaladas.` };
}

async function killBackground(serial) {
  await sh(serial, 'am kill-all');
  return { ok: true, msg: 'Procesos en segundo plano detenidos.' };
}

async function forceStopApp(serial, pkg) {
  await sh(serial, `am force-stop ${pkg}`);
  return { ok: true, pkg };
}

async function getRunningApps(serial) {
  const raw = await sh(serial, 'ps -A 2>/dev/null || ps', 10000);
  return raw.split('\n').filter(l => l.includes('u0_a')).map(l => l.trim());
}

/* ── 3. PERMISOS ─────────────────────────────────────────────────────────── */

async function getAppPermissions(serial, pkg) {
  const raw = await sh(serial, `dumpsys package ${pkg} | grep -A200 "granted permissions"`, 10000);
  const granted = [];
  const denied  = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/(\S+): granted=(\w+)/);
    if (m) (m[2] === 'true' ? granted : denied).push(m[1]);
  }
  return { pkg, granted, denied };
}

async function revokePermission(serial, pkg, perm) {
  const out = await sh(serial, `pm revoke ${pkg} ${perm}`);
  return { ok: true, pkg, perm, msg: out || 'Permiso revocado.' };
}

async function grantPermission(serial, pkg, perm) {
  const out = await sh(serial, `pm grant ${pkg} ${perm}`);
  return { ok: true, pkg, perm, msg: out || 'Permiso concedido.' };
}

/* ── 4. OPTIMIZACIÓN ─────────────────────────────────────────────────────── */

async function setAnimationScale(serial, scale) {
  const v = String(scale);
  await Promise.all([
    sh(serial, `settings put global window_animation_scale ${v}`),
    sh(serial, `settings put global transition_animation_scale ${v}`),
    sh(serial, `settings put global animator_duration_scale ${v}`),
  ]);
  const label = scale === 0 ? 'desactivadas' : `x${scale}`;
  return { ok: true, scale, msg: `Animaciones ${label}.` };
}

async function getAnimationScales(serial) {
  const [w, t, a] = await Promise.all([
    sh(serial, 'settings get global window_animation_scale'),
    sh(serial, 'settings get global transition_animation_scale'),
    sh(serial, 'settings get global animator_duration_scale'),
  ]);
  return { window: parseFloat(w) || 1, transition: parseFloat(t) || 1, animator: parseFloat(a) || 1 };
}

async function setPerformanceMode(serial, mode) {
  // mode: 'performance' | 'balanced' | 'powersave'
  const gov = { performance: 'performance', balanced: 'schedutil', powersave: 'powersave' }[mode] || 'schedutil';
  try {
    await sh(serial, `su -c "for f in /sys/devices/system/cpu/cpufreq/policy*/scaling_governor; do echo ${gov} > $f; done"`);
    return { ok: true, mode, gov, msg: `Modo ${mode} activado.` };
  } catch (_) {
    return { ok: false, msg: 'Se necesita root para cambiar el modo de rendimiento.' };
  }
}

async function disableTelemetry(serial) {
  const services = [
    'com.google.android.gms/.checkin.CheckinService',
    'com.google.android.gms/.update.SystemUpdateService',
  ];
  const results = [];
  for (const svc of services) {
    try {
      await sh(serial, `am stopservice ${svc}`);
      results.push({ svc, ok: true });
    } catch (_) {
      results.push({ svc, ok: false });
    }
  }
  // Desactivar envío de diagnósticos
  try {
    await sh(serial, 'settings put global send_action_app_error 0');
    await sh(serial, 'settings put global dropbox:dumpsys:procstats 0');
  } catch (_) { }
  return { ok: true, results, msg: 'Telemetría reducida.' };
}

/* ── 5. SISTEMA / RED ─────────────────────────────────────────────────────── */

async function fixClock(serial) {
  const epoch = Math.floor(Date.now() / 1000);
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
  try {
    await sh(serial, `date -s ${dateStr}`);
  } catch (_) { }
  await sh(serial, 'settings put global auto_time 1');
  await sh(serial, 'settings put global auto_time_zone 1');
  return { ok: true, msg: `Hora sincronizada y actualización automática activada.` };
}

async function toggleWifi(serial, on) {
  await sh(serial, `svc wifi ${on ? 'enable' : 'disable'}`);
  return { ok: true, on, msg: `WiFi ${on ? 'activado' : 'desactivado'}.` };
}

async function toggleBluetooth(serial, on) {
  await sh(serial, `svc bluetooth ${on ? 'enable' : 'disable'}`);
  return { ok: true, on, msg: `Bluetooth ${on ? 'activado' : 'desactivado'}.` };
}

async function toggleAirplane(serial, on) {
  await sh(serial, `settings put global airplane_mode_on ${on ? 1 : 0}`);
  await sh(serial, `am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ${on}`);
  return { ok: true, on, msg: `Modo avión ${on ? 'activado' : 'desactivado'}.` };
}

async function enableDevOptions(serial) {
  await sh(serial, 'settings put global development_settings_enabled 1');
  return { ok: true, msg: 'Opciones de desarrollador activadas.' };
}

async function disableDevOptions(serial) {
  await sh(serial, 'settings put global development_settings_enabled 0');
  return { ok: true, msg: 'Opciones de desarrollador desactivadas.' };
}

async function rebootSafeMode(serial) {
  await run(['-s', serial, 'reboot', 'safe-mode']);
  return { ok: true, msg: 'Reiniciando en modo seguro...' };
}

async function resetNetworkSettings(serial) {
  await sh(serial, 'settings put global wifi_networks_available_notification_on 1');
  await sh(serial, 'cmd wifi clear-configured-networks 2>/dev/null || true');
  try {
    await sh(serial, 'su -c "service call wifi 47" 2>/dev/null');
  } catch (_) { }
  return { ok: true, msg: 'Configuración de red restablecida.' };
}

async function setCustomDns(serial, dns1, dns2) {
  try {
    await sh(serial, `ndc resolver setnetdns 100 "" ${dns1} ${dns2}`);
    return { ok: true, msg: `DNS configurado: ${dns1} / ${dns2}` };
  } catch (_) {
    await sh(serial, `settings put global dns_override ${dns1}`);
    return { ok: true, msg: `DNS alternativo anotado. Puede requerir root para aplicarse.` };
  }
}

async function resetPasswordPolicy(serial) {
  try {
    await sh(serial, 'dpm remove-active-admin com.android.enterprise/.DeviceAdminReceiver 2>/dev/null || true');
    await sh(serial, 'settings put secure lockscreen.password_type 0 2>/dev/null || true');
    return { ok: true, msg: 'Política de contraseñas restablecida.' };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

/* ── 6. INFORME DE MANTENIMIENTO ─────────────────────────────────────────── */

async function generateReport(serial) {
  const ts = new Date().toLocaleString('es-ES');
  const [model, android, brand, storage, battery, wifi, bt, animW, devOpts, userApps, sysApps, disApps] = await Promise.all([
    sh(serial, 'getprop ro.product.model').catch(() => 'N/A'),
    sh(serial, 'getprop ro.build.version.release').catch(() => 'N/A'),
    sh(serial, 'getprop ro.product.brand').catch(() => 'N/A'),
    sh(serial, "df /data | tail -1 | awk '{print $2, $3, $4}'").catch(() => 'N/A'),
    sh(serial, "dumpsys battery | grep level | head -1").catch(() => 'N/A'),
    sh(serial, 'settings get global wifi_on').catch(() => 'N/A'),
    sh(serial, 'settings get global bluetooth_on').catch(() => 'N/A'),
    sh(serial, 'settings get global window_animation_scale').catch(() => '1'),
    sh(serial, 'settings get global development_settings_enabled').catch(() => '0'),
    sh(serial, 'pm list packages -3').catch(() => ''),
    sh(serial, 'pm list packages -s').catch(() => ''),
    sh(serial, 'pm list packages -d').catch(() => ''),
  ]);

  const userCount = userApps.split('\n').filter(Boolean).length;
  const sysCount  = sysApps.split('\n').filter(Boolean).length;
  const disCount  = disApps.split('\n').filter(Boolean).length;
  const battLevel = (battery.match(/\d+/) || ['N/A'])[0];
  const animScale = parseFloat(animW) || 1;

  const report = [
    '='.repeat(50),
    'INFORME DE MANTENIMIENTO — OptiGSM',
    `Fecha: ${ts}`,
    '='.repeat(50),
    '',
    `DISPOSITIVO: ${brand} ${model} — Android ${android}`,
    `SERIAL: ${serial}`,
    '',
    'ESTADO ACTUAL:',
    `  Batería          : ${battLevel}%`,
    `  Almacenamiento   : ${storage}`,
    `  WiFi             : ${wifi === '1' ? 'Activado' : 'Desactivado'}`,
    `  Bluetooth        : ${bt === '1' ? 'Activado' : 'Desactivado'}`,
    `  Animaciones      : x${animScale}`,
    `  Modo desarrollo  : ${devOpts === '1' ? 'Activado' : 'Desactivado'}`,
    '',
    'APPS INSTALADAS:',
    `  Usuario          : ${userCount}`,
    `  Sistema          : ${sysCount}`,
    `  Desactivadas     : ${disCount}`,
    '',
    'ACCIONES RECOMENDADAS:',
    animScale > 1 ? '  [ ] Reducir animaciones a x0.5 o desactivar' : '  [✓] Animaciones optimizadas',
    devOpts === '1' ? '  [ ] Desactivar opciones de desarrollador' : '  [✓] Opciones de desarrollador desactivadas',
    disCount > 0   ? `  [✓] ${disCount} apps de sistema desactivadas (bloatware)` : '  [ ] Revisar bloatware del sistema',
    '',
    'Generado por OptiGSM v1.0.0 — optisuite.app',
    '='.repeat(50),
  ].join('\n');

  return { ok: true, report, ts, model: `${brand} ${model}`, android };
}

/* ── 7. SNAPSHOT ANTES/DESPUÉS ───────────────────────────────────────────── */

async function takeSnapshot(serial) {
  const [storage, battery, userApps, disApps, anim] = await Promise.all([
    sh(serial, "df /data | tail -1").catch(() => ''),
    sh(serial, "dumpsys battery | grep level | head -1").catch(() => ''),
    sh(serial, 'pm list packages -3').catch(() => ''),
    sh(serial, 'pm list packages -d').catch(() => ''),
    sh(serial, 'settings get global window_animation_scale').catch(() => '1'),
  ]);
  return {
    ts: Date.now(),
    storage: storage.trim(),
    battery: (battery.match(/\d+/) || ['?'])[0],
    userApps: userApps.split('\n').filter(Boolean).length,
    disApps:  disApps.split('\n').filter(Boolean).length,
    anim: parseFloat(anim) || 1,
  };
}

/* ── 8. CURATED BLOATWARE LISTS ──────────────────────────────────────────── */

const BLOATWARE_PRESETS = {
  google: [
    'com.google.android.feedback',
    'com.google.android.tts',
    'com.google.android.printspooler',
    'com.android.printspooler',
    'com.google.android.apps.tachyon',
    'com.google.android.apps.magazines',
    'com.google.android.videos',
    'com.google.android.music',
  ],
  samsung: [
    'com.samsung.android.game.gametools',
    'com.samsung.android.bixby.agent',
    'com.samsung.android.bixbyvision.framework',
    'com.samsung.android.app.sbrowser',
    'com.sec.android.app.shealth',
    'com.samsung.android.samsungpay.gear',
    'com.samsung.android.livestickers',
    'com.samsung.android.ar.camera',
    'com.samsung.android.dialer',
  ],
  xiaomi: [
    'com.miui.analytics',
    'com.xiaomi.gamecenter.sdk.service',
    'com.miui.msa.global',
    'com.miui.cloudservice',
    'com.xiaomi.market',
    'com.duokan.phone.immersiveassistant',
  ],
  oppo: [
    'com.heytap.market',
    'com.opos.cs',
    'com.oppo.logkitservice',
    'com.coloros.phonemanager',
  ],
};

function getBloatwarePreset(brand) {
  const b = (brand || '').toLowerCase();
  if (b.includes('samsung')) return BLOATWARE_PRESETS.samsung;
  if (b.includes('xiaomi') || b.includes('redmi') || b.includes('poco')) return BLOATWARE_PRESETS.xiaomi;
  if (b.includes('oppo') || b.includes('realme') || b.includes('oneplus')) return BLOATWARE_PRESETS.oppo;
  return BLOATWARE_PRESETS.google;
}

/* ── 9. ONE-TAP MANTENIMIENTO COMPLETO ──────────────────────────────────────*/

async function runFullMaintenance(serial, opts = {}) {
  const log = [];
  const step = async (label, fn) => {
    try { const r = await fn(); log.push({ label, ok: r.ok !== false, msg: r.msg || '' }); }
    catch (e) { log.push({ label, ok: false, msg: e.message }); }
  };

  if (opts.clearCache !== false)  await step('Limpiar caché de apps',    () => clearAllUserCache(serial));
  if (opts.clearLogs  !== false)  await step('Limpiar logs del sistema',  () => clearSystemLogs(serial));
  if (opts.clearTemp  !== false)  await step('Limpiar temporales',        () => clearTempFiles(serial));
  if (opts.killBg     !== false)  await step('Matar procesos segundo plano', () => killBackground(serial));
  if (opts.resetBatt  !== false)  await step('Reiniciar estadísticas batería', () => resetBatteryStats(serial));
  if (opts.fixClock   !== false)  await step('Sincronizar fecha y hora',  () => fixClock(serial));
  if (opts.animations !== false)  await step('Optimizar animaciones (x1)', () => setAnimationScale(serial, 1));

  const ok = log.filter(l => l.ok).length;
  return { ok: true, steps: log, summary: `${ok}/${log.length} tareas completadas.` };
}

module.exports = {
  setAdb,
  clearSystemLogs, clearTempFiles, clearAppCache, clearAllUserCache, clearDalvikCache,
  resetBatteryStats, listSystemApps, listUserApps, disableApp, enableApp,
  batchDisable, batchUninstall, killBackground, forceStopApp, getRunningApps,
  getAppPermissions, revokePermission, grantPermission,
  setAnimationScale, getAnimationScales, setPerformanceMode, disableTelemetry,
  fixClock, toggleWifi, toggleBluetooth, toggleAirplane,
  enableDevOptions, disableDevOptions, rebootSafeMode,
  resetNetworkSettings, setCustomDns, resetPasswordPolicy,
  generateReport, takeSnapshot, getBloatwarePreset, runFullMaintenance,
};
