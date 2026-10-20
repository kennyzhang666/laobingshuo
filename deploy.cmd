@echo off
chcp 65001 >nul
rem laobingshuo one-click deploy (Windows)
rem   deploy.cmd            install and start (as Administrator: register startup task + firewall rule)
rem   deploy.cmd restart    restart
rem   deploy.cmd status     show task status
rem   deploy.cmd uninstall  stop and remove task (data\ is kept)
rem   set PYTHON=C:\path\python.exe before running to choose a Python
setlocal EnableExtensions
cd /d "%~dp0"
set "DIR=%CD%"
set "NAME=laobingshuo"
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=install"

net session >nul 2>&1
if %errorlevel%==0 (set "ADMIN=1") else (set "ADMIN=0")

if /i "%ACTION%"=="install" goto install
if /i "%ACTION%"=="restart" goto restart
if /i "%ACTION%"=="status" goto status
if /i "%ACTION%"=="uninstall" goto uninstall
echo 用法：deploy.cmd [install^|restart^|status^|uninstall]
exit /b 1

:findpython
if defined PYTHON goto checkpython
for /f "delims=" %%p in ('where python 2^>nul') do (
  "%%p" -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1 && if not defined PYTHON set "PYTHON=%%p"
)
:checkpython
if not defined PYTHON goto nopython
"%PYTHON%" -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1 || goto nopython
exit /b 0
:nopython
echo 未找到 Python 3.8 及以上版本。请先安装，或先执行 set PYTHON=C:\路径\python.exe
exit /b 1

:install
call :findpython || (pause & exit /b 1)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo 已生成 .env（默认配置，LDAP 与 AI 训战平台一致）
)
if not exist "data" mkdir "data"
set "PORT=8095"
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" ".env"') do set "PORT=%%b"
if not "%ADMIN%"=="1" goto plainstart
netsh advfirewall firewall delete rule name="%NAME%" >nul 2>&1
netsh advfirewall firewall add rule name="%NAME%" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>&1 || echo 警告：防火墙规则添加失败，其他电脑可能访问不到，请手动放通端口 %PORT%
schtasks /end /tn "%NAME%" >nul 2>&1
schtasks /create /tn "%NAME%" /tr "\"%PYTHON%\" \"%DIR%\server.py\" --log" /sc onstart /ru SYSTEM /rl highest /f >nul 2>&1 || goto taskfail
schtasks /run /tn "%NAME%" >nul 2>&1 || goto taskfail
echo 已注册开机自启任务 %NAME%。
goto check

:taskfail
schtasks /delete /tn "%NAME%" /f >nul 2>&1
echo 警告：开机自启任务注册失败，改为直接启动。服务器重启后需重新运行 deploy.cmd。
goto startnow
:plainstart
echo 未以管理员身份运行：没有注册开机自启，也没有配置防火墙，直接启动。
:startnow
start "laobingshuo" /min "%PYTHON%" "%DIR%\server.py" --log

:check
"%PYTHON%" "%DIR%\server.py" check
if errorlevel 1 goto startfail
echo 启动成功。访问地址：http://本机IP:%PORT%
echo 提示：第一个登录的人会自动成为助理。
pause
exit /b 0
:startfail
echo 启动失败，端口 %PORT% 没有响应（可能被占用）。查看日志：data\server.log
pause
exit /b 1

:restart
schtasks /query /tn "%NAME%" >nul 2>&1 || (echo 未安装，请先运行 deploy.cmd & exit /b 1)
schtasks /end /tn "%NAME%" >nul 2>&1
schtasks /run /tn "%NAME%" >nul
echo 已重启
exit /b 0

:status
schtasks /query /tn "%NAME%" /v /fo list 2>nul | findstr /i /c:"Status" /c:"状态" /c:"Last Run" /c:"上次运行" || echo 未安装
exit /b 0

:uninstall
schtasks /end /tn "%NAME%" >nul 2>&1
schtasks /delete /tn "%NAME%" /f >nul 2>&1
netsh advfirewall firewall delete rule name="%NAME%" >nul 2>&1
echo 已停止并移除任务，data\ 数据保留。
exit /b 0
