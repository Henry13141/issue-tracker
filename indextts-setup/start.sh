#!/bin/bash
# IndexTTS macOS 启动脚本
# 用法：./start.sh
# 服务启动后访问 http://localhost:7860

cd "$(dirname "$0")"

export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
export PYTHONUNBUFFERED=1

LOG_DIR="$(dirname "$0")/logs"
mkdir -p "$LOG_DIR"

echo ""
echo " ╔══════════════════════════════════╗"
echo " ║  IndexTTS 语音合成服务           ║"
echo " ║  启动后访问 http://localhost:7860 ║"
echo " ╚══════════════════════════════════╝"
echo ""

while true; do
    LOG_FILE="$LOG_DIR/webui_$(date +%Y%m%d_%H%M%S).log"
    echo "$(date): 启动中，日志: $LOG_FILE"
    uv run python -u webui.py 2>&1 | tee "$LOG_FILE"
    EXIT_CODE=${PIPESTATUS[0]}
    echo "$(date): 服务退出（退出码 $EXIT_CODE），3 秒后自动重启，Ctrl+C 停止..."
    sleep 3
done
