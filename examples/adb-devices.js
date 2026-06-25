'use strict';
/**
 * OptiGSM - ejemplo basico: listar dispositivos ADB.
 * Requiere: Node.js 18+ y ADB en PATH.
 * Uso: node examples/adb-devices.js
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const ADB = 'adb';

async function getDevices() {
  const { stdout } = await exec(ADB, ['devices', '-l']);
  return stdout.trim().split('\n').slice(1)
    .filter(l => l.includes('device') && !l.includes('offline'))
    .map(l => {
      const [serial, , ...rest] = l.trim().split(/\s+/);
      const info = Object.fromEntries(rest.filter(r => r.includes(':')).map(r => r.split(':')));
      return { serial, model: info.model || 'unknown' };
    });
}

async function shell(serial, cmd) {
  const { stdout } = await exec(ADB, ['-s', serial, 'shell', cmd]);
  return stdout.trim();
}

(async () => {
  console.log('Searching for ADB devices...\n');
  const devices = await getDevices();
  if (!devices.length) {
    console.log('No devices found. Connect an Android device with USB debugging enabled.');
    return;
  }
  for (const dev of devices) {
    const [android, model, brand] = await Promise.all([
      shell(dev.serial, 'getprop ro.build.version.release'),
      shell(dev.serial, 'getprop ro.product.model'),
      shell(dev.serial, 'getprop ro.product.brand'),
    ]);
    console.log(`Serial : ${dev.serial}`);
    console.log(`Model  : ${brand} ${model}`);
    console.log(`Android: ${android}\n`);
  }
})().catch(e => console.error('Error:', e.message));
