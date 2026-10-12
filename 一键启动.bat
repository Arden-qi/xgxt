@echo off
REM ===========================================================================
REM  Liangzhi SMS . Unified Portal   ONE-CLICK START
REM
REM  This file is deliberately ASCII-only.
REM  Reason: cmd.exe parses .bat files using the system ANSI code page (GBK on
REM  Chinese Windows), so a UTF-8 .bat containing Chinese text gets mangled --
REM  titles become garbage and even variables can be corrupted.
REM  All the real work (and all the Chinese output) lives in tools\start.mjs,
REM  which Node reads as UTF-8 and prints correctly.
REM
REM  Change console to UTF-8 (65001) so Node's Chinese output renders properly.
REM ===========================================================================

setlocal
chcp 65001 >nul 2>&1

REM Force UTF-8 for Node's stdio on Windows.
set "PYTHONIOENCODING=utf-8"

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :no_node

if not exist "tools\start.mjs" goto :no_entry

node "tools\start.mjs" %*
goto :done

:no_node
echo.
echo   [ERROR] Node.js not found. / 没有找到 Node.js
echo.
echo   Please install Node.js 18 or higher, then run this file again.
echo   请先安装 Node.js 18 或更高版本，然后重新双击本文件。
echo.
echo   Download / 下载地址: https://nodejs.org   (choose LTS / 选 LTS)
echo.
pause
exit /b 1

:no_entry
echo.
echo   [ERROR] tools\start.mjs not found.
echo   The package looks incomplete -- please re-extract the archive.
echo.
echo   找不到 tools\start.mjs，包可能解压不完整，请重新解压。
echo.
pause
exit /b 1

:done
REM If start.mjs exited with an error, keep the window open so the user can read it.
if errorlevel 1 (
  echo.
  echo   ---- startup returned an error, see messages above / 启动未成功，请看上面的提示 ----
  echo.
  pause
)
exit /b 0
