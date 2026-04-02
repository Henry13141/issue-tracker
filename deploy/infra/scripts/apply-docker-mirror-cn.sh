#!/usr/bin/env bash
# 腾讯云轻量 / 国内访问 Docker Hub 易超时，配置官方推荐镜像加速后重启 Docker。
# 用法：sudo bash apply-docker-mirror-cn.sh
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "请使用: sudo bash $0"
  exit 1
fi

mkdir -p /etc/docker
# 若已有 daemon.json，请先手动合并 registry-mirrors，勿直接覆盖复杂配置
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF

systemctl daemon-reload
systemctl restart docker
sleep 2
docker info 2>/dev/null | grep -A5 "Registry Mirrors" || true
echo "Docker 已重启。请执行: cd /opt/infra && docker compose pull && docker compose up -d --build"
