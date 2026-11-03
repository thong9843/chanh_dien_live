@echo off
rem Mo overlay trong cua so Edge rieng de TikTok LIVE Studio quay bang Window capture.
rem Can chay server truoc (npm start trong thu muc live).
cd /d "%~dp0"

rem ---- Kich thuoc cua so (muon net hon khi LIVE Studio phat 720p: thu W=576 H=1024) ----
set W=540
set H=960
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

rem --user-data-dir rieng: neu khong, cua so se gop vao tien trinh Edge cu va cac co ben duoi mat tac dung.
start "" "%EDGE%" --app=http://localhost:%PORT%/live/overlay.html --window-size=%W%,%H% --user-data-dir="%LOCALAPPDATA%\chanh_dien_overlay" --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows

echo Da mo overlay %W%x%H%. Bam "Bat am thanh" mot lan trong cua so do.
pause
