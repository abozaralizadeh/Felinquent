#!/usr/bin/env bash
# Installs or updates Felinquent from the latest release, without the "can't check this app"
# warning. Paste this in Terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-mac.sh | bash
#
# It downloads Felinquent.dmg from the latest GitHub release, checks it against the SHA-256
# published next to it, copies the app into /Applications (or ~/Applications when /Applications
# isn't writable for you) and starts it. Browsers tag what they download as "from the internet",
# and that tag is what makes macOS ask whether the app is safe. A download made by curl doesn't
# get it, so the app just opens. The cat keeps what it learned: that lives in
# ~/Library/Application Support/app.felinquent, not in the app.
#
# Options, after "bash -s --" when piping (or after the script name when running it from a file):
#   --dir DIR    install into DIR instead of /Applications
#   --no-open    don't start it at the end
# FELINQUENT_FROM=<url> downloads from another folder with the same two files, for testing.
set -euo pipefail

FROM="${FELINQUENT_FROM:-https://github.com/abozaralizadeh/Felinquent/releases/latest/download}"
DIR="/Applications"
OPEN=1

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) shift; DIR="${1:?--dir needs a folder}" ;;
    --no-open) OPEN=0 ;;
    -h|--help) echo "Usage: get-mac.sh [--dir DIR] [--no-open]"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

say() { printf '==> %s\n' "$*"; }
fail() { printf 'Felinquent: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS."
os="$(sw_vers -productVersion)"
[ "${os%%.*}" -ge 13 ] || fail "Felinquent needs macOS 13 or newer, and this Mac has $os."

tmp="$(mktemp -d -t felinquent)"
mnt="$tmp/mnt"
cleanup() {
  if [ -d "$mnt" ]; then hdiutil detach -quiet "$mnt" >/dev/null 2>&1 || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

say "Downloading Felinquent"
curl -fL --progress-bar -o "$tmp/Felinquent.dmg" "$FROM/Felinquent.dmg" || fail "the download didn't work. Check the connection and try again."
want="$(curl -fsSL "$FROM/Felinquent.dmg.sha256" | awk '{print $1}')" || fail "couldn't get the checksum to check the download against."
got="$(shasum -a 256 "$tmp/Felinquent.dmg" | awk '{print $1}')"
if [ -z "$want" ] || [ "$got" != "$want" ]; then
  fail "the download doesn't match the checksum on the release, so nothing was installed. Try again in a bit."
fi
say "Checksum matches the release"

mkdir -p "$mnt"
hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$tmp/Felinquent.dmg" || fail "couldn't open the DMG."
[ -d "$mnt/Felinquent.app" ] || fail "there's no Felinquent.app in the DMG."
version="$(defaults read "$mnt/Felinquent.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")"

mkdir -p "$DIR" 2>/dev/null || true
if [ ! -w "$DIR" ]; then
  DIR="$HOME/Applications"
  mkdir -p "$DIR"
  echo "    /Applications isn't writable for you, so it goes in $DIR"
fi
app="$DIR/Felinquent.app"

# A copy running from this folder stops first, so the new one can take its place.
if pkill -f "$app/Contents/MacOS/felinquent" 2>/dev/null; then sleep 1; fi

say "Installing Felinquent${version:+ $version} into $DIR"
staged="$DIR/.Felinquent.app.new"
rm -rf "$staged"
ditto "$mnt/Felinquent.app" "$staged"
rm -rf "$app"
mv "$staged" "$app"

if [ "$OPEN" = 1 ]; then
  say "Starting it"
  open "$app"
fi
say "Done. The cat's icon is in the menu bar. Run this again any time to update (from 0.1.2 on, the app also updates itself)."
