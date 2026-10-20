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

REM Locate node.exe by ABSOLUTE PATH first. Never rely only on `where node`:
REM if the system PATH value is damaged (e.g. "C:\Windows\system32" accidentally
REM split into "C:\Wi;dows\system32"), where.exe itself cannot be found and the
REM launcher wrongly reports "Node.js not found".
set "NODE_EXE="
if exist "D:\node.js\node.exe" set "NODE_EXE=D:\node.js\node.exe"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe"

REM Last resort: fall back to PATH lookup (works when PATH is healthy).
if not defined NODE_EXE for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%p"

if not defined NODE_EXE goto :no_node

if not exist "tools\start.mjs" goto :no_entry

REM Make node's own folder visible to child processes (npm, etc.).
for %%I in ("%NODE_EXE%") do set "PATH=%%~dpI;%PATH%"

"%NODE_EXE%" "tools\start.mjs" %*
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
