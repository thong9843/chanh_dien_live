@echo off
chcp 65001 >nul
echo ========================================================
echo   Chanh Dien Tinh Tam - VieNeu TTS Sidecar (:5000)
echo ========================================================
cd /d "%~dp0"
if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)
python app.py
pause

