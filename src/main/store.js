'use strict';
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let dbPath = '';

async function init() {
  const dir = path.join(app.getPath('userData'), 'data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  dbPath = path.join(dir, 'optigsm.sqlite');

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      platform TEXT, model TEXT, imei TEXT, operation TEXT, result TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT UNIQUE, model TEXT, brand TEXT, chipset TEXT, android TEXT,
      first_seen TEXT, last_seen TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS firmware_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT, model TEXT, version TEXT, region TEXT, url TEXT,
      size INTEGER, hash TEXT, ts TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `);

  const defaults = { advancedMode: '0', theme: 'dark', adbPath: '', pythonPath: '', autoDetect: '1', logLevel: 'info' };
  for (const [k, v] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', [k, v]);
  }
  save();
}

function save() {
  if (!db || !dbPath) return;
  try { fs.writeFileSync(dbPath, Buffer.from(db.export())); } catch (_) {}
}

function queryAll(sql, params = []) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (_) { return []; }
}

function queryOne(sql, params = []) { return queryAll(sql, params)[0] || null; }

function run(sql, params = []) {
  if (!db) return;
  db.run(sql, params);
  save();
}

function getSetting(key, def = '') {
  const r = queryOne('SELECT value FROM settings WHERE key=?', [key]);
  return r ? r.value : def;
}
function setSetting(key, value) { run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', [key, String(value)]); }
function getAllSettings() {
  return Object.fromEntries(queryAll('SELECT key,value FROM settings').map(r => [r.key, r.value]));
}

function logOperation(op) {
  run('INSERT INTO operations(ts,platform,model,imei,operation,result,notes) VALUES(?,?,?,?,?,?,?)',
    [new Date().toISOString(), op.platform||'', op.model||'', op.imei||'', op.operation||'', op.result||'', op.notes||'']);
}
function getOperations(limit = 200) { return queryAll('SELECT * FROM operations ORDER BY id DESC LIMIT ?', [limit]); }

function upsertDevice(d) {
  if (!d || !d.serial) return;
  const now = new Date().toISOString();
  if (queryOne('SELECT id FROM devices WHERE serial=?', [d.serial])) {
    run('UPDATE devices SET model=?,brand=?,chipset=?,android=?,last_seen=? WHERE serial=?',
      [d.model||'', d.brand||'', d.chipset||d.cpu||'', d.android||'', now, d.serial]);
  } else {
    run('INSERT INTO devices(serial,model,brand,chipset,android,first_seen,last_seen) VALUES(?,?,?,?,?,?,?)',
      [d.serial, d.model||'', d.brand||'', d.chipset||d.cpu||'', d.android||'', now, now]);
  }
}
function getDevices() { return queryAll('SELECT * FROM devices ORDER BY last_seen DESC'); }

function cacheFirmware(f) {
  run('INSERT OR REPLACE INTO firmware_cache(brand,model,version,region,url,size,hash,ts) VALUES(?,?,?,?,?,?,?,?)',
    [f.brand||'', f.model||'', f.version||'', f.region||'', f.url||'', f.size||0, f.hash||'', new Date().toISOString()]);
}
function getFirmwareCache(brand, model) {
  return queryAll('SELECT * FROM firmware_cache WHERE brand=? AND model=? ORDER BY ts DESC', [brand, model]);
}

module.exports = { init, getSetting, setSetting, getAllSettings, logOperation, getOperations, upsertDevice, getDevices, cacheFirmware, getFirmwareCache };
