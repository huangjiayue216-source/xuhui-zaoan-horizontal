@echo off
cd /d "%~dp0"
title 停止早安徐汇编辑器服务

if not exist "data\server.pid" goto nopid
set /p SRVPID=<"data\server.pid"
echo 正在停止服务 (PID %SRVPID%) ...
taskkill /F /PID %SRVPID% >nul 2>nul
del "data\server.pid" >nul 2>nul
echo 已停止。
pause >nul
exit /b

:nopid
echo 没有找到运行中的服务（data\server.pid 不存在）。
echo 如果服务窗口还开着，直接关闭那个窗口即可。
pause >nul
