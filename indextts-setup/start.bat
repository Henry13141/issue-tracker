@echo off
chcp 65001 >nul
title IndexTTS 语音合成服务

:: 切换到脚本所在目录
cd /d "%~dp0"

set NO_PROXY=localhost,127.0.0.1
set no_proxy=localhost,127.0.0.1
set PYTHONUNBUFFERED=1

if not exist logs mkdir logs

echo.
echo  ╔══════════════════════════════════╗
echo  ║  IndexTTS 语音合成服务           ║
echo  ║  启动后访问 http://localhost:7860 ║
echo  ╚══════════════════════════════════╝
echo.

:loop
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set DATE=%%c%%b%%a
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set TIME=%%a%%b
set LOG_FILE=logs\webui_%DATE%_%TIME%.log

echo [%date% %time%] 启动中...
uv run python -u webui.py
echo.
echo [%date% %time%] 服务退出，3 秒后自动重启，按 Ctrl+C 停止...
timeout /t 3 /nobreak >nul
goto loop
