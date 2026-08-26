#!/usr/bin/env bash
# Care Platform — Staging Deployment Script
# Usage: ./scripts/deploy-staging.sh
# Requires: sshpass (brew install hudochenkov/sshpass/sshpass), SSH key on VPS
set -euo pipefail

VPS_HOST="deploy@109.199.125.205"
VPS_PATH="/opt/care-platform"
SSH_PASS="menot"

echo "=== Care Platform Staging Deployment ==="
echo "Target: ${VPS_HOST}:${VPS_PATH}"
echo ""

# 1. Copy deployment files
echo "[1/6] Copying deployment files to VPS..."
for f in Dockerfile Dockerfile.migrate compose.staging.yaml .dockerignore .env.staging; do
  sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no "$f" "${VPS_HOST}:${VPS_PATH}/${f}"
done
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" \
  "mkdir -p ${VPS_PATH}/apps/api ${VPS_PATH}/packages/database"
sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
  apps/api/tsconfig.json \
  "${VPS_HOST}:${VPS_PATH}/apps/api/tsconfig.json"
sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
  packages/database/drizzle.config.ts \
  "${VPS_HOST}:${VPS_PATH}/packages/database/drizzle.config.ts"
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" "chmod 600 ${VPS_PATH}/.env.staging"
echo "  ✅ Files copied"

# 2. Update code
echo "[2/6] Updating code on VPS..."
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" \
  "cd ${VPS_PATH} && git fetch origin feat/m2-catalog-pricing && git checkout feat/m2-catalog-pricing && git pull origin feat/m2-catalog-pricing --ff-only"
echo "  ✅ Code updated"

# 3. Build images
echo "[3/6] Building Docker images (this may take a few minutes)..."
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" \
  "cd ${VPS_PATH} && docker compose -f compose.staging.yaml --env-file .env.staging build"
echo "  ✅ Images built"

# 4. Start infrastructure
echo "[4/6] Starting infrastructure (Postgres + Redis)..."
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" \
  "cd ${VPS_PATH} && docker compose -f compose.staging.yaml --env-file .env.staging up -d care-platform-postgres care-platform-redis"
echo "  Waiting for health checks..."
sleep 10

# 5. Run migrations
echo "[5/6] Running database migrations..."
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" \
  "cd ${VPS_PATH} && docker compose -f compose.staging.yaml --env-file .env.staging --profile migrate run --rm care-platform-migrate"
echo "  ✅ Migrations applied"

# 6. Start app services
echo "[6/6] Starting application services..."
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" \
  "cd ${VPS_PATH} && docker compose -f compose.staging.yaml --env-file .env.staging up -d care-platform-api care-platform-worker care-platform-relay"
echo "  Waiting for health checks..."
sleep 20

# Verify
echo ""
echo "=== Deployment Verification ==="
sshpass -p "$SSH_PASS" ssh "$VPS_HOST" \
  'docker ps --format "table {{.Names}}\t{{.Status}}" | grep care-platform'

echo ""
echo "Health check:"
curl -sk https://api.care-systems.site/health | python3 -m json.tool

echo ""
echo "Metrics check:"
curl -sk -H "Authorization: Bearer $(grep METRICS_BEARER_TOKEN .env.staging | cut -d= -f2)" \
  https://api.care-systems.site/metrics | head -5

echo ""
echo "✅ Deployment complete!"
echo "   API:        https://api.care-systems.site"
echo "   Health:     https://api.care-systems.site/health"
echo "   Metrics:    https://api.care-systems.site/metrics"
