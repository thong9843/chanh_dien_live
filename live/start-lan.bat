@echo off
rem Chạy server với chế độ xem overlay qua LAN (điện thoại cùng WiFi). Control vẫn chỉ ở localhost.
cd /d "%~dp0"
set LAN=1
npm start
