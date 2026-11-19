@echo off
rem The stdio command of DroneClean Studio's MCP server (task 2.2, design 4.1).
rem
rem An MCP client configured with this file gets a stdio server: it runs
rem launcher.mjs beside it under the app's own Electron binary in Node mode, so
rem a client needs no Node of its own, and the launcher starts the app with --mcp
rem when it is closed. Point DRONECLEAN_APP_BINARY at another copy of the app to use
rem that one instead.
setlocal
set "MCP_DIR=%~dp0"
if not defined DRONECLEAN_APP_BINARY set "DRONECLEAN_APP_BINARY=%MCP_DIR%..\..\DroneClean Studio.exe"
if not exist "%MCP_DIR%launcher.mjs" (
  echo DroneClean Studio: launcher.mjs is missing beside %~f0; reinstall the app. 1>&2
  exit /b 2
)
if not exist "%DRONECLEAN_APP_BINARY%" (
  echo DroneClean Studio: the app binary was not found at %DRONECLEAN_APP_BINARY%. 1>&2
  exit /b 2
)
rem ELECTRON_RUN_AS_NODE makes this process (the launcher) run under the app's
rem own Node; the launcher starts the app itself without it.
set "ELECTRON_RUN_AS_NODE=1"
"%DRONECLEAN_APP_BINARY%" "%MCP_DIR%launcher.mjs" %*
exit /b %errorlevel%
