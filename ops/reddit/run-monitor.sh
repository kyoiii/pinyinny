#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ -z "${NODE_BIN:-}" ]; then
  echo "node binary not found; set NODE_BIN in $ENV_FILE or your service environment" >&2
  exit 1
fi

cd "$SCRIPT_DIR"
"$NODE_BIN" search-opportunities.mjs
"$NODE_BIN" monitor-feedback.mjs
