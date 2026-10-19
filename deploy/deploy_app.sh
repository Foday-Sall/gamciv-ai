#!/bin/bash
# Deploy the GamCiv app build into the landing container under /app/.
# Mirrors redeploy.sh's pattern, but keeps the app tree separate so landing
# redeploys (rm -rf dist) can't wipe it. Requires /opt/gamciv-landing/Dockerfile
# and nginx-default.conf to have the /app/ additions (this script ensures them).
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO_ROOT/frontend/app"
KEY="${SSH_KEY:?Set SSH_KEY=/path/to/key}"
HOST="${VPS_HOST:?Set VPS_HOST=root@host}"

tar czf /tmp/gamciv-app.tgz -C $APP/dist .
scp -q -i $KEY -o StrictHostKeyChecking=no /tmp/gamciv-app.tgz $HOST:/tmp/gamciv-app.tgz

ssh -i $KEY -o StrictHostKeyChecking=no $HOST '
set -e
# persistent app tree (outside dist so landing redeploys keep it)
mkdir -p /opt/gamciv-app && rm -rf /opt/gamciv-app/* && tar xzf /tmp/gamciv-app.tgz -C /opt/gamciv-app && rm /tmp/gamciv-app.tgz

# Dockerfile: add app COPY if missing
grep -q "COPY app" /opt/gamciv-landing/Dockerfile || \
  sed -i "/COPY dist\/usr\/share\/nginx\/html/a COPY app /usr/share/nginx/html/app" /opt/gamciv-landing/Dockerfile

# nginx conf: add /app/ locations if missing
if ! grep -q "location \^~ /app/" /opt/gamciv-landing/nginx-default.conf; then
  sed -i "s|location /assets/|location ^~ /app/assets/ { expires 30d; add_header Cache-Control \"public, immutable\"; }\n    location ^~ /app/ { try_files \$uri \$uri/ /app/index.html; }\n    location /assets/|" /opt/gamciv-landing/nginx-default.conf
fi

cp -r /opt/gamciv-app/. /opt/gamciv-landing/app/
docker build -q -t gamciv-landing:latest /opt/gamciv-landing > /dev/null
docker stop gamciv-landing > /dev/null
docker rm gamciv-landing > /dev/null
docker run -d --name gamciv-landing --restart unless-stopped -p 127.0.0.1:8095:80 gamciv-landing:latest > /dev/null
sleep 2
docker ps --format "{{.Names}} {{.Status}}" | grep gamciv
'
rm -f /tmp/gamciv-app.tgz
echo DEPLOYED
