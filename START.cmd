@echo off
cd /d "%~dp0"
chcp 65001 >nul
if not exist node_modules npm install
node main.mjs
if errorlevel 1 pause
