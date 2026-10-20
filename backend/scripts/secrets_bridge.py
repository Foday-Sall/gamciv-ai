#!/usr/bin/env python3
"""GamCiv secrets bridge daemon.

Runs on the VPS host as root. Listens on the docker bridge gateway IP
(172.18.0.1:8790) so the Supabase containers can reach it, while nftables
blocks that port from the public internet (rule accepts only the bridge
interface). It edits
/opt/supabase/docker/.env.functions atomically and reloads the functions
container (in the background) so the new values take effect.

Endpoints (POST, JSON):
  POST /set     {key, value}  -> upsert one line KEY=VALUE
  POST /delete  {key}         -> remove the KEY line
  POST /list    {}            -> [{key, set, updated_at}], values never returned
  POST /status  {}            -> daemon version, env file mtime, last reload

Auth: X-Bridge-Token header must equal the token stored in
/opt/supabase/docker/.secrets_bridge_token (chmod 600). The same token is
configured as SECRET_BRIDGE_TOKEN in .env.functions for the edge function.

Security notes:
  - Binds the docker gateway only (172.18.0.1). nftables restricts tcp/8790
    to the docker bridge interfaces; never open this port publicly.
  - Token auth on every call; timing-safe comparison.
  - Key names are whitelisted here as well as in the edge function; the
    daemon refuses anything not matching the same policy.
  - Values are written for keys only; nothing is logged or echoed back.
  - The env file is rewritten atomically (tmp file + os.replace) with
    mode 0600, preserving unrelated lines and comments.
"""

import json
import os
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ENV_FILE = "/opt/supabase/docker/.env.functions"
TOKEN_FILE = "/opt/supabase/docker/.secrets_bridge_token"
COMPOSE_DIR = "/opt/supabase/docker"
BIND_ADDR = ("172.18.0.1", 8790)

NAMED_KEYS = {
    "RESEND_API_KEY",
    "RESEND_FROM",
    "AI_API_KEY",
    "AI_BASE_URL",
    "AI_MODEL",
    "GOWA_BASIC_AUTH",
    "GOWA_BASE_URL",
    "GOWA_WEBHOOK_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "SECRET_BRIDGE_TOKEN",
}
CUSTOM_RE = re.compile(r"^CUSTOM_[A-Z0-9_]{1,40}$")
MAX_VALUE_LEN = 4096

_state_lock = threading.Lock()
_last_reload = None  # (ok: bool, detail: str, at: epoch seconds)


def token_valid(presented: str) -> bool:
    try:
        with open(TOKEN_FILE, "rb") as fh:
            expected = fh.read().strip()
    except OSError:
        return False
    import hmac

    return hmac.compare_digest(expected, presented.encode("utf-8"))


def key_allowed(key: str) -> bool:
    return key in NAMED_KEYS or bool(CUSTOM_RE.match(key))


def parse_env_file(text: str):
    """Return (lines, index of each key -> line number). Preserves order."""
    lines = text.split("\n")
    positions = {}
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.split("=", 1)[0].strip()
        if key and key not in positions:
            positions[key] = i
    return lines, positions


def quote_value(value: str) -> str:
    """Single-quote the value; docker compose env_file supports this."""
    return "'" + value.replace("'", "'\\''") + "'"


def apply_change(action: str, key: str, value=None):
    """Atomically upsert or remove KEY in the env file. Returns updated_at."""
    with open(ENV_FILE, "r", encoding="utf-8") as fh:
        text = fh.read()
    lines, positions = parse_env_file(text)
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    if action == "set":
        new_line = f"{key}={quote_value(str(value))}"
        if key in positions:
            lines[positions[key]] = new_line
        else:
            # keep a trailing newline at the end of the file
            if lines and lines[-1] != "":
                lines.append("")
            lines.insert(len(lines) - 1, new_line)
    elif action == "delete":
        if key not in positions:
            return None  # nothing to do; not an error
        del lines[positions[key]]
    else:
        raise ValueError("bad action")

    tmp = ENV_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    os.chmod(tmp, 0o600)
    os.replace(tmp, ENV_FILE)
    return now_iso


def read_state():
    """Return (entries, last_reload) without values."""
    with open(ENV_FILE, "r", encoding="utf-8") as fh:
        text = fh.read()
    lines, positions = parse_env_file(text)
    entries = []
    for key, line_no in positions.items():
        # timestamps: file mtime is the best available signal
        entries.append({"key": key, "set": True, "updated_at": None})
    mtime = os.path.getmtime(ENV_FILE)
    return entries, mtime


def reload_functions():
    global _last_reload
    try:
        result = subprocess.run(
            ["docker", "compose", "up", "-d", "--force-recreate", "functions"],
            cwd=COMPOSE_DIR,
            capture_output=True,
            timeout=120,
        )
        ok = result.returncode == 0
        detail = (result.stderr or result.stdout).decode("utf-8", "replace")[-400:]
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, str(exc)[-400:]
    with _state_lock:
        _last_reload = (ok, detail, time.time())
    return ok, detail


def reload_functions_async():
    """Kick off the container reload in a background thread.

    The edge function that triggered this change is itself running inside the
    functions container being recreated; if we reload synchronously the
    caller's connection dies mid-request and kong reports a 502. Responding
    immediately and reloading in the background avoids that.
    """
    threading.Thread(target=reload_functions, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    server_version = "gamciv-secrets-bridge/1.0"

    def _reply(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._reply(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        # Auth first
        presented = self.headers.get("X-Bridge-Token", "")
        if not presented or not token_valid(presented):
            self._reply(401, {"ok": False, "error": "unauthorized"})
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 16384:
            self._reply(413, {"ok": False, "error": "too_large"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, UnicodeDecodeError):
            self._reply(400, {"ok": False, "error": "bad_json"})
            return

        path = self.path.rstrip("/") or "/"

        if path == "/status":
            entries, mtime = read_state()
            with _state_lock:
                last = _last_reload
            payload = {
                "ok": True,
                "version": 1,
                "env_file_mtime": mtime,
                "keys_managed": len(entries),
                "last_reload_ok": last[0] if last else None,
                "last_reload_at": last[2] if last else None,
            }
            self._reply(200, payload)
            return

        if path == "/list":
            entries, _ = read_state()
            self._reply(200, {"ok": True, "entries": entries, "last_reload": None})
            return

        if path == "/set":
            key = body.get("key")
            value = body.get("value")
            if not isinstance(key, str) or not key_allowed(key):
                self._reply(400, {"ok": False, "error": "key_not_allowed"})
                return
            if not isinstance(value, str) or not (0 < len(value) <= MAX_VALUE_LEN):
                self._reply(400, {"ok": False, "error": "invalid_value"})
                return
            apply_change("set", key, value)
            reload_functions_async()
            self._reply(200, {"ok": True, "reloading": True})
            return

        if path == "/delete":
            key = body.get("key")
            if not isinstance(key, str) or not key_allowed(key):
                self._reply(400, {"ok": False, "error": "key_not_allowed"})
                return
            apply_change("delete", key)
            reload_functions_async()
            self._reply(200, {"ok": True, "reloading": True})
            return

        self._reply(404, {"ok": False, "error": "not_found"})

    def log_message(self, format, *args):  # noqa: A002, A003 - stdlib signature
        # Never log bodies; the default would write to stderr, silence it.
        pass


def main():
    server = ThreadingHTTPServer(BIND_ADDR, Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
