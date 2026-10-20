#!/bin/bash
# One-shot setup for the GamCiv secrets bridge on the VPS.
# Run on the VPS as root. Assumes the Supabase stack lives in /opt/supabase/docker.
set -euo pipefail

STACK_DIR="/opt/supabase/docker"
BRIDGE_SCRIPT="$STACK_DIR/secrets_bridge.py"
SERVICE_FILE="/etc/systemd/system/secrets-bridge.service"
TOKEN_FILE="$STACK_DIR/.secrets_bridge_token"

# 1) Token: create if missing (64 hex chars).
if [ ! -f "$TOKEN_FILE" ]; then
  umask 077
  openssl rand -hex 32 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "Generated new bridge token at $TOKEN_FILE"
else
  echo "Bridge token already exists at $TOKEN_FILE"
fi

# 2) SECRET_BRIDGE_TOKEN into .env.functions (idempotent) if not already there,
#    plus the bridge URL (the docker gateway is reachable from the containers;
#    host.docker.internal aliases the functions container itself, not the host).
if ! grep -q '^SECRET_BRIDGE_TOKEN=' "$STACK_DIR/.env.functions"; then
  printf '\n# Secrets bridge token (admin panel -> host daemon)\nSECRET_BRIDGE_TOKEN=%s\n' "$(cat "$TOKEN_FILE")" >> "$STACK_DIR/.env.functions"
  chmod 600 "$STACK_DIR/.env.functions"
  echo "Added SECRET_BRIDGE_TOKEN to .env.functions"
else
  echo "SECRET_BRIDGE_TOKEN already set in .env.functions"
fi
if ! grep -q '^SECRET_BRIDGE_URL=' "$STACK_DIR/.env.functions"; then
  echo "SECRET_BRIDGE_URL=http://172.18.0.1:8790" >> "$STACK_DIR/.env.functions"
  chmod 600 "$STACK_DIR/.env.functions"
  echo "Added SECRET_BRIDGE_URL to .env.functions"
else
  echo "SECRET_BRIDGE_URL already set in .env.functions"
fi

# 2b) Firewall: the nftables input chain drops container->host packets by
#     default; allow tcp/8790 from the supabase bridge network only.
if command -v nft >/dev/null 2>&1; then
  BR_IFACE="$(ip -o -4 route show to 172.18.0.0/16 2>/dev/null | awk '{print $5}' | head -1 || true)"
  BR_IFACE="${BR_IFACE:-br-46b426e8e853}"
  if ! nft list chain inet filter input | grep -q '8790'; then
    nft add rule inet filter input iifname "$BR_IFACE" tcp dport 8790 accept comment "secrets-bridge"
  fi
  if ! grep -q '8790' /etc/nftables.conf; then
    python3 - "$BR_IFACE" <<'PY'
import sys
path = "/etc/nftables.conf"
s = open(path).read()
anchor = '\t\ticmp type echo-request accept comment "ping"\n'
add = f'\t\tiifname "{sys.argv[1]}" tcp dport 8790 accept comment "secrets-bridge"\n'
s = s.replace(anchor, anchor + add)
open(path, "w").write(s)
PY
  fi
  echo "nftables rule for 8790 in place"
fi

# 3) systemd unit.
cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=GamCiv secrets bridge (writes .env.functions, reloads edge functions)
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/supabase/docker/secrets_bridge.py
Restart=on-failure
RestartSec=3
User=root
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=false
ReadWritePaths=/opt/supabase/docker
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now secrets-bridge
sleep 1
systemctl --no-pager --lines 5 status secrets-bridge | head -12

echo "Setup complete. Bridge listens on 127.0.0.1:8790"
