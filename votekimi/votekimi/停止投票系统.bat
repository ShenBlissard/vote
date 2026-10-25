@echo off
title 停止投票系统
cd /d "%~dp0"

netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  if exist ".stop" del ".stop"
  echo 当前没有正在运行的投票系统。
  pause
  exit /b 0
)

echo stop > ".stop"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
echo 已停止投票系统。
pause
