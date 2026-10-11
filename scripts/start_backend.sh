#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "Starting WAYBOUND Production Backend"
echo "Environment: ${ENVIRONMENT:-development}"
echo "Port: ${PORT:-8000}"
echo "=========================================="

# Run database migrations if DATABASE_URL is set
if [ -n "${DATABASE_URL:-}" ]; then
  echo "Applying database migrations with Alembic..."
  alembic upgrade head
  echo "Database migrations applied successfully."
else
  echo "WARNING: DATABASE_URL is not set. Skipping Alembic migrations."
fi

# Determine worker count (default to 1 on small instances to conserve DB connections)
WORKERS="${WEB_CONCURRENCY:-1}"

# Narrowly trusted proxy list (defaults to local loopback and trusted proxy boundary)
FORWARDED_ALLOW_IPS="${FORWARDED_ALLOW_IPS:-${TRUSTED_PROXIES:-127.0.0.1,::1}}"

echo "Launching Uvicorn server on 0.0.0.0:${PORT:-8000} with ${WORKERS} worker(s)..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers "${WORKERS}" \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS}"
