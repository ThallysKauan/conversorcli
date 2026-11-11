@echo off
node "%~dp0bin\ppnet.mjs" start %*
exit /b %errorlevel%
