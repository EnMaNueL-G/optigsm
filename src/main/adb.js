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

async function deviceInfo(serial) {
  const [model, brand, android, sdk, cpu, product, serial2, imei1, imei2, build, ram, storage, battery] = await Promise.all([
    adbProp(serial, 'ro.product.model'),
    adbProp(serial, 'ro.product.brand'),
    adbProp(serial, 'ro.build.version.release'),
    adbProp(serial, 'ro.build.version.sdk'),
    adbProp(serial, 'ro.hardware'),
    adbProp(serial, 'ro.product.name'),
    adbProp(serial, 'ro.serialno'),
    adbShell(serial, 'service call iphonesubinfo 1 2>/dev/null | awk -F"\'" \'NR>1{printf $2}\' | tr -d \'.\'').then(r=>r.out.replace(/[^0-9]/g,'').slice(0,15)),
    adbShell(serial, 'service call iphonesubinfo 3 2>/dev/null | awk -F"\'" \'NR>1{printf $2}\' | tr -d \'.\'').then(r=>r.out.replace(/[^0-9]/g,'').slice(0,15)),
    adbProp(serial, 'ro.build.display.id'),
    adbShell(serial, 'cat /proc/meminfo | grep MemTotal').then(r=>{const m=r.out.match(/(\d+)/);return m?Math.round(parseInt(m[1])/1024)+'MB':'';}),
    adbShell(serial, 'df /data 2>/dev/null | tail -1').then(r=>{const m=r.out.split(/\s+/);return m[1]?Math.round(parseInt(m[1])/1024)+'MB':'';}),
    adbShell(serial, 'dumpsys battery | grep level').then(r=>{const m=r.out.match(/level: (\d+)/);return m?m[1]+'%':'';}),
  ]);
  return { serial: serial2||serial, model, brand, android, sdk, cpu, product, imei1, imei2, build, ram, storage, battery };
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
  const args = ['-s', serial, 'backup', '-f', outputPath];
  if (opts.apk) args.push('-apk'); else args.push('-noapk');
  if (opts.shared) args.push('-shared'); else args.push('-noshared');
  if (opts.all) args.push('-all');
  if (opts.packages) args.push(...opts.packages);
  return runStream(resolveAdb(), args, onData);
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
  const r = await adbShell(serial, 'ip addr show wlan0 | grep inet');
  const m = r.out.match(/inet\s+([\d.]+)/);
  if (!m) return { ok: false, out: 'No se encontró IP WiFi' };
  const ip = m[1];
  await adbShell(serial, 'setprop service.adb.tcp.port 5555');
  await run(resolveAdb(), ['-s', serial, 'tcpip', '5555']);
  return { ok: true, out: `Conectar vía WiFi: adb connect ${ip}:5555`, ip };
}

async function adbWifiConnect(host) {
  return run(resolveAdb(), ['connect', host.includes(':') ? host : host + ':5555']);
}

async function adbBatteryInfo(serial) {
  const r = await adbShell(serial, 'dumpsys battery');
  const parse = (key) => { const m = r.out.match(new RegExp(key + ':\\s*(.+)')); return m ? m[1].trim() : ''; };
  return {
    level: parse('level'), health: parse('health'), status: parse('status'),
    plugged: parse('plugged'), voltage: parse('voltage'), temperature: parse('temperature'),
    technology: parse('technology'),
  };
}

async function adbStorageInfo(serial) {
  const r = await adbShell(serial, 'df -h 2>/dev/null');
  return r.out;
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
  adbDevices, deviceInfo, adbShell, adbProp,
  adbInstall, adbUninstall, adbListPackages, adbDisablePackage, adbEnablePackage,
  adbPull, adbPush, adbScreenshot, adbScreenRecord, adbLogcat,
  adbBackup, adbReboot, adbEnableDebugging, adbWifi, adbWifiConnect,
  adbBatteryInfo, adbStorageInfo, adbSensors, adbTestDisplay, adbWipeData, adbSideload,
  // FASTBOOT
  fastbootDevices, fastbootGetvar, fastbootInfo,
  fastbootFlash, fastbootErase, fastbootReboot,
  fastbootOemUnlock, fastbootOemLock, fastbootFlashingUnlock,
  fastbootWipe, fastbootBootImg,
};
