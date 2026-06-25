'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const log = require('./log');
const store = require('./store');
const device = require('./device');
const adb = require('./adb');
const mtk = require('./mtk');
const qc = require('./qc');
const samsung = require('./samsung');
const frp = require('./frp');
const firmware = require('./firmware');
const advanced = require('./advanced');
const copilot = require('./copilot');
const crm = require('./crm');
const license = require('./license');
const maint = require('./maintenance');

let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 900, minHeight: 600,
    backgroundColor: '#0d1117',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'default',
    show: false,
  });

  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  Menu.setApplicationMenu(null);

  mainWin.on('closed', () => { mainWin = null; });
}

app.whenReady().then(async () => {
  log.init();
  await store.init();
  createWindow();
  device.setWindow(mainWin);
  device.startPolling(2000);

  // Configure tool paths from settings
  const adbPath = store.getSetting('adbPath');
  if (adbPath) adb.setToolPaths(adbPath, '');
  const pythonPath = store.getSetting('pythonPath');
  if (pythonPath) { mtk.setPython(pythonPath); qc.setPython(pythonPath); }

  log.info('OptiGSM iniciado');
});

app.on('window-all-closed', () => {
  device.stopPolling();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (!mainWin) createWindow(); });

/* ===== Stream helper ===== */
function sendStream(data) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('stream:data', data);
  }
}
function sendStreamDone(result) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('stream:done', result);
  }
}

function wrapStream(fn, ...args) {
  const [last] = args.slice(-1);
  const onData = typeof last === 'function' ? last : sendStream;
  const realArgs = typeof last === 'function' ? args.slice(0, -1) : args;
  return fn(...realArgs, onData);
}

/* ===== Settings ===== */
ipcMain.handle('settings:get', () => store.getAllSettings());
ipcMain.handle('settings:set', (_, k, v) => { store.setSetting(k, v); return true; });

/* ===== Device ===== */
ipcMain.handle('device:list', () => device.currentDevices());
ipcMain.handle('device:info', async (_, serial) => {
  const info = await adb.deviceInfo(serial).catch(e => ({ error: e.message }));
  store.upsertDevice(info);
  return info;
});
ipcMain.handle('device:usb', () => device.detectUsbDevices());

/* ===== ADB ===== */
ipcMain.handle('adb:shell', async (_, serial, cmd, timeout) => adb.adbShell(serial, cmd, timeout));
ipcMain.handle('adb:install', async (_, serial, apkPath, opts) => adb.adbInstall(serial, apkPath, opts));
ipcMain.handle('adb:uninstall', async (_, serial, pkg, keepData) => adb.adbUninstall(serial, pkg, keepData));
ipcMain.handle('adb:packages', async (_, serial, flags) => adb.adbListPackages(serial, flags));
ipcMain.handle('adb:disable', async (_, serial, pkg) => adb.adbDisablePackage(serial, pkg));
ipcMain.handle('adb:enable', async (_, serial, pkg) => adb.adbEnablePackage(serial, pkg));
ipcMain.handle('adb:forceStop', async (_, serial, pkg) => adb.adbForceStop(serial, pkg));
ipcMain.handle('adb:clearData', async (_, serial, pkg) => adb.adbClearData(serial, pkg));
ipcMain.handle('adb:reboot', async (_, serial, mode) => adb.adbReboot(serial, mode));
ipcMain.handle('adb:wifi', async (_, serial) => adb.adbWifi(serial));
ipcMain.handle('adb:wifiConnect', async (_, host) => adb.adbWifiConnect(host));
ipcMain.handle('adb:readImei', async (_, serial) => adb.readImei(serial));
ipcMain.handle('adb:battery', async (_, serial) => adb.adbBatteryInfo(serial));
ipcMain.handle('adb:storage', async (_, serial) => adb.adbStorageInfo(serial));
ipcMain.handle('adb:wipeData', async (_, serial) => adb.adbWipeData(serial));
ipcMain.handle('adb:backup', async (_, serial, opts) => {
  const dest = path.join(app.getPath('desktop'), `backup_${serial}_${Date.now()}`);
  fs.mkdirSync(dest, { recursive: true });
  return adb.adbBackup(serial, dest, opts, sendStream);
});
ipcMain.handle('adb:screenshot', async (_, serial) => {
  const dest = path.join(os.tmpdir(), `ss_${serial}_${Date.now()}.png`);
  const r = await adb.adbScreenshot(serial, dest);
  if (r.ok) return { ok: true, path: dest };
  return r;
});

/* ===== Fastboot ===== */
ipcMain.handle('fastboot:devices', () => adb.fastbootDevices());
ipcMain.handle('fastboot:info', async (_, serial) => adb.fastbootInfo(serial));
ipcMain.handle('fastboot:flash', async (_, serial, partition, imgPath) => adb.fastbootFlash(serial, partition, imgPath, sendStream));
ipcMain.handle('fastboot:erase', async (_, serial, partition) => adb.fastbootErase(serial, partition));
ipcMain.handle('fastboot:reboot', async (_, serial, mode) => adb.fastbootReboot(serial, mode));
ipcMain.handle('fastboot:unlock', async (_, serial) => adb.fastbootOemUnlock(serial));
ipcMain.handle('fastboot:lock', async (_, serial) => adb.fastbootOemLock(serial));
ipcMain.handle('fastboot:wipe', async (_, serial) => adb.fastbootWipe(serial));

/* ===== MTK ===== */
ipcMain.handle('mtk:check', () => mtk.checkMtk());
ipcMain.handle('mtk:info', () => mtk.readInfo(sendStream));
ipcMain.handle('mtk:readPartition', (_, name, outPath) => mtk.readPartition(name, outPath, sendStream));
ipcMain.handle('mtk:writePartition', (_, name, imgPath) => mtk.writePartition(name, imgPath, sendStream));
ipcMain.handle('mtk:readFlash', (_, outPath) => mtk.readFlash(outPath, sendStream));
ipcMain.handle('mtk:writeFlash', (_, imgPath) => mtk.writeFlash(imgPath, sendStream));
ipcMain.handle('mtk:resetFrp', () => mtk.resetFrp(sendStream));
ipcMain.handle('mtk:wipe', () => mtk.wipeUserdata(sendStream));
ipcMain.handle('mtk:printGpt', () => mtk.printGpt(sendStream));
ipcMain.handle('mtk:unlockBootloader', () => mtk.unlockBootloader(sendStream));
ipcMain.handle('mtk:flashScatter', (_, scatterPath) => mtk.flashScatter(scatterPath, sendStream));

/* ===== Qualcomm ===== */
ipcMain.handle('qc:check', () => qc.checkEdl());
ipcMain.handle('qc:printGpt', () => qc.printGpt(sendStream));
ipcMain.handle('qc:readPartition', (_, name, outPath) => qc.readPartition(name, outPath, sendStream));
ipcMain.handle('qc:writePartition', (_, name, imgPath) => qc.writePartition(name, imgPath, sendStream));
ipcMain.handle('qc:readEfs', (_, outPath) => qc.readEfs(outPath, sendStream));
ipcMain.handle('qc:writeEfs', (_, p1, p2) => qc.writeEfs(p1, p2, sendStream));
ipcMain.handle('qc:resetFrp', () => qc.resetFrp(sendStream));
ipcMain.handle('qc:wipe', () => qc.wipeUserdata(sendStream));
ipcMain.handle('qc:reboot', () => qc.reboot(sendStream));
ipcMain.handle('qc:backupCritical', (_, dir) => qc.backupCritical(dir, sendStream));

/* ===== Samsung ===== */
ipcMain.handle('samsung:check', () => samsung.checkHeimdall());
ipcMain.handle('samsung:detect', () => samsung.detectDevice());
ipcMain.handle('samsung:printPit', () => samsung.printPit());
ipcMain.handle('samsung:flashFirmware', (_, files) => samsung.flashFirmware(files, sendStream));
ipcMain.handle('samsung:flashPartition', (_, name, imgPath) => samsung.flashPartition(name, imgPath, sendStream));
ipcMain.handle('samsung:resetFrp', (_, serial) => samsung.resetFrp(serial));
ipcMain.handle('samsung:info', (_, serial) => samsung.samsungInfo(serial));
ipcMain.handle('samsung:rebootToDownload', (_, serial) => samsung.rebootToDownload(serial));
ipcMain.handle('samsung:searchFw', (_, model, region) => firmware.searchSamsungFw(model, region));

/* ===== FRP ===== */
ipcMain.handle('frp:listMethods', () => frp.listMethods());
ipcMain.handle('frp:checkStatus', (_, serial) => frp.checkFrpStatus(serial));
ipcMain.handle('frp:instructions', (_, type) => {
  if (type === 'emergency') return { out: frp.getEmergencyBypassInstructions() };
  if (type === 'samsung') return { out: frp.getSamsungFrpInstructions() };
  return { out: 'Tipo desconocido' };
});
ipcMain.handle('frp:run', async (_, methodId, serial, opts) => {
  store.logOperation({ platform: 'FRP', operation: `bypass_method_${methodId}`, model: serial });
  switch (methodId) {
    case 1: return frp.wipeFrpAdb(serial);
    case 2: return frp.disableGoogleAccountManager(serial);
    case 3: return frp.removeGoogleAccount(serial);
    case 4: return frp.clearFrpSettings(serial);
    case 5: return frp.launchFrpBypassApk(serial, opts && opts.apkPath);
    case 6: return { ok: true, out: frp.getSideloadCmd(serial) };
    case 7: return frp.eraseFrpPartition(serial);
    case 8: return { ok: true, out: frp.getEmergencyBypassInstructions() };
    case 9: return frp.oemUnlockAndWipe(serial);
    case 10: return { ok: true, out: frp.getSamsungFrpInstructions() };
    default: return { ok: false, out: 'Método no válido' };
  }
});

/* ===== Firmware ===== */
ipcMain.handle('firmware:search', (_, brand, model, region) => firmware.searchFirmware(brand, model, region));
ipcMain.handle('firmware:download', async (_, url, destPath) => {
  const dest = destPath || path.join(app.getPath('downloads'), `fw_${Date.now()}.zip`);
  return firmware.downloadFile(url, dest, (p) => sendStream(`${p.pct}% (${(p.received / 1048576).toFixed(1)} MB)`));
});
ipcMain.handle('firmware:extract', (_, zipPath, destDir) => firmware.extractZip(zipPath, destDir));
ipcMain.handle('firmware:verify', (_, filePath) => firmware.md5File(filePath).then(md5 => ({ ok: true, md5 })));

/* ===== Advanced ===== */
ipcMain.handle('advanced:isEnabled', () => advanced.isEnabled());
ipcMain.handle('advanced:mtkWriteImei', (_, i1, i2) => advanced.mtkWriteImei(i1, i2, sendStream).catch(e => ({ ok: false, out: e.message })));
ipcMain.handle('advanced:qcWriteImei', (_, i1, i2) => advanced.qcWriteImei(i1, i2, null, sendStream).catch(e => ({ ok: false, out: e.message })));
ipcMain.handle('advanced:samsungWriteImei', (_, serial, i1, i2) => advanced.samsungWriteImei(serial, i1, i2, sendStream).catch(e => ({ ok: false, out: e.message })));
ipcMain.handle('advanced:generateUnlockCode', (_, imei, algo) => {
  try { return advanced.generateUnlockCode(imei, algo); }
  catch (e) { return { ok: false, out: e.message }; }
});
ipcMain.handle('advanced:miAccountRemove', (_, serial) => advanced.miAccountRemove(serial, sendStream).catch(e => ({ ok: false, out: e.message })));
ipcMain.handle('advanced:huaweiIdRemove', (_, serial) => advanced.huaweiIdRemove(serial, sendStream).catch(e => ({ ok: false, out: e.message })));
ipcMain.handle('advanced:mtkFrpBypass', () => advanced.mtkFrpBypass(sendStream).catch(e => ({ ok: false, out: e.message })));
ipcMain.handle('advanced:qcFrpBypass', () => advanced.qcFrpBypass(sendStream).catch(e => ({ ok: false, out: e.message })));

/* ===== History ===== */
ipcMain.handle('history:get', (_, limit) => store.getOperations(limit));
ipcMain.handle('history:log', (_, op) => { store.logOperation(op); return true; });

/* ===== Dialogs ===== */
ipcMain.handle('dialog:pickFile', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWin, {
    properties: ['openFile'],
    filters: opts && opts.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:pickDirectory', async () => {
  const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:saveFile', async (_, opts) => {
  const r = await dialog.showSaveDialog(mainWin, {
    defaultPath: (opts && opts.defaultPath) || '',
    filters: (opts && opts.filters) || [{ name: 'All Files', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePath;
});

/* ===== Security / Knox / Widevine ===== */
ipcMain.handle('adb:security', async (_, serial) => {
  const data = await adb.adbSecurityInfo(serial).catch(e => null);
  if (!data) return { ok: false, out: 'Error leyendo seguridad', data: {} };
  return { ok: true, data };
});

/* ===== Build.prop ===== */
ipcMain.handle('adb:buildpropRead', async (_, serial) => ({ ok: true, out: await adb.adbBuildPropRead(serial) }));
ipcMain.handle('adb:buildpropWrite', async (_, serial, key, value) => adb.adbBuildPropWrite(serial, key, value));

/* ===== MAC change ===== */
ipcMain.handle('adb:changeMac', async (_, serial, mac) => adb.adbChangeMac(serial, mac));

/* ===== CSC info & changer ===== */
ipcMain.handle('adb:cscInfo', async (_, serial) => adb.adbCscInfo(serial));
ipcMain.handle('samsung:changeCsc', async (_, serial, csc) => samsung.changeCsc(serial, csc));

/* ===== Co-Pilot IA ===== */
ipcMain.handle('copilot:check', async () => copilot.detectBackends());
ipcMain.handle('copilot:models', async () => copilot.listModels());
ipcMain.handle('copilot:prompts', async () => copilot.QUICK_PROMPTS);
ipcMain.handle('copilot:chat', async (_, opts) => {
  return copilot.chat(opts, (token) => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('copilot:token', token);
  });
});
ipcMain.handle('copilot:abort', () => { copilot.abortChat(); return { ok: true }; });

/* ===== MIRROR (scrcpy) ===== */
let _mirrorProc = null;
function resolveScrcpy() {
  const candidates = [
    path.join(process.resourcesPath || '', 'tools', 'scrcpy.exe'),
    path.join(__dirname, '..', '..', 'tools', 'scrcpy.exe'),
    path.join(__dirname, '..', '..', 'tools', 'scrcpy'),
    'scrcpy',
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || 'scrcpy';
}
ipcMain.handle('mirror:start', async (_, serial, opts = {}) => {
  if (_mirrorProc && !_mirrorProc.killed) {
    try { _mirrorProc.kill(); } catch (_) {}
    _mirrorProc = null;
  }
  const bin = resolveScrcpy();
  const args = ['--serial', serial, '--window-title', `OptiGSM Mirror — ${serial}`, '--always-on-top', '--max-fps', '30', '--max-size', '900'];
  if (opts.noControl) args.push('--no-control');
  if (opts.noAudio !== false) args.push('--no-audio');
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn(bin, args, { detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    _mirrorProc = proc;
    let stderr = '';
    proc.stderr && proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, out: `scrcpy no encontrado.\n\nInstala: scoop install scrcpy\nO coloca scrcpy.exe en la carpeta tools/ del proyecto.\n\n${e.message}` }));
    setTimeout(() => {
      if (proc.exitCode !== null && proc.exitCode !== 0) {
        resolve({ ok: false, out: `scrcpy falló (código ${proc.exitCode}):\n${stderr.slice(0, 400)}` });
      } else {
        resolve({ ok: true, out: 'Espejo iniciado en ventana separada' });
      }
    }, 1200);
  });
});
ipcMain.handle('mirror:stop', async () => {
  if (_mirrorProc) { try { _mirrorProc.kill(); } catch (_) {} _mirrorProc = null; }
  return { ok: true };
});

/* ===== LICENCIA ===== */
ipcMain.handle('license:check', () => license.checkLicense());
ipcMain.handle('license:grace', () => license.graceStatus());
ipcMain.handle('license:activate', async (_, key) => license.activateLicense(key));
ipcMain.handle('license:deactivate', () => license.deactivateLicense());

/* ===== CRM ===== */
ipcMain.handle('crm:clients', (_, search) => ({ ok: true, data: crm.allClients(search) }));
ipcMain.handle('crm:client', (_, id) => ({ ok: true, data: crm.getClient(id) }));
ipcMain.handle('crm:upsertClient', (_, data) => crm.upsertClient(data));
ipcMain.handle('crm:deleteClient', (_, id) => crm.deleteClient(id));
ipcMain.handle('crm:repairs', (_, clientId) => ({ ok: true, data: crm.getRepairs(clientId) }));
ipcMain.handle('crm:repair', (_, id) => ({ ok: true, data: crm.getRepair(id) }));
ipcMain.handle('crm:upsertRepair', (_, data) => crm.upsertRepair(data));
ipcMain.handle('crm:stats', () => ({ ok: true, data: crm.repairStats() }));

/* ===== Hash / verificación firmware ===== */
ipcMain.handle('util:hashFile', async (_, filePath, algo) => {
  const crypto = require('crypto');
  return new Promise((resolve) => {
    const hash = crypto.createHash(algo || 'sha256');
    const stream = require('fs').createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve({ ok: true, hash: hash.digest('hex'), algo: algo || 'sha256' }));
    stream.on('error', e => resolve({ ok: false, out: e.message }));
  });
});

/* ===== Logcat ===== */
let _logcatProc = null;
ipcMain.handle('adb:logcatStart', async (_, serial, level, tag, pkg) => {
  if (_logcatProc) { try { _logcatProc.kill(); } catch (_) {} _logcatProc = null; }
  const { spawn } = require('child_process');
  const args = ['-s', serial, 'logcat', '-v', 'brief', `*:${level || 'I'}`];
  if (tag) args.push(`${tag}:${level || 'I'}`, '*:S');
  _logcatProc = spawn(adb.resolveAdb(), args);
  _logcatProc.stdout.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    lines.forEach(l => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('logcat:line', l); });
  });
  return { ok: true };
});
ipcMain.handle('adb:logcatStop', () => {
  if (_logcatProc) { try { _logcatProc.kill(); } catch (_) {} _logcatProc = null; }
  return { ok: true };
});

/* ── MANTENIMIENTO ─────────────────────────────────────────────────────── */
ipcMain.handle('maint:clearLogs',       (_, s)       => maint.clearSystemLogs(s));
ipcMain.handle('maint:clearTemp',       (_, s)       => maint.clearTempFiles(s));
ipcMain.handle('maint:clearAppCache',   (_, s, pkg)  => maint.clearAppCache(s, pkg));
ipcMain.handle('maint:clearAllCache',   (_, s)       => maint.clearAllUserCache(s));
ipcMain.handle('maint:clearDalvik',     (_, s)       => maint.clearDalvikCache(s));
ipcMain.handle('maint:resetBattery',    (_, s)       => maint.resetBatteryStats(s));
ipcMain.handle('maint:listSystemApps',  (_, s)       => maint.listSystemApps(s));
ipcMain.handle('maint:listUserApps',    (_, s)       => maint.listUserApps(s));
ipcMain.handle('maint:disableApp',      (_, s, pkg)  => maint.disableApp(s, pkg));
ipcMain.handle('maint:enableApp',       (_, s, pkg)  => maint.enableApp(s, pkg));
ipcMain.handle('maint:batchDisable',    (_, s, pkgs) => maint.batchDisable(s, pkgs));
ipcMain.handle('maint:batchUninstall',  (_, s, pkgs) => maint.batchUninstall(s, pkgs));
ipcMain.handle('maint:killBg',          (_, s)       => maint.killBackground(s));
ipcMain.handle('maint:forceStop',       (_, s, pkg)  => maint.forceStopApp(s, pkg));
ipcMain.handle('maint:runningApps',     (_, s)       => maint.getRunningApps(s));
ipcMain.handle('maint:permissions',     (_, s, pkg)  => maint.getAppPermissions(s, pkg));
ipcMain.handle('maint:revoke',          (_, s, pkg, perm) => maint.revokePermission(s, pkg, perm));
ipcMain.handle('maint:grant',           (_, s, pkg, perm) => maint.grantPermission(s, pkg, perm));
ipcMain.handle('maint:setAnimations',   (_, s, sc)   => maint.setAnimationScale(s, sc));
ipcMain.handle('maint:getAnimations',   (_, s)       => maint.getAnimationScales(s));
ipcMain.handle('maint:setPerfMode',     (_, s, mode) => maint.setPerformanceMode(s, mode));
ipcMain.handle('maint:disableTelemetry',(_, s)       => maint.disableTelemetry(s));
ipcMain.handle('maint:fixClock',        (_, s)       => maint.fixClock(s));
ipcMain.handle('maint:wifi',            (_, s, on)   => maint.toggleWifi(s, on));
ipcMain.handle('maint:bluetooth',       (_, s, on)   => maint.toggleBluetooth(s, on));
ipcMain.handle('maint:airplane',        (_, s, on)   => maint.toggleAirplane(s, on));
ipcMain.handle('maint:devOptions',      (_, s, on)   => on ? maint.enableDevOptions(s) : maint.disableDevOptions(s));
ipcMain.handle('maint:safeMode',        (_, s)       => maint.rebootSafeMode(s));
ipcMain.handle('maint:resetNetwork',    (_, s)       => maint.resetNetworkSettings(s));
ipcMain.handle('maint:setDns',          (_, s, d1, d2) => maint.setCustomDns(s, d1, d2));
ipcMain.handle('maint:resetPassword',   (_, s)       => maint.resetPasswordPolicy(s));
ipcMain.handle('maint:report',          (_, s)       => maint.generateReport(s));
ipcMain.handle('maint:snapshot',        (_, s)       => maint.takeSnapshot(s));
ipcMain.handle('maint:bloatPreset',     (_, brand)   => ({ ok: true, pkgs: maint.getBloatwarePreset(brand) }));
ipcMain.handle('maint:runFull',         (_, s, opts) => maint.runFullMaintenance(s, opts));
