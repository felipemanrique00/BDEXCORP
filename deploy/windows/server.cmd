@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "COMMAND=%~1"

if /I "%COMMAND%"=="start" set "SCRIPT=start-server.ps1"
if /I "%COMMAND%"=="stop" set "SCRIPT=stop-server.ps1"
if /I "%COMMAND%"=="restart" set "SCRIPT=restart-server.ps1"
if /I "%COMMAND%"=="status" set "SCRIPT=status-server.ps1"
if /I "%COMMAND%"=="health" set "SCRIPT=health-check.ps1"
if /I "%COMMAND%"=="logs" set "SCRIPT=logs-server.ps1"
if /I "%COMMAND%"=="backup" set "SCRIPT=backup-server.ps1"
if /I "%COMMAND%"=="install" set "SCRIPT=install-autostart.ps1"
if /I "%COMMAND%"=="tunnel" set "SCRIPT=configure-tailscale.ps1"
if /I "%COMMAND%"=="test" set "SCRIPT=test-deployment.ps1"

if not defined SCRIPT goto usage
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%%SCRIPT%"
exit /b %ERRORLEVEL%

:usage
echo Uso: server.cmd ^<start^|stop^|restart^|status^|health^|logs^|backup^|install^|tunnel^|test^>
exit /b 2
