#!/bin/sh
# 老兵说 一键部署（Linux）
#   sudo ./deploy.sh            安装并启动（root 下注册 systemd 服务，开机自启）
#   sudo ./deploy.sh restart    重启
#   sudo ./deploy.sh status     查看状态
#   sudo ./deploy.sh uninstall  停止并移除服务（保留 data/ 数据）
# 指定 Python：PYTHON=/path/to/python3 sudo -E ./deploy.sh
set -e
cd "$(dirname "$0")"
DIR=$(pwd)
NAME=laobingshuo
UNIT=/etc/systemd/system/$NAME.service
ACTION=${1:-install}

use_systemd() { [ "$(id -u)" = 0 ] && command -v systemctl >/dev/null 2>&1; }

find_python() {
  for p in "$PYTHON" python3 python; do
    [ -n "$p" ] || continue
    if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then
      command -v "$p"; return 0
    fi
  done
  echo "未找到 Python 3.8 及以上版本。请先安装，或用 PYTHON=/path/to/python3 指定。" >&2
  exit 1
}

port() { sed -n 's/^PORT=//p' .env | tail -1 | tr -d ' "'\'; }

start_bg() {
  pkill -f "$DIR/server.py" 2>/dev/null || true
  nohup "$1" "$DIR/server.py" >> data/server.log 2>&1 &
}

# 注册 systemd 服务；任何一步失败都返回非 0，由调用方回退到直接启动
install_service() {
  cat > "$UNIT" <<EOF || return 1
[Unit]
Description=laobingshuo
After=network.target

[Service]
WorkingDirectory=$DIR
ExecStart=$1 $DIR/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload >/dev/null 2>&1 && systemctl enable "$NAME" >/dev/null 2>&1 && systemctl restart "$NAME" >/dev/null 2>&1
}

# 等端口能连上，最多 10 秒
check_up() { "$1" "$DIR/server.py" check; }

case "$ACTION" in
  install)
    PY=$(find_python)
    [ -f .env ] || { cp .env.example .env; echo "已生成 .env（默认配置，LDAP 与 AI 训战平台一致）"; }
    mkdir -p data
    if use_systemd && install_service "$PY"; then
      LOG="journalctl -u $NAME"
      echo "已注册系统服务 $NAME，开机自启。"
    else
      if use_systemd; then
        rm -f "$UNIT"; systemctl daemon-reload >/dev/null 2>&1 || true
        echo "警告：开机自启注册失败（systemd 不可用），改为直接在后台启动。服务器重启后需重新运行 deploy.sh。"
      else
        echo "未用 root 运行，没有注册开机自启，直接在后台启动。"
      fi
      start_bg "$PY"
      LOG="tail -50 $DIR/data/server.log"
    fi
    if check_up "$PY"; then
      IP=$(hostname -I 2>/dev/null | awk '{print $1}')
      echo "启动成功。访问地址：http://${IP:-本机IP}:$(port)"
      echo "提示：第一个登录的人会自动成为助理。"
    else
      echo "启动失败，端口 $(port) 没有响应（可能被占用）。查看日志：$LOG"
      exit 1
    fi
    ;;
  restart)
    if use_systemd && [ -f "$UNIT" ] && systemctl restart "$NAME" >/dev/null 2>&1; then :; else start_bg "$(find_python)"; fi
    echo "已重启"
    ;;
  status)
    if use_systemd && [ -f "$UNIT" ]; then systemctl status "$NAME" --no-pager; else pgrep -af "$DIR/server.py" || echo "未运行"; fi
    ;;
  uninstall)
    if use_systemd && [ -f "$UNIT" ]; then
      systemctl disable --now "$NAME" >/dev/null 2>&1 || true
      rm -f "$UNIT"; systemctl daemon-reload
    fi
    pkill -f "$DIR/server.py" 2>/dev/null || true
    echo "已停止并移除服务，data/ 数据保留。"
    ;;
  *)
    echo "用法：$0 [install|restart|status|uninstall]"; exit 1
    ;;
esac
