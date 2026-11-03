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

rem ---- Chon ban onnxruntime theo phan cung: co card NVIDIA (nvidia-smi chay duoc) thi dung onnxruntime-gpu, khong thi onnxruntime (CPU).
rem Hai goi nay khong duoc cai cung luc nen luon go goi con lai truoc khi doi. Chay moi lan khoi dong de keo repo sang may khac van dung.
set HAS_GPU=0
nvidia-smi -L >nul 2>nul
if not errorlevel 1 set HAS_GPU=1

set HAVE_GPU_PKG=0
python -m pip show onnxruntime-gpu >nul 2>nul
if not errorlevel 1 set HAVE_GPU_PKG=1
set HAVE_CPU_PKG=0
python -m pip show onnxruntime >nul 2>nul
if not errorlevel 1 set HAVE_CPU_PKG=1

if "%HAS_GPU%"=="1" (
    if "%HAVE_GPU_PKG%"=="0" goto :install_gpu
    if "%HAVE_CPU_PKG%"=="1" goto :install_gpu
    echo [VieNeu Sidecar] Phat hien NVIDIA GPU - da co onnxruntime-gpu.
    goto :run
) else (
    if "%HAVE_CPU_PKG%"=="1" if "%HAVE_GPU_PKG%"=="0" (
        echo [VieNeu Sidecar] Khong co NVIDIA GPU - dung onnxruntime CPU. Gioi han luong CPU bang VIENEU_THREADS trong .env ^(mac dinh 2^).
        goto :run
    )
    goto :install_cpu
)

:install_gpu
echo [VieNeu Sidecar] Phat hien NVIDIA GPU: cai onnxruntime-gpu...
python -m pip uninstall -y onnxruntime onnxruntime-gpu
python -m pip install onnxruntime-gpu
if errorlevel 1 (
    echo [WARN] Cai onnxruntime-gpu that bai, quay ve onnxruntime CPU.
    goto :install_cpu
)
goto :run

:install_cpu
echo [VieNeu Sidecar] Cai onnxruntime ^(CPU^)...
python -m pip uninstall -y onnxruntime onnxruntime-gpu
python -m pip install onnxruntime
if errorlevel 1 (
    echo [ERROR] Cai onnxruntime that bai.
    pause
    exit /b 1
)

:run
python app.py
pause
