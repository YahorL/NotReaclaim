#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

echo "[entrypoint] Starting NotReclaim API on :${PORT:-3000}..."
exec node packages/server/dist/server.js
