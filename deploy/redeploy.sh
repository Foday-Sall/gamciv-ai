#!/bin/bash
# Deploy the GamCiv landing page build to the VPS container.
# Env: VPS_HOST=root@host  SSH_KEY=/path/to/key
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LANDING_DIST="$REPO_ROOT/frontend/landing/gamciv-landing/dist"
[ -d "$LANDING_DIST" ] || { echo "No landing dist at $LANDING_DIST — build it first (see DEPLOY.md)"; exit 1; }
: "${VPS_HOST:?Set VPS_HOST=root@host}"
: "${SSH_KEY:?Set SSH_KEY=/path/to/key}"

tar czf /tmp/gamciv-dist.tgz -C "$LANDING_DIST" .
scp -q -i "$SSH_KEY" -o StrictHostKeyChecking=no /tmp/gamciv-dist.tgz "$VPS_HOST:/tmp/gamciv-dist.tgz"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_HOST" "cd /opt/gamciv-landing && rm -rf dist && mkdir dist && tar xzf /tmp/gamciv-dist.tgz -C dist && rm /tmp/gamciv-dist.tgz && docker build -q -t gamciv-landing:latest . > /dev/null && docker stop gamciv-landing > /dev/null && docker rm gamciv-landing > /dev/null && docker run -d --name gamciv-landing --restart unless-stopped -p 127.0.0.1:8095:80 gamciv-landing:latest > /dev/null && sleep 2 && docker ps --format '{{.Names}} {{.Status}}' | grep gamciv"
rm -f /tmp/gamciv-dist.tgz
echo DEPLOYED
