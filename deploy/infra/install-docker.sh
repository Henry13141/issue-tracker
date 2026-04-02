#!/usr/bin/env bash
# Ubuntu: install Docker Engine + Compose plugin (official convenience script).
# Run on the server as root: bash install-docker.sh
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (sudo bash install-docker.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg

if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker

# Optional: allow current SSH user to run docker without sudo
if [[ -n "${SUDO_USER:-}" ]]; then
  usermod -aG docker "$SUDO_USER" || true
  echo "Added $SUDO_USER to group docker (re-login for it to take effect)."
fi

docker --version
docker compose version
echo "Docker install complete."
