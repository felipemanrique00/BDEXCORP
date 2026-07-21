#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
MIN_FREE_KB="${MIN_FREE_KB:-5242880}"

test -f "$ENV_FILE" || { echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2; exit 1; }
node scripts/validate-environment.mjs "--env-file=$ENV_FILE"
npm run validate

free_kb="$(df -Pk . | awk 'NR==2 {print $4}')"
[ "$free_kb" -ge "$MIN_FREE_KB" ] || { echo "Espaco livre insuficiente." >&2; exit 1; }

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile ops run --rm backup
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build app migrate bootstrap
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps app
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d caddy

node --env-file="$ENV_FILE" scripts/smoke-test.mjs
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
echo "Release concluido. Monitore logs e metricas antes de encerrar a janela."
