#!/bin/sh
# Ad-hoc signs the locally built app so macOS (Apple Silicon especially) will launch it.
# No Apple developer account is needed; this only marks the bundle as intact on this Mac.
# Usage: npm run build && sh scripts/adhoc-sign.sh
set -e
for app in "release/mac-arm64/Teaching OS.app" "release/mac/Teaching OS.app"; do
  if [ -d "$app" ]; then
    codesign --force --deep --sign - "$app"
    xattr -cr "$app" 2>/dev/null || true
    echo "Signed: $app"
    exit 0
  fi
done
echo "No built app found under release/. Run 'npm run build' first." >&2
exit 1
