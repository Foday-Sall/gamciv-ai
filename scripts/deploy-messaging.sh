#!/usr/bin/env bash
# ============================================================================
# deploy-messaging.sh — bring the GamCiv messaging layer up on a VPS.
#
# Reproduces the full system from a fresh clone:
#   PicoClaw (Telegram native + WhatsApp via bridge) + gowa-bridge +
#   the agent-api edge function.
#
# Prerequisites:
#   - Docker + docker compose plugin on the VPS
#   - A running GOWA container (WhatsApp gateway)
#   - A running self-hosted Supabase stack (functions container)
#
# Usage:
#   local:   cd repo && cp .env.example .env && $EDITOR .env
#            ./scripts/deploy-messaging.sh --local
#   remote:  VPS_HOST=root@your-vps ./scripts/deploy-messaging.sh
#            (uses ./scripts/.env from this repo; .env stays local)
# ============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PICO_DIR="${PICO_DIR:-/opt/picoclaw}"
STACK_DIR="${SUPABASE_STACK_DIR:-/opt/supabase/docker}"
BRIDGE_PORT="${GOWA_BRIDGE_PORT:-3001}"
MODE="local"
if [[ "${1:-}" == "--local" ]]; then MODE="local"; elif [[ -n "${1:-}" ]]; then MODE="ssh"; fi
VPS_HOST="${VPS_HOST:-${1:-}}"

log() { echo "[deploy] $*"; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }

if [[ ! -f "$REPO_DIR/.env" ]]; then
  die ".env not found in $REPO_DIR — copy .env.example and fill real values"
fi
set -a; source "$REPO_DIR/.env"; set +a

for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY AGENT_API_KEY GOWA_BASE_URL \
         GOWA_BASIC_AUTH GOWA_WEBHOOK_SECRET PICOCLAW_TELEGRAM_BOT_TOKEN \
         PICOCLAW_TELEGRAM_ALLOW_FROM PICOCLAW_WHATSAPP_ALLOW_FROM \
         PICOCLAW_LLM_MODEL PICOCLAW_LLM_API_BASE PICOCLAW_LLM_API_KEY; do
  [[ -n "${!v:-}" ]] || die "$v is not set in .env"
done

# ----------------------------------------------------------------------------
# Remote script: everything that runs ON THE VPS is generated here and piped
# through ssh in one pass. In --local mode the same script runs via bash -s.
# ----------------------------------------------------------------------------
REMOTE_SCRIPT=$(cat <<'REMOTE_EOF'
set -euo pipefail
PICO_DIR="__PICO_DIR__"
STACK_DIR="__STACK_DIR__"
BRIDGE_DIR="/opt/gowa-bridge"
BRIDGE_PORT="__BRIDGE_PORT__"
SUPABASE_URL="__SUPABASE_URL__"
AGENT_API_KEY="__AGENT_API_KEY__"
RESEND_API_KEY="__RESEND_API_KEY__"
RESEND_FROM="__RESEND_FROM__"
GOWA_BASE_URL="__GOWA_BASE_URL__"
GOWA_BASIC_AUTH="__GOWA_BASIC_AUTH__"
GOWA_WEBHOOK_SECRET="__GOWA_WEBHOOK_SECRET__"
GOWA_DEVICE_ID="__GOWA_DEVICE_ID__"
PICOCLAW_TELEGRAM_BOT_TOKEN="__PICOCLAW_TELEGRAM_BOT_TOKEN__"
PICOCLAW_TELEGRAM_ALLOW_FROM="__PICOCLAW_TELEGRAM_ALLOW_FROM__"
PICOCLAW_WHATSAPP_ALLOW_FROM="__PICOCLAW_WHATSAPP_ALLOW_FROM__"
PICOCLAW_LLM_MODEL="__PICOCLAW_LLM_MODEL__"
PICOCLAW_LLM_API_BASE="__PICOCLAW_LLM_API_BASE__"
PICOCLAW_LLM_API_KEY="__PICOCLAW_LLM_API_KEY__"

log() { echo "[vps] $*"; }

# Build a JSON string array from a comma-separated value (no shell quoting traps)
json_array() {
  local out="[" first=1 v
  local IFS=','
  for v in $1; do
    v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
    [ -n "$v" ] || continue
    if [ $first -eq 1 ]; then first=0; else out="$out, "; fi
    out="$out\"$v\""
  done
  printf '%s' "$out]"
}

# --- 1) deno (bridge runtime) -----------------------------------------------
if [ ! -x /usr/local/bin/deno ]; then
  log "installing deno"
  curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip
  (command -v unzip >/dev/null || (apt-get update -qq && apt-get install -y -qq unzip))
  unzip -oq /tmp/deno.zip -d /usr/local/bin && chmod +x /usr/local/bin/deno
fi
/usr/local/bin/deno --version | head -1

# --- 2) gowa-bridge systemd service -----------------------------------------
log "installing gowa-bridge"
mkdir -p $BRIDGE_DIR
cat > $BRIDGE_DIR/gowa-bridge.env <<BRIDGE_ENV
GOWA_BRIDGE_PORT=$BRIDGE_PORT
GOWA_WEBHOOK_SECRET=$GOWA_WEBHOOK_SECRET
GOWA_BASE_URL=$GOWA_BASE_URL
GOWA_BASIC_AUTH=$GOWA_BASIC_AUTH
BRIDGE_ENV
[ -n "$GOWA_DEVICE_ID" ] && echo "GOWA_DEVICE_ID=$GOWA_DEVICE_ID" >> $BRIDGE_DIR/gowa-bridge.env
chmod 600 $BRIDGE_DIR/gowa-bridge.env

cat > /etc/systemd/system/gowa-bridge.service <<UNIT
[Unit]
Description=GamCiv GOWA-to-PicoClaw bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$BRIDGE_DIR/gowa-bridge.env
ExecStart=/usr/local/bin/deno run --allow-net --allow-env $BRIDGE_DIR/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

# --- 3) GOWA per-device webhook -> bridge (intake webhook untouched) --------
log "configuring GOWA webhook"
DOCKER_GW=$(ip -4 addr show docker0 2>/dev/null | awk "/inet /{print \$2}" | cut -d/ -f1 | head -1 || true)
[ -n "$DOCKER_GW" ] || DOCKER_GW=172.17.0.1
AUTH=$(docker exec gowa printenv APP_BASIC_AUTH)
curl -s -u "$AUTH" -X PATCH "http://127.0.0.1:3100/devices/main/webhook" -H "Content-Type: application/json" -d "{\"webhook_url\": \"http://$DOCKER_GW:$BRIDGE_PORT/gowa\"}"
echo

# --- 4) agent-api function code + env ---------------------------------------
log "deploying agent-api (expect the repo tarball at /tmp/gamciv-agentapi.tgz)"
tar xzf /tmp/gamciv-agentapi.tgz -C "$STACK_DIR/volumes/functions/"
chown -R 10000:10000 "$STACK_DIR/volumes/functions/agent-api" "$STACK_DIR/volumes/functions/_shared"
grep -q "^AGENT_API_KEY=" "$STACK_DIR/.env.functions" 2>/dev/null || echo "AGENT_API_KEY=$AGENT_API_KEY" >> "$STACK_DIR/.env.functions"
if [ -n "$RESEND_API_KEY" ]; then
  grep -q "^RESEND_API_KEY=" "$STACK_DIR/.env.functions" 2>/dev/null || echo "RESEND_API_KEY=$RESEND_API_KEY" >> "$STACK_DIR/.env.functions"
  grep -q "^RESEND_FROM=" "$STACK_DIR/.env.functions" 2>/dev/null || echo "RESEND_FROM=$RESEND_FROM" >> "$STACK_DIR/.env.functions"
fi
cd "$STACK_DIR" && docker compose up -d --force-recreate functions >/dev/null
sleep 5
docker ps --format "{{.Names}} {{.Status}}" | grep functions

# --- 5) PicoClaw -------------------------------------------------------------
log "installing PicoClaw"
mkdir -p "$PICO_DIR/data/workspace"
docker pull -q sipeed/picoclaw:latest

cat > "$PICO_DIR/data/config.json" <<PICO_CONFIG
{
  "version": 3,
  "agents": {
    "defaults": {
      "model_name": "gamciv",
      "workspace": "/root/.picoclaw/workspace",
      "restrict_to_workspace": true,
      "max_tool_iterations": 20,
      "max_tokens": 8192
    }
  },
  "model_list": [
    {
      "model_name": "gamciv",
      "provider": "openai",
      "model": "$PICOCLAW_LLM_MODEL",
      "api_base": "$PICOCLAW_LLM_API_BASE",
      "api_keys": ["$PICOCLAW_LLM_API_KEY"],
      "enabled": true
    }
  ],
  "channel_list": {
    "telegram": {
      "enabled": true,
      "type": "telegram",
      "allow_from": $(json_array "$PICOCLAW_TELEGRAM_ALLOW_FROM"),
      "settings": { "token": "$PICOCLAW_TELEGRAM_BOT_TOKEN" }
    },
    "whatsapp": {
      "enabled": true,
      "type": "whatsapp",
      "allow_from": $(json_array "$PICOCLAW_WHATSAPP_ALLOW_FROM"),
      "settings": { "bridge_url": "ws://172.17.0.1:$BRIDGE_PORT" }
    }
  },
  "tools": {
    "exec": { "enabled": false },
    "web": { "enabled": false },
    "web_fetch": { "enabled": false },
    "cron": { "enabled": false },
    "spawn": { "enabled": false },
    "subagent": { "enabled": false },
    "mcp": {
      "enabled": true,
      "servers": {
        "gamciv": {
          "enabled": true,
          "type": "http",
          "url": "$SUPABASE_URL/functions/v1/agent-api/mcp",
          "headers": { "Authorization": "Bearer $AGENT_API_KEY" }
        }
      }
    }
  },
  "gateway": { "host": "localhost", "port": 18790 }
}
PICO_CONFIG
chmod 600 "$PICO_DIR/data/config.json"

cat > "$PICO_DIR/data/workspace/AGENT.md" <<'PICO_AGENT'
---
name: gamciv
description: GamCiv civic assistant
tools: [mcp_gamciv_gamciv_report, mcp_gamciv_gamciv_status]
mcpServers: [gamciv]
---

You are the GamCiv civic assistant for The Gambia. Your ONLY job:

1. When the user describes a public problem (water, power, roads, waste,
   safety, health, education...), call the gamciv_report tool with their
   message as text. Relay the returned confirmation_text to the user.
2. When the user asks about an existing report, ask for the tracking number
   (format GMC-YYYY-NNNNN) and call the gamciv_status tool. Relay the status.
3. Never invent tracking numbers, statuses or institutions.
4. Do not discuss anything unrelated to civic reports; politely redirect.
PICO_AGENT

cat > "$PICO_DIR/docker-compose.yml" <<'PICO_COMPOSE'
services:
  picoclaw:
    image: sipeed/picoclaw:latest
    container_name: picoclaw
    restart: unless-stopped
    ports:
      - "127.0.0.1:18790:18790"
    volumes:
      - PICO_DATA:/root/.picoclaw
PICO_COMPOSE
sed -i "s|PICO_DATA|$PICO_DIR/data|" "$PICO_DIR/docker-compose.yml"

cd "$PICO_DIR" && docker compose up -d

# --- 6) verify ---------------------------------------------------------------
sleep 4
log "verification"
echo "bridge:   $(systemctl is-active gowa-bridge) $(curl -s http://127.0.0.1:$BRIDGE_PORT/health | head -c 100)"
echo "picoclaw: $(docker inspect picoclaw --format "{{.State.Status}}" 2>/dev/null || echo missing)"
echo "gateway:  $(curl -s http://127.0.0.1:18790/health | head -c 100)"
REMOTE_EOF
)

# Substitute placeholders
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICO_DIR__/$PICO_DIR}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__STACK_DIR__/$STACK_DIR}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__BRIDGE_PORT__/$BRIDGE_PORT}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SUPABASE_URL__/$SUPABASE_URL}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__AGENT_API_KEY__/$AGENT_API_KEY}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__RESEND_API_KEY__/${RESEND_API_KEY:-}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__RESEND_FROM__/${RESEND_FROM:-GamCiv <onboarding@resend.dev>}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__GOWA_BASE_URL__/$GOWA_BASE_URL}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__GOWA_BASIC_AUTH__/$GOWA_BASIC_AUTH}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__GOWA_WEBHOOK_SECRET__/$GOWA_WEBHOOK_SECRET}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__GOWA_DEVICE_ID__/${GOWA_DEVICE_ID:-}}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_TELEGRAM_BOT_TOKEN__/$PICOCLAW_TELEGRAM_BOT_TOKEN}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_TELEGRAM_ALLOW_FROM_JSON__/$PICOCLAW_TELEGRAM_ALLOW_FROM_JSON}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_WHATSAPP_ALLOW_FROM_JSON__/$PICOCLAW_WHATSAPP_ALLOW_FROM_JSON}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_LLM_MODEL__/$PICOCLAW_LLM_MODEL}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_LLM_API_BASE__/$PICOCLAW_LLM_API_BASE}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_LLM_API_KEY__/$PICOCLAW_LLM_API_KEY}"

# Build allow_from JSON arrays from comma-separated .env values

# Build JSON string arrays from comma-separated values
json_array() {
  local out="[" first=1 v
  local IFS=','
  for v in $1; do
    v="${v#[[:space:]]}"; v="${v%[[:space:]]}"
    [[ -n "$v" ]] || continue
    if [[ $first -eq 1 ]]; then first=0; else out+=", "; fi
    out+="\"$v\""
  done
  printf '%s' "$out]"
}
PICOCLAW_TELEGRAM_ALLOW_FROM_JSON=$(json_array "$PICOCLAW_TELEGRAM_ALLOW_FROM")
PICOCLAW_WHATSAPP_ALLOW_FROM_JSON=$(json_array "$PICOCLAW_WHATSAPP_ALLOW_FROM")
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_TELEGRAM_ALLOW_FROM_JSON__/$PICOCLAW_TELEGRAM_ALLOW_FROM_JSON}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__PICOCLAW_WHATSAPP_ALLOW_FROM_JSON__/$PICOCLAW_WHATSAPP_ALLOW_FROM_JSON}"

# Type-check the agent-api function before shipping
log "type-checking agent-api"
(cd "$REPO_DIR" && "${DENO_BIN:-deno}" check backend/functions/agent-api/index.ts) || die "deno check failed"

# Package the function code
log "packaging agent-api"
tar czf /tmp/gamciv-agentapi.tgz -C "$REPO_DIR/backend/functions" agent-api _shared

# Copy bridge source into the remote script payload? Simpler: tar everything the
# remote needs and pipe the script after the tarball over the same ssh session.
if [[ "$MODE" == "ssh" ]]; then
  [[ -n "$VPS_HOST" ]] || die "set VPS_HOST=user@host"
  log "deploying to $VPS_HOST"
  scp -q "$REPO_DIR/backend/channels/gowa-bridge/index.ts" "$VPS_HOST:/opt/gowa-bridge/index.ts.tmp"     || { ssh "$VPS_HOST" "mkdir -p /opt/gowa-bridge"; scp -q "$REPO_DIR/backend/channels/gowa-bridge/index.ts" "$VPS_HOST:/opt/gowa-bridge/index.ts.tmp"; }
  ssh "$VPS_HOST" "mv /opt/gowa-bridge/index.ts.tmp /opt/gowa-bridge/index.ts"
  scp -q /tmp/gamciv-agentapi.tgz "$VPS_HOST:/tmp/gamciv-agentapi.tgz"
  printf '%s' "$REMOTE_SCRIPT" | ssh -o StrictHostKeyChecking=accept-new "$VPS_HOST" 'bash -s'
else
  log "deploying locally"
  mkdir -p /opt/gowa-bridge
  cp "$REPO_DIR/backend/channels/gowa-bridge/index.ts" /opt/gowa-bridge/index.ts
  printf '%s' "$REMOTE_SCRIPT" | bash -s
fi
rm -f /tmp/gamciv-agentapi.tgz

log "done."
echo "Next steps:"
echo " 1. Verify: journalctl -u gowa-bridge -n 20"
echo " 2. Verify: docker logs picoclaw --tail 20"
echo " 3. Test: message the bot on Telegram / WhatsApp"
