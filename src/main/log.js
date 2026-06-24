'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let _win = null;
let _file = null;

function init(win) {
  _win = win;
  const dir = path.join(app.getPath('userData'), 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _file = path.join(dir, 'optigsm-' + ts + '.log');
}

function write(level, msg, extra) {
  const ts = new Date().toISOString();
  const line = '[' + ts + '] [' + level.toUpperCase().padEnd(5) + '] ' + msg + (extra ? ' | ' + JSON.stringify(extra) : '');
  if (_file) { try { fs.appendFileSync(_file, line + '\n'); } catch (_) {} }
  if (_win && !_win.isDestroyed()) {
    try { _win.webContents.send('log:entry', { ts, level, msg, extra }); } catch (_) {}
  }
  if (level === 'error') process.stderr.write(line + '\n');
}

const log = {
  init,
  info:  (m, e) => write('info',  m, e),
  warn:  (m, e) => write('warn',  m, e),
  error: (m, e) => write('error', m, e),
  ok:    (m, e) => write('ok',    m, e),
  debug: (m, e) => { if (process.env.DEBUG) write('debug', m, e); },
  getFile: () => _file,
};

module.exports = log;
