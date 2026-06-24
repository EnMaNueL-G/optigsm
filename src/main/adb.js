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
  // Method 1: service call iphonesubinfo (works ADB Android <10, or root)
  const parseServiceCall = (out) => out.replace(/[^0-9]/g,'').slice(0,15);
  const r1 = await adbShell(serial, "service call iphonesubinfo 1 i32 2 2>/dev/null | grep -oP \"'[0-9.]+'\" | tr -d \"'.\" | tr -d ' '").catch(()=>({out:''}));
  const imei1a = parseServiceCall(r1.out);
  const r2 = await adbShell(serial, "service call iphonesubinfo 3 i32 2 2>/dev/null | grep -oP \"'[0-9.]+'\" | tr -d \"'.\" | tr -d ' '").catch(()=>({out:''}));
  const imei2a = parseServiceCall(r2.out);
  if (imei1a.length === 15) return { imei1: imei1a, imei2: imei2a };
  // Method 2: getprop (some older Samsung/MTK)
  const p1 = await adbProp(serial, 'gsm.imei').catch(()=>'');
  if (p1 && p1.length >= 15) return { imei1: p1.slice(0,15), imei2: p1.slice(15,30)||'' };
  // Method 3: root via /sys or /dev/block/modem
  const r3 = await adbShell(serial, "su -c 'cat /sys/devices/soc/4080000.qcom,mss/net/rmnet_ipa0/address 2>/dev/null || getprop gsm.imei'").catch(()=>({out:''}));
  const imei1c = parseServiceCall(r3.out);
  if (imei1c.length === 15) return { imei1: imei1c, imei2: '' };
  return { imei1: '', imei2: '' };
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
  const [r, rSys] = await Promise.all([
    adbShell(serial, 'dumpsys battery 2>/dev/null'),
    adbShell(serial, 'cat /sys/class/power_supply/battery/charge_counter /sys/class/power_supply/battery/cycle_count /sys/class/power_supply/battery/charge_full /sys/class/power_supply/battery/charge_full_design 2>/dev/null'),
  ]);
  const parse = (key) => { const m = r.out.match(new RegExp(key + ':\\s*(.+)')); return m ? m[1].trim() : ''; };
  const level = parse('level');
  const healthCode = parse('health');
  const statusCode = parse('status');
  const pluggedCode = parse('plugged');
  const voltageRaw = parse('voltage');
  const tempRaw = parse('temperature');
  const technology = parse('technology');
  const maxChargingVoltage = parse('Max charging voltage');
  // Parse sys values
  const sysLines = rSys.out.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const cycleCount = sysLines.find(l => /^\d+$/.test(l) && parseInt(l) < 10000) || '';
  const chargeFull = sysLines.find(l => /^\d{4,}$/.test(l)) || '';
  const chargeDesign = sysLines.filter(l => /^\d{4,}$/.test(l))[1] || '';
  const healthPct = (chargeFull && chargeDesign && parseInt(chargeDesign) > 0)
    ? Math.round(parseInt(chargeFull) / parseInt(chargeDesign) * 100) + '%' : '';
  return {
    'Nivel': level ? level + '%' : '',
    'Estado': BATTERY_STATUS[statusCode] || statusCode,
    'Salud': BATTERY_HEALTH[healthCode] || healthCode,
    'Salud capacidad': healthPct,
    'Ciclos de carga': cycleCount,
    'Conectado a': BATTERY_PLUGGED[pluggedCode] || pluggedCode,
    'Voltaje': voltageRaw ? (parseInt(voltageRaw) / 1000).toFixed(3) + ' V' : '',
    'Temperatura': tempRaw ? (parseInt(tempRaw) / 10).toFixed(1) + ' °C' : '',
    'Tecnología': technology,
    'Voltaje máx. carga': maxChargingVoltage ? parseInt(maxChargingVoltage) / 1000 + ' V' : '',
  };
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
