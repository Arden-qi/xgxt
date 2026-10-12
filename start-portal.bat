@echo off
REM ===========================================================================
REM  Liangzhi SMS . Unified Portal   START (thin wrapper, ASCII-only)
REM
REM  Original version had the a hardcoded database host and
REM  a fixed 28s sleep. Now it just delegates to tools\start.mjs, which does
REM  the real work: env check, deps, migrate, services, port readiness, browser.
REM
REM  Kept for backwards compatibility -- both this and 一键启动.bat work.
REM ===========================================================================

setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :no_node

if not exist "tools\start.mjs" goto :no_entry

node "tools\start.mjs" %*
goto :done

:no_node
echo.
echo   [ERROR] Node.js not found. Install Node 18+ first.
echo   没有找到 Node.js，请先安装 Node.js 18 或更高版本：https://nodejs.org
echo.
pause
exit /b 1

:no_entry
echo.
echo   [ERROR] tools\start.mjs not found. Re-extract the archive.
echo   找不到 tools\start.mjs，请重新解压压缩包。
echo.
pause
exit /b 1

:done
if errorlevel 1 (
  echo.
  echo   ---- startup returned an error, see messages above ----
  echo.
  pause
)
exit /b 0
