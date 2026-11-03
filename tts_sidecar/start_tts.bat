@echo off
chcp 65001 >nul
echo ========================================================
echo   Chanh Dien Tinh Tam - VieNeu TTS Sidecar
echo ========================================================
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [VieNeu Sidecar] Khoi tao virtual environment tai .venv...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Khong the tao virtual environment.
        pause
        exit /b 1
    )
    call ".venv\Scripts\activate.bat"
    echo [VieNeu Sidecar] Cai dat thu vien tu requirements.txt...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Cai dat requirements.txt that bai.
        pause
        exit /b 1
    )
) else (
    call ".venv\Scripts\activate.bat"
)

python app.py
pause
