#!/usr/bin/env sh
set -eu

# Bun 1.3.14 aborts during repeated Playwright webServer runs on Linux CI.
version="${BUN_VERSION:-1.3.13}"
system="$(uname -s)"
machine="$(uname -m)"

if [ -n "${BUN_BASELINE_TARGET:-}" ]; then
  target="$BUN_BASELINE_TARGET"
elif [ "$system" = "Linux" ] && [ "$machine" = "x86_64" ]; then
  target="bun-linux-x64-baseline"
elif [ "$system" = "Linux" ] && [ "$machine" = "aarch64" ]; then
  target="bun-linux-aarch64"
elif [ "$system" = "Darwin" ] && [ "$machine" = "arm64" ]; then
  target="bun-darwin-aarch64"
elif [ "$system" = "Darwin" ] && [ "$machine" = "x86_64" ]; then
  target="bun-darwin-x64"
else
  echo "Unsupported platform for Bun install: $system $machine" >&2
  exit 1
fi

install_root="${RUNNER_TEMP:-/tmp}/daoflow-bun-baseline"
archive="$install_root/${target}.zip"
bin_dir="$install_root/$target"

mkdir -p "$install_root"
curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${target}.zip" -o "$archive"

if command -v unzip >/dev/null 2>&1; then
  unzip -q -o "$archive" -d "$install_root"
elif command -v python3 >/dev/null 2>&1; then
  python3 -m zipfile -e "$archive" "$install_root"
else
  echo "Installing Bun baseline requires unzip or python3." >&2
  exit 1
fi

if [ -f "$bin_dir/bun" ]; then
  chmod +x "$bin_dir/bun"
fi

if [ ! -x "$bin_dir/bun" ]; then
  echo "Bun baseline binary was not installed at $bin_dir/bun" >&2
  exit 1
fi

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$bin_dir" >> "$GITHUB_PATH"
fi

"$bin_dir/bun" --version
