@echo off
cd /d "%~dp0"
chcp 65001 >nul

set "NODE_DIR=%~dp0.tools\node22"
set "PATH=%NODE_DIR%;%PATH%"

if not exist "%NODE_DIR%\node.exe" (
    echo Node.js 22 not found in .tools\node22
    pause
    exit /b 1
)

if not exist node_modules npm install

node main.mjs
if errorlevel 1 pause
