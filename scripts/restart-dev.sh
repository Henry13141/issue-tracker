#!/usr/bin/env bash
# 结束本机 Next 开发进程并重新启动（默认端口 3000）
set -euo pipefail
cd "$(dirname "$0")/.."
for port in 3000 3001; do
  lsof -ti ":$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
done
exec npm run dev
