@echo off
cd /d "%~dp0"
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -File "%~dp0Start.ps1"
) else (
  powershell -NoProfile -File "%~dp0Start.ps1"
)
pause
