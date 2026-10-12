@echo off
REM ===========================================================================
REM  Liangzhi SMS . Unified Portal   STOP ALL SERVICES
REM
REM  ASCII-only on purpose (see 一键启动.bat for the explanation).
REM  Only kills processes listening on 8004 / 5173. Leaves MySQL running.
REM ===========================================================================

setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :no_node

if not exist "tools\stop.mjs" goto :no_entry

node "tools\stop.mjs"
goto :done

:no_node
echo.
echo   [ERROR] Node.js not found. / 没有找到 Node.js
echo   Please install Node.js 18+ first. / 请先安装 Node.js 18 或更高版本。
echo.
pause
exit /b 1

:no_entry
echo.
echo   [ERROR] tools\stop.mjs not found. Re-extract the archive.
echo   找不到 tools\stop.mjs，请重新解压压缩包。
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
