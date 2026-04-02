#!/usr/bin/env bash
# 在你自己的 Mac 上执行（需已能 ssh 登录服务器，例如 ssh root@IP）。
# 用法：
#   cd issue-tracker/deploy/infra
#   chmod +x bootstrap-remote.sh
#   REMOTE_HOST=122.51.219.134 REMOTE_USER=root ./bootstrap-remote.sh
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-122.51.219.134}"
REMOTE_USER="${REMOTE_USER:-root}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> rsync ${SCRIPT_DIR}/ -> ${REMOTE_USER}@${REMOTE_HOST}:/opt/infra/"
rsync -avz --delete \
  --exclude '.git' \
  "${SCRIPT_DIR}/" "${REMOTE_USER}@${REMOTE_HOST}:/opt/infra/"

echo "==> remote: install Docker (if needed) + docker compose up"
ssh "${REMOTE_USER}@${REMOTE_HOST}" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/infra
chmod +x install-docker.sh backup/scripts/backup.sh scripts/ufw-harden.sh 2>/dev/null || true
if ! command -v docker &>/dev/null; then
  bash install-docker.sh || curl -fsSL https://get.docker.com | sh
fi
docker --version
docker compose version
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo ""
  echo ">>> 已创建 /opt/infra/.env ，请 SSH 登录服务器后编辑并保存："
  echo "    nano /opt/infra/.env"
  echo "    必填：CADDY_EMAIL、REDIS_PASSWORD、WECOM_WEBHOOK_URL"
  echo "    保存后在本机再执行一次本脚本，或服务器上执行："
  echo "    cd /opt/infra && docker compose build webhook-relay && docker compose up -d"
  echo ""
  exit 0
fi
docker compose build webhook-relay
docker compose up -d
docker compose ps
REMOTE

echo "==> done"
