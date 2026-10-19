#!/bin/bash
# Deploy the GamCiv dashboard build into the landing container under /dashboard/.
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASH="$REPO_ROOT/frontend/dashboard/admin"
KEY="${SSH_KEY:?Set SSH_KEY=/path/to/key}"
HOST="${VPS_HOST:?Set VPS_HOST=root@host}"

tar czf /tmp/gamciv-dash.tgz -C $DASH/dist .
scp -q -i $KEY -o StrictHostKeyChecking=no /tmp/gamciv-dash.tgz $HOST:/tmp/gamciv-dash.tgz

ssh -i $KEY -o StrictHostKeyChecking=no $HOST '
set -e
mkdir -p /opt/gamciv-dashboard && rm -rf /opt/gamciv-dashboard/* && tar xzf /tmp/gamciv-dash.tgz -C /opt/gamciv-dashboard && rm /tmp/gamciv-dash.tgz

grep -q "COPY dashboard" /opt/gamciv-landing/Dockerfile ||   sed -i "/COPY app/a COPY dashboard /usr/share/nginx/html/dashboard" /opt/gamciv-landing/Dockerfile

if ! grep -q "location \^~ /dashboard/" /opt/gamciv-landing/nginx-default.conf; then
  sed -i "s|location /assets/|location ^~ /dashboard/assets/ { expires 30d; add_header Cache-Control \"public, immutable\"; }\n    location ^~ /dashboard/ { try_files \$uri \$uri/ /dashboard/index.html; }\n    location /assets/|" /opt/gamciv-landing/nginx-default.conf
fi

cp -r /opt/gamciv-dashboard/. /opt/gamciv-landing/dashboard/
docker build -q -t gamciv-landing:latest /opt/gamciv-landing
docker rm -f gamciv-landing 2>/dev/null || true
docker run -d --name gamciv-landing -p 127.0.0.1:8095:80 --restart unless-stopped gamciv-landing:latest
sleep 2
echo DEPLOYED
'
