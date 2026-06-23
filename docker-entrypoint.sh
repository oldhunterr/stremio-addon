#!/bin/bash
set -e

REPO_URL="https://github.com/oldhunterr/stremio-addon.git"
APP_DIR="/app"

if [ -d "$APP_DIR/.git" ]; then
  echo ">>> Repo exists — pulling latest..."
  cd "$APP_DIR"
  git pull
else
  echo ">>> Cloning repo from $REPO_URL ..."
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo ">>> Installing dependencies..."
npm install

echo ">>> Installing Playwright browsers..."
npx playwright install chromium 2>&1 | tail -5

echo ">>> Starting stremio-addon on port ${PORT:-7100}..."
exec node index.js
