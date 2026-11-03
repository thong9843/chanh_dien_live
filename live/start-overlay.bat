@echo off
rem Mo overlay trong cua so Edge rieng de TikTok LIVE Studio quay bang Window capture.
rem Can chay server truoc (npm start trong thu muc live).
rem Canvas luon ve noi bo 1080x1920; cua so nho hon chi la thu nho hien thi, cua so 1080x1920 cho anh net 1:1.
cd /d "%~dp0"

set PORT=3000

set "EDGE="
where msedge >nul 2>nul && set "EDGE=msedge"
if not defined EDGE if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE (
  echo Khong tim thay Microsoft Edge.
  pause
  exit /b 1
)

echo ================================================
echo   Mo overlay Chanh Dien Tinh Tam
echo ================================================
echo   [1] Cua so 540x960   (may thuong, Window capture 720p; thu 576x1024 neu muon net hon)
echo   [2] Cua so 1080x1920 (man hinh doc / man hinh ao, anh net 1:1, may co card do hoa khoe hon)
echo.
choice /c 12 /n /m "Chon 1 hoac 2: "
if errorlevel 2 (
  set W=1080
  set H=1920
) else (
  set W=540
  set H=960
)

rem --user-data-dir rieng: neu khong, cua so se gop vao tien trinh Edge cu va cac co ben duoi mat tac dung.
rem --force-device-scale-factor=1: khong de Windows phong to (125%%, 150%%) lam cua so thanh thieu pixel.
start "" "%EDGE%" --app=http://localhost:%PORT%/live/overlay.html --window-size=%W%,%H% --window-position=0,0 --force-device-scale-factor=1 --user-data-dir="%LOCALAPPDATA%\chanh_dien_overlay_%W%" --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows

echo Da mo overlay %W%x%H%. Bam "Bat am thanh" mot lan trong cua so do.
pause
