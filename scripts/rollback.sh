#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
: "${PREVIOUS_APP_VERSION:?Defina PREVIOUS_APP_VERSION com uma imagem existente}"

test -f "$ENV_FILE" || { echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2; exit 1; }
rollback_image="${BBT_IMAGE:-bbt-corporativo}:$PREVIOUS_APP_VERSION"
if [ "${ROLLBACK_PULL:-false}" = "true" ]; then
  docker pull "$rollback_image"
else
  docker image inspect "$rollback_image" >/dev/null 2>&1 || {
    echo "Imagem de rollback ausente: $rollback_image. Publique-a ou use ROLLBACK_PULL=true." >&2
    exit 1
  }
fi
APP_VERSION="$PREVIOUS_APP_VERSION" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps app
node --env-file="$ENV_FILE" scripts/smoke-test.mjs
echo "Imagem anterior restaurada. Migrations nao foram revertidas automaticamente."
