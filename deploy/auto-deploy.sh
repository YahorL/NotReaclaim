#!/bin/sh
# Pull-based auto-deploy for NotReclaim.
# Fetches origin/main; if it moved, fast-forwards and rebuilds the stack.
# Safe for a public repo + Tailscale-only host: only ever consumes already-merged
# main, needs no inbound connectivity, and never touches the git-ignored .env.
set -eu

# Repo root = the parent of this script's deploy/ directory (override with NOTRECLAIM_DIR).
REPO_DIR="${NOTRECLAIM_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
cd "$REPO_DIR"

git fetch --quiet origin main
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0  # already up to date
fi

echo "[auto-deploy] $(date -u +%FT%TZ) main moved ${LOCAL} -> ${REMOTE}; deploying"
git pull --ff-only origin main
docker compose up -d --build
docker image prune -f
echo "[auto-deploy] $(date -u +%FT%TZ) done"
