@echo off
rem The Windows service runs this instead of node directly, because NSSM did not reliably start the game
rem again after it exited. The game exits on purpose to restart for a deploy (it warns the players and
rem saves first), and it can crash; either way this brings it straight back after three seconds.
rem Install: Copy-Item C:\krosshair\deploy\run-game.cmd C:\krosshair-deploy\run-game.cmd -Force
rem A copy is used so a deploy never rewrites a batch file while it is running.
cd /d C:\krosshair
:loop
"C:\Program Files\nodejs\node.exe" src\arena\multiplayer-server.mjs
echo %date% %time% game exited with code %errorlevel%, starting it again in 3 seconds
ping -n 4 127.0.0.1 >nul
goto loop
