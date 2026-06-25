'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gsm', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (k, v) => ipcRenderer.invoke('settings:set', k, v),

  // Device
  getDevices: () => ipcRenderer.invoke('device:list'),
  deviceInfo: (serial) => ipcRenderer.invoke('device:info', serial),
  detectUsb: () => ipcRenderer.invoke('device:usb'),
  onDeviceConnected: (cb) => { ipcRenderer.on('device:connected', (_, d) => cb(d)); },
  onDeviceDisconnected: (cb) => { ipcRenderer.on('device:disconnected', (_, d) => cb(d)); },
  onDeviceInfo: (cb) => { ipcRenderer.on('device:info', (_, d) => cb(d)); },

  // ADB operations
  adb: {
    shell: (serial, cmd, timeout) => ipcRenderer.invoke('adb:shell', serial, cmd, timeout),
    security: (serial) => ipcRenderer.invoke('adb:security', serial),
    buildpropRead: (serial) => ipcRenderer.invoke('adb:buildpropRead', serial),
    buildpropWrite: (serial, key, val) => ipcRenderer.invoke('adb:buildpropWrite', serial, key, val),
    changeMac: (serial, mac) => ipcRenderer.invoke('adb:changeMac', serial, mac),
    cscInfo: (serial) => ipcRenderer.invoke('adb:cscInfo', serial),
    install: (serial, apkPath, opts) => ipcRenderer.invoke('adb:install', serial, apkPath, opts),
    uninstall: (serial, pkg, keepData) => ipcRenderer.invoke('adb:uninstall', serial, pkg, keepData),
    packages: (serial, flags) => ipcRenderer.invoke('adb:packages', serial, flags),
    disable: (serial, pkg) => ipcRenderer.invoke('adb:disable', serial, pkg),
    enable: (serial, pkg) => ipcRenderer.invoke('adb:enable', serial, pkg),
    forceStop: (serial, pkg) => ipcRenderer.invoke('adb:forceStop', serial, pkg),
    clearData: (serial, pkg) => ipcRenderer.invoke('adb:clearData', serial, pkg),
    screenshot: (serial) => ipcRenderer.invoke('adb:screenshot', serial),
    reboot: (serial, mode) => ipcRenderer.invoke('adb:reboot', serial, mode),
    wifi: (serial) => ipcRenderer.invoke('adb:wifi', serial),
    wifiConnect: (host) => ipcRenderer.invoke('adb:wifiConnect', host),
    readImei: (serial) => ipcRenderer.invoke('adb:readImei', serial),
    battery: (serial) => ipcRenderer.invoke('adb:battery', serial),
    storage: (serial) => ipcRenderer.invoke('adb:storage', serial),
    wipeData: (serial) => ipcRenderer.invoke('adb:wipeData', serial),
    backup: (serial, opts) => ipcRenderer.invoke('adb:backup', serial, opts),
  },

  // Fastboot
  fastboot: {
    devices: () => ipcRenderer.invoke('fastboot:devices'),
    info: (serial) => ipcRenderer.invoke('fastboot:info', serial),
    flash: (serial, partition, imagePath) => ipcRenderer.invoke('fastboot:flash', serial, partition, imagePath),
    erase: (serial, partition) => ipcRenderer.invoke('fastboot:erase', serial, partition),
    reboot: (serial, mode) => ipcRenderer.invoke('fastboot:reboot', serial, mode),
    unlock: (serial) => ipcRenderer.invoke('fastboot:unlock', serial),
    lock: (serial) => ipcRenderer.invoke('fastboot:lock', serial),
    wipe: (serial) => ipcRenderer.invoke('fastboot:wipe', serial),
  },

  // MTK
  mtk: {
    check: () => ipcRenderer.invoke('mtk:check'),
    info: () => ipcRenderer.invoke('mtk:info'),
    readPartition: (name, outPath) => ipcRenderer.invoke('mtk:readPartition', name, outPath),
    writePartition: (name, imgPath) => ipcRenderer.invoke('mtk:writePartition', name, imgPath),
    readFlash: (outPath) => ipcRenderer.invoke('mtk:readFlash', outPath),
    writeFlash: (imgPath) => ipcRenderer.invoke('mtk:writeFlash', imgPath),
    resetFrp: () => ipcRenderer.invoke('mtk:resetFrp'),
    wipe: () => ipcRenderer.invoke('mtk:wipe'),
    printGpt: () => ipcRenderer.invoke('mtk:printGpt'),
    unlockBootloader: () => ipcRenderer.invoke('mtk:unlockBootloader'),
    flashScatter: (scatterPath) => ipcRenderer.invoke('mtk:flashScatter', scatterPath),
  },

  // Qualcomm
  qc: {
    check: () => ipcRenderer.invoke('qc:check'),
    printGpt: () => ipcRenderer.invoke('qc:printGpt'),
    readPartition: (name, outPath) => ipcRenderer.invoke('qc:readPartition', name, outPath),
    writePartition: (name, imgPath) => ipcRenderer.invoke('qc:writePartition', name, imgPath),
    readEfs: (outPath) => ipcRenderer.invoke('qc:readEfs', outPath),
    writeEfs: (p1, p2) => ipcRenderer.invoke('qc:writeEfs', p1, p2),
    resetFrp: () => ipcRenderer.invoke('qc:resetFrp'),
    wipe: () => ipcRenderer.invoke('qc:wipe'),
    reboot: () => ipcRenderer.invoke('qc:reboot'),
    backupCritical: (dir) => ipcRenderer.invoke('qc:backupCritical', dir),
  },

  // Samsung
  samsung: {
    check: () => ipcRenderer.invoke('samsung:check'),
    detect: () => ipcRenderer.invoke('samsung:detect'),
    printPit: () => ipcRenderer.invoke('samsung:printPit'),
    flashFirmware: (files) => ipcRenderer.invoke('samsung:flashFirmware', files),
    flashPartition: (name, imgPath) => ipcRenderer.invoke('samsung:flashPartition', name, imgPath),
    resetFrp: (serial) => ipcRenderer.invoke('samsung:resetFrp', serial),
    info: (serial) => ipcRenderer.invoke('samsung:info', serial),
    rebootToDownload: (serial) => ipcRenderer.invoke('samsung:rebootToDownload', serial),
    searchFw: (model, region) => ipcRenderer.invoke('samsung:searchFw', model, region),
    changeCsc: (serial, csc) => ipcRenderer.invoke('samsung:changeCsc', serial, csc),
  },

  // FRP
  frp: {
    listMethods: () => ipcRenderer.invoke('frp:listMethods'),
    run: (methodId, serial, opts) => ipcRenderer.invoke('frp:run', methodId, serial, opts),
    checkStatus: (serial) => ipcRenderer.invoke('frp:checkStatus', serial),
    instructions: (type) => ipcRenderer.invoke('frp:instructions', type),
  },

  // Firmware
  firmware: {
    search: (brand, model, region) => ipcRenderer.invoke('firmware:search', brand, model, region),
    download: (url, destPath) => ipcRenderer.invoke('firmware:download', url, destPath),
    extract: (zipPath, destDir) => ipcRenderer.invoke('firmware:extract', zipPath, destDir),
    verify: (filePath) => ipcRenderer.invoke('firmware:verify', filePath),
  },

  // Advanced (gated)
  advanced: {
    isEnabled: () => ipcRenderer.invoke('advanced:isEnabled'),
    mtkWriteImei: (i1, i2) => ipcRenderer.invoke('advanced:mtkWriteImei', i1, i2),
    qcWriteImei: (i1, i2) => ipcRenderer.invoke('advanced:qcWriteImei', i1, i2),
    samsungWriteImei: (serial, i1, i2) => ipcRenderer.invoke('advanced:samsungWriteImei', serial, i1, i2),
    generateUnlockCode: (imei, algo) => ipcRenderer.invoke('advanced:generateUnlockCode', imei, algo),
    miAccountRemove: (serial) => ipcRenderer.invoke('advanced:miAccountRemove', serial),
    huaweiIdRemove: (serial) => ipcRenderer.invoke('advanced:huaweiIdRemove', serial),
    mtkFrpBypass: () => ipcRenderer.invoke('advanced:mtkFrpBypass'),
    qcFrpBypass: () => ipcRenderer.invoke('advanced:qcFrpBypass'),
  },

  // Mirror (scrcpy)
  mirror: {
    start: (serial, opts) => ipcRenderer.invoke('mirror:start', serial, opts),
    stop: () => ipcRenderer.invoke('mirror:stop'),
  },

  // Licencia
  license: {
    check: () => ipcRenderer.invoke('license:check'),
    grace: () => ipcRenderer.invoke('license:grace'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    deactivate: () => ipcRenderer.invoke('license:deactivate'),
  },

  // Co-Pilot IA
  copilot: {
    check: () => ipcRenderer.invoke('copilot:check'),
    models: () => ipcRenderer.invoke('copilot:models'),
    prompts: () => ipcRenderer.invoke('copilot:prompts'),
    chat: (opts) => ipcRenderer.invoke('copilot:chat', opts),
    abort: () => ipcRenderer.invoke('copilot:abort'),
    onToken: (cb) => ipcRenderer.on('copilot:token', (_, t) => cb(t)),
    offToken: () => ipcRenderer.removeAllListeners('copilot:token'),
  },

  // History
  history: {
    get: (limit) => ipcRenderer.invoke('history:get', limit),
    log: (op) => ipcRenderer.invoke('history:log', op),
  },

  // CRM
  crm: {
    clients: (search) => ipcRenderer.invoke('crm:clients', search),
    client: (id) => ipcRenderer.invoke('crm:client', id),
    upsertClient: (data) => ipcRenderer.invoke('crm:upsertClient', data),
    deleteClient: (id) => ipcRenderer.invoke('crm:deleteClient', id),
    repairs: (clientId) => ipcRenderer.invoke('crm:repairs', clientId),
    repair: (id) => ipcRenderer.invoke('crm:repair', id),
    upsertRepair: (data) => ipcRenderer.invoke('crm:upsertRepair', data),
    stats: () => ipcRenderer.invoke('crm:stats'),
  },

  // Utilidades
  util: {
    hashFile: (filePath, algo) => ipcRenderer.invoke('util:hashFile', filePath, algo),
  },

  // Logcat
  logcat: {
    start: (serial, level, tag, pkg) => ipcRenderer.invoke('adb:logcatStart', serial, level, tag, pkg),
    stop: () => ipcRenderer.invoke('adb:logcatStop'),
    onLine: (cb) => ipcRenderer.on('logcat:line', (_, l) => cb(l)),
    offLine: () => ipcRenderer.removeAllListeners('logcat:line'),
  },

  // Mantenimiento
  maint: {
    clearLogs:        (s)          => ipcRenderer.invoke('maint:clearLogs', s),
    clearTemp:        (s)          => ipcRenderer.invoke('maint:clearTemp', s),
    clearAppCache:    (s, pkg)     => ipcRenderer.invoke('maint:clearAppCache', s, pkg),
    clearAllCache:    (s)          => ipcRenderer.invoke('maint:clearAllCache', s),
    clearDalvik:      (s)          => ipcRenderer.invoke('maint:clearDalvik', s),
    resetBattery:     (s)          => ipcRenderer.invoke('maint:resetBattery', s),
    listSystemApps:   (s)          => ipcRenderer.invoke('maint:listSystemApps', s),
    listUserApps:     (s)          => ipcRenderer.invoke('maint:listUserApps', s),
    disableApp:       (s, pkg)     => ipcRenderer.invoke('maint:disableApp', s, pkg),
    enableApp:        (s, pkg)     => ipcRenderer.invoke('maint:enableApp', s, pkg),
    batchDisable:     (s, pkgs)    => ipcRenderer.invoke('maint:batchDisable', s, pkgs),
    batchUninstall:   (s, pkgs)    => ipcRenderer.invoke('maint:batchUninstall', s, pkgs),
    killBg:           (s)          => ipcRenderer.invoke('maint:killBg', s),
    forceStop:        (s, pkg)     => ipcRenderer.invoke('maint:forceStop', s, pkg),
    runningApps:      (s)          => ipcRenderer.invoke('maint:runningApps', s),
    permissions:      (s, pkg)     => ipcRenderer.invoke('maint:permissions', s, pkg),
    revoke:           (s, pkg, p)  => ipcRenderer.invoke('maint:revoke', s, pkg, p),
    grant:            (s, pkg, p)  => ipcRenderer.invoke('maint:grant', s, pkg, p),
    setAnimations:    (s, sc)      => ipcRenderer.invoke('maint:setAnimations', s, sc),
    getAnimations:    (s)          => ipcRenderer.invoke('maint:getAnimations', s),
    setPerfMode:      (s, mode)    => ipcRenderer.invoke('maint:setPerfMode', s, mode),
    disableTelemetry: (s)          => ipcRenderer.invoke('maint:disableTelemetry', s),
    fixClock:         (s)          => ipcRenderer.invoke('maint:fixClock', s),
    wifi:             (s, on)      => ipcRenderer.invoke('maint:wifi', s, on),
    bluetooth:        (s, on)      => ipcRenderer.invoke('maint:bluetooth', s, on),
    airplane:         (s, on)      => ipcRenderer.invoke('maint:airplane', s, on),
    devOptions:       (s, on)      => ipcRenderer.invoke('maint:devOptions', s, on),
    safeMode:         (s)          => ipcRenderer.invoke('maint:safeMode', s),
    resetNetwork:     (s)          => ipcRenderer.invoke('maint:resetNetwork', s),
    setDns:           (s, d1, d2)  => ipcRenderer.invoke('maint:setDns', s, d1, d2),
    resetPassword:    (s)          => ipcRenderer.invoke('maint:resetPassword', s),
    report:           (s)          => ipcRenderer.invoke('maint:report', s),
    snapshot:         (s)          => ipcRenderer.invoke('maint:snapshot', s),
    bloatPreset:      (brand)      => ipcRenderer.invoke('maint:bloatPreset', brand),
    runFull:          (s, opts)    => ipcRenderer.invoke('maint:runFull', s, opts),
  },

  // File pickers
  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),

  // Stream output
  onStream: (cb) => { ipcRenderer.on('stream:data', (_, d) => cb(d)); },
  onStreamDone: (cb) => { ipcRenderer.on('stream:done', (_, d) => cb(d)); },

  // Log
  onLog: (cb) => { ipcRenderer.on('log:entry', (_, e) => cb(e)); },
});
