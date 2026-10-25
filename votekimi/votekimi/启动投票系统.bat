@echo off
title 班级投票系统
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=%PATH%;C:\Program Files\nodejs"
  ) else (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo 首次运行：正在安装依赖，大约需要1-2分钟，请耐心等待……
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重新运行本程序。
    pause
    exit /b 1
  )
)

if not exist ".next\BUILD_ID" (
  echo 正在构建系统（仅首次或更新后需要），请稍候……
  call npm run build
  if errorlevel 1 (
    echo [错误] 构建失败，请把本窗口截图发给维护者。
    pause
    exit /b 1
  )
)

netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo 系统已在运行，直接打开网页……
  start "" "http://localhost:3000"
  exit /b 0
)

echo.
echo ==================================================
echo   班级投票系统启动中……就绪后浏览器将自动打开
echo   地址：http://localhost:3000
echo   投票期间请保持本窗口开启（最小化没关系）
echo   服务器意外停止会自动重启
echo   停止系统：运行「停止投票系统.bat」或关闭本窗口
echo ==================================================
echo.

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-open.ps1"

:loop
call npm start
if exist ".stop" goto stopped
echo.
echo 服务器已停止，3秒后自动重启……
echo （如需停止系统，请运行「停止投票系统.bat」或直接关闭本窗口）
timeout /t 3 /nobreak >nul
if exist ".stop" goto stopped
goto loop

:stopped
del ".stop" 2>nul
echo.
echo 已收到停止指令，投票系统已完全停止。
exit /b 0
