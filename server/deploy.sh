#!/usr/bin/env bash
# Деплой Фины на VPS вне Cloudflare.
# Нужны: VPS_SSH_HOST, VPS_SSH_USER, VPS_SSH_PRIVATE_KEY, GITHUB_TOKEN
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VPS_SSH_HOST:?}"
USER="${VPS_SSH_USER:?}"
PORT="${VPS_SSH_PORT:-22}"
KEY_FILE="$(mktemp)"
trap 'rm -f "$KEY_FILE"' EXIT

printf '%s\n' "${VPS_SSH_PRIVATE_KEY:?}" >"$KEY_FILE"
chmod 600 "$KEY_FILE"

SSH=(ssh -i "$KEY_FILE" -p "$PORT" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes "$USER@$HOST")
RSYNC=(rsync -az --delete -e "ssh -i $KEY_FILE -p $PORT -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes")

echo "==> prepare remote dir"
"${SSH[@]}" 'mkdir -p ~/fina/server ~/fina/web'

echo "==> sync sources"
"${RSYNC[@]}" \
  --exclude node_modules --exclude .next --exclude out --exclude dist \
  "$ROOT/server/" "$USER@$HOST:~/fina/server/"
"${RSYNC[@]}" \
  --exclude node_modules --exclude .next --exclude out \
  "$ROOT/web/" "$USER@$HOST:~/fina/web/"
"${RSYNC[@]}" "$ROOT/server/Dockerfile" "$USER@$HOST:~/fina/server/Dockerfile"
# Dockerfile context is repo root
"${SSH[@]}" 'mkdir -p ~/fina && ln -sfn ~/fina/server/Dockerfile ~/fina/Dockerfile'

echo "==> write env"
"${SSH[@]}" "cat > ~/fina/server/.env <<'EOF'
GITHUB_TOKEN=${GITHUB_TOKEN}
FINA_GIST_ID=${FINA_GIST_ID:-9ae03be0b8cb1a5a2d1818bd4492c8ea}
WEB_URL=${WEB_URL:-https://api.fovkotov.lol}
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-https://api.fovkotov.lol,https://app.fovkotov.lol}
ACME_EMAIL=${ACME_EMAIL:-admin@fovkotov.lol}
EOF"

echo "==> install docker if needed"
"${SSH[@]}" 'command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh)'
"${SSH[@]}" 'docker compose version >/dev/null 2>&1 || docker --help | grep -q compose || true'

echo "==> build & up"
"${SSH[@]}" 'cd ~/fina && docker compose -f server/docker-compose.yml --project-directory server build && docker compose -f server/docker-compose.yml --project-directory server up -d'

echo "==> health"
sleep 3
"${SSH[@]}" 'curl -fsS http://127.0.0.1:8787/api/health || curl -fsS http://127.0.0.1/api/health || true'
echo
echo "OK. Дальше DNS: убери Workers custom domain, поставь A api/app → $HOST, proxy OFF (серое облако)."
