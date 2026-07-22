#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git nginx postgresql postgresql-client certbot python3-certbot-nginx ufw build-essential

if ! command -v node >/dev/null 2>&1 || [ "$(node -p "Number(process.versions.node.split('.')[0])")" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

systemctl enable --now postgresql
systemctl enable --now nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "Base do servidor pronta. Copie o projeto para /var/www/bbt-corporate e siga o INSTALAR.txt."
