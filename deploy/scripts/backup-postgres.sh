#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bbt-corporate}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bbt-corporate}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL nao configurado em $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/bbt-postgres-$timestamp.sql.gz"

find "$BACKUP_DIR" -type f -name 'bbt-postgres-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Backup criado: $BACKUP_DIR/bbt-postgres-$timestamp.sql.gz"
