@echo off
cd /d "%~dp0"
title Replace background template

rem 用 Windows PowerShell 5.1：它能直接编译图像分析代码，速度更快
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE=powershell"

if not "%~1"=="" goto withimage
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0replace-template.ps1"
goto end

:withimage
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0replace-template.ps1" -ImagePath "%~1"

:end
echo.
pause >nul
