@echo off
REM ============================================================
REM  start-nexo.bat  -  Dev launcher para Nexo (axieUIHouston)
REM ------------------------------------------------------------
REM  Instala dependencias (pnpm) y arranca los 3 servicios de
REM  dev en ventanas separadas, equivalente a `pnpm dev` (mprocs)
REM  pero nativo de Windows (los scripts dev:* usan sintaxis
REM  POSIX que no corre en cmd.exe):
REM    - host    (@nexo/host)        -> http://127.0.0.1:4318
REM    - gateway (@nexo/host-cloud)  -> http://127.0.0.1:8090
REM    - app     (Tauri desktop)     -> ventana de escritorio
REM
REM  Prerrequisitos de SISTEMA (se detectan, no se instalan solos):
REM    - Node.js 22.19+     https://nodejs.org
REM    - Rust + cargo       https://rustup.rs   (para la app Tauri)
REM    - VS Build Tools con "Desktop development with C++" (Tauri)
REM  Windows 11 ya trae WebView2.
REM ============================================================

setlocal enableextensions
chcp 65001 >nul
title Nexo - Dev launcher
cd /d "%~dp0"

echo ============================================
echo   Nexo (axieUIHouston) - Dev launcher
echo ============================================
echo.

REM --- Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no encontrado. Instala Node 22.19+ desde https://nodejs.org y vuelve a correr.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [ok] Node %%v

REM --- pnpm (via corepack, version fijada por packageManager) ---
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [..] pnpm no encontrado; activando via corepack...
  call corepack enable
  call corepack prepare pnpm@10.32.1 --activate
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se pudo activar pnpm. Instala manual con:  npm i -g pnpm@10.32.1
  pause
  exit /b 1
)
for /f "delims=" %%v in ('pnpm -v') do echo [ok] pnpm %%v

REM --- Rust / cargo (necesario para compilar la app Tauri) ---
set "NO_CARGO="
where cargo >nul 2>nul
if errorlevel 1 (
  set "NO_CARGO=1"
  echo [WARN] cargo/Rust no encontrado: la app de escritorio Tauri NO compilara.
  echo        Instala Rust desde https://rustup.rs y los VS Build Tools con C++.
) else (
  for /f "delims=" %%v in ('cargo --version') do echo [ok] %%v
)

echo.
echo [..] Instalando dependencias (pnpm install)...
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install fallo. Revisa la salida de arriba.
  pause
  exit /b 1
)
echo [ok] Dependencias instaladas.
echo.

REM --- Env de dev (equivale a dev:host / dev:gateway / dev:app) ---
REM  Se define aqui una sola vez; cada ventana hija las hereda.
set "HOUSTON_HOST_TOKEN=devtoken"
set "HOUSTON_HOST_PORT=4318"
set "CP_DEV=1"
set "CP_PORT=8090"
set "VITE_NEW_ENGINE_URL=http://127.0.0.1:4318"
set "VITE_NEW_ENGINE_TOKEN=devtoken"
set "VITE_HOSTED_ENGINE_URL="

echo [..] Arrancando servicios en ventanas separadas...
start "Nexo Host (4318)"    cmd /k "pnpm --filter @nexo/host dev"
start "Nexo Gateway (8090)" cmd /k "pnpm --filter @nexo/host-cloud dev"

if defined NO_CARGO (
  echo [WARN] Se omite la app Tauri porque falta cargo.
  echo        Instala Rust y luego, dentro de la carpeta app:  pnpm tauri dev
) else (
  start "Nexo App (Tauri)" cmd /k "cd app && pnpm tauri dev"
)

echo.
echo ============================================
echo  Servicios lanzados en ventanas aparte:
echo    Host    : http://127.0.0.1:4318   (ventana "Nexo Host")
echo    Gateway : http://127.0.0.1:8090   (ventana "Nexo Gateway")
echo    App     : ventana "Nexo App (Tauri)"  (abre la ventana de escritorio)
echo.
echo  Nota: la PRIMERA compilacion de Tauri (Rust) tarda varios minutos.
echo  Para detener todo: cierra las ventanas o Ctrl+C en cada una.
echo ============================================
echo.
pause
endlocal
