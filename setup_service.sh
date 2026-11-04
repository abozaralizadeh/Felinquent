#!/usr/bin/env bash
# Installs and runs the Felinquent playground (the browser demo of the cat) as a systemd service on a Linux VM.
# Run it the first time and every time after: it updates the code dependencies, rebuilds, rewrites the service
# and restarts it. Watch the logs with:  journalctl -u felinquent-playground.service -f
#
# Usage:  sudo ./setup_service.sh [--dry-run] [--port 4173]
# The desktop cat itself is a Mac app and does not run here. This only serves the demo page.
set -euo pipefail

SERVICE="felinquent-playground"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="felinquent"
PORT="${FELINQUENT_PORT:-4173}"
LOG_DIR="${FELINQUENT_LOG_DIR:-$APP_DIR/logs}"
ENV_FILE="/etc/felinquent/playground.env"
UNIT_FILE="/etc/systemd/system/${SERVICE}.service"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }

if [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root: sudo ./setup_service.sh" >&2
  exit 1
fi
case "$PORT" in ''|*[!0-9]*) echo "Port must be a number" >&2; exit 2 ;; esac

say "1/6 Node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    run apt-get update -y
    run apt-get install -y nodejs npm curl
  else
    echo "Node.js 20 or newer is needed and this system has no apt-get. Install it, then run this script again." >&2
    exit 1
  fi
  if [ "$DRY" = 0 ]; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -lt 20 ]; then
      echo "The packaged Node.js is version $major, but 20+ is needed. Install a newer one (for example from nodejs.org) and run this script again." >&2
      exit 1
    fi
  fi
else
  echo "Node.js $(node -v) is fine."
fi

say "2/6 Service user and folders"
if ! id "$RUN_USER" >/dev/null 2>&1; then
  run useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi
run mkdir -p "$LOG_DIR" "$(dirname "$ENV_FILE")"
run chown -R "$RUN_USER":"$RUN_USER" "$LOG_DIR"

say "3/6 Dependencies and build"
cd "$APP_DIR"
if [ -f package-lock.json ]; then run npm ci --no-audit --no-fund; else run npm install --no-audit --no-fund; fi
run npm run build
run chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR/dist" "$APP_DIR/node_modules"

say "4/6 Settings file (no secrets in it)"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] write $ENV_FILE with port $PORT, root $APP_DIR/dist, logs $LOG_DIR"
else
  cat > "$ENV_FILE" <<ENV
FELINQUENT_PORT=$PORT
FELINQUENT_ROOT=$APP_DIR/dist
FELINQUENT_LOG_DIR=$LOG_DIR
ENV
  chmod 640 "$ENV_FILE"
  chgrp "$RUN_USER" "$ENV_FILE"
fi

say "5/6 systemd unit"
UNIT="[Unit]
Description=Felinquent playground (browser demo of the desktop cat)
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v npx || echo /usr/bin/npx) tsx src/node/serve.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$LOG_DIR

[Install]
WantedBy=multi-user.target"
if [ "$DRY" = 1 ]; then
  printf '[dry-run] write %s:\n%s\n' "$UNIT_FILE" "$UNIT"
else
  printf '%s\n' "$UNIT" > "$UNIT_FILE"
fi
run systemctl daemon-reload
run systemctl enable "$SERVICE"
run systemctl restart "$SERVICE"

say "6/6 Check it is up"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] curl http://127.0.0.1:$PORT/healthz"
else
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
      echo "Up: http://<this-vm>:$PORT/"
      echo "Logs: journalctl -u $SERVICE.service -f   (size-limited copy: $LOG_DIR/playground.log)"
      exit 0
    fi
    sleep 1
  done
  echo "The service did not answer in 20 seconds. Look at: journalctl -u $SERVICE.service -n 50" >&2
  exit 1
fi
