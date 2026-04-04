#!/usr/bin/env bash
# 推送到 origin/main 后重启本地 Next 开发服务
set -euo pipefail
cd "$(dirname "$0")/.."
git push origin main
exec bash scripts/restart-dev.sh
