#!/bin/sh
# Builds Teaching OS and installs it in /Applications, replacing an older copy. Your data is not in the
# app (it lives in ~/Library/Application Support/TeachingOS), so updating never touches it.
# Usage, from the project folder: npm run install:mac
set -e
cd "$(dirname "$0")/.."

if [ "$(uname)" != "Darwin" ]; then
  echo "This installs the Mac app; run it on your Mac." >&2
  exit 1
fi

echo "Installing dependencies..."
npm ci --no-audit --no-fund
echo "Building..."
npm run build
sh scripts/adhoc-sign.sh

app=$(ls -d release/mac*/"Teaching OS.app" | head -1)
if pgrep -x "Teaching OS" >/dev/null; then
  echo "Quitting the running copy..."
  osascript -e 'quit app "Teaching OS"' || true
  sleep 2
fi
rm -rf "/Applications/Teaching OS.app"
cp -R "$app" /Applications/
echo "Installed: /Applications/Teaching OS.app"
open "/Applications/Teaching OS.app"
