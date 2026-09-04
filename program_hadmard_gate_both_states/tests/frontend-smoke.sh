#!/usr/bin/env bash
set -euo pipefail

port="${1:-18084}"
python3 -m http.server "$port" --directory frontend >/tmp/cudaq-frontend-test.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${port}/" > /tmp/cudaq-frontend-test.html; then
    grep -q 'CUDA-Q WORKBENCH' /tmp/cudaq-frontend-test.html
    curl -fsS "http://127.0.0.1:${port}/app.js" | grep -q "gate.gate === 'X'"
    printf '%s\n' 'frontend smoke test: PASS'
    exit 0
  fi
  sleep 0.1
done

printf '%s\n' 'frontend smoke test: FAIL' >&2
exit 1
