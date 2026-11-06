@echo off
:: Talks to the Cmder window (frontend/). Clink users can type /settings instead.
::   cmder-ui settings       open the settings panel
::   cmder-ui new            open the shell picker
::   cmder-ui theme <name>   switch theme, e.g. cmder-ui theme nord
setlocal
if not defined CMDER_UI (
    echo cmder-ui only works inside the Cmder window.
    exit /b 1
)
for /f %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"
set "req=%~1"
if "%req%"=="" set "req=settings"
if /i "%req%"=="new" set "req=palette"
if /i "%req%"=="theme" set "req=theme=%~2"
<nul set /p "=%ESC%]7337;%req%%ESC%\"
endlocal
