#!/usr/bin/env bash
# Removes Felinquent from a Mac.
#   bash scripts/uninstall-mac.sh           remove the app and the start-at-login entry
#   bash scripts/uninstall-mac.sh --purge   also delete what the cat remembers, its settings and its logs
set -euo pipefail
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1
pkill -x felinquent 2>/dev/null || true
rm -rf /Applications/Felinquent.app "$HOME/Applications/Felinquent.app"
launchctl unload "$HOME/Library/LaunchAgents/app.felinquent.plist" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/app.felinquent.plist"
if [ "$PURGE" = 1 ]; then
  # app.felinquent.spike is the folder of builds before 0.1.0.
  rm -rf "$HOME/Library/Application Support/app.felinquent" "$HOME/Library/Application Support/app.felinquent.spike" "$HOME/Library/Logs/Felinquent"
  echo "Removed the app, its memory, settings and logs."
else
  echo "Removed the app. Its memory and settings are still in ~/Library/Application Support/app.felinquent (use --purge to delete them)."
fi
