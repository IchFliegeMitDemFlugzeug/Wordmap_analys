@echo off
cd /d "%~dp0"
chcp 65001 >nul
if not exist node_modules npm ci
node main.mjs
if errorlevel 1 pause

