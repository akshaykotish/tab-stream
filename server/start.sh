#!/usr/bin/env bash
# Tab Stream server launcher (macOS / Linux)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org then run this again."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install || exit 1
fi
echo "Starting Tab Stream..."
node server.js
