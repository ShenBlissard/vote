@echo off
title 后台静默运行投票系统
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  if not exist "C:\Program Files\nodejs\node.exe" (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo 请先运行一次「启动投票系统.bat」完成依赖安装，再使用后台模式。
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo 请先运行一次「启动投票系统.bat」完成构建，再使用后台模式。
  pause
  exit /b 1
)

netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo 系统已在运行，直接打开网页……
  start "" "http://localhost:3000"
  exit /b 0
)

wscript.exe "%~dp0silent.vbs" "%~dp0启动投票系统.bat"
echo 投票系统已在后台启动，就绪后将自动打开浏览器。
echo 窗口可以关闭；需要停止系统时请运行「停止投票系统.bat」。
pause
