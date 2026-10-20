#!/bin/bash
# Deploy the GamCiv dashboard build into the landing container under /dash/.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASH="$REPO_ROOT/frontend/dashboard/admin"
NGINX_CONF="$REPO_ROOT/deploy/nginx/default.conf"
KEY="${SSH_KEY:?Set SSH_KEY=/path/to/key}"
HOST="${VPS_HOST:?Set VPS_HOST=user@host}"
TARBALL="/tmp/gamciv-dash.tgz"
trap 'rm -f "$TARBALL"' EXIT

[ -d "$DASH/dist" ] || { echo "No dashboard dist at $DASH/dist; build it first." >&2; exit 1; }
[ -f "$NGINX_CONF" ] || { echo "Missing Nginx config at $NGINX_CONF." >&2; exit 1; }

tar czf "$TARBALL" -C "$DASH/dist" .
SSH_OPTS=(-o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=no -o ConnectTimeout=15)
scp -q -i "$KEY" "${SSH_OPTS[@]}" "$TARBALL" "$HOST:/tmp/gamciv-dash.tgz"
scp -q -i "$KEY" "${SSH_OPTS[@]}" "$NGINX_CONF" "$HOST:/tmp/gamciv-nginx-default.conf"

ssh -i "$KEY" "${SSH_OPTS[@]}" "$HOST" 'bash -se' <<'REMOTE'
set -euo pipefail
mkdir -p /opt/gamciv-dashboard
rm -rf /opt/gamciv-dashboard/*
tar xzf /tmp/gamciv-dash.tgz -C /opt/gamciv-dashboard
rm -f /tmp/gamciv-dash.tgz

# Keep old hashed assets available while canonical page URLs move to /dash.
mkdir -p /opt/gamciv-landing/dash
rm -rf /opt/gamciv-landing/dash/*
cp -r /opt/gamciv-dashboard/. /opt/gamciv-landing/dash/
cp /tmp/gamciv-nginx-default.conf /opt/gamciv-landing/nginx-default.conf
rm -f /tmp/gamciv-nginx-default.conf

if ! grep -q 'COPY dash /usr/share/nginx/html/dash' /opt/gamciv-landing/Dockerfile; then
  sed -i '/COPY app \/usr\/share\/nginx\/html\/app/a COPY dash /usr/share/nginx/html/dash' /opt/gamciv-landing/Dockerfile
fi

docker build -q -t gamciv-landing:latest /opt/gamciv-landing >/dev/null
docker rm -f gamciv-landing >/dev/null 2>&1 || true
docker run -d --name gamciv-landing -p 127.0.0.1:8095:80 --restart unless-stopped gamciv-landing:latest >/dev/null
sleep 2
curl -fsS -o /dev/null http://127.0.0.1:8095/dash
curl -fsSL -o /dev/null http://127.0.0.1:8095/dashboard/
curl -fsS -o /dev/null http://127.0.0.1:8095/app/login
docker ps --format '{{.Names}} {{.Status}}' | grep '^gamciv-landing '
echo DEPLOYED
REMOTE
