'use strict';
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let ADB = 'adb';
let FASTBOOT = 'fastboot';

function setToolPaths(adbPath, fastbootPath) {
  if (adbPath && fs.existsSync(adbPath)) ADB = adbPath;
  if (fastbootPath && fs.existsSync(fastbootPath)) FASTBOOT = fastbootPath;
}

function resolveAdb() {
  // look in app tools dir, then PATH
  const candidates = [
    path.join(process.resourcesPath || '', 'tools', 'adb.exe'),
    path.join(__dirname, '..', '..', 'tools', 'adb.exe'),
    ADB,
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  return ADB;
}
function resolveFastboot() {
  const candidates = [
    path.join(process.resourcesPath || '', 'tools', 'fastboot.exe'),
    path.join(__dirname, '..', '..', 'tools', 'fastboot.exe'),
    FASTBOOT,
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  return FASTBOOT;
}

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: opts.timeout || 30000, encoding: 'utf8', ...opts }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr || '');
      resolve({ ok: !err || !err.code, out: out.trim(), code: err ? err.code : 0 });
    });
  });
}

function runStream(bin, args, onData) {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const handler = (d) => { const s = d.toString(); out += s; if (onData) onData(s); };
    proc.stdout.on('data', handler);
    proc.stderr.on('data', handler);
    proc.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), code }));
    proc.on('error', (e) => resolve({ ok: false, out: e.message, code: -1 }));
  });
}

/* ===== ADB ===== */
async function adbDevices() {
  const r = await run(resolveAdb(), ['devices', '-l']);
  const lines = r.out.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('*'));
  return lines.map(l => {
    const [serial, ...rest] = l.trim().split(/\s+/);
    const state = rest[0] || 'unknown';
    const model = (rest.join(' ').match(/model:(\S+)/) || [])[1] || '';
    const product = (rest.join(' ').match(/product:(\S+)/) || [])[1] || '';
    return { serial, state, model, product };
  }).filter(d => d.serial);
}

async function adbShell(serial, cmd, timeout = 15000) {
  const args = serial ? ['-s', serial, 'shell', cmd] : ['shell', cmd];
  return run(resolveAdb(), args, { timeout });
}

async function adbProp(serial, prop) {
  const r = await adbShell(serial, `getprop ${prop}`);
  return r.out.trim();
}

async function readImei(serial) {
  const isImei = (s) => /^\d{15}$/.test((s||'').trim());
  const clean = (s) => (s||'').replace(/[^0-9]/g,'').slice(0,15);

  // Method 1: service call iphonesubinfo slot 0 (Android <10 or root)
  const r1 = await adbShell(serial, "service call iphonesubinfo 1 i32 0 2>/dev/null", 6000).catch(()=>({out:''}));
  const m1 = (r1.out.match(/'([0-9.]+)'/g)||[]).map(s=>s.replace(/['.]/g,'')).join('');
  if (isImei(clean(m1))) return { imei1: clean(m1), imei2: '' };

  // Method 2: getprop variants (older Samsung/MTK)
  for (const prop of ['ril.imei','ril.imei1','gsm.imei','ro.ril.imei','persist.radio.device.imei','persist.ril.imei']) {
    const p = await adbShell(serial, `su -c 'getprop ${prop} 2>/dev/null'`, 4000).catch(()=>({out:''}));
    const v = clean(p.out);
    if (isImei(v)) return { imei1: v, imei2: '' };
  }

  // Method 3: Qualcomm /sys path (root)
  const r3 = await adbShell(serial, "su -c 'cat /sys/devices/soc/4080000.qcom,mss/net/rmnet_ipa0/address 2>/dev/null'", 5000).catch(()=>({out:''}));
  if (isImei(clean(r3.out))) return { imei1: clean(r3.out), imei2: '' };

  // Method 4: Samsung telephony content provider (root, Android 12+)
  const r4 = await adbShell(serial, "su -c 'content query --uri content://telephony/siminfo --projection imsi,icc_id 2>/dev/null | grep -oE \"[0-9]{15}\"' 2>/dev/null", 5000).catch(()=>({out:''}));
  const m4 = (r4.out.match(/\d{15}/)||[])[0]||'';
  if (isImei(m4)) return { imei1: m4, imei2: '' };

  // Method 5: MTK modem path (root)
  const r5 = await adbShell(serial, "su -c 'cat /sys/class/net/ccmni0/address 2>/dev/null || strings /dev/block/by-name/nvdata 2>/dev/null | grep -E \"^[0-9]{15}$\" | head -2'", 5000).catch(()=>({out:''}));
  const m5 = (r5.out.match(/\d{15}/g)||[]).find(v=>isImei(v))||'';
  if (m5) return { imei1: m5, imei2: '' };

  return { imei1: '', imei2: '', note: 'Samsung Android 12+: IMEI en NV RAM binario. Usa modo Download + Heimdall o MTK/QC según chipset.' };
}

async function deviceInfo(serial) {
  const [model, brand, android, sdk, cpu, product, serial2, build, ram, storage, battery, imeis] = await Promise.all([
    adbProp(serial, 'ro.product.model'),
    adbProp(serial, 'ro.product.brand'),
    adbProp(serial, 'ro.build.version.release'),
    adbProp(serial, 'ro.build.version.sdk'),
    adbProp(serial, 'ro.hardware'),
    adbProp(serial, 'ro.product.name'),
    adbProp(serial, 'ro.serialno'),
    adbProp(serial, 'ro.build.display.id'),
    adbShell(serial, 'cat /proc/meminfo 2>/dev/null | grep MemTotal').then(r=>{const m=r.out.match(/(\d+)/);return m?Math.round(parseInt(m[1])/1024)+'MB':'';}),
    adbShell(serial, 'df /data 2>/dev/null | tail -1').then(r=>{const parts=r.out.trim().split(/\s+/);const kb=parseInt(parts[1]);return isNaN(kb)?'':Math.round(kb/1024)+'MB';}),
    adbShell(serial, 'dumpsys battery 2>/dev/null | grep level').then(r=>{const m=r.out.match(/level:\s*(\d+)/);return m?m[1]+'%':'';}),
    readImei(serial),
  ]);
  return { serial: serial2||serial, model, brand, android, sdk, cpu, product, imei1: imeis.imei1, imei2: imeis.imei2, build, ram, storage, battery };
}

async function adbInstall(serial, apkPath, opts = {}) {
  const args = ['-s', serial, 'install'];
  if (opts.replace) args.push('-r');
  if (opts.grant) args.push('-g');
  args.push(apkPath);
  return run(resolveAdb(), args, { timeout: 120000 });
}

async function adbUninstall(serial, pkg, keepData = false) {
  const args = ['-s', serial, 'uninstall'];
  if (keepData) args.push('-k');
  args.push(pkg);
  return run(resolveAdb(), args, { timeout: 30000 });
}

async function adbListPackages(serial, flags = '') {
  const r = await adbShell(serial, `pm list packages ${flags}`);
  return r.out.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean);
}

async function adbDisablePackage(serial, pkg) {
  return adbShell(serial, `pm disable-user --user 0 ${pkg}`);
}
async function adbEnablePackage(serial, pkg) {
  return adbShell(serial, `pm enable ${pkg}`);
}

async function adbPull(serial, remote, local, onData) {
  return runStream(resolveAdb(), ['-s', serial, 'pull', remote, local], onData);
}
async function adbPush(serial, local, remote, onData) {
  return runStream(resolveAdb(), ['-s', serial, 'push', local, remote], onData);
}

async function adbScreenshot(serial, destPath) {
  await adbShell(serial, 'screencap -p /sdcard/optigsm_ss.png');
  return adbPull(serial, '/sdcard/optigsm_ss.png', destPath || path.join(os.tmpdir(), 'optigsm_ss.png'));
}

async function adbScreenRecord(serial, destPath, opts = {}) {
  const remote = '/sdcard/optigsm_rec.mp4';
  const args = ['-s', serial, 'shell', 'screenrecord'];
  if (opts.time) args.push('--time-limit', String(opts.time));
  if (opts.bitrate) args.push('--bit-rate', String(opts.bitrate));
  args.push(remote);
  return runStream(resolveAdb(), args.slice(2));
}

async function adbLogcat(serial, filter, onLine) {
  const proc = spawn(resolveAdb(), ['-s', serial, 'logcat', '-v', 'time', filter || '*:V']);
  proc.stdout.on('data', (d) => { d.toString().split('\n').forEach(l => { if (l.trim()) onLine(l); }); });
  proc.stderr.on('data', (d) => { d.toString().split('\n').forEach(l => { if (l.trim()) onLine('[ERR] ' + l); }); });
  return { kill: () => { try { proc.kill(); } catch (_) {} } };
}

async function adbBackup(serial, outputPath, opts = {}, onData) {
  // Use adb pull for key directories — adb backup is deprecated on Android 12+
  const send = (msg) => { if (onData) onData(msg); };
  const dirs = ['/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Download', '/sdcard/WhatsApp', '/sdcard/Documents'];
  let ok = true; const results = [];
  for (const dir of dirs) {
    const dest = path.join(outputPath, path.basename(dir));
    send(`Copiando ${dir} → ${dest}`);
    const r = await runStream(resolveAdb(), ['-s', serial, 'pull', dir, dest], onData).catch(e => ({ ok: false, out: e.message }));
    results.push(`${path.basename(dir)}: ${r.ok !== false ? '✓' : '✗ ' + (r.out || '')}`);
    if (!r.ok) ok = false;
  }
  return { ok, out: 'Backup completado:\n' + results.join('\n') + `\n\nGuardado en: ${outputPath}` };
}

async function adbReboot(serial, mode = '') {
  const args = ['-s', serial, 'reboot'];
  if (mode) args.push(mode);
  return run(resolveAdb(), args);
}

async function adbEnableDebugging(serial) {
  await adbShell(serial, 'settings put global development_settings_enabled 1');
  return adbShell(serial, 'settings put global adb_enabled 1');
}

async function adbWifi(serial) {
  const r = await adbShell(serial, 'ip addr show wlan0 2>/dev/null | grep "inet "');
  const m = r.out.match(/inet\s+([\d.]+)/);
  if (!m) return { ok: false, out: 'No se encontró IP WiFi. Asegúrate de que el dispositivo está en la misma red WiFi.' };
  const ip = m[1];
  await run(resolveAdb(), ['-s', serial, 'tcpip', '5555']);
  await new Promise(res => setTimeout(res, 1500));
  const conn = await run(resolveAdb(), ['connect', `${ip}:5555`]);
  const connected = conn.out && (conn.out.includes('connected') || conn.out.includes('already connected'));
  return {
    ok: connected,
    out: connected ? `✓ Conectado a ${ip}:5555\n${conn.out.trim()}\n\nPuedes desconectar el cable USB ahora.` : `IP: ${ip}:5555\n${conn.out || ''}\nSi falla, usa: adb connect ${ip}:5555`,
    ip,
  };
}

async function adbWifiConnect(host) {
  return run(resolveAdb(), ['connect', host.includes(':') ? host : host + ':5555']);
}

const BATTERY_HEALTH = { '1':'Desconocido','2':'Bueno ✓','3':'Sobrecalentado ⚠','4':'Muerto ✗','5':'Sobrevoltaje ⚠','6':'Fallo desconocido','7':'Frío ⚠' };
const BATTERY_STATUS = { '1':'Desconocido','2':'Cargando','3':'Descargando','4':'Sin cargar','5':'Lleno' };
const BATTERY_PLUGGED = { '0':'No conectado','1':'AC','2':'USB','4':'Wireless' };

async function adbBatteryInfo(serial) {
  // Try with root first for more data, fallback to shell user
  const [rRoot, rUevent] = await Promise.all([
    adbShell(serial, "su -c 'dumpsys battery 2>/dev/null' 2>/dev/null", 8000).catch(()=>({out:''})),
    adbShell(serial, "su -c 'cat /sys/class/power_supply/battery/uevent 2>/dev/null' 2>/dev/null", 6000).catch(()=>({out:''})),
  ]);
  const r = rRoot.out.length > 50 ? rRoot : await adbShell(serial, 'dumpsys battery 2>/dev/null', 8000).catch(()=>({out:''}));

  // Anchored multiline parse — avoids "Max charging voltage" matching "voltage:"
  const parseField = (out, key) => {
    const m = out.match(new RegExp(`^[ \\t]*${key}:[ \\t]*(.+)`, 'm'));
    return m ? m[1].trim() : '';
  };

  const level      = parseField(r.out, 'level');
  const healthCode = parseField(r.out, 'health');
  const statusCode = parseField(r.out, 'status');
  const pluggedCode = parseField(r.out, 'plugged');
  const voltageRaw = parseField(r.out, 'voltage');   // "3901" (mV) — no longer captures "Max charging voltage"
  const tempRaw    = parseField(r.out, 'temperature');
  const technology = parseField(r.out, 'technology');

  // Parse uevent (key=value pairs, µV and µAh)
  const uevent = {};
  rUevent.out.split('\n').forEach(l => { const i = l.indexOf('='); if (i > 0) uevent[l.slice(0,i).trim()] = l.slice(i+1).trim(); });
  const voltageUV   = uevent['POWER_SUPPLY_VOLTAGE_NOW'];   // µV
  const chargeFull  = uevent['POWER_SUPPLY_CHARGE_FULL'];   // µAh
  const chargeDesign= uevent['POWER_SUPPLY_CHARGE_FULL_DESIGN']; // µAh
  const chargeNow   = uevent['POWER_SUPPLY_CHARGE_NOW'];    // µAh

  // Voltage: prefer uevent µV → V; fallback dumpsys mV → V
  let voltageStr = '';
  if (voltageUV && parseInt(voltageUV) > 500000) {
    voltageStr = (parseInt(voltageUV) / 1000000).toFixed(3) + ' V';
  } else if (voltageRaw && parseInt(voltageRaw) > 100) {
    voltageStr = (parseInt(voltageRaw) / 1000).toFixed(3) + ' V';
  }

  // Corriente y potencia (uevent o sys)
  const currentUAStr = uevent['POWER_SUPPLY_CURRENT_NOW'] || '';
  if (currentUAStr && parseInt(currentUAStr) !== 0) {
    const mA = parseInt(currentUAStr) / 1000;
    const sign = mA < 0 ? '' : '+';
    result['Corriente'] = `${sign}${mA.toFixed(0)} mA`;
    // Potencia aproximada = V × I
    const vNum = voltageUV ? parseInt(voltageUV) / 1000000 : (voltageRaw ? parseInt(voltageRaw) / 1000 : 0);
    if (vNum > 0) result['Potencia'] = (vNum * mA / 1000).toFixed(2) + ' W';
  }

  // Samsung EFS — available only with root (non-blocking, short timeout)
  const [asocR, bsohR, cableR, daysR] = await Promise.all([
    adbShell(serial, "su -c 'cat /efs/FactoryApp/asoc 2>/dev/null'", 4000).catch(()=>({out:''})),
    adbShell(serial, "su -c 'cat /efs/FactoryApp/bsoh 2>/dev/null'", 4000).catch(()=>({out:''})),
    adbShell(serial, "su -c 'cat /efs/FactoryApp/batt_cable_count 2>/dev/null'", 4000).catch(()=>({out:''})),
    adbShell(serial, "su -c 'cat /efs/FactoryApp/batt_after_manufactured 2>/dev/null'", 4000).catch(()=>({out:''})),
  ]);
  const asoc      = asocR.out.trim();
  const bsohRaw   = (bsohR.out.trim().match(/[\d.]+/)||[])[0]||'';
  const cableCount= cableR.out.trim();
  const daysInUse = daysR.out.trim();

  const result = {
    'Nivel':       level ? level + '%' : (uevent['POWER_SUPPLY_CAPACITY'] ? uevent['POWER_SUPPLY_CAPACITY'] + '%' : ''),
    'Estado':      BATTERY_STATUS[statusCode] || uevent['POWER_SUPPLY_STATUS'] || statusCode,
    'Salud':       BATTERY_HEALTH[healthCode] || healthCode,
    'Voltaje':     voltageStr,
    'Temperatura': tempRaw ? (parseInt(tempRaw) / 10).toFixed(1) + ' °C' : '',
    'Tecnología':  technology || uevent['POWER_SUPPLY_TECHNOLOGY'] || '',
    'Conectado a': BATTERY_PLUGGED[pluggedCode] || (uevent['POWER_SUPPLY_STATUS'] === 'Charging' ? 'Cargando' : ''),
  };

  // Capacity health from uevent
  if (chargeFull && chargeDesign && parseInt(chargeDesign) > 0) {
    const mAhFull   = Math.round(parseInt(chargeFull) / 1000);
    const mAhDesign = Math.round(parseInt(chargeDesign) / 1000);
    const pct       = Math.round(parseInt(chargeFull) / parseInt(chargeDesign) * 100);
    result['Capacidad'] = `${mAhFull} mAh de ${mAhDesign} mAh (${pct}%)`;
  }
  if (chargeNow && parseInt(chargeNow) > 0) {
    result['Carga actual'] = Math.round(parseInt(chargeNow) / 1000) + ' mAh';
  }

  // Samsung EFS data (only if root returned data)
  if (asoc) result['Salud ASOC'] = asoc + '%  (desgaste real Samsung)';
  if (bsohRaw) result['Salud BSOH'] = parseFloat(bsohRaw).toFixed(1) + '%  (capacidad vs diseño)';
  if (cableCount) result['Eventos de carga'] = parseInt(cableCount).toLocaleString() + ' ciclos';
  if (daysInUse) {
    const d = parseInt(daysInUse);
    const y = Math.floor(d / 365), mo = Math.floor((d % 365) / 30);
    result['Días en uso'] = `${d} días${y ? `  (${y}a ${mo}m)` : ''}`;
  }

  return result;
}

async function adbStorageInfo(serial) {
  const r = await adbShell(serial, 'df -h 2>/dev/null');
  const lines = r.out.trim().split('\n').filter(l => l.trim() && !l.startsWith('Filesystem'));
  const parsed = lines.map(l => {
    const p = l.trim().split(/\s+/);
    if (p.length < 5) return null;
    return { filesystem: p[0], size: p[1], used: p[2], available: p[3], use: p[4], mountpoint: p[5] || '' };
  }).filter(Boolean);
  const interesting = parsed.filter(p => ['/data','/sdcard','/storage','/system','/cache','/'].some(m => p.mountpoint.includes(m)));
  const display = (interesting.length ? interesting : parsed.slice(0,8)).map(p =>
    `${p.mountpoint.padEnd(20)} ${p.size.padStart(6)} total  ${p.used.padStart(6)} usado  ${p.available.padStart(6)} libre  ${p.use}`
  ).join('\n');
  return { ok: true, out: display || r.out, parsed };
}

async function adbForceStop(serial, pkg) {
  return adbShell(serial, `am force-stop ${pkg}`);
}

async function adbClearData(serial, pkg) {
  return adbShell(serial, `pm clear ${pkg}`);
}

async function adbSensors(serial) {
  const r = await adbShell(serial, 'dumpsys sensorservice 2>/dev/null | grep "Sensor" | head -30');
  return r.out;
}

async function adbTestDisplay(serial) {
  return adbShell(serial, 'wm size && wm density && dumpsys display | grep mDisplayId | head -5');
}

async function adbWipeData(serial) {
  return run(resolveAdb(), ['-s', serial, 'shell', 'recovery', '--wipe_data']);
}

async function adbSideload(serial, zipPath, onData) {
  return runStream(resolveAdb(), ['-s', serial, 'sideload', zipPath], onData);
}

/* ===== FASTBOOT ===== */
async function fastbootDevices() {
  const r = await run(resolveFastboot(), ['devices']);
  return r.out.split('\n').filter(l => l.trim() && l.includes('fastboot'))
    .map(l => { const [serial] = l.split('\t'); return { serial: serial.trim(), mode: 'fastboot' }; });
}

async function fastbootGetvar(serial, varname) {
  const args = serial ? ['-s', serial, 'getvar', varname] : ['getvar', varname];
  const r = await run(resolveFastboot(), args);
  const m = (r.out + '\n').match(new RegExp(varname + ':\\s*(.+)'));
  return m ? m[1].trim() : r.out;
}

async function fastbootInfo(serial) {
  const vars = ['product', 'version', 'serialno', 'unlocked', 'secure', 'verity-mode', 'current-slot', 'slot-count'];
  const result = {};
  for (const v of vars) {
    try { result[v] = await fastbootGetvar(serial, v); } catch (_) { result[v] = ''; }
  }
  return result;
}

async function fastbootFlash(serial, partition, imagePath, onData) {
  const args = serial ? ['-s', serial, 'flash', partition, imagePath] : ['flash', partition, imagePath];
  return runStream(resolveFastboot(), args, onData);
}

async function fastbootErase(serial, partition) {
  const args = serial ? ['-s', serial, 'erase', partition] : ['erase', partition];
  return run(resolveFastboot(), args, { timeout: 60000 });
}

async function fastbootReboot(serial, mode = '') {
  const args = serial ? ['-s', serial] : [];
  args.push('reboot');
  if (mode) args.push(mode);
  return run(resolveFastboot(), args);
}

async function fastbootOemUnlock(serial) {
  const args = serial ? ['-s', serial, 'oem', 'unlock'] : ['oem', 'unlock'];
  return run(resolveFastboot(), args, { timeout: 60000 });
}
async function fastbootOemLock(serial) {
  const args = serial ? ['-s', serial, 'oem', 'lock'] : ['oem', 'lock'];
  return run(resolveFastboot(), args, { timeout: 60000 });
}
async function fastbootFlashingUnlock(serial) {
  return run(resolveFastboot(), ['-s', serial, 'flashing', 'unlock'], { timeout: 60000 });
}

async function fastbootWipe(serial) {
  const r1 = await fastbootErase(serial, 'userdata');
  const r2 = await fastbootErase(serial, 'cache');
  return { ok: r1.ok && r2.ok, out: r1.out + '\n' + r2.out };
}

async function fastbootBootImg(serial, imagePath, onData) {
  const args = serial ? ['-s', serial, 'boot', imagePath] : ['boot', imagePath];
  return runStream(resolveFastboot(), args, onData);
}

module.exports = {
  setToolPaths, resolveAdb, resolveFastboot,
  // ADB
  adbDevices, deviceInfo, adbShell, adbProp, readImei,
  adbInstall, adbUninstall, adbListPackages, adbDisablePackage, adbEnablePackage,
  adbForceStop, adbClearData,
  adbPull, adbPush, adbScreenshot, adbScreenRecord, adbLogcat,
  adbBackup, adbReboot, adbEnableDebugging, adbWifi, adbWifiConnect,
  adbBatteryInfo, adbStorageInfo, adbSensors, adbTestDisplay, adbWipeData, adbSideload,
  // FASTBOOT
  fastbootDevices, fastbootGetvar, fastbootInfo,
  fastbootFlash, fastbootErase, fastbootReboot,
  fastbootOemUnlock, fastbootOemLock, fastbootFlashingUnlock,
  fastbootWipe, fastbootBootImg,
};
