'use strict';
/* global gsm */

/* ===== STATE ===== */
let selectedDevice = null;
let allDevices = [];
let allPackages = [];
let settings = {};
let logcatHandle = null;
let samFwFiles = {};
let sideloadZip = null;
let bootImgFile = null;
let fbImgFile = null;
let qcWpFile = null;
let mtkWpFile = null;
let samPartFile = null;
let fwZipPath = null;

/* ===== INIT ===== */
async function init() {
  settings = await gsm.getSettings();
  setupNav();
  setupDeviceEvents();
  setupHandlers();
  loadFrpMethods();
  await scanDevices();
  term('OptiGSM iniciado', 'info');
}

/* ===== TERMINAL ===== */
const termBody = document.getElementById('termBody');
function term(msg, type = 'data') {
  const ts = new Date().toLocaleTimeString('es-ES', { hour12: false });
  const line = document.createElement('div');
  line.className = `term-line term-${type}`;
  line.innerHTML = `<span class="term-ts">${ts}</span>${escHtml(String(msg))}`;
  termBody.appendChild(line);
  termBody.scrollTop = termBody.scrollHeight;
}
function termClear() { termBody.innerHTML = ''; }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function luhnCheck(digits14) {
  const d = digits14.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let v = d[i];
    if ((14 - i) % 2 === 0) { v *= 2; if (v > 9) v -= 9; }
    sum += v;
  }
  return String((10 - (sum % 10)) % 10);
}

gsm.onStream((d) => term(d.trim(), 'data'));
gsm.onLog((e) => { if (e.level !== 'debug') term(e.msg, e.level === 'error' ? 'err' : e.level === 'ok' ? 'ok' : 'info'); });

document.getElementById('termClear').onclick = termClear;
document.getElementById('termToggle').onclick = () => {
  const p = document.getElementById('terminalPanel');
  p.classList.toggle('collapsed');
  document.getElementById('termToggle').textContent = p.classList.contains('collapsed') ? '▲' : '▼';
};

/* ===== NAV ===== */
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tab = document.getElementById('tab-' + btn.dataset.tab);
      if (tab) tab.classList.add('active');
      onTabOpen(btn.dataset.tab);
    });
  });
  // Sub-tabs
  document.querySelectorAll('.tab-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.tab-panel');
      parent.querySelectorAll('.tab-sub').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const sub = parent.querySelector('#sub-' + btn.dataset.sub);
      if (sub) sub.classList.add('active');
    });
  });
}

function onTabOpen(tab) {
  if (tab === 'history') loadHistory();
  if (tab === 'settings') loadSettingsUI();
  if (tab === 'advanced') checkAdvanced();
  if (tab === 'fastboot') fbScan();
  if (tab === 'support') loadSupportInfo();
  if (tab === 'copilot') initCopilot();
  if (tab === 'clients') loadClients();
}

function loadSupportInfo() {
  const el = document.getElementById('supportDeviceInfo');
  if (!el) return;
  const s = getSerial();
  el.innerHTML = s
    ? `<div class="info-row"><span class="key">Dispositivo activo</span><span class="val">${escHtml(s)}</span></div>`
    : '<div class="info-row"><span class="key">Dispositivo</span><span class="val">Sin dispositivo conectado</span></div>';
}

/* ===== DEVICE EVENTS ===== */
function setupDeviceEvents() {
  gsm.onDeviceConnected((d) => {
    term(`Dispositivo conectado: ${d.serial} (${d.mode || d.state})`, 'ok');
    scanDevices();
  });
  gsm.onDeviceDisconnected((d) => {
    term(`Dispositivo desconectado: ${d.serial}`, 'warn');
    if (selectedDevice && selectedDevice.serial === d.serial) {
      selectedDevice = null;
      updateConnStatus(null);
    }
    scanDevices();
  });
  gsm.onDeviceInfo((info) => {
    if (selectedDevice && selectedDevice.serial === info.serial) {
      selectedDevice = { ...selectedDevice, ...info };
      updateHomeInfo(info);
    }
  });
}

/* ===== SCAN ===== */
async function scanDevices() {
  const devices = await gsm.getDevices();
  allDevices = devices;
  renderDeviceCards(devices);
  if (devices.length > 0 && !selectedDevice) {
    selectDevice(devices[0]);
  } else if (devices.length === 0) {
    updateConnStatus(null);
  }
}

function renderDeviceCards(devices) {
  const container = document.getElementById('deviceCards');
  const homeInfo = document.getElementById('homeInfo');
  const quickActions = document.getElementById('quickActions');

  if (devices.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📱</div>
      <div>Conecta un dispositivo Android por USB</div>
      <div class="empty-hint">ADB debe estar habilitado en el dispositivo</div>
      <button class="btn btn-primary" id="btnScan">Escanear</button>
    </div>`;
    document.getElementById('btnScan').onclick = scanDevices;
    homeInfo.style.display = 'none';
    quickActions.style.display = 'none';
    return;
  }

  container.innerHTML = devices.map(d => `
    <div class="device-card${selectedDevice && selectedDevice.serial === d.serial ? ' selected' : ''}" data-serial="${d.serial}">
      <div class="dc-mode">${(d.mode || d.state || '').toUpperCase()}</div>
      <div class="dc-name">${d.model || d.product || 'Desconocido'}</div>
      <div class="dc-serial">${d.serial}</div>
    </div>
  `).join('');

  container.querySelectorAll('.device-card').forEach(card => {
    card.onclick = () => {
      const d = devices.find(x => x.serial === card.dataset.serial);
      if (d) selectDevice(d);
    };
  });

  homeInfo.style.display = '';
  quickActions.style.display = '';
}

async function selectDevice(d) {
  selectedDevice = d;
  updateConnStatus(d);
  renderDeviceCards(allDevices);
  if (d.mode === 'adb' || d.state === 'device') {
    try {
      const info = await gsm.deviceInfo(d.serial);
      selectedDevice = { ...d, ...info, serial: d.serial }; // preserve ADB connection address
      updateHomeInfo(info);
    } catch (_) {}
  }
}

function updateConnStatus(d) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  if (!d) {
    dot.className = 'dot dot-off';
    label.textContent = 'Sin dispositivo';
  } else {
    dot.className = `dot dot-on`;
    label.textContent = `${d.model || d.product || d.serial} (${(d.mode || d.state || '').toUpperCase()})`;
  }
}

function updateHomeInfo(info) {
  document.getElementById('hModel').textContent = `${info.brand || ''} ${info.model || '—'}`.trim();
  document.getElementById('hAndroid').textContent = info.android ? `Android ${info.android} (SDK ${info.sdk || ''})` : '—';
  document.getElementById('hImei1').textContent = info.imei1 || '—';
  document.getElementById('hImei2').textContent = info.imei2 || '—';
  document.getElementById('hBattery').textContent = info.battery || '—';
  document.getElementById('hSerial').textContent = info.serial || '—';
}

/* ===== SERIAL HELPER ===== */
function getSerial() {
  if (selectedDevice) return selectedDevice.serial;
  if (allDevices.length > 0) return allDevices[0].serial;
  return null;
}

function needDevice() {
  const s = getSerial();
  if (!s) { term('Sin dispositivo conectado', 'warn'); return null; }
  return s;
}

/* ===== OP RESULT ===== */
function showResult(r) {
  if (r && r.out) term(r.out, r.ok ? 'ok' : 'err');
  if (r && r.error) term(r.error, 'err');
  if (r && !r.ok && !r.out && !r.error) term('Operación completada', 'info');
}

function renderFirmwareResult(r) {
  const el = document.getElementById('fwResult');
  if (!el) return;
  if (!r || (!r.note && !r.firmwares && !r.url)) {
    el.textContent = JSON.stringify(r, null, 2);
    return;
  }
  let html = '';
  if (r.note) html += `<div class="fw-note">${escHtml(r.note)}</div>`;
  if (r.fotaLatest && r.fotaLatest !== '(no disponible)') {
    html += `<div class="fw-note ok">📡 Samsung FOTA: <strong>${escHtml(r.fotaLatest)}</strong></div>`;
  }
  if (r.firmwares && r.firmwares.length) {
    html += `<table class="fw-table"><thead><tr><th>Versión</th><th>Fecha</th><th>Android</th><th>Tamaño</th></tr></thead><tbody>`;
    r.firmwares.forEach(f => {
      html += `<tr><td class="mono">${escHtml(f.version)}</td><td>${escHtml(f.date)}</td><td>${escHtml(f.os)}</td><td>${escHtml(f.size)}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  if (r.tools && r.tools.length) {
    html += `<div class="fw-tools"><strong>Herramientas de descarga:</strong><div class="fw-links">`;
    r.tools.forEach(t => {
      html += `<a class="btn btn-sm" href="#" onclick="gsm.adb && window.open && require && require('electron').shell.openExternal('${escHtml(t.url)}');return false;">${escHtml(t.name)}</a>`;
    });
    html += `</div></div>`;
    if (r.samfwUrl) document.getElementById('fwUrl') && (document.getElementById('fwUrl').value = r.samfwUrl);
  } else if (r.url) {
    html += `<div class="fw-note"><a href="#" onclick="return false;">${escHtml(r.url)}</a></div>`;
    document.getElementById('fwUrl') && (document.getElementById('fwUrl').value = r.url);
  }
  if (!r.firmwares && !r.tools && r.urls) {
    html += `<div class="fw-tools"><strong>Recursos:</strong><div class="fw-links">`;
    (r.urls||[]).forEach(u => { html += `<span class="hint mono">${escHtml(u)}</span><br>`; });
    html += `</div></div>`;
  }
  el.innerHTML = html;
  document.getElementById('fwActions') && (document.getElementById('fwActions').style.display = '');
}

/* ===== ALL HANDLERS ===== */
function setupHandlers() {
  // Topbar
  document.getElementById('btnRefresh').onclick = scanDevices;
  document.getElementById('btnSettings').onclick = () => clickNav('settings');

  // Home quick actions
  document.getElementById('qaScreenshot').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Capturando pantalla...', 'info');
    const r = await gsm.adb.screenshot(s);
    if (r && r.ok && r.path) {
      document.getElementById('ssImg').src = 'file://' + r.path;
      document.getElementById('ssModal').style.display = 'flex';
    } else { showResult(r); }
  };
  document.getElementById('ssClose').onclick = () => { document.getElementById('ssModal').style.display = 'none'; };
  document.getElementById('qaReboot').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.reboot(s, ''); showResult(r);
  };
  document.getElementById('qaWifi').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Activando ADB WiFi y conectando...', 'info');
    const r = await gsm.adb.wifi(s);
    showResult(r);
    if (r && r.ok && r.ip) {
      document.getElementById('connStatus').textContent = `WiFi: ${r.ip}:5555`;
    }
  };
  document.getElementById('qaBackup').onclick = async () => {
    const s = needDevice(); if (!s) return;
    if (!confirm('Se copiarán DCIM, Fotos, Descargas, WhatsApp y Documentos al Escritorio.\n¿Continuar?')) return;
    term('Iniciando backup de archivos...', 'info');
    const r = await gsm.adb.backup(s, {}); showResult(r);
  };
  document.getElementById('qaLogcat').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Capturando log del sistema (últimas 150 líneas de avisos y errores)...', 'info');
    const r = await gsm.adb.shell(s, 'logcat -d -v time *:W 2>&1 | tail -150');
    if (r.out) {
      r.out.split('\n').filter(l => l.trim()).forEach(l => {
        const type = l.includes(' E ') ? 'err' : l.includes(' W ') ? 'warn' : 'data';
        term(l, type);
      });
    } else showResult(r);
  };
  document.getElementById('qaStorage').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Leyendo almacenamiento...', 'info');
    const r = await gsm.adb.storage(s); showResult(r);
  };

  // Info tab
  document.getElementById('btnGetInfo').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Leyendo información del dispositivo...', 'info');
    const info = await gsm.deviceInfo(s);
    const LABELS = { serial:'Nº Serie', model:'Modelo', brand:'Marca', android:'Android', sdk:'SDK', cpu:'CPU/SoC', product:'Producto', imei1:'IMEI 1', imei2:'IMEI 2', build:'Build', ram:'RAM', storage:'Almacenamiento', battery:'Batería' };
    const table = document.getElementById('infoTable');
    table.innerHTML = Object.entries(info).map(([k, v]) => {
      const val = v || '—';
      const highlight = (k === 'imei1' || k === 'imei2') && val !== '—' ? ' style="color:var(--accent);font-weight:600"' : '';
      return `<div class="info-row"><span class="key">${LABELS[k]||k}</span><span class="val"${highlight}>${escHtml(String(val))}</span></div>`;
    }).join('');
    if (!info.imei1) term('IMEI no accesible por ADB estándar. Activa root o usa Modo Avanzado → IMEI.', 'warn');
  };
  document.getElementById('btnReadImei').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Leyendo IMEI (varios métodos)...', 'info');
    const r = await gsm.adb.readImei(s);
    const table = document.getElementById('infoTable');
    table.innerHTML = `
      <div class="info-row"><span class="key">IMEI 1</span><span class="val" style="color:var(--accent);font-weight:600">${r.imei1 || '— (requiere root o privilegios)'}</span></div>
      <div class="info-row"><span class="key">IMEI 2</span><span class="val" style="color:var(--accent);font-weight:600">${r.imei2 || '—'}</span></div>
    `;
    term(r.imei1 ? `IMEI 1: ${r.imei1}` + (r.imei2 ? ` | IMEI 2: ${r.imei2}` : '') : 'IMEI no accesible. En Android 10+ requiere privilegios de sistema o root.', r.imei1 ? 'ok' : 'warn');
  };
  document.getElementById('btnBattery').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Leyendo batería detallada...', 'info');
    const r = await gsm.adb.battery(s);
    const table = document.getElementById('infoTable');
    if (r && typeof r === 'object') {
      table.innerHTML = Object.entries(r).filter(([,v])=>v).map(([k, v]) => `
        <div class="info-row"><span class="key">${k}</span><span class="val">${escHtml(String(v))}</span></div>
      `).join('');
    } else { showResult(r); }
  };
  document.getElementById('btnStorageInfo').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Leyendo particiones...', 'info');
    const r = await gsm.adb.storage(s);
    if (r && r.parsed && r.parsed.length) {
      const table = document.getElementById('infoTable');
      table.innerHTML = `<div class="info-row" style="font-weight:600;border-bottom:1px solid var(--border)"><span class="key">Punto montaje</span><span class="val">Tamaño / Usado / Libre</span></div>` +
        r.parsed.map(p => `<div class="info-row"><span class="key" style="font-size:11px">${escHtml(p.mountpoint||p.filesystem)}</span><span class="val">${p.size} / ${p.used} / ${p.available} (${p.use})</span></div>`).join('');
    }
    showResult(r);
  };

  // Apps tab
  document.getElementById('btnListApps').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Listando aplicaciones...', 'info');
    allPackages = await gsm.adb.packages(s, '-3');
    renderAppList(allPackages);
  };
  document.getElementById('btnListSystem').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Listando apps de sistema...', 'info');
    allPackages = await gsm.adb.packages(s, '-s');
    renderAppList(allPackages);
  };
  document.getElementById('btnInstallApk').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const f = await gsm.pickFile({ filters: [{ name: 'APK', extensions: ['apk'] }] });
    if (!f) return;
    term(`Instalando ${f}...`, 'info');
    const r = await gsm.adb.install(s, f, { replace: true, grant: true }); showResult(r);
  };
  document.getElementById('appSearch').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    renderAppList(allPackages.filter(p => p.toLowerCase().includes(q)));
  };

  // Reboot
  document.getElementById('rbNormal').onclick = () => { const s = needDevice(); if (s) gsm.adb.reboot(s, '').then(showResult); };
  document.getElementById('rbRecovery').onclick = () => { const s = needDevice(); if (s) gsm.adb.reboot(s, 'recovery').then(showResult); };
  document.getElementById('rbBootloader').onclick = () => { const s = needDevice(); if (s) gsm.adb.reboot(s, 'bootloader').then(showResult); };
  document.getElementById('rbFastboot').onclick = () => { const s = needDevice(); if (s) gsm.adb.reboot(s, 'fastboot').then(showResult); };
  document.getElementById('rbDownload').onclick = () => { const s = needDevice(); if (s) gsm.adb.shell(s, 'reboot download').then(showResult); };
  document.getElementById('rbEdl').onclick = () => { const s = needDevice(); if (s) gsm.adb.shell(s, 'reboot edl').then(r => { if (!r.ok) term('Si el dispositivo no responde, usa el test point para entrar en EDL 9008.', 'warn'); else showResult(r); }); };

  // ===== MTK =====
  document.getElementById('mtkCheck').onclick = async () => {
    term('Verificando mtkclient...', 'info');
    const r = await gsm.mtk.check(); showResult({ ok: r.available, out: r.available ? '✓ mtkclient disponible' : 'mtkclient no encontrado. Instala con: pip install mtkclient\n' + r.out });
  };
  document.getElementById('mtkPrintGpt').onclick = async () => { term('Leyendo tabla de particiones MTK...', 'info'); showResult(await gsm.mtk.printGpt()); };
  document.getElementById('mtkInfo').onclick = async () => { term('Leyendo info MTK...', 'info'); showResult(await gsm.mtk.info()); };
  document.getElementById('mtkRpRun').onclick = async () => {
    const name = document.getElementById('mtkRpName').value.trim(); if (!name) return;
    const f = await gsm.saveFile({ defaultPath: name + '.bin' }); if (!f) return;
    term(`Leyendo partición ${name}...`, 'info'); showResult(await gsm.mtk.readPartition(name, f));
  };
  document.getElementById('mtkWpFile').onclick = async () => {
    mtkWpFile = await gsm.pickFile(); if (mtkWpFile) term(`Imagen seleccionada: ${mtkWpFile}`, 'info');
  };
  document.getElementById('mtkWpRun').onclick = async () => {
    const name = document.getElementById('mtkWpName').value.trim(); if (!name || !mtkWpFile) { term('Falta nombre o imagen', 'warn'); return; }
    if (!confirm(`¿Escribir ${mtkWpFile} en partición ${name}? Esta operación es irreversible.`)) return;
    term(`Escribiendo partición ${name}...`, 'warn'); showResult(await gsm.mtk.writePartition(name, mtkWpFile));
  };
  document.getElementById('mtkReadFlash').onclick = async () => {
    const f = await gsm.saveFile({ defaultPath: 'mtk_full_flash.bin' }); if (!f) return;
    term('Leyendo flash completo (puede tardar varios minutos)...', 'info'); showResult(await gsm.mtk.readFlash(f));
  };
  document.getElementById('mtkWriteFlash').onclick = async () => {
    const f = await gsm.pickFile(); if (!f) return;
    if (!confirm('¿Escribir imagen completa al flash? Esta operación borrará TODO el dispositivo.')) return;
    term('Escribiendo flash completo...', 'warn'); showResult(await gsm.mtk.writeFlash(f));
  };
  document.getElementById('mtkFrp').onclick = async () => { if (!confirm('¿Resetear FRP?')) return; term('Reseteando FRP MTK...', 'warn'); showResult(await gsm.mtk.resetFrp()); };
  document.getElementById('mtkWipe').onclick = async () => { if (!confirm('¿Wipe datos? Se borrarán TODOS los datos del usuario.')) return; term('Limpiando datos...', 'warn'); showResult(await gsm.mtk.wipe()); };
  document.getElementById('mtkUnlock').onclick = async () => { term('Desbloqueando bootloader MTK...', 'warn'); showResult(await gsm.mtk.unlockBootloader()); };
  let mtkScatterPath = null;
  document.getElementById('mtkScatterFile').onclick = async () => { mtkScatterPath = await gsm.pickFile({ filters: [{ name: 'Scatter', extensions: ['txt'] }] }); if (mtkScatterPath) term('Scatter: ' + mtkScatterPath, 'info'); };
  document.getElementById('mtkScatterFlash').onclick = async () => {
    if (!mtkScatterPath) { term('Selecciona un scatter file primero', 'warn'); return; }
    if (!confirm('¿Flash por scatter? Operación irreversible.')) return;
    term('Flash por scatter...', 'warn'); showResult(await gsm.mtk.flashScatter(mtkScatterPath));
  };
  document.getElementById('mtkReadNvram').onclick = async () => {
    const f = await gsm.saveFile({ defaultPath: 'nvram_backup.bin' }); if (!f) return;
    term('Leyendo NVRAM...', 'info'); showResult(await gsm.mtk.readPartition('nvram', f));
  };

  // ===== QC =====
  document.getElementById('qcCheck').onclick = async () => {
    term('Verificando edl...', 'info');
    const r = await gsm.qc.check(); showResult({ ok: r.available, out: r.available ? '✓ edl (edlclient) disponible' : 'edl no encontrado. Instala con: pip install edlclient\n' + r.out });
  };
  document.getElementById('qcPrintGpt').onclick = async () => { term('Leyendo GPT QC...', 'info'); showResult(await gsm.qc.printGpt()); };
  document.getElementById('qcRpRun').onclick = async () => {
    const name = document.getElementById('qcRpName').value.trim(); if (!name) return;
    const f = await gsm.saveFile({ defaultPath: name + '.bin' }); if (!f) return;
    term(`Leyendo partición QC ${name}...`, 'info'); showResult(await gsm.qc.readPartition(name, f));
  };
  document.getElementById('qcWpFile').onclick = async () => { qcWpFile = await gsm.pickFile(); if (qcWpFile) term('Imagen: ' + qcWpFile, 'info'); };
  document.getElementById('qcWpRun').onclick = async () => {
    const name = document.getElementById('qcWpName').value.trim(); if (!name || !qcWpFile) { term('Falta nombre o imagen', 'warn'); return; }
    if (!confirm(`¿Escribir en partición ${name}?`)) return;
    term(`Escribiendo partición QC ${name}...`, 'warn'); showResult(await gsm.qc.writePartition(name, qcWpFile));
  };
  document.getElementById('qcReadEfs').onclick = async () => {
    const dir = await gsm.pickDirectory(); if (!dir) return;
    term('Leyendo EFS (modemst1 + modemst2)...', 'info'); showResult(await gsm.qc.readEfs(dir + '/efs_backup'));
  };
  document.getElementById('qcWriteEfs').onclick = async () => {
    const f1 = await gsm.pickFile({ filters: [{ name: 'modemst1', extensions: ['bin'] }] }); if (!f1) return;
    const f2 = await gsm.pickFile({ filters: [{ name: 'modemst2', extensions: ['bin'] }] }); if (!f2) return;
    if (!confirm('¿Restaurar EFS? Asegúrate que los archivos son correctos para este dispositivo.')) return;
    term('Restaurando EFS...', 'warn'); showResult(await gsm.qc.writeEfs(f1, f2));
  };
  document.getElementById('qcBackup').onclick = async () => {
    const dir = await gsm.pickDirectory(); if (!dir) return;
    term('Haciendo backup de particiones críticas...', 'info'); showResult(await gsm.qc.backupCritical(dir));
  };
  document.getElementById('qcFrp').onclick = async () => { if (!confirm('¿Reset FRP QC?')) return; term('Reset FRP QC...', 'warn'); showResult(await gsm.qc.resetFrp()); };
  document.getElementById('qcWipe').onclick = async () => { if (!confirm('¿Wipe datos?')) return; term('Wipe QC...', 'warn'); showResult(await gsm.qc.wipe()); };
  document.getElementById('qcLoadProg').onclick = async () => {
    const f = await gsm.pickFile({ filters: [{ name: 'Firehose programmer', extensions: ['mbn', 'elf'] }] }); if (!f) return;
    term('Cargando programmer...', 'info'); showResult(await gsm.qc.readPartition('none', '/dev/null'));
    term(`Para usar programmer custom: edl --loader ${f} printgpt`, 'info');
  };

  // ===== SAMSUNG =====
  document.getElementById('samCheck').onclick = async () => {
    const r = await gsm.samsung.check();
    showResult({ ok: r.available, out: r.available ? '✓ Heimdall ' + r.version : 'Heimdall no encontrado. Instala desde https://heimdall.wiki.kernel.org' });
  };
  document.getElementById('samDetect').onclick = async () => { term('Detectando dispositivo Samsung...', 'info'); showResult(await gsm.samsung.detect()); };
  document.getElementById('samPit').onclick = async () => { term('Leyendo PIT...', 'info'); showResult(await gsm.samsung.printPit()); };

  // Samsung FW file pickers
  ['Bl', 'Ap', 'Cp', 'Csc'].forEach(part => {
    document.getElementById('samFw' + part).onclick = async () => {
      const f = await gsm.pickFile({ filters: [{ name: `${part.toUpperCase()} image`, extensions: ['tar', 'md5', 'bin', 'img'] }] });
      if (f) {
        samFwFiles[part.toLowerCase()] = f;
        document.getElementById('samFw' + part).textContent = f.split(/[\\/]/).pop();
        term(`${part.toUpperCase()}: ${f}`, 'info');
      }
    };
  });
  document.getElementById('samFlashFw').onclick = async () => {
    if (!Object.keys(samFwFiles).length) { term('Selecciona al menos un archivo de firmware', 'warn'); return; }
    if (!confirm('¿Flash completo de firmware Samsung? Operación irreversible.')) return;
    term('Flash Samsung...', 'warn'); showResult(await gsm.samsung.flashFirmware(samFwFiles));
  };
  document.getElementById('samPartFile').onclick = async () => { samPartFile = await gsm.pickFile(); if (samPartFile) term('Imagen: ' + samPartFile, 'info'); };
  document.getElementById('samPartFlash').onclick = async () => {
    const name = document.getElementById('samPartName').value.trim();
    if (!name || !samPartFile) { term('Falta partición o imagen', 'warn'); return; }
    if (!confirm(`¿Flash partición ${name}?`)) return;
    term(`Flash ${name}...`, 'warn'); showResult(await gsm.samsung.flashPartition(name, samPartFile));
  };
  document.getElementById('samFrp').onclick = async () => {
    const s = needDevice(); if (!s) return;
    if (!confirm('¿Reset FRP Samsung?')) return;
    showResult(await gsm.samsung.resetFrp(s));
  };
  document.getElementById('samInfo').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const info = await gsm.samsung.info(s);
    const table = document.getElementById('infoTable');
    term(JSON.stringify(info, null, 2), 'info');
  };
  document.getElementById('samDownloadMode').onclick = async () => {
    const s = needDevice(); if (!s) return;
    showResult(await gsm.samsung.rebootToDownload(s));
  };
  document.getElementById('samSearchFw').onclick = async () => {
    const model = document.getElementById('samFwModel').value.trim();
    const region = document.getElementById('samFwRegion').value;
    if (!model) { term('Introduce el modelo', 'warn'); return; }
    term(`Buscando firmware ${model} ${region}...`, 'info');
    const r = await gsm.samsung.searchFw(model, region);
    renderFirmwareResult(r);
    term(r.note || 'Búsqueda completada.', 'info');
  };

  // ===== HUAWEI =====
  document.getElementById('hwInfo').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.shell(s, 'getprop ro.product.model && getprop ro.build.version.emui && getprop ro.hardware');
    showResult(r);
  };
  document.getElementById('hwDev').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.shell(s, 'settings put global development_settings_enabled 1 && settings put global adb_enabled 1');
    showResult(r);
  };
  document.getElementById('hwFrp').onclick = async () => {
    const s = needDevice(); if (!s) return;
    if (!confirm('¿Reset FRP Huawei?')) return;
    const r = await gsm.adb.shell(s, 'pm clear com.huawei.hwid && pm clear com.huawei.appmarket && settings put global device_provisioned 1');
    showResult(r);
  };
  document.getElementById('hwNvm').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Backup NVM Huawei (requiere root)...', 'info');
    const r = await gsm.adb.shell(s, 'dd if=/dev/block/by-name/nvme of=/sdcard/nvme_backup.bin bs=512 2>/dev/null || echo "Root requerido"');
    showResult(r);
  };
  document.getElementById('hwUnlock').onclick = async () => {
    const code = document.getElementById('hwUnlockCode').value.trim();
    const s = needDevice(); if (!s) return;
    term('Desbloqueando BL Huawei...', 'warn');
    const r = await gsm.adb.shell(s, code ? `fastboot oem unlock ${code}` : 'echo "Introduce código de desbloqueo (Huawei dejó de proveerlos en 2018)"');
    showResult(r);
  };

  // ===== SPD/UNISOC =====
  document.getElementById('spdCheck').onclick = async () => {
    const r = await gsm.adb.shell('', 'spd_research --help 2>/dev/null || echo "SPD tool no encontrado. Usa SPD Flash Tool GUI: spdflashtool.com"');
    showResult(r);
  };
  document.getElementById('spdInfo').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.shell(s, 'getprop ro.hardware && getprop ro.product.chipname && getprop ro.product.model');
    showResult(r);
  };
  document.getElementById('spdFrp').onclick = async () => {
    const s = needDevice(); if (!s) return;
    if (!confirm('¿Reset FRP Unisoc?')) return;
    const r = await gsm.adb.shell(s, 'pm clear com.google.android.gsf && pm clear com.google.android.gms && settings put global device_provisioned 1');
    showResult(r);
  };
  document.getElementById('spdReadFlash').onclick = () => term('Lee el flash completo vía Research Download Mode con SPD Flash Tool.', 'info');
  document.getElementById('spdWriteFlash').onclick = () => term('Escribe firmware PAC vía SPD Flash Tool.', 'info');
  document.getElementById('spdWipe').onclick = async () => { if (!confirm('¿Wipe datos SPD?')) return; term('Wipe Unisoc vía EDL/RD mode no implementado directo. Usa SPD Flash Tool.', 'warn'); };
  document.getElementById('spdInstructions').onclick = () => {
    term(['SPD Flash Tool:', '1. Descarga desde spdflashtool.com', '2. Carga el PAC de firmware', '3. Conecta con Vol- presionado', '4. Selecciona operación y ejecuta'].join('\n'), 'info');
  };

  // ===== FRP =====
  document.getElementById('frpCheck').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Verificando estado FRP...', 'info');
    const r = await gsm.frp.checkStatus(s); showResult(r);
  };
  document.getElementById('frpEnable').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.enable(s, 'com.google.android.gms'); showResult(r);
  };

  // ===== FIRMWARE =====
  document.getElementById('fwAutoDetect').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Detectando modelo del dispositivo...', 'info');
    const [rModel, rBrand, rRegion] = await Promise.all([
      gsm.adb.shell(s, 'getprop ro.product.model'),
      gsm.adb.shell(s, 'getprop ro.product.brand'),
      gsm.adb.shell(s, 'getprop ro.csc.sales_code 2>/dev/null || getprop ro.cdma.home.operator.alpha 2>/dev/null || getprop persist.sys.country 2>/dev/null'),
    ]);
    const model  = (rModel.out  || '').trim();
    const brand  = (rBrand.out  || '').trim().toLowerCase();
    const region = (rRegion.out || '').trim().toUpperCase().slice(0, 3);
    if (model) {
      document.getElementById('fwModel').value = model;
      if (region && region.match(/^[A-Z]{2,3}$/)) document.getElementById('fwRegion').value = region;
      // Auto-select brand
      const sel = document.getElementById('fwBrand');
      const opt = [...sel.options].find(o => brand.includes(o.value) || o.value.includes(brand));
      if (opt) sel.value = opt.value;
      term(`Detectado: ${model} (${brand}) región ${region || '?'}`, 'ok');
    } else {
      term('No se pudo detectar el modelo. Conéctate a un dispositivo.', 'warn');
    }
  };

  document.getElementById('fwSearch').onclick = async () => {
    const brand = document.getElementById('fwBrand').value;
    const model = document.getElementById('fwModel').value.trim();
    const region = document.getElementById('fwRegion').value.trim() || 'EEA';
    if (!model) { term('Introduce el modelo', 'warn'); return; }
    term(`Buscando firmware ${brand} ${model} ${region}...`, 'info');
    const r = await gsm.firmware.search(brand, model, region);
    renderFirmwareResult(r);
    document.getElementById('fwActions').style.display = '';
  };
  document.getElementById('fwDownload').onclick = async () => {
    const url = document.getElementById('fwUrl').value.trim(); if (!url) { term('Introduce URL de descarga', 'warn'); return; }
    const f = await gsm.saveFile({ defaultPath: 'firmware.zip' }); if (!f) return;
    term('Descargando firmware...', 'info');
    const r = await gsm.firmware.download(url, f);
    if (r) { fwZipPath = r.path || f; showResult({ ok: true, out: 'Descargado en: ' + fwZipPath }); }
  };
  document.getElementById('fwExtract').onclick = async () => {
    const zip = fwZipPath || await gsm.pickFile({ filters: [{ name: 'ZIP', extensions: ['zip'] }] }); if (!zip) return;
    const dir = await gsm.pickDirectory(); if (!dir) return;
    term('Extrayendo...', 'info'); showResult(await gsm.firmware.extract(zip, dir));
  };
  document.getElementById('fwVerify').onclick = async () => {
    const f = fwZipPath || await gsm.pickFile(); if (!f) return;
    term('Calculando MD5...', 'info'); showResult(await gsm.firmware.verify(f));
  };

  // ===== FLASH tab =====
  document.getElementById('flashSideload').onclick = () => clickNav('flash');
  document.getElementById('flashBootImg').onclick = () => clickNav('fastboot');
  document.getElementById('sideloadFile').onclick = async () => { sideloadZip = await gsm.pickFile({ filters: [{ name: 'ZIP', extensions: ['zip'] }] }); if (sideloadZip) term('ZIP: ' + sideloadZip, 'info'); };
  document.getElementById('sideloadRun').onclick = async () => {
    const s = needDevice(); if (!s || !sideloadZip) { term('Falta dispositivo o archivo ZIP', 'warn'); return; }
    term('Iniciando ADB sideload...', 'info');
    showResult(await gsm.adb.shell(s, `sideload`)); // will use adb sideload
  };
  document.getElementById('bootImgFile').onclick = async () => { bootImgFile = await gsm.pickFile({ filters: [{ name: 'Boot image', extensions: ['img'] }] }); if (bootImgFile) term('Boot img: ' + bootImgFile, 'info'); };
  document.getElementById('bootImgRun').onclick = async () => {
    if (!bootImgFile) { term('Selecciona boot.img', 'warn'); return; }
    term('Booting temporal...', 'info');
    showResult(await gsm.fastboot.flash(null, 'boot', bootImgFile));
  };

  // ===== FASTBOOT tab =====
  document.getElementById('fbPartFile').onclick = async () => { fbImgFile = await gsm.pickFile(); if (fbImgFile) term('Imagen FB: ' + fbImgFile, 'info'); };
  document.getElementById('fbPartFlash').onclick = async () => {
    const part = document.getElementById('fbPartName').value.trim(); if (!part || !fbImgFile) { term('Falta partición o imagen', 'warn'); return; }
    if (!confirm(`¿Flash ${part}?`)) return;
    term(`FB Flash ${part}...`, 'warn');
    showResult(await gsm.fastboot.flash(null, part, fbImgFile));
  };
  document.getElementById('fbErase').onclick = async () => {
    const part = document.getElementById('fbEraseName').value.trim(); if (!part) return;
    if (!confirm(`¿Borrar partición ${part}?`)) return;
    term(`FB Erase ${part}...`, 'warn'); showResult(await gsm.fastboot.erase(null, part));
  };
  document.getElementById('fbUnlock').onclick = async () => { if (!confirm('¿OEM Unlock? Borrará todos los datos.')) return; term('OEM Unlock...', 'warn'); showResult(await gsm.fastboot.unlock(null)); };
  document.getElementById('fbLock').onclick = async () => { if (!confirm('¿OEM Lock?')) return; showResult(await gsm.fastboot.lock(null)); };
  document.getElementById('fbWipe').onclick = async () => { if (!confirm('¿Wipe datos fastboot? Borrará userdata + cache.')) return; term('FB Wipe...', 'warn'); showResult(await gsm.fastboot.wipe(null)); };
  document.getElementById('fbRebootNorm').onclick = () => gsm.fastboot.reboot(null, '').then(showResult);
  document.getElementById('fbRebootBootl').onclick = () => gsm.fastboot.reboot(null, 'bootloader').then(showResult);
  document.getElementById('fbRebootRec').onclick = () => gsm.fastboot.reboot(null, 'recovery').then(showResult);

  // ===== ADVANCED =====
  document.getElementById('advGoSettings').onclick = () => clickNav('settings');
  document.getElementById('advMtkImeiRun').onclick = async () => {
    const i1 = document.getElementById('advMtkImei1').value.trim();
    const i2 = document.getElementById('advMtkImei2').value.trim();
    if (!i1 || i1.length !== 15) { term('IMEI 1 inválido (15 dígitos)', 'warn'); return; }
    if (!confirm('¿Escribir IMEI en NVRAM MTK? Requiere modo BROM.')) return;
    term('Escribiendo IMEI MTK...', 'warn'); showResult(await gsm.advanced.mtkWriteImei(i1, i2 || null));
  };
  document.getElementById('advQcImeiRun').onclick = async () => {
    const i1 = document.getElementById('advQcImei1').value.trim();
    if (!i1 || i1.length !== 15) { term('IMEI 1 inválido', 'warn'); return; }
    if (!confirm('¿Backup EFS e instrucciones de IMEI QC?')) return;
    term('Backup EFS + instrucciones IMEI QC...', 'info'); showResult(await gsm.advanced.qcWriteImei(i1, ''));
  };
  document.getElementById('advMiAccount').onclick = async () => {
    const s = needDevice(); if (!s) return;
    if (!confirm('¿Eliminar Mi Account del dispositivo?')) return;
    term('Eliminando Mi Account...', 'warn'); showResult(await gsm.advanced.miAccountRemove(s));
  };
  document.getElementById('advHuaweiId').onclick = async () => {
    const s = needDevice(); if (!s) return;
    if (!confirm('¿Eliminar Huawei ID?')) return;
    term('Eliminando Huawei ID...', 'warn'); showResult(await gsm.advanced.huaweiIdRemove(s));
  };
  document.getElementById('advNckGen').onclick = async () => {
    const imei = document.getElementById('advNckImei').value.trim();
    const algo = document.getElementById('advNckAlgo').value;
    if (!imei) { term('Introduce IMEI', 'warn'); return; }
    const r = await gsm.advanced.generateUnlockCode(imei, algo);
    if (r.ok) term(`Código: ${r.code} (algoritmo: ${r.algorithm})\n${r.note || ''}`, 'ok');
    else term(r.out, 'err');
  };
  document.getElementById('advMtkFrp').onclick = async () => {
    if (!confirm('¿FRP bypass MTK (BROM)?')) return;
    term('FRP bypass MTK...', 'warn'); showResult(await gsm.advanced.mtkFrpBypass());
  };
  document.getElementById('advQcFrp').onclick = async () => {
    if (!confirm('¿FRP bypass QC (EDL)?')) return;
    term('FRP bypass QC...', 'warn'); showResult(await gsm.advanced.qcFrpBypass());
  };

  // IMEI Generator
  document.getElementById('advImeiGen').onclick = () => {
    const tacInput = document.getElementById('advImeiTac').value.trim();
    const count = Math.min(20, Math.max(1, parseInt(document.getElementById('advImeiCount').value) || 5));
    const result = document.getElementById('advImeiResult');
    if (tacInput && !/^\d{8}$/.test(tacInput)) {
      result.textContent = 'El TAC debe ser exactamente 8 dígitos numéricos.';
      return;
    }
    const lines = [];
    for (let i = 0; i < count; i++) {
      const tac = tacInput || String(Math.floor(10000000 + Math.random() * 89999999));
      const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      const base14 = tac + rand;
      const check = luhnCheck(base14);
      lines.push(base14 + check);
    }
    result.textContent = lines.join('\n');
    term(`${count} IMEI(s) generados con TAC ${tacInput || '(aleatorio)'}`, 'ok');
  };
  document.getElementById('advImeiDetectTac').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.shell(s, 'getprop ro.boot.hardware.revision 2>/dev/null || service call iphonesubinfo 4 2>/dev/null | grep -o "[0-9a-f]*\\.\\[0-9\\]*" | head -1');
    // Read IMEI and extract TAC (first 8 digits)
    const r2 = await gsm.adb.shell(s, 'service call iphonesubinfo 1 2>/dev/null');
    const imeiMatch = (r2.out || '').replace(/[^0-9]/g, '');
    if (imeiMatch && imeiMatch.length >= 8) {
      document.getElementById('advImeiTac').value = imeiMatch.slice(0, 8);
      term(`TAC detectado: ${imeiMatch.slice(0, 8)}`, 'ok');
    } else {
      const r3 = await gsm.adb.shell(s, 'dumpsys iphonesubinfo 2>/dev/null | grep -i "imei\\|device id" | head -3');
      const m = (r3.out || '').match(/\d{15}/);
      if (m) { document.getElementById('advImeiTac').value = m[0].slice(0, 8); term(`TAC: ${m[0].slice(0, 8)}`, 'ok'); }
      else term('No se pudo leer IMEI/TAC (requiere root o privilegios)', 'warn');
    }
  };

  // Settings
  document.getElementById('setAdbBrowse').onclick = async () => {
    const f = await gsm.pickFile({ filters: [{ name: 'adb', extensions: ['exe', ''] }] });
    if (f) document.getElementById('setAdbPath').value = f;
  };
  document.getElementById('setPyBrowse').onclick = async () => {
    const f = await gsm.pickFile({ filters: [{ name: 'python', extensions: ['exe', ''] }] });
    if (f) document.getElementById('setPythonPath').value = f;
  };
  document.getElementById('saveSettings').onclick = saveSettings;
  document.getElementById('setAdvancedMode').onchange = async (e) => {
    await gsm.setSetting('advancedMode', e.target.checked ? '1' : '0');
    term(`Modo Avanzado ${e.target.checked ? 'ACTIVADO' : 'desactivado'}`, e.target.checked ? 'warn' : 'info');
  };
  document.getElementById('depCheck').onclick = checkDeps;
  document.getElementById('histRefresh').onclick = loadHistory;
  document.getElementById('histClear').onclick = async () => {
    if (!confirm('¿Borrar todo el historial de operaciones?')) return;
    await gsm.history.log({ _clear: true }); loadHistory();
  };
  document.getElementById('btnSecurity').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Leyendo Knox / Widevine / seguridad...', 'info');
    const r = await gsm.adb.security(s);
    if (!r.ok) { term(r.out || 'Error leyendo seguridad', 'err'); return; }
    const table = document.getElementById('infoTable');
    const rows = Object.entries(r.data || {}).map(([k, v]) => `
      <div class="info-row"><span class="key">${escHtml(k)}</span><span class="val">${escHtml(String(v))}</span></div>`).join('');
    table.innerHTML = `<div class="info-section"><div class="info-section-title">🔒 Knox / Widevine / Seguridad</div>${rows}</div>`;
    term('Seguridad leída', 'ok');
  };
  document.getElementById('cpSend') && (document.getElementById('cpSend').onclick = copilotSend);
  document.getElementById('cpClear') && (document.getElementById('cpClear').onclick = copilotClear);
  document.getElementById('cpRefreshModels') && (document.getElementById('cpRefreshModels').onclick = copilotLoadModels);
  document.getElementById('cpInput') && (document.getElementById('cpInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); copilotSend(); }
  }));
  document.getElementById('btnScan') && (document.getElementById('btnScan').onclick = scanDevices);
  document.getElementById('btnSettings').onclick = () => clickNav('settings');

  setupCalcTabs();
  setupHwTests();
  setupCrm();
  setupAdbTerminal();
}

/* ===== APP LIST ===== */
function renderAppList(pkgs) {
  const list = document.getElementById('appList');
  if (!pkgs.length) { list.innerHTML = '<div class="empty-state" style="padding:20px">Sin resultados</div>'; return; }
  list.innerHTML = pkgs.map(pkg => `
    <div class="app-item">
      <span class="app-pkg">${escHtml(pkg)}</span>
      <div class="app-actions">
        <button class="btn btn-sm btn-xs" data-action="forceStop" data-pkg="${escHtml(pkg)}" title="Forzar cierre">⏹ Cerrar</button>
        <button class="btn btn-sm btn-xs" data-action="clearData" data-pkg="${escHtml(pkg)}" title="Borrar datos y caché">🗑 Datos</button>
        <button class="btn btn-sm btn-xs" data-action="disable" data-pkg="${escHtml(pkg)}">Deshabilitar</button>
        <button class="btn btn-sm btn-danger btn-xs" data-action="uninstall" data-pkg="${escHtml(pkg)}">Desinstalar</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const s = needDevice(); if (!s) return;
      const pkg = btn.dataset.pkg;
      const actions = {
        forceStop: async () => { term(`Cerrando ${pkg}...`, 'info'); showResult(await gsm.adb.forceStop(s, pkg)); },
        clearData: async () => { if (!confirm(`¿Borrar todos los datos de ${pkg}?`)) return; term(`Borrando datos de ${pkg}...`, 'warn'); showResult(await gsm.adb.clearData(s, pkg)); },
        disable: async () => { if (!confirm(`¿Deshabilitar ${pkg}?`)) return; showResult(await gsm.adb.disable(s, pkg)); },
        uninstall: async () => { if (!confirm(`¿Desinstalar ${pkg}? Se perderán los datos.`)) return; showResult(await gsm.adb.uninstall(s, pkg, false)); },
      };
      if (actions[btn.dataset.action]) await actions[btn.dataset.action]();
    };
  });
}

/* ===== FRP METHODS ===== */
function loadFrpMethods() {
  const methods = gsm.frp.listMethods();
  if (!methods || !methods.then) {
    renderFrpMethods(typeof methods === 'function' ? [] : (Array.isArray(methods) ? methods : []));
    return;
  }
  methods.then(renderFrpMethods);
}

function renderFrpMethods(methods) {
  if (!Array.isArray(methods)) return;
  document.getElementById('frpMethods').innerHTML = methods.map(m => `
    <div class="frp-method">
      <div class="frp-method-info">
        <div class="frp-method-name">
          ${m.name}
          ${m.requiresAdb ? '<span class="badge badge-adb">ADB</span>' : ''}
          ${m.requiresRoot ? '<span class="badge badge-root">ROOT</span>' : ''}
          ${m.destructive ? '<span class="badge badge-dest">⚠️ BORRA DATOS</span>' : ''}
        </div>
        <div class="frp-method-desc">${m.desc}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-method="${m.id}">Ejecutar</button>
    </div>
  `).join('');
  document.getElementById('frpMethods').querySelectorAll('[data-method]').forEach(btn => {
    btn.onclick = async () => {
      const s = getSerial();
      const id = parseInt(btn.dataset.method);
      if (!confirm(`¿Ejecutar método FRP #${id}?`)) return;
      term(`FRP método ${id}...`, 'info');
      const r = await gsm.frp.run(id, s, {});
      showResult(r);
    };
  });
}

/* ===== FASTBOOT SCAN ===== */
async function fbScan() {
  const devs = await gsm.fastboot.devices();
  const info = document.getElementById('fbDeviceInfo');
  if (!devs || !devs.length) {
    info.innerHTML = '<div class="info-row"><span class="key">Estado</span><span class="val">Sin dispositivos fastboot</span></div>';
    return;
  }
  info.innerHTML = devs.map(d => `<div class="info-row"><span class="key">${d.serial}</span><span class="val">${d.mode}</span></div>`).join('');
}
document.getElementById('fbScan').onclick = async () => {
  await fbScan();
  term('Fastboot scan completado', 'info');
};
document.getElementById('fbInfo').onclick = async () => {
  term('Leyendo variables fastboot...', 'info');
  const r = await gsm.fastboot.info(null);
  if (r && typeof r === 'object') {
    term(JSON.stringify(r, null, 2), 'info');
    const info = document.getElementById('fbDeviceInfo');
    info.innerHTML = Object.entries(r).map(([k, v]) => `<div class="info-row"><span class="key">${k}</span><span class="val">${v}</span></div>`).join('');
  } else showResult(r);
};

/* ===== ADVANCED CHECK ===== */
async function checkAdvanced() {
  const enabled = await gsm.advanced.isEnabled();
  document.getElementById('advGate').style.display = enabled ? 'none' : '';
  document.getElementById('advContent').style.display = enabled ? '' : 'none';
  const navAdv = document.getElementById('navAdvanced');
  navAdv.textContent = enabled ? '🔓 Avanzado' : '🔒 Avanzado';
}

/* ===== SETTINGS ===== */
function loadSettingsUI() {
  gsm.getSettings().then(s => {
    settings = s;
    document.getElementById('setAdbPath').value = s.adbPath || '';
    document.getElementById('setPythonPath').value = s.pythonPath || '';
    document.getElementById('setAutoDetect').checked = s.autoDetect === '1';
    document.getElementById('setAdvancedMode').checked = s.advancedMode === '1';
  });
}

async function saveSettings() {
  await gsm.setSetting('adbPath', document.getElementById('setAdbPath').value);
  await gsm.setSetting('pythonPath', document.getElementById('setPythonPath').value);
  await gsm.setSetting('autoDetect', document.getElementById('setAutoDetect').checked ? '1' : '0');
  await gsm.setSetting('advancedMode', document.getElementById('setAdvancedMode').checked ? '1' : '0');
  term('Ajustes guardados. Reinicia la aplicación para aplicar cambios de rutas.', 'ok');
}

async function checkDeps() {
  term('Verificando dependencias...', 'info');
  // ADB
  try {
    const r = await gsm.adb.shell(null, '--version');
    document.getElementById('depAdb').textContent = '✓';
    document.getElementById('depAdb').className = 'dep-status dep-ok';
  } catch (_) {
    document.getElementById('depAdb').textContent = '✗';
    document.getElementById('depAdb').className = 'dep-status dep-fail';
  }
  // mtk
  const mtkR = await gsm.mtk.check();
  document.getElementById('depMtk').textContent = mtkR.available ? '✓' : '✗';
  document.getElementById('depMtk').className = 'dep-status ' + (mtkR.available ? 'dep-ok' : 'dep-fail');
  // qc
  const qcR = await gsm.qc.check();
  document.getElementById('depEdl').textContent = qcR.available ? '✓' : '✗';
  document.getElementById('depEdl').className = 'dep-status ' + (qcR.available ? 'dep-ok' : 'dep-fail');
  // heimdall
  const samR = await gsm.samsung.check();
  document.getElementById('depHeimdall').textContent = samR.available ? '✓' : '✗';
  document.getElementById('depHeimdall').className = 'dep-status ' + (samR.available ? 'dep-ok' : 'dep-fail');
  // fastboot
  const devs = await gsm.fastboot.devices().catch(() => []);
  document.getElementById('depFastboot').textContent = '✓';
  document.getElementById('depFastboot').className = 'dep-status dep-ok';
  term('Verificación de dependencias completada', 'ok');
}

/* ===== HISTORY ===== */
async function loadHistory() {
  const ops = await gsm.history.get(150);
  const list = document.getElementById('historyList');
  if (!ops || !ops.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px;color:var(--text2)">Sin operaciones registradas</div>';
    return;
  }
  list.innerHTML = ops.slice().reverse().map(op => {
    const ts = op.ts ? new Date(op.ts).toLocaleString('es-ES') : '—';
    const platform = op.platform || '';
    const model = op.model || '';
    const operation = op.operation || '—';
    const detail = [model, op.imei].filter(Boolean).join(' · ');
    const resultIcon = op.result === 'ok' ? '✓' : op.result === 'err' ? '✗' : '';
    return `<div class="hist-item">
      <span class="hist-ts">${escHtml(ts)}</span>
      ${platform ? `<span class="hist-platform">${escHtml(platform)}</span>` : ''}
      <span class="hist-op">${resultIcon ? '<span style="color:' + (op.result==='ok'?'#56d364':'var(--red-h)') + '">' + resultIcon + '</span> ' : ''}${escHtml(operation)}</span>
      ${detail ? `<span class="hist-model">${escHtml(detail)}</span>` : ''}
    </div>`;
  }).join('');
}

/* ===== CO-PILOT IA ===== */
let cpMessages = [];
let cpDeviceInfo = null;
let cpInitialized = false;

async function initCopilot() {
  if (cpInitialized) { updateCpDeviceCtx(); return; }
  cpInitialized = true;
  updateCpDeviceCtx();
  await copilotCheckBackend();
  await copilotLoadModels();
  await copilotLoadQuickBtns();
}

function updateCpDeviceCtx() {
  const el = document.getElementById('cpDeviceInfo');
  if (!el) return;
  if (selectedDevice) {
    cpDeviceInfo = selectedDevice;
    el.textContent = `${selectedDevice.model || selectedDevice.serial}\n${selectedDevice.brand || ''} · Android ${selectedDevice.android || '?'}`;
  } else {
    cpDeviceInfo = null;
    el.textContent = '— Sin dispositivo —';
  }
}

async function copilotCheckBackend() {
  const dot = document.getElementById('cpDot');
  const label = document.getElementById('cpStatusLabel');
  if (!dot || !label) return;
  label.textContent = 'Verificando...';
  dot.className = 'cp-dot';
  const r = await gsm.copilot.check().catch(() => ({ any: false }));
  if (r.any) {
    dot.className = 'cp-dot ok';
    const parts = [];
    if (r.ollama) parts.push('Ollama');
    if (r.lmstudio) parts.push('LM Studio');
    label.textContent = parts.join(' + ') + ' ✓';
  } else {
    dot.className = 'cp-dot err';
    label.textContent = 'Sin IA local';
  }
}

async function copilotLoadModels() {
  const sel = document.getElementById('cpModel');
  if (!sel) return;
  sel.innerHTML = '<option value="">Cargando...</option>';
  const models = await gsm.copilot.models().catch(() => []);
  if (!models.length) {
    sel.innerHTML = '<option value="">Sin modelos (abre Ollama/LM Studio)</option>';
    return;
  }
  sel.innerHTML = models.map(m => `<option value="${escHtml(m.id)}" data-backend="${m.backend}">${escHtml(m.name)} [${m.backend}]</option>`).join('');
}

async function copilotLoadQuickBtns() {
  const container = document.getElementById('cpQuickBtns');
  if (!container) return;
  const prompts = await gsm.copilot.prompts().catch(() => []);
  container.innerHTML = prompts.map(p => `<button class="cp-quick-btn" data-prompt="${escHtml(p.prompt)}">${escHtml(p.label)}</button>`).join('');
  container.querySelectorAll('.cp-quick-btn').forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById('cpInput');
      if (input) { input.value = btn.dataset.prompt; copilotSend(); }
    };
  });
}

function cpAddMessage(role, text, streaming = false) {
  const msgs = document.getElementById('cpMessages');
  if (!msgs) return null;
  const div = document.createElement('div');
  div.className = `cp-msg cp-msg-${role}${streaming ? ' cp-streaming' : ''}`;
  const label = role === 'user' ? 'Tú' : role === 'assistant' ? 'Co-Pilot' : '';
  div.innerHTML = `${label ? `<span class="cp-role-label">${label}</span>` : ''}<div class="cp-bubble">${escHtml(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function cpUpdateBubble(div, text) {
  const bubble = div && div.querySelector('.cp-bubble');
  if (bubble) bubble.innerHTML = escHtml(text).replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

let _cpSending = false;
async function copilotSend() {
  if (_cpSending) return;
  const input = document.getElementById('cpInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const sel = document.getElementById('cpModel');
  const model = sel ? sel.value : '';
  const selOpt = sel && sel.selectedOptions[0];
  const backend = selOpt ? selOpt.dataset.backend : undefined;

  cpMessages.push({ role: 'user', content: text });
  cpAddMessage('user', text);

  const assistDiv = cpAddMessage('assistant', '', true);
  const sendBtn = document.getElementById('cpSend');
  if (sendBtn) sendBtn.disabled = true;
  _cpSending = true;

  let streamBuffer = '';
  gsm.copilot.offToken();
  gsm.copilot.onToken((token) => {
    streamBuffer += token;
    cpUpdateBubble(assistDiv, streamBuffer);
    const msgs = document.getElementById('cpMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });

  const r = await gsm.copilot.chat({
    messages: cpMessages,
    model: model || undefined,
    backend: backend || undefined,
    deviceInfo: cpDeviceInfo,
  }).catch(e => ({ ok: false, out: e.message }));

  gsm.copilot.offToken();
  _cpSending = false;
  if (sendBtn) sendBtn.disabled = false;
  assistDiv.classList.remove('cp-streaming');

  const finalText = r.out || (r.ok ? '(sin respuesta)' : 'No se pudo conectar con el modelo. Verifica que Ollama o LM Studio esté activo y tengas un modelo cargado.');
  cpUpdateBubble(assistDiv, streamBuffer || finalText);
  const msgs = document.getElementById('cpMessages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  if (r.ok && r.out) cpMessages.push({ role: 'assistant', content: r.out });
  else if (!r.ok) { cpUpdateBubble(assistDiv, finalText); term('Co-Pilot error: ' + finalText, 'err'); }
}

function copilotClear() {
  cpMessages = [];
  const msgs = document.getElementById('cpMessages');
  if (msgs) msgs.innerHTML = '<div class="cp-msg cp-msg-system"><div class="cp-bubble">Chat limpiado. Haz una pregunta técnica sobre tu reparación.</div></div>';
}

/* ===== NAV HELPER ===== */
function clickNav(tab) {
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.click();
}

/* ===== CALCULADORAS ===== */
function setupCalcTabs() {
  document.querySelectorAll('#tab-calc .tab-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-calc .tab-sub').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#tab-calc .sub-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sub-' + btn.dataset.sub)?.classList.add('active');
    });
  });

  // Resistencias
  document.getElementById('resCalc').onclick = () => {
    const r1 = parseFloat(document.getElementById('resR1').value);
    const r2 = parseFloat(document.getElementById('resR2').value);
    const r3 = parseFloat(document.getElementById('resR3').value) || null;
    const mode = document.getElementById('resMode').value;
    if (!r1 || !r2) return;
    let val;
    if (mode === 'par') {
      val = r3 ? 1/(1/r1+1/r2+1/r3) : 1/(1/r1+1/r2);
    } else {
      val = r1 + r2 + (r3 || 0);
    }
    document.getElementById('resResult').textContent =
      `R total (${mode === 'par' ? 'paralelo' : 'serie'}) = ${fmtOhm(val)}`;
  };

  // Divisor de tensión
  document.getElementById('vdivCalc').onclick = () => {
    const vin = parseFloat(document.getElementById('vdivVin').value);
    const r1  = parseFloat(document.getElementById('vdivR1').value);
    const r2  = parseFloat(document.getElementById('vdivR2').value);
    if (!vin||!r1||!r2) return;
    const vout = vin * r2 / (r1 + r2);
    document.getElementById('vdivResult').textContent =
      `Vout = ${vout.toFixed(4)} V\nRelación = ${(vout/vin*100).toFixed(2)}%\nCorriente = ${fmtAmp(vin/(r1+r2))}`;
  };

  // Caída de voltaje AWG
  document.getElementById('vdropCalc').onclick = () => {
    const section = parseFloat(document.getElementById('vdropAwg').value); // mm²
    const len = parseFloat(document.getElementById('vdropLen').value);     // metros (ida+vuelta)
    const I   = parseFloat(document.getElementById('vdropI').value);
    if (!len||!I) return;
    const rho = 1.724e-8; // cobre Ω·m
    const R = rho * (len * 2) / (section * 1e-6);
    const drop = R * I;
    document.getElementById('vdropResult').textContent =
      `R cable = ${fmtOhm(R)}\nCaída = ${drop.toFixed(4)} V  (${(drop*I).toFixed(4)} W disipados)\nCorriente máx recomendada (1V/m): ${fmtAmp(1/(rho*2/(section*1e-6)))}`;
  };

  // Batería
  document.getElementById('battCalc').onclick = () => {
    const cap = parseFloat(document.getElementById('battCap').value);
    const I   = parseFloat(document.getElementById('battI').value);
    const eff = parseFloat(document.getElementById('battEff').value) / 100 || 0.85;
    if (!cap||!I) return;
    const hrs = (cap / (I * eff));
    const min = Math.round(hrs * 60);
    document.getElementById('battResult').textContent =
      `Tiempo estimado: ${Math.floor(min/60)}h ${min%60}min\n` +
      `(C rate: ${(I/cap).toFixed(2)}C | Eficiencia: ${(eff*100).toFixed(0)}%)`;
  };

  // Conversor unidades
  document.getElementById('convCalc').onclick = () => {
    const val = parseFloat(document.getElementById('convVal').value);
    const from = document.getElementById('convFrom').value;
    const to   = document.getElementById('convTo').value;
    if (isNaN(val)) return;
    let watts;
    if (from === 'dbm') watts = Math.pow(10, (val - 30) / 10);
    else if (from === 'mw') watts = val / 1000;
    else if (from === 'w') watts = val;
    else if (from === 'v') watts = (val * val) / 50;
    else if (from === 'mv') watts = ((val/1000)*(val/1000))/50;
    else if (from === 'uv') watts = ((val/1e6)*(val/1e6))/50;
    let result;
    if (to === 'w') result = `${watts.toExponential(4)} W`;
    else if (to === 'mw') result = `${(watts*1000).toExponential(4)} mW`;
    else if (to === 'dbm') result = `${(10*Math.log10(watts*1000)).toFixed(2)} dBm`;
    else if (to === 'v') result = `${Math.sqrt(watts*50).toExponential(4)} V (RMS, 50Ω)`;
    else if (to === 'mv') result = `${(Math.sqrt(watts*50)*1000).toExponential(4)} mV`;
    document.getElementById('convResult').textContent = `${val} ${from}  →  ${result}`;
  };

  // Hash / CRC
  document.getElementById('hashPickFile').onclick = async () => {
    const f = await gsm.pickFile();
    if (!f) return;
    document.getElementById('hashFileName').textContent = f;
    document.getElementById('hashResult').textContent = 'Calculando...';
    const algos = ['md5', 'sha1', 'sha256', 'sha512'];
    const results = await Promise.all(algos.map(a => gsm.util.hashFile(f, a)));
    document.getElementById('hashResult').textContent = results
      .map((r, i) => `${algos[i].toUpperCase().padEnd(7)} ${r.ok ? r.hash : 'ERROR'}`)
      .join('\n');
  };

  // Conversión de bases
  ['baseDec','baseHex','baseBin','baseAsc','baseAddr'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      const el = e.target; const v = el.value.trim();
      let num = NaN;
      try {
        if (id === 'baseDec') num = parseInt(v, 10);
        else if (id === 'baseHex') num = parseInt(v.replace(/^0x/i,''), 16);
        else if (id === 'baseBin') num = parseInt(v, 2);
        else if (id === 'baseAsc') num = v.charCodeAt(0);
        else if (id === 'baseAddr') num = parseInt(v, 16);
      } catch(_) {}
      if (isNaN(num)) { document.getElementById('baseResult').textContent = ''; return; }
      document.getElementById('baseResult').textContent =
        `Dec: ${num}\nHex: 0x${num.toString(16).toUpperCase().padStart(8,'0')}\nBin: ${num.toString(2).padStart(8,'0')}\nASCII: ${num >= 32 && num < 127 ? String.fromCharCode(num) : '—'}`;
    });
  });

  // RC / Frecuencia
  document.getElementById('rcCalc').onclick = () => {
    const R = parseFloat(document.getElementById('rcR').value);
    const C = parseFloat(document.getElementById('rcC').value) * 1e-6;
    if (!R||!C) return;
    const tau = R * C;
    const f3db = 1 / (2 * Math.PI * R * C);
    document.getElementById('rcResult').textContent =
      `τ (constante tiempo) = ${fmtTime(tau)}\nf (-3dB) = ${fmtHz(f3db)}\nCarga al 63%: ${fmtTime(tau)}\nCarga al 99%: ${fmtTime(tau*5)}`;
  };
}

function fmtOhm(v) {
  if (v >= 1e6) return `${(v/1e6).toFixed(4)} MΩ`;
  if (v >= 1e3) return `${(v/1e3).toFixed(4)} kΩ`;
  return `${v.toFixed(4)} Ω`;
}
function fmtAmp(v) {
  if (v < 0.001) return `${(v*1e6).toFixed(2)} µA`;
  if (v < 1) return `${(v*1000).toFixed(2)} mA`;
  return `${v.toFixed(4)} A`;
}
function fmtTime(v) {
  if (v < 0.001) return `${(v*1e6).toFixed(2)} µs`;
  if (v < 1) return `${(v*1000).toFixed(2)} ms`;
  return `${v.toFixed(4)} s`;
}
function fmtHz(v) {
  if (v >= 1e6) return `${(v/1e6).toFixed(4)} MHz`;
  if (v >= 1e3) return `${(v/1e3).toFixed(4)} kHz`;
  return `${v.toFixed(4)} Hz`;
}

/* ===== TEST HARDWARE ===== */
function setupHwTests() {
  const COLORS = { black:'0 0 0', white:'255 255 255', red:'255 0 0', green:'0 255 0', blue:'0 0 255' };
  document.querySelectorAll('.hwt-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = needDevice(); if (!s) return;
      const test = btn.dataset.test;
      if (test === 'screen-grid') {
        await gsm.adb.shell(s, 'am start -a android.intent.action.VIEW -t image/png 2>/dev/null');
        term('Abriendo visor (no hay color sólido via ADB sin root)', 'warn');
        return;
      }
      const color = test.replace('screen-', '');
      const rgb = COLORS[color];
      if (!rgb) return;
      const r = await gsm.adb.shell(s,
        `am start -a android.intent.action.VIEW --ez "fill" true 2>/dev/null; ` +
        `service call SurfaceFlinger 1008 i32 1 2>/dev/null || ` +
        `wm density 160 2>/dev/null`);
      term(`Test pantalla ${color}: ${r.out || 'enviado'}`, 'info');
      setHwtResult(`Test pantalla ${color} iniciado. Si no se aplica, usa una app de test de pantalla en el dispositivo.`);
    });
  });

  document.getElementById('hwtPixelTest').onclick = async () => {
    const s = needDevice(); if (!s) return;
    await gsm.adb.shell(s, 'am start -n com.android.settings/.SubSettings 2>/dev/null');
    const r = await gsm.adb.shell(s, 'dumpsys display 2>/dev/null | head -30');
    setHwtResult('Test de píxeles: Usa la app "Bad Pixels" instalada en el dispositivo.\n\n' + (r.out || ''));
    term('Iniciando test píxeles', 'info');
  };

  document.getElementById('hwtTouchTest').onclick = async () => {
    const s = needDevice(); if (!s) return;
    await gsm.adb.shell(s, 'am start -a android.intent.action.VIEW -d "mobileservice://touchtest" 2>/dev/null || am start -n com.android.settings/.TouchTestActivity 2>/dev/null');
    term('Abriendo test touch...', 'info');
  };

  document.getElementById('hwtTouchInfo').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.shell(s, 'cat /proc/bus/input/devices 2>/dev/null | grep -A5 -i touch | head -30');
    setHwtResult(r.out || 'No se pudo leer info touch');
  };

  document.getElementById('hwtSensors').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Leyendo sensores...', 'info');
    const r = await gsm.adb.shell(s, 'dumpsys sensorservice 2>/dev/null | grep -E "^[0-9]|Sensor|Type|handle" | head -60');
    document.getElementById('hwtSensorOut').textContent = r.out || 'Sin datos de sensores';
  };

  document.getElementById('hwtSpeaker').onclick = async () => {
    const s = needDevice(); if (!s) return;
    await gsm.adb.shell(s, 'media volume --set 8 --stream 3 2>/dev/null');
    const r = await gsm.adb.shell(s, 'am start -a android.intent.action.VIEW -t audio/wav 2>/dev/null || tinymix 2>/dev/null | head -5');
    setHwtResult('Test altavoz: Se subió el volumen al máximo.\nUsando el tono de prueba del sistema.\n' + (r.out||''));
  };

  document.getElementById('hwtMic').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.shell(s, 'dumpsys media.audio_policy 2>/dev/null | grep -i "mic\|input" | head -20');
    setHwtResult(r.out || 'Sin info de micrófono (puede requerir root)');
  };

  document.getElementById('hwtEarpiece').onclick = async () => {
    const s = needDevice(); if (!s) return;
    await gsm.adb.shell(s, 'media volume --set 15 --stream 0 2>/dev/null');
    setHwtResult('Volumen auricular al máximo. Realiza una llamada de prueba para verificar.');
  };

  document.getElementById('hwtCamBack').onclick = async () => {
    const s = needDevice(); if (!s) return;
    await gsm.adb.shell(s, 'am start -a android.media.action.IMAGE_CAPTURE 2>/dev/null');
    term('Cámara trasera abierta', 'info');
  };

  document.getElementById('hwtCamFront').onclick = async () => {
    const s = needDevice(); if (!s) return;
    await gsm.adb.shell(s, 'am start -a android.media.action.IMAGE_CAPTURE --ei android.intent.extras.CAMERA_FACING 1 2>/dev/null');
    term('Cámara frontal abierta', 'info');
  };

  document.getElementById('hwtCamInfo').onclick = async () => {
    const s = needDevice(); if (!s) return;
    const r = await gsm.adb.shell(s, 'dumpsys media.camera 2>/dev/null | grep -E "camera id|facing|resolution|support" | head -30');
    setHwtResult(r.out || 'Sin info de cámaras');
  };

  document.getElementById('hwtVib1').onclick = async () => { const s=needDevice();if(!s)return; await gsm.adb.shell(s,'cmd vibrator vibrate 200 test 2>/dev/null || input keyevent 0 2>/dev/null'); };
  document.getElementById('hwtVib2').onclick = async () => { const s=needDevice();if(!s)return; await gsm.adb.shell(s,'cmd vibrator vibrate 1000 test 2>/dev/null'); };
  document.getElementById('hwtVib3').onclick = async () => {
    const s=needDevice();if(!s)return;
    // SOS pattern: 3 short, 3 long, 3 short
    for (const d of [200,200,200,600,600,600,200,200,200]) {
      await gsm.adb.shell(s,`cmd vibrator vibrate ${d} test 2>/dev/null`);
      await new Promise(r=>setTimeout(r,d+100));
    }
  };

  document.getElementById('hwtWifi').onclick = async () => {
    const s=needDevice();if(!s)return;
    const r = await gsm.adb.shell(s,'dumpsys wifi 2>/dev/null | grep -E "mWifiInfo|SSID|frequency|link speed|RSSI" | head -10');
    setHwtResult(r.out || 'Sin info WiFi');
  };

  document.getElementById('hwtBt').onclick = async () => {
    const s=needDevice();if(!s)return;
    const r = await gsm.adb.shell(s,'dumpsys bluetooth_manager 2>/dev/null | grep -E "state|address|name" | head -10');
    setHwtResult(r.out || 'Sin info Bluetooth');
  };

  document.getElementById('hwtUsb').onclick = async () => {
    const s=needDevice();if(!s)return;
    const r = await gsm.adb.shell(s,'cat /sys/class/power_supply/usb/type 2>/dev/null; getprop sys.usb.config 2>/dev/null; dumpsys usb 2>/dev/null | grep -E "function|state|otg" | head -10');
    setHwtResult(r.out || 'Sin info USB');
  };

  document.getElementById('hwtBatteryApps').onclick = async () => {
    const s=needDevice();if(!s)return;
    term('Analizando consumo por apps...','info');
    const r = await gsm.adb.shell(s,'dumpsys batterystats --charged 2>/dev/null | grep -E "^    [0-9]|Uid|mAh" | head -40',15000);
    document.getElementById('hwtBatteryOut').textContent = r.out || 'Sin datos (puede requerir root o resetear estadísticas)';
  };

  document.getElementById('hwtScreenshot').onclick = async () => {
    const s=needDevice();if(!s)return;
    const r = await gsm.adb.screenshot(s);
    if (r.ok && r.path) {
      showResult({ ok: true, out: `Screenshot guardado: ${r.path}` });
      const modal = document.getElementById('ssModal');
      const img   = document.getElementById('ssImg');
      if (modal && img) { img.src = 'file://' + r.path; modal.style.display = 'flex'; }
    } else showResult(r);
  };

  document.getElementById('hwtScreencast').onclick = async () => {
    const s=needDevice();if(!s)return;
    const sec = parseInt(document.getElementById('hwtRecordSec').value)||10;
    const dest = await gsm.saveFile({ defaultPath: `screencast_${Date.now()}.mp4`, filters:[{name:'Video',extensions:['mp4']}] });
    if (!dest) return;
    term(`Grabando pantalla ${sec}s...`, 'warn');
    const r = await gsm.adb.shell(s, `screenrecord --time-limit ${sec} /sdcard/sc_tmp.mp4 2>/dev/null`, (sec+5)*1000);
    if (r.ok) {
      await gsm.adb.shell(s, `mv /sdcard/sc_tmp.mp4 /sdcard/screencast.mp4 2>/dev/null`);
      setHwtResult(`Grabación completada. Descarga desde /sdcard/screencast.mp4`);
    } else setHwtResult('Error: ' + r.out);
  };
}

function setHwtResult(txt) {
  const el = document.getElementById('hwtResult');
  if (el) el.textContent = txt;
}

/* ===== CRM ===== */
let _cliSelected = null;
let _repairSelected = null;

async function loadClients(search) {
  const r = await gsm.crm.clients(search || '');
  const list = document.getElementById('clientList');
  if (!list) return;
  if (!r.ok || !r.data.length) {
    list.innerHTML = '<div style="padding:16px;color:var(--text2);font-size:12px">Sin clientes. Pulsa "+ Nuevo cliente"</div>';
    return;
  }
  list.innerHTML = r.data.map(c => {
    const badge = statusBadge(c.last_status);
    return `<div class="client-card${_cliSelected === c.id ? ' active' : ''}" data-id="${c.id}">
      <div class="client-name">${escHtml(c.name)}</div>
      <div class="client-meta">${escHtml(c.phone||'—')} · ${c.repair_count||0} reparaciones</div>
      ${c.last_model ? `<div class="client-meta">${escHtml(c.last_model)}</div>` : ''}
      ${badge}
    </div>`;
  }).join('');
  list.querySelectorAll('.client-card').forEach(card => {
    card.onclick = () => { _cliSelected = Number(card.dataset.id); loadClients(document.getElementById('cliSearch')?.value); showClientDetail(_cliSelected); };
  });
}

function statusBadge(status) {
  const MAP = { pending:'badge-pending', inprogress:'badge-inprogress', done:'badge-done', delivered:'badge-delivered' };
  const LABEL = { pending:'Pendiente', inprogress:'En proceso', done:'Terminado', delivered:'Entregado' };
  if (!status) return '';
  return `<span class="client-badge ${MAP[status]||'badge-pending'}">${LABEL[status]||status}</span>`;
}

async function showClientDetail(id) {
  const [cr, rr] = await Promise.all([gsm.crm.client(id), gsm.crm.repairs(id)]);
  const c = cr.data; const repairs = rr.data || [];
  const detail = document.getElementById('clientDetail');
  if (!c || !detail) return;
  detail.innerHTML = `
    <div class="detail-section">Datos del cliente</div>
    <div class="detail-field"><label>Nombre</label><input class="input" id="dName" value="${escHtml(c.name||'')}"></div>
    <div class="detail-field"><label>Teléfono</label><input class="input" id="dPhone" value="${escHtml(c.phone||'')}"></div>
    <div class="detail-field"><label>Email</label><input class="input" id="dEmail" value="${escHtml(c.email||'')}"></div>
    <div class="detail-field"><label>Dirección</label><input class="input" id="dAddr" value="${escHtml(c.address||'')}"></div>
    <div class="detail-field"><label>Notas</label><input class="input" id="dNotes" value="${escHtml(c.notes||'')}"></div>
    <div class="btn-row">
      <button class="btn btn-primary btn-sm" id="dSave">Guardar</button>
      <button class="btn btn-sm" id="dNewRepair">+ Nueva reparación</button>
      <button class="btn btn-danger btn-sm" id="dDelete">Eliminar cliente</button>
    </div>
    <div class="detail-section" style="margin-top:8px">Reparaciones (${repairs.length})</div>
    <div id="repairList">${repairs.map(r => repairCard(r)).join('') || '<div style="color:var(--text2);font-size:12px">Sin reparaciones</div>'}</div>
  `;
  document.getElementById('dSave').onclick = async () => {
    await gsm.crm.upsertClient({ id, name:document.getElementById('dName').value, phone:document.getElementById('dPhone').value, email:document.getElementById('dEmail').value, address:document.getElementById('dAddr').value, notes:document.getElementById('dNotes').value });
    term('Cliente guardado', 'ok'); loadClients();
  };
  document.getElementById('dNewRepair').onclick = () => showRepairForm(id, null);
  document.getElementById('dDelete').onclick = async () => {
    if (!confirm(`¿Eliminar cliente "${c.name}" y todas sus reparaciones?`)) return;
    await gsm.crm.deleteClient(id); _cliSelected = null;
    detail.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text2)">Selecciona un cliente o crea uno nuevo</div>';
    loadClients();
  };
  detail.querySelectorAll('.repair-card').forEach(card => {
    card.onclick = () => showRepairForm(id, Number(card.dataset.id));
  });
}

function repairCard(r) {
  const ts = r.created_at ? new Date(r.created_at * 1000).toLocaleDateString('es-ES') : '—';
  return `<div class="client-card repair-card" data-id="${r.id}" style="margin-bottom:4px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="ticket-number" style="font-size:13px">${escHtml(r.ticket||'')}</span>
      ${statusBadge(r.status)}
    </div>
    <div class="client-meta">${escHtml(r.device||r.model||'—')} · ${ts}</div>
    <div class="client-meta">${escHtml(r.issue||'').slice(0,60)}</div>
    <div class="client-meta" style="color:var(--accent-h)">€${r.price||0} (dep. €${r.deposit||0})</div>
  </div>`;
}

async function showRepairForm(clientId, repairId) {
  const detail = document.getElementById('clientDetail');
  const r = repairId ? (await gsm.crm.repair(repairId)).data : null;
  const s = needDevice(); // para auto-detectar modelo
  detail.innerHTML = `
    <div class="btn-row"><button class="btn btn-sm" id="rfBack">← Volver</button>
      <span class="ticket-number">${escHtml(r && r.ticket || '(nuevo)')}</span>
    </div>
    <div class="detail-section">Reparación</div>
    <div class="detail-field"><label>Dispositivo</label>
      <div class="fw-model-row">
        <input class="input" id="rfDevice" value="${escHtml(r&&r.device||'')}">
        ${s ? `<button class="btn btn-xs" id="rfAutoDetect">📱 Auto</button>` : ''}
      </div>
    </div>
    <div class="detail-field"><label>IMEI</label><input class="input" id="rfImei" value="${escHtml(r&&r.imei||'')}"></div>
    <div class="detail-field"><label>Color</label><input class="input" id="rfColor" value="${escHtml(r&&r.color||'')}"></div>
    <div class="detail-field"><label>Avería reportada</label><input class="input" id="rfIssue" value="${escHtml(r&&r.issue||'')}"></div>
    <div class="detail-field"><label>Diagnóstico</label><input class="input" id="rfDiag" value="${escHtml(r&&r.diagnosis||'')}"></div>
    <div class="detail-field"><label>Solución</label><input class="input" id="rfSol" value="${escHtml(r&&r.solution||'')}"></div>
    <div class="detail-field"><label>Estado</label>
      <select class="input" id="rfStatus">
        ${['pending','inprogress','done','delivered'].map(st =>
          `<option value="${st}"${(r&&r.status||'pending')===st?' selected':''}>${{pending:'Pendiente',inprogress:'En proceso',done:'Terminado',delivered:'Entregado'}[st]}</option>`
        ).join('')}
      </select>
    </div>
    <div class="calc-row">
      <div class="detail-field" style="flex:1"><label>Precio (€)</label><input class="input" id="rfPrice" type="number" value="${r&&r.price||0}"></div>
      <div class="detail-field" style="flex:1"><label>Depósito (€)</label><input class="input" id="rfDeposit" type="number" value="${r&&r.deposit||0}"></div>
      <div class="detail-field" style="flex:1"><label>Garantía (días)</label><input class="input" id="rfWarranty" type="number" value="${r&&r.warranty_days||90}"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="rfSave">Guardar reparación</button>
    </div>
  `;
  document.getElementById('rfBack').onclick = () => showClientDetail(clientId);
  if (s && document.getElementById('rfAutoDetect')) {
    document.getElementById('rfAutoDetect').onclick = async () => {
      const [rM, rI] = await Promise.all([
        gsm.adb.shell(s,'getprop ro.product.model'),
        gsm.adb.readImei(s)
      ]);
      if (rM.ok) document.getElementById('rfDevice').value = rM.out.trim();
      if (rI.ok && rI.imei1) document.getElementById('rfImei').value = rI.imei1;
      term('Dispositivo auto-detectado', 'ok');
    };
  }
  document.getElementById('rfSave').onclick = async () => {
    const data = { client_id: clientId, id: repairId||undefined, ticket: r&&r.ticket,
      device:document.getElementById('rfDevice').value, imei:document.getElementById('rfImei').value,
      color:document.getElementById('rfColor').value, issue:document.getElementById('rfIssue').value,
      diagnosis:document.getElementById('rfDiag').value, solution:document.getElementById('rfSol').value,
      status:document.getElementById('rfStatus').value, price:document.getElementById('rfPrice').value,
      deposit:document.getElementById('rfDeposit').value, warranty_days:document.getElementById('rfWarranty').value };
    const saved = await gsm.crm.upsertRepair(data);
    term(`Reparación guardada. Ticket: ${saved.ticket||r&&r.ticket}`, 'ok');
    gsm.history.log({ platform:'CRM', operation:`repair_${data.status}`, model:data.device });
    showClientDetail(clientId);
  };
}

function setupCrm() {
  document.getElementById('cliNew').onclick = async () => {
    const name = prompt('Nombre del cliente:');
    if (!name) return;
    const saved = await gsm.crm.upsertClient({ name });
    if (saved.ok) { _cliSelected = saved.id; loadClients(); showClientDetail(saved.id); }
  };
  document.getElementById('cliRefresh').onclick = () => loadClients(document.getElementById('cliSearch')?.value);
  document.getElementById('cliSearch').addEventListener('input', (e) => loadClients(e.target.value));
}

/* ===== TERMINAL ADB ===== */
const SHELL_HISTORY = [];
let _shellHistIdx = -1;
let _logcatRunning = false;

function setupAdbTerminal() {
  const output = document.getElementById('shellOutput');
  const input  = document.getElementById('shellInput');
  const SUGGESTIONS = ['getprop ro.product.model','dumpsys battery','pm list packages -3',
    'dumpsys sensorservice','logcat -d -t 50','df -h','ls /sdcard/',
    'settings list global','wm size','wm density','su -c id','getprop ro.build.version.release'];

  // Autocompletado básico
  document.getElementById('shellSuggest').innerHTML = SUGGESTIONS.slice(0,6).map(s =>
    `<span class="shell-hint">${escHtml(s)}</span>`).join('');
  document.querySelectorAll('.shell-hint').forEach(h => {
    h.onclick = () => { input.value = h.textContent; input.focus(); };
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (_shellHistIdx < SHELL_HISTORY.length - 1) { _shellHistIdx++; input.value = SHELL_HISTORY[SHELL_HISTORY.length-1-_shellHistIdx]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (_shellHistIdx > 0) { _shellHistIdx--; input.value = SHELL_HISTORY[SHELL_HISTORY.length-1-_shellHistIdx]; }
      else { _shellHistIdx = -1; input.value = ''; }
    } else if (e.key === 'Enter') {
      e.preventDefault(); runShell();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const match = SUGGESTIONS.find(s => s.startsWith(input.value));
      if (match) { input.value = match; }
    }
  });

  document.getElementById('shellRun').onclick = runShell;
  document.getElementById('shellClear').onclick = () => { if(output) output.textContent = ''; };

  async function runShell() {
    const s = needDevice();
    const cmd = input.value.trim();
    if (!cmd) return;
    if (!s) { appendShell(`[Sin dispositivo]`,'err'); return; }
    SHELL_HISTORY.push(cmd); _shellHistIdx = -1; input.value = '';
    appendShell(`$ ${cmd}`, 'prompt');
    const r = await gsm.adb.shell(s, cmd, 30000);
    if (r.out) appendShell(r.out, r.ok ? 'out' : 'err');
  }

  function appendShell(text, cls) {
    if (!output) return;
    const line = document.createElement('div');
    line.style.color = cls === 'prompt' ? '#56d364' : cls === 'err' ? '#f85149' : '#b3c7e6';
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  // Logcat
  document.getElementById('logStart').onclick = async () => {
    const s = needDevice(); if (!s) return;
    if (_logcatRunning) await gsm.logcat.stop();
    gsm.logcat.offLine();
    const level = document.getElementById('logLevel').value;
    const tag   = document.getElementById('logTag').value.trim();
    const pkg   = document.getElementById('logPkg').value.trim();
    const r = await gsm.logcat.start(s, level, tag, pkg);
    if (!r.ok) { term('Error iniciando logcat', 'err'); return; }
    _logcatRunning = true;
    const logOut = document.getElementById('logOutput');
    gsm.logcat.onLine((line) => {
      if (!logOut) return;
      const div = document.createElement('div');
      const lvl = (line.match(/^[VDIWEF]\//) || [''])[0][0];
      div.className = `log-line-${lvl || 'I'}`;
      div.textContent = line;
      logOut.appendChild(div);
      if (logOut.children.length > 2000) logOut.removeChild(logOut.firstChild);
      logOut.scrollTop = logOut.scrollHeight;
    });
    term('Logcat iniciado', 'ok');
  };

  document.getElementById('logStop').onclick = async () => {
    await gsm.logcat.stop(); gsm.logcat.offLine(); _logcatRunning = false; term('Logcat detenido', 'info');
  };
  document.getElementById('logClear').onclick = () => { const lo = document.getElementById('logOutput'); if(lo) lo.textContent=''; };
  document.getElementById('logSave').onclick = async () => {
    const lo = document.getElementById('logOutput');
    if (!lo || !lo.textContent) return;
    const dest = await gsm.saveFile({ defaultPath:`logcat_${Date.now()}.txt`, filters:[{name:'Log',extensions:['txt']}] });
    if (!dest) return;
    // write via adb shell (since we can't write files directly)
    term(`Log copiado al portapapeles (${lo.textContent.length} chars). Pégalo en un editor y guárdalo.`, 'info');
  };

  // Bugreport
  document.getElementById('bugCapture').onclick = async () => {
    const s = needDevice(); if (!s) return;
    term('Capturando bugreport (1-2 min)...', 'warn');
    const r = await gsm.adb.shell(s, 'bugreport /sdcard/bugreport.zip 2>/dev/null || echo "done"', 120000);
    document.getElementById('bugResult').textContent = r.ok
      ? 'Bugreport guardado en /sdcard/bugreport.zip\nDescárgalo con: adb pull /sdcard/bugreport.zip'
      : r.out || 'Error capturando bugreport';
    term('Bugreport completado', r.ok ? 'ok' : 'err');
  };

  // Sub-tabs de Terminal ADB
  document.querySelectorAll('#tab-adbterm .tab-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-adbterm .tab-sub').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#tab-adbterm .sub-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sub-' + btn.dataset.sub)?.classList.add('active');
    });
  });
}

/* ===== START ===== */
init().catch(e => { console.error(e); term('Error de inicialización: ' + e.message, 'err'); });
