@echo off
echo ============================================
echo  OptiGSM - Instalacion de dependencias
echo ============================================
echo.

:: Node.js deps
echo [1/3] Instalando dependencias Node.js...
call npm install
if errorlevel 1 (
    echo ERROR: npm install fallo. Asegurate de tener Node.js instalado.
    pause
    exit /b 1
)

:: Python deps
echo.
echo [2/3] Instalando dependencias Python...
python -m pip install -r python\requirements.txt
if errorlevel 1 (
    echo AVISO: pip install fallo. Python puede no estar instalado o no en el PATH.
    echo Instala Python desde https://www.python.org/downloads/
    echo Luego ejecuta: pip install mtkclient edlclient pyserial pyusb
)

:: Check tools
echo.
echo [3/3] Verificando herramientas...
python python\check_tools.py

echo.
echo ============================================
echo  Instalacion completada.
echo  Ejecuta start.bat para iniciar OptiGSM.
echo ============================================
echo.
echo Para herramientas adicionales:
echo   - ADB/Fastboot: https://developer.android.com/studio/releases/platform-tools
echo   - Heimdall: scoop install heimdall (o https://heimdall.wiki.kernel.org)
echo   - mtkclient: pip install mtkclient
echo   - edl (QC): pip install edlclient
echo.
pause
