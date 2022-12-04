@pushd %~dp0
set TZ=Asia/Tokyo
node web.js
@popd
@if errorlevel 1 pause
