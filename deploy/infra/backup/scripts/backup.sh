#!/usr/bin/env bash
# Run as root (cron). Backs up Squid config, /opt/infra (excluding large caches), Redis RDB, Kuma sqlite dir.
set -euo pipefail

INFRA_ROOT="${INFRA_ROOT:-/opt/infra}"
OUT="${INFRA_ROOT}/backup/output"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [[ ! -f "${INFRA_ROOT}/.env" ]]; then
  echo "Missing ${INFRA_ROOT}/.env" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "${INFRA_ROOT}/.env"

mkdir -p "${OUT}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# Trigger Redis save (container must be running)
if docker ps --format '{{.Names}}' | grep -qx infra-redis; then
  docker exec infra-redis redis-cli -a "${REDIS_PASSWORD}" --no-auth-warning BGSAVE || true
  sleep 3
fi

ARCHIVE="${TMP}/infra-backup-${STAMP}.tar.gz"

tar -czf "${ARCHIVE}" \
  -C / \
  --exclude='opt/infra/redis/data/appendonlydir' \
  opt/infra/docker-compose.yml \
  opt/infra/.env \
  opt/infra/caddy/Caddyfile \
  opt/infra/caddy/config \
  opt/infra/caddy/data \
  opt/infra/uptime-kuma/data \
  opt/infra/redis/data \
  opt/infra/webhook \
  opt/infra/backup/scripts

mv "${ARCHIVE}" "${OUT}/"

# Squid (optional)
squid_paths=()
[[ -f /etc/squid/squid.conf ]] && squid_paths+=(etc/squid/squid.conf)
[[ -f /etc/squid/passwd ]] && squid_paths+=(etc/squid/passwd)
if ((${#squid_paths[@]})); then
  tar -czf "${OUT}/squid-${STAMP}.tar.gz" -C / "${squid_paths[@]}"
fi

find "${OUT}" -name 'infra-backup-*.tar.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
find "${OUT}" -name 'squid-*.tar.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true

echo "$(date -Iseconds) backup ok -> ${OUT}/infra-backup-${STAMP}.tar.gz"
