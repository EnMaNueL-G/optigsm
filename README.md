# OptiGSM — Suite Profesional de Reparación Android

<p align="center">
  <img src="assets/icon.png" width="90" alt="OptiGSM Logo" />
</p>

<p align="center">
  <strong>La herramienta todo-en-uno para técnicos de reparación de móviles Android</strong><br>
  ADB · Fastboot · Samsung · MTK · Qualcomm · FRP · Firmware · Co-Pilot IA · CRM
</p>

<p align="center">
  <a href="https://optisuite.app/optigsm"><img src="https://img.shields.io/badge/Descargar-OptiGSM_PRO-1f6feb?style=for-the-badge&logo=windows" alt="Descargar"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/Plataforma-Windows_10%2F11-0078d4?style=for-the-badge&logo=windows11" alt="Windows">
  &nbsp;
  <img src="https://img.shields.io/badge/Versión-1.0.0-2ea043?style=for-the-badge" alt="v1.0.0">
</p>

---

## ¿Qué es OptiGSM?

**OptiGSM** es una suite de escritorio para Windows (Electron) orientada a profesionales del servicio técnico de telefonía móvil. Unifica en una sola interfaz todas las operaciones que normalmente requieren 5-6 herramientas distintas:

| Módulo | Qué hace |
|---|---|
| **ADB / Fastboot** | Shell, captura, reboot, backup, logcat, WiFi ADB |
| **Samsung (Heimdall)** | Flash firmware, PIT, cambio de CSC, EFS backup |
| **MTK (mtkclient)** | Flash, EFS, GPT, FRP, unlock bootloader |
| **Qualcomm (EDL)** | Particiones, EFS, FRP, backup crítico |
| **FRP Bypass** | 8 métodos automáticos según chip y Android |
| **Test Hardware** | Pantalla, vibración, sensores, batería, cámara |
| **Espejo (scrcpy)** | Ver y controlar el dispositivo en tiempo real |
| **Terminal ADB** | 80+ comandos en 9 categorías con sugerencias |
| **Co-Pilot IA** | Asistente con IA local (Ollama / LM Studio) |
| **CRM** | Clientes, historial de reparaciones, estadísticas |
| **Calculadoras** | IMEI, descifrado de patrones, resistencias, batería |
| **Drivers USB** | Descarga directa: Universal, Google, Samsung, MTK, QC |

---

## Capturas de pantalla

<!-- Añadir capturas una vez generadas -->

> *Las capturas se agregarán próximamente. Descarga la versión de demostración para verla en acción.*

---

## Características destacadas

- **Sin instalación de dependencias complejas** — ADB incluido, scrcpy detectable automáticamente
- **Co-Pilot IA 100% local** — pregunta sobre cualquier procedimiento sin enviar datos a la nube
- **Compatible con TV Box** — conexión por WiFi ADB, cambio de launcher, instalar APKs, ajustar densidad
- **CRM integrado** — registra clientes, reparaciones, fechas de entrega y genera estadísticas
- **Licencia mensual** — actívala con tu clave directamente desde Ajustes

---

## Instalación

### Requisitos
- Windows 10 / 11 (64-bit)
- .NET Framework 4.8 (incluido en Windows 10+)
- USB Debugging habilitado en el dispositivo Android

### Pasos
1. Descarga el instalador desde [optisuite.app/optigsm](https://optisuite.app/optigsm)
2. Ejecuta `OptiGSM-Setup.exe`
3. Activa tu licencia en **Ajustes → Licencia**

---

## Conexión de TV Box

Si tu TV Box **solo tiene puertos USB-A (hembra)**:

1. **Método recomendado — WiFi ADB:**
   - Ajustes → Opciones de desarrollador → Depuración ADB por red → Activar
   - En OptiGSM: Panel principal → ADB WiFi → introduce la IP (ej: `192.168.1.x:5555`)
2. **Cable USB-A a USB-A** (macho a macho) si el TV Box lo soporta como periférico
3. **Puerto micro-USB oculto** — muchos TV Box tienen uno en la parte posterior para firmware

---

## Código de demostración

Este repositorio contiene una versión simplificada con las funciones básicas de ADB.  
El código completo de la suite PRO es privado.

```bash
git clone https://github.com/EnMaNueL-G/optigsm
cd optigsm
npm install
npm start
```

---

## Licencia y precio

| Plan | Precio | Incluye |
|---|---|---|
| **PRO** | ~9,99€/mes | Todos los módulos + Co-Pilot IA + CRM + soporte |
| **Demo** | Gratis | ADB básico, 7 días de prueba completa |

Adquiere tu licencia en **[optisuite.app/optigsm](https://optisuite.app/optigsm)**

---

## OptiSuite — Ecosistema completo

| App | Descripción |
|---|---|
| [OptiGSM](https://optisuite.app/optigsm) | Suite reparación Android (este proyecto) |
| [OptiDocs](https://optisuite.app/optidocs) | IA local para documentos + RAG |
| [OptiFleet](https://optisuite.app/optifleet) | Gestión de múltiples dispositivos Android |
| [OptiSocial](https://optisuite.app/optisocial) | Gestor SMM multi-cuenta |
| [OptiCert](https://optisuite.app/opticert) | Diagnóstico y certificado para móviles usados |

---

<p align="center">
  Desarrollado por <strong>Enmanuel Gil</strong> · <a href="https://optisuite.app">optisuite.app</a><br>
  <sub>OptiGSM es una herramienta para uso profesional y educativo en servicio técnico autorizado.</sub>
</p>
