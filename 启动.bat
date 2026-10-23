@echo off
cd /d "%~dp0"
title 早安徐汇编辑器 - 本地服务（关闭本窗口即停止）

set "PSEXE=powershell"
where pwsh >nul 2>nul && set "PSEXE=pwsh"

echo.
echo   正在启动「早安徐汇」图片文字编辑器...
echo   浏览器会自动打开；如果没打开，请手动访问 http://127.0.0.1:5310/
echo.

%PSEXE% -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

echo.
echo   服务已退出。按任意键关闭窗口。
pause >nul
