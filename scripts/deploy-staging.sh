#!/usr/bin/env bash
# Care Platform — repeatable staging deployment
#
# Usage:
#   VPS_SSH_PASSWORD='<staging SSH password>' ./scripts/deploy-staging.sh [branch]
#
# The target branch defaults to the current local branch. Staging secrets remain
# on the VPS in /opt/care-platform/.env.staging and are never copied or printed.
set -euo pipefail

VPS_HOST="${VPS_HOST:-deploy@109.199.125.205}"
VPS_PATH="${VPS_PATH:-/opt/care-platform}"
TARGET_BRANCH="${1:-$(git branch --show-current)}"

if [[ ! "$VPS_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid VPS host: $VPS_HOST" >&2
  exit 2
fi

if [[ ! "$VPS_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "Invalid VPS path: $VPS_PATH" >&2
  exit 2
fi

if [[ ! "$TARGET_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Invalid branch name: $TARGET_BRANCH" >&2
  exit 2
fi

: "${VPS_SSH_PASSWORD:?Set VPS_SSH_PASSWORD for the staging deploy user.}"

if ! command -v sshpass >/dev/null; then
  echo "sshpass is required to access the configured staging host." >&2
  exit 2
fi

ssh_run() {
  SSHPASS="$VPS_SSH_PASSWORD" sshpass -e ssh \
    -o StrictHostKeyChecking=accept-new \
    "$VPS_HOST" "$@"
}

echo "=== Care Platform Staging Deployment ==="
echo "Target: ${VPS_HOST}:${VPS_PATH}"
echo "Branch: ${TARGET_BRANCH}"

echo "[1/7] Preflight remote checkout and configuration..."
ssh_run "
  set -e
  test -d '${VPS_PATH}/.git'
  test -f '${VPS_PATH}/.env.staging'
  test ! -e '${VPS_PATH}/.env.staging' || chmod 600 '${VPS_PATH}/.env.staging'
  if find '${VPS_PATH}' -xdev -user root -print -quit | grep -q .; then
    echo 'Refusing deployment: root-owned files exist in the checkout.' >&2
    echo 'Restore checkout ownership to the deploy user before retrying.' >&2
    exit 1
  fi
"

echo "[2/7] Updating source checkout..."
ssh_run "
  set -e
  cd '${VPS_PATH}'
  git fetch origin '${TARGET_BRANCH}'
  git checkout '${TARGET_BRANCH}'
  git pull origin '${TARGET_BRANCH}' --ff-only
"

echo "[3/7] Building immutable application and migration images..."
ssh_run "
  set -e
  cd '${VPS_PATH}'
  docker compose -f compose.staging.yaml --env-file .env.staging --profile migrate build
"

echo "[4/7] Starting stateful infrastructure..."
ssh_run "
  set -e
  cd '${VPS_PATH}'
  docker compose -f compose.staging.yaml --env-file .env.staging up -d postgres redis
"

echo "[5/7] Ensuring staging database and applying migrations..."
ssh_run "
  set -e
  cd '${VPS_PATH}'
  if ! docker compose -f compose.staging.yaml --env-file .env.staging exec -T postgres \
    psql -U care_platform_app -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname = 'care_platform_staging'\" | grep -qx 1; then
    docker compose -f compose.staging.yaml --env-file .env.staging exec -T postgres \
      psql -U care_platform_app -d postgres -c \"CREATE DATABASE care_platform_staging OWNER care_platform_app\"
  fi
  docker compose -f compose.staging.yaml --env-file .env.staging --profile migrate run --rm migrate
"

echo "[6/7] Starting API, worker, and relay..."
ssh_run "
  set -e
  cd '${VPS_PATH}'
  # The first reconciliation replaces legacy manually started, stateless
  # containers whose names predate the compose service names.
  docker rm -f care-platform-api care-platform-worker care-platform-relay >/dev/null 2>&1 || true
  docker compose -f compose.staging.yaml --env-file .env.staging up -d --remove-orphans api worker relay
"

echo "[7/7] Verifying deployment..."
sleep 15
ssh_run "
  set -e
  cd '${VPS_PATH}'
  docker compose -f compose.staging.yaml --env-file .env.staging ps
  docker compose -f compose.staging.yaml --env-file .env.staging exec -T api \
    curl -fsS http://localhost:3000/health >/dev/null
"
curl -fsS --connect-timeout 15 https://api.care-systems.site/health >/dev/null

echo "✅ Staging deployment complete: ${TARGET_BRANCH}"
