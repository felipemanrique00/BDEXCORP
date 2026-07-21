#!/bin/sh
set -eu
umask 077

for name in PGHOST PGUSER RESTORE_SOURCE RESTORE_DATABASE RESTORE_STORAGE_ROOT; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "$name e obrigatoria." >&2
    exit 1
  fi
done

case "$RESTORE_DATABASE" in
  ''|*[!A-Za-z0-9_-]*|[0-9-]*)
    echo "RESTORE_DATABASE possui formato invalido." >&2
    exit 1
    ;;
esac
case "$RESTORE_STORAGE_ROOT" in
  /|/var/lib/bbt/files|/var/lib/bbt/files/)
    echo "Diretorio de restore inseguro ou igual ao volume de producao." >&2
    exit 1
    ;;
esac

if [ ! -d "$RESTORE_SOURCE" ]; then
  echo "RESTORE_SOURCE deve apontar para um diretorio de backup." >&2
  exit 1
fi
for file in database.dump files.tar.gz manifest.json SHA256SUMS; do
  test -f "$RESTORE_SOURCE/$file" || { echo "Arquivo ausente: $file" >&2; exit 1; }
done

(cd "$RESTORE_SOURCE" && sha256sum -c SHA256SUMS)

if [ "${PGDATABASE:-}" = "$RESTORE_DATABASE" ] && [ "${ALLOW_PRODUCTION_RESTORE:-}" != "YES" ]; then
  echo "Restore sobre o banco configurado foi bloqueado. Use um banco isolado." >&2
  exit 1
fi

created_database=0
restore_completed=0
cleanup_failed_restore() {
  status=$?
  if [ "$restore_completed" -ne 1 ]; then
    if [ "$created_database" -eq 1 ]; then
      dropdb --if-exists --force "$RESTORE_DATABASE" >/dev/null 2>&1 || true
    fi
    if [ -d "$RESTORE_STORAGE_ROOT" ]; then
      find "$RESTORE_STORAGE_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    fi
  fi
  exit "$status"
}
trap cleanup_failed_restore EXIT INT TERM

if psql -X -d postgres -v database_name="$RESTORE_DATABASE" -Atqc "select 1 from pg_database where datname = :'database_name'" | grep -q 1; then
  table_count="$(psql -X -d "$RESTORE_DATABASE" -Atqc "select count(*) from pg_tables where schemaname = 'public'")"
  [ "$table_count" = "0" ] || { echo "O banco de destino nao esta vazio." >&2; exit 1; }
else
  createdb "$RESTORE_DATABASE"
  created_database=1
fi

mkdir -p "$RESTORE_STORAGE_ROOT"
if find "$RESTORE_STORAGE_ROOT" -mindepth 1 -print -quit | grep -q .; then
  echo "O diretorio de arquivos de destino nao esta vazio." >&2
  exit 1
fi
if tar -tzf "$RESTORE_SOURCE/files.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Backup de arquivos contem caminho inseguro." >&2
  exit 1
fi

pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE" "$RESTORE_SOURCE/database.dump"
tar -C "$RESTORE_STORAGE_ROOT" -xzf "$RESTORE_SOURCE/files.tar.gz"

tenant_count="$(psql -X -d "$RESTORE_DATABASE" -Atqc 'select count(*) from tenants')"
membership_count="$(psql -X -d "$RESTORE_DATABASE" -Atqc 'select count(*) from tenant_memberships')"
stored_file_count="$(psql -X -d "$RESTORE_DATABASE" -Atqc "select count(*) from stored_files where status = 'active'")"
[ "$tenant_count" -gt 0 ] || { echo "Restore invalido: nenhum tenant." >&2; exit 1; }
[ "$membership_count" -gt 0 ] || { echo "Restore invalido: nenhum vinculo de usuario." >&2; exit 1; }

missing_files=0
psql -X -d "$RESTORE_DATABASE" -Atqc "select storage_key from stored_files where status = 'active' order by storage_key" |
while IFS= read -r storage_key; do
  case "$storage_key" in
    ''|/*|*../*|../*) exit 2 ;;
  esac
  [ -f "$RESTORE_STORAGE_ROOT/$storage_key" ] || exit 3
done || missing_files=$?
[ "$missing_files" -eq 0 ] || { echo "Restore invalido: metadados apontam para arquivos ausentes ou inseguros." >&2; exit 1; }

restore_completed=1
trap - EXIT INT TERM
echo "Restore verificado: tenants=$tenant_count memberships=$membership_count stored_files=$stored_file_count"
