#!/bin/bash
# Runs the Supply/stock/role API checks against a throw-away copy of the server (port 3100, temp data folder).
# Your real data/ folder and uploads/ are never touched. Usage:  bash .claude/skills/supply-checks/scripts/run.sh [security|logic|photos|roles ...]
# With no arguments every suite runs, each on a fresh server and fresh data.
cd "$(dirname "$0")/../../../.." || exit 1
ROOT="$(pwd)"
TMP="$(mktemp -d)"
export PORT=3100 DATA_DIR="$TMP/data" UPLOADS_DIR="$TMP/uploads"
SUITES=("$@"); [ ${#SUITES[@]} -eq 0 ] && SUITES=(security logic photos roles)
declare -A FILE=( [security]=api-security.js [logic]=api-logic.js [photos]=api-photos.js [roles]=api-roles.js )
stop_server() { [ -n "$SRV" ] && kill "$SRV" 2>/dev/null; SRV=""; }
trap 'stop_server; rm -rf "$TMP"' EXIT
FAILED=0
for s in "${SUITES[@]}"; do
  f="${FILE[$s]}"; [ -z "$f" ] && { echo "Unknown suite: $s (use security, logic, photos, roles)"; exit 2; }
  stop_server; rm -rf "$DATA_DIR" "$UPLOADS_DIR"; mkdir -p "$DATA_DIR" "$UPLOADS_DIR"
  node "$ROOT/.claude/skills/supply-checks/scripts/seed-products.js" "$DATA_DIR" >/dev/null
  node "$ROOT/server.js" > "$TMP/server.log" 2>&1 & SRV=$!
  for i in $(seq 1 40); do curl -s -o /dev/null "localhost:$PORT/api/health" && break; sleep 0.5; done
  echo "== $s"
  out="$(node "$ROOT/.claude/skills/supply-checks/scripts/$f" 2>&1)"; echo "$out" | grep -E "passed|FAIL|CRASH"
  echo "$out" | grep -qE "CRASH| [1-9][0-9]* failed" && FAILED=1
done
[ $FAILED -eq 0 ] && echo "ALL SUITES PASSED" || { echo "SOME CHECKS FAILED (server log: $TMP/server.log)"; trap 'stop_server' EXIT; exit 1; }
