@echo off
setlocal
title Skeleton2D Studio
cd /d "%~dp0"

set PORT=8788
set URL=http://localhost:%PORT%/

echo ============================================================
echo   Skeleton2D Studio - Godot 骨骼动画制作
echo   地址: %URL%
echo   关闭此窗口即停止服务
echo ============================================================
echo.

if not exist "%~dp0serve.mjs" (
    echo [错误] 未找到 serve.mjs，请确认脚本位于项目根目录
    echo        当前目录: %CD%
    echo.
    pause
    exit /b 1
)

rem ---------- 1. 查找 Node.js 运行时 ----------
set "NODE_BIN="

rem 1a. 系统 PATH
for /f "delims=" %%i in ('where node 2^>nul') do (
    if not defined NODE_BIN set "NODE_BIN=%%i"
)

rem 1b. WorkBuddy 托管目录（不在 PATH 上），按版本号倒序取第一个可用的
if not defined NODE_BIN (
    for /f "delims=" %%v in ('dir /b /o-n "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do (
        if not defined NODE_BIN if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\%%v\node.exe" set "NODE_BIN=%USERPROFILE%\.workbuddy\binaries\node\versions\%%v\node.exe"
    )
)

rem 1c. 官方安装路径
if not defined NODE_BIN if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_BIN if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_BIN (
    echo [错误] 未找到 Node.js 运行时
    echo        已尝试: 系统 PATH / WorkBuddy 托管目录 / Program Files
    echo        如需安装: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [信息] Node.js: %NODE_BIN%
echo.

rem ---------- 2. 端口已占用则直接打开浏览器 ----------
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [提示] 服务已在运行，直接打开浏览器...
    start "" "%URL%"
    timeout /t 2 >nul
    exit /b 0
)

rem ---------- 3. 延迟 2 秒打开浏览器（等服务就绪）----------
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

rem ---------- 4. 前台启动服务，关闭窗口即停止 ----------
"%NODE_BIN%" serve.mjs

echo.
echo 服务已停止。
pause
