#!/bin/sh
set -eu
umask 077

for name in PGHOST PGDATABASE PGUSER BACKUP_ROOT STORAGE_ROOT; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "$name e obrigatoria." >&2
    exit 1
  fi
done

case "$BACKUP_ROOT" in
  /|'') echo "BACKUP_ROOT inseguro." >&2; exit 1 ;;
esac
case "$STORAGE_ROOT" in
  /|'') echo "STORAGE_ROOT inseguro." >&2; exit 1 ;;
esac

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_dir="$BACKUP_ROOT/$timestamp"
work_dir="$BACKUP_ROOT/.incomplete-$timestamp-$$"
retention_days="${BACKUP_RETENTION_DAYS:-14}"

if [ -e "$final_dir" ] || [ -e "$work_dir" ]; then
  echo "Destino de backup ja existe." >&2
  exit 1
fi

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM
mkdir -p "$work_dir"

pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$work_dir/database.dump"
test -s "$work_dir/database.dump"

tar -C "$STORAGE_ROOT" -czf "$work_dir/files.tar.gz" .
test -s "$work_dir/files.tar.gz"

if [ "$(psql -X -Atqc "select to_regclass('public.tenants') is not null")" = "t" ]; then
  tenant_count="$(psql -X -Atqc 'select count(*) from tenants')"
else
  tenant_count=0
fi
file_count="$(find "$STORAGE_ROOT" -type f | wc -l | tr -d ' ')"
cat > "$work_dir/manifest.json" <<EOF
{"created_at":"$timestamp","database":"$PGDATABASE","tenant_count":$tenant_count,"file_count":$file_count,"format_version":1}
EOF

(cd "$work_dir" && sha256sum database.dump files.tar.gz manifest.json > SHA256SUMS)
mv "$work_dir" "$final_dir"
trap - EXIT INT TERM

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '????????T??????Z' -mtime "+$retention_days" -exec rm -rf -- {} +
echo "Backup concluido: $final_dir"
