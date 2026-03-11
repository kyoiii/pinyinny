#!/usr/bin/env bash
set -euo pipefail

APP_NAME="pinyinka-reddit-ops"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REMOTE_DIR="${REMOTE_DIR:-$HOME/apps/$APP_NAME}"
SYSTEMD_DIR="${SYSTEMD_DIR:-$HOME/.config/systemd/user}"

mkdir -p "$REMOTE_DIR"
mkdir -p "$SYSTEMD_DIR"

rsync -a --delete \
  --exclude '.env' \
  --exclude 'out/' \
  --exclude 'state/' \
  "$ROOT_DIR/" "$REMOTE_DIR/"

cp "$REMOTE_DIR/deploy/$APP_NAME.service" "$SYSTEMD_DIR/$APP_NAME.service"
cp "$REMOTE_DIR/deploy/$APP_NAME.timer" "$SYSTEMD_DIR/$APP_NAME.timer"

if [ ! -f "$REMOTE_DIR/.env" ]; then
  cp "$REMOTE_DIR/.env.example" "$REMOTE_DIR/.env"
  echo "Created $REMOTE_DIR/.env"
fi

cd "$REMOTE_DIR"
npm install
npx playwright install --with-deps firefox

systemctl --user daemon-reload
systemctl --user enable --now "$APP_NAME.timer"

echo
echo "Remote worker installed."
echo "Project: $REMOTE_DIR"
echo "Timer:   $APP_NAME.timer"
echo "Service: $APP_NAME.service"
echo
echo "If the timer should survive logout, run:"
echo "  sudo loginctl enable-linger $USER"
