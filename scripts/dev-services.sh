#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$REPO_ROOT/docker-compose.local.yml"
ENV_FILE="$REPO_ROOT/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.local.example first." >&2
  exit 1
fi

case "${1:-}" in
  up)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
    ;;
  down)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
    ;;
  logs)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs -f
    ;;
  ps)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
    ;;
  *)
    echo "Usage: scripts/dev-services.sh {up|down|logs|ps}" >&2
    exit 1
    ;;
esac
