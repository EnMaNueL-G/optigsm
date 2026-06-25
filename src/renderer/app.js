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
  document.getElementById('btnScan') && (document.getElementById('btnScan').onclick = scanDevices);
  document.getElementById('btnSettings').onclick = () => clickNav('settings');
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
  const ops = await gsm.history.get(100);
  const list = document.getElementById('historyList');
  if (!ops || !ops.length) { list.innerHTML = '<div class="empty-state" style="padding:20px">Sin operaciones registradas</div>'; return; }
  list.innerHTML = ops.map(op => `
    <div class="hist-item">
      <span class="hist-ts">${new Date(op.ts).toLocaleString('es-ES')}</span>
      <span class="hist-op">${op.operation || '—'}</span>
      <span class="hist-detail">${[op.platform, op.model, op.imei].filter(Boolean).join(' · ')}</span>
      <span class="hist-detail">${op.result || ''}</span>
    </div>
  `).join('');
}

/* ===== NAV HELPER ===== */
function clickNav(tab) {
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.click();
}

/* ===== START ===== */
init().catch(e => { console.error(e); term('Error de inicialización: ' + e.message, 'err'); });
