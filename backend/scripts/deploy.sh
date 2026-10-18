#!/usr/bin/env bash
# Deploy GamCiv edge functions to a self-hosted Supabase server.
# Set these in your environment before running:
#   VPS_HOST  e.g. user@your-server
#   SSH_KEY   path to your private key
set -euo pipefail

VPS_HOST="${VPS_HOST:?Set VPS_HOST=user@host}"
SSH_KEY="${SSH_KEY:?Set SSH_KEY=/path/to/key}"
STACK_DIR="/opt/supabase/docker"
REMOTE_TMP="/tmp/gamciv-functions.tgz"

HERE="$(cd "$(dirname "$0")/.." && pwd)"

# 1) Package the functions tree (main dispatcher, _shared, both functions)
tar czf "$REMOTE_TMP" -C "$HERE/functions" main _shared whatsapp-intake notify-out telegram-intake

# 2) Ship + extract + fix ownership
scp -i "$SSH_KEY" -q "$REMOTE_TMP" "$VPS_HOST:$REMOTE_TMP"
ssh -i "$SSH_KEY" "$VPS_HOST" "
  set -e
  tar xzf $REMOTE_TMP -C $STACK_DIR/volumes/functions/
  chown -R 10000:10000 $STACK_DIR/volumes/functions
  rm -f $REMOTE_TMP
"

# 3) Recreate the functions container (picks up code + env)
ssh -i "$SSH_KEY" "$VPS_HOST" "cd $STACK_DIR && docker compose up -d --force-recreate functions >/dev/null && sleep 6 && docker ps --format '{{.Names}} {{.Status}}' | grep edge"

echo "Deployed. Quick check:"
curl -s -m 15 "https://api.pocketsoftware.dev/functions/v1/main" | head -c 120
echo
