#!/bin/sh
# Claude Code on the web: install dependencies when a cloud session starts, so lint, typecheck, tests
# and the smoke test can run straight away. Does nothing on your own machine.
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -d node_modules ] && exit 0
npm ci --no-audit --no-fund >/dev/null 2>&1 || echo "session-start: npm ci failed; run it by hand" >&2
exit 0
