#!/usr/bin/env sh
set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if [ ! -f .githooks/pre-commit ]; then
  exit 0
fi

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit

echo "Git hooks installed to .githooks"
