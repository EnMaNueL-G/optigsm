'use strict';
const { execFile } = require('child_process');
const adb = require('./adb');

let _win = null;
let _timer = null;
let _lastDevices = [];

function setWindow(win) { _win = win; }

function emit(event, data) {
  if (_win && !_win.isDestroyed()) {
    try { _win.webContents.send(event, data); } catch (_) {}
  }
}

async function scanAll() {
  const adbList = await adb.adbDevices().catch(() => []);
  const fbList  = await adb.fastbootDevices().catch(() => []);

  const current = [
    ...adbList.map(d => ({ ...d, mode: d.state === 'device' ? 'adb' : d.state })),
    ...fbList,
  ];

  // detect connect / disconnect
  const prevIds = new Set(_lastDevices.map(d => d.serial));
  const currIds = new Set(current.map(d => d.serial));

  for (const d of current) {
    if (!prevIds.has(d.serial)) {
      emit('device:connected', d);
      // fetch full info for ADB devices
      if (d.mode === 'adb') {
        adb.deviceInfo(d.serial).then(info => {
          emit('device:info', { ...d, ...info });
        }).catch(() => {});
      }
    }
  }
  for (const d of _lastDevices) {
    if (!currIds.has(d.serial)) {
      emit('device:disconnected', d);
    }
  }

  _lastDevices = current;
  return current;
}

function startPolling(intervalMs = 2000) {
  if (_timer) return;
  scanAll(); // immediate
  _timer = setInterval(() => scanAll(), intervalMs);
}

function stopPolling() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

function currentDevices() { return _lastDevices; }

// Detect device by USB VID/PID using PowerShell (Windows)
async function detectUsbDevices() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command',
      'Get-PnpDevice -PresentOnly | Where-Object {$_.FriendlyName -like "*Android*" -or $_.FriendlyName -like "*MediaTek*" -or $_.FriendlyName -like "*Qualcomm*"} | Select-Object FriendlyName,Status,DeviceID | ConvertTo-Json'
    ], { timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        let data = JSON.parse(stdout);
        if (!Array.isArray(data)) data = [data];
        resolve(data.map(d => ({ name: d.FriendlyName, status: d.Status, id: d.DeviceID })));
      } catch (_) { resolve([]); }
    });
  });
}

// Identify platform from device info
function identifyPlatform(info) {
  const cpu = (info.cpu || info.chipset || '').toLowerCase();
  const model = (info.model || '').toLowerCase();
  if (/mt\d{4}|mediatek|helio|dimensity/.test(cpu)) return 'MTK';
  if (/msm|sm-\d|snapdragon|qualcomm|qcom/.test(cpu)) return 'QCOM';
  if (/exynos/.test(cpu)) return 'SAMSUNG';
  if (/kirin|hisilicon/.test(cpu)) return 'HUAWEI';
  if (/unisoc|spreadtrum|sprd|sc\d{4}/.test(cpu)) return 'UNISOC';
  if (/google|tensor/.test(cpu)) return 'QCOM';
  return 'UNKNOWN';
}

module.exports = { setWindow, scanAll, startPolling, stopPolling, currentDevices, detectUsbDevices, identifyPlatform };
