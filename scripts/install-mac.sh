#!/usr/bin/env bash
# Installs (or updates) Felinquent on a Mac. Run it again any time to update.
#   bash scripts/install-mac.sh                 build and install into /Applications, then start it
#   bash scripts/install-mac.sh --with-model    also set up Ollama and the small local model (about 1 GB)
#   bash scripts/install-mac.sh --login         also start it when you log in
#   bash scripts/install-mac.sh --prefix DIR    install into DIR instead of /Applications
#   bash scripts/install-mac.sh --no-launch     do not start it at the end
#   bash scripts/install-mac.sh --dry-run       only print what it would do
set -euo pipefail

PREFIX="/Applications"
WITH_MODEL=0
LOGIN=0
LAUNCH=1
DRY=0
MODEL="${FELINQUENT_OLLAMA_MODEL:-gemma3:1b}"

while [ $# -gt 0 ]; do
  case "$1" in
    --with-model) WITH_MODEL=1 ;;
    --login) LOGIN=1 ;;
    --no-launch) LAUNCH=0 ;;
    --dry-run) DRY=1 ;;
    --prefix) shift; PREFIX="${1:?--prefix needs a folder}" ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '    [dry run] %s\n' "$*"; else "$@"; fi; }

[ "$(uname -s)" = "Darwin" ] || { echo "This script is for macOS. On Windows use scripts/install-windows.ps1."; exit 1; }
cd "$(dirname "$0")/.."

say "Checking the tools"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Apple's command line tools are missing. Run: xcode-select --install   then run this script again."
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is missing. Install it from https://brew.sh, then run this script again."
  exit 1
fi
command -v node >/dev/null 2>&1 || { say "Installing Node"; run brew install node; }
if ! command -v cargo >/dev/null 2>&1; then
  RUSTUP_BIN="$(brew --prefix 2>/dev/null)/opt/rustup/bin"
  if [ ! -x "$RUSTUP_BIN/rustup" ] && [ ! -x "$HOME/.cargo/bin/rustup" ]; then say "Installing Rust"; run brew install rustup; fi
  export PATH="$RUSTUP_BIN:$HOME/.cargo/bin:$PATH"
  command -v cargo >/dev/null 2>&1 || run rustup default stable
else
  export PATH="$HOME/.cargo/bin:$PATH"
fi

say "Building the app (the first build takes a few minutes)"
run npm ci
run npm run bundle:mac
APP_SRC="src-tauri/target/release/bundle/macos/Felinquent.app"

say "Installing into $PREFIX"
if [ "$DRY" = 0 ] && [ ! -d "$PREFIX" ]; then mkdir -p "$PREFIX"; fi
if [ "$DRY" = 0 ] && [ ! -w "$PREFIX" ]; then
  PREFIX="$HOME/Applications"
  mkdir -p "$PREFIX"
  echo "    /Applications is not writable for you, using $PREFIX instead."
fi
run pkill -x felinquent || true
run rm -rf "$PREFIX/Felinquent.app"
run cp -R "$APP_SRC" "$PREFIX/Felinquent.app"
# Sign it on this Mac, so macOS does not complain that the app is damaged. Not a Developer ID signature.
run codesign --force --deep -s - "$PREFIX/Felinquent.app"
run xattr -cr "$PREFIX/Felinquent.app"

if [ "$WITH_MODEL" = 1 ]; then
  say "Setting up the local model ($MODEL)"
  command -v ollama >/dev/null 2>&1 || run brew install ollama
  if ! curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then run brew services start ollama; [ "$DRY" = 1 ] || sleep 4; fi
  run ollama pull "$MODEL"
else
  echo "    (Skipping the local model. The cat works without it. Add --with-model to set it up.)"
fi

if [ "$LOGIN" = 1 ]; then
  say "Starting it at login"
  PLIST="$HOME/Library/LaunchAgents/app.felinquent.plist"
  if [ "$DRY" = 0 ]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.felinquent</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>$PREFIX/Felinquent.app</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLISTEOF
  else
    echo "    [dry run] write $PLIST"
  fi
fi

if [ "$LAUNCH" = 1 ]; then
  say "Starting Felinquent"
  run open "$PREFIX/Felinquent.app"
fi

say "Done"
echo "Felinquent is in $PREFIX. Look for its icon in the menu bar: it has Character, Panic, Shoo and Quit."
echo "Logs: ~/Library/Logs/Felinquent/overlay.log"
echo "Run this script again any time to update."
