'use strict';
/* Co-Pilot IA — integración con Ollama y LM Studio (100% local, sin telemetría) */
const http = require('http');
const https = require('https');

const OLLAMA_BASE = 'http://localhost:11434';
const LMSTUDIO_BASE = 'http://localhost:1234';

// ── Utilidad HTTP simple ────────────────────────────────────────────────────
function httpPost(url, body, onChunk, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const proto = parsed.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = proto.request({
      hostname: parsed.hostname, port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout,
    }, (res) => {
      let full = '';
      res.on('data', (chunk) => {
        const s = chunk.toString();
        full += s;
        if (onChunk) onChunk(s);
      });
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, data: full }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function httpGet(url, timeout = 5000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const proto = parsed.protocol === 'https:' ? https : http;
    const req = proto.get({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, timeout }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ ok: res.statusCode < 400, data }));
    });
    req.on('error', () => resolve({ ok: false, data: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: '' }); });
  });
}

// ── Detección de backends ───────────────────────────────────────────────────
async function detectBackends() {
  const [ollama, lmstudio] = await Promise.all([
    httpGet(`${OLLAMA_BASE}/api/tags`),
    httpGet(`${LMSTUDIO_BASE}/v1/models`),
  ]);
  return {
    ollama: ollama.ok,
    lmstudio: lmstudio.ok,
    any: ollama.ok || lmstudio.ok,
  };
}

async function listModels() {
  const models = [];
  const ollamaR = await httpGet(`${OLLAMA_BASE}/api/tags`);
  if (ollamaR.ok) {
    try {
      const j = JSON.parse(ollamaR.data);
      (j.models || []).forEach(m => models.push({ id: m.name, name: m.name, backend: 'ollama', size: m.size }));
    } catch (_) {}
  }
  const lmR = await httpGet(`${LMSTUDIO_BASE}/v1/models`);
  if (lmR.ok) {
    try {
      const j = JSON.parse(lmR.data);
      (j.data || []).forEach(m => models.push({ id: m.id, name: m.id, backend: 'lmstudio' }));
    } catch (_) {}
  }
  return models;
}

// ── Contexto del dispositivo ────────────────────────────────────────────────
function buildDeviceContext(info) {
  if (!info || !info.model) return 'No hay dispositivo conectado.';
  const lines = [
    `Modelo: ${info.model || '?'} (${info.brand || '?'})`,
    `Android: ${info.android || '?'} (SDK ${info.sdk || '?'})`,
    `Chipset/CPU: ${info.cpu || '?'}`,
    info.imei1 ? `IMEI 1: ${info.imei1}` : null,
    info.ram    ? `RAM: ${info.ram}` : null,
    info.storage ? `Almacenamiento: ${info.storage}` : null,
    info.battery ? `Batería: ${info.battery}` : null,
    info.knox    ? `Knox: ${info.knox}` : null,
    info.widevine ? `Widevine: ${info.widevine}` : null,
    info.bootloader ? `Bootloader: ${info.bootloader}` : null,
    info.build   ? `Build: ${info.build}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

const SYSTEM_PROMPT = `Eres OptiGSM Co-Pilot, un asistente técnico experto en reparación de teléfonos Android.
Conoces a fondo: ADB, Fastboot, Heimdall, MTK (mtkclient), Qualcomm EDL/Firehose, Samsung, Huawei, Xiaomi, FRP bypass, IMEI, firmware, recovery, root, Magisk, TWRP, errores de bootloop, diagnóstico de hardware.

REGLAS:
- Responde SIEMPRE en español.
- Da instrucciones paso a paso, concretas y seguras.
- Si la operación puede borrar datos, AVISA primero.
- Si necesitas más información del técnico, pídela claramente.
- Usa el contexto del dispositivo conectado cuando sea relevante.
- Sé honesto: si no sabes algo, dilo. No inventes métodos que no existen.
- Cuando des comandos ADB o shell, ponlos en bloques de código.`;

// ── Chat principal ──────────────────────────────────────────────────────────
async function chat({ messages, model, deviceInfo, backend }, onChunk) {
  const ctx = buildDeviceContext(deviceInfo);
  const systemMsg = SYSTEM_PROMPT + (ctx && ctx !== 'No hay dispositivo conectado.'
    ? `\n\nDISPOSITIVO ACTUALMENTE CONECTADO:\n${ctx}`
    : '');

  const fullMessages = [
    { role: 'system', content: systemMsg },
    ...(messages || []),
  ];

  // Determine backend: auto-detect if not specified
  let useBackend = backend;
  if (!useBackend) {
    const b = await detectBackends();
    useBackend = b.ollama ? 'ollama' : (b.lmstudio ? 'lmstudio' : null);
  }
  if (!useBackend) return { ok: false, out: 'No se detectó Ollama ni LM Studio.\n\nInstala Ollama: https://ollama.com\nO LM Studio: https://lmstudio.ai' };

  let fullText = '';
  const collectChunk = (raw) => {
    // Parse streaming responses
    raw.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line === 'data: [DONE]') return;
      if (line.startsWith('data: ')) line = line.slice(6);
      try {
        const j = JSON.parse(line);
        // Ollama: j.message.content or j.response
        // LM Studio / OpenAI: j.choices[0].delta.content
        const token = (j.message && j.message.content) || j.response ||
          (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '';
        if (token) { fullText += token; if (onChunk) onChunk(token); }
      } catch (_) {}
    });
  };

  try {
    if (useBackend === 'ollama') {
      await httpPost(`${OLLAMA_BASE}/api/chat`, {
        model: model || 'mistral',
        messages: fullMessages,
        stream: true,
      }, collectChunk, 120000);
    } else {
      await httpPost(`${LMSTUDIO_BASE}/v1/chat/completions`, {
        model: model || 'local-model',
        messages: fullMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 2048,
      }, collectChunk, 120000);
    }
    return { ok: true, out: fullText };
  } catch (e) {
    return { ok: false, out: `Error al conectar con ${useBackend}: ${e.message}` };
  }
}

// ── Prompts predefinidos ────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  { id: 'frp', label: '🔓 FRP Bypass', prompt: '¿Cuál es el mejor método para hacer FRP bypass en este dispositivo? Dame los pasos detallados.' },
  { id: 'imei', label: '📡 Reparar IMEI', prompt: '¿Cómo puedo reparar o restaurar el IMEI de este dispositivo? Dame los pasos seguros.' },
  { id: 'bootloop', label: '🔄 Bootloop', prompt: 'El teléfono está en bootloop. ¿Qué pasos debo seguir para diagnosticar y solucionar el problema?' },
  { id: 'firmware', label: '💾 Flash firmware', prompt: '¿Cómo actualizo o restauro el firmware completo de este dispositivo de forma segura?' },
  { id: 'recovery', label: '🛠 Instalar recovery', prompt: '¿Cómo instalo TWRP o un recovery custom en este dispositivo?' },
  { id: 'root', label: '🔑 Root con Magisk', prompt: '¿Cuál es el proceso para hacer root con Magisk en este dispositivo? Dame los pasos completos.' },
  { id: 'screen', label: '🖥 Pantalla bloqueada', prompt: 'El teléfono tiene la pantalla de bloqueo PIN/patrón que no recuerdo. ¿Cómo puedo desbloquearlo sin perder datos?' },
  { id: 'drm', label: '🎬 Widevine L1', prompt: '¿Cómo verifico o recupero la certificación Widevine L1 en este dispositivo?' },
];

module.exports = { detectBackends, listModels, buildDeviceContext, chat, QUICK_PROMPTS };
