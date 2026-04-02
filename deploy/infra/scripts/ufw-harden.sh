#!/usr/bin/env bash
# Example UFW rules for infra host. Review YOUR_SSH_IP before running.
# Usage: sudo YOUR_SSH_IP=1.2.3.4 bash ufw-harden.sh
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo YOUR_SSH_IP=x.x.x.x bash $0"
  exit 1
fi

SSH_IP="${YOUR_SSH_IP:-}"

ufw default deny incoming
ufw default allow outgoing

if [[ -n "${SSH_IP}" ]]; then
  ufw allow from "${SSH_IP}" to any port 22 proto tcp comment "SSH from admin"
else
  echo "WARNING: YOUR_SSH_IP not set; allowing SSH from anywhere (change later)"
  ufw allow 22/tcp
fi

ufw allow 80/tcp comment "HTTP ACME / redirect"
ufw allow 443/tcp comment "HTTPS Caddy"
# Squid: restrict to your egress (e.g. Vercel); example — replace with real CIDRs
# ufw allow from 0.0.0.0/0 to any port 3128 proto tcp comment "Squid — tighten me"

ufw --force enable
ufw status verbose
