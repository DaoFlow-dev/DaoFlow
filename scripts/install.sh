#!/bin/sh
# DaoFlow Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh
#        curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh -s -- --domain deploy.example.com --email admin@test.com --password pass --yes
set -eu

REPO="DaoFlow-dev/DaoFlow"
INSTALL_DIR="/usr/local/bin"
DAOFLOW_VERSION="${DAOFLOW_VERSION:-latest}"

main() {
  echo "🚀 DaoFlow Installer"
  echo ""

  os=$(detect_os)
  arch=$(detect_arch)
  ensure_docker "$os"
  install_binary "$os" "$arch"
  run_install "$@"
}

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *)
      echo "Unsupported OS: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64)  echo "x64" ;;
    aarch64) echo "arm64" ;;
    arm64)   echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

ensure_docker() {
  os="$1"

  if docker info >/dev/null 2>&1; then
    echo "✓ Docker is running"
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    if [ "$os" = "darwin" ]; then
      echo "Docker Desktop is installed but not running."
      echo "Please start Docker Desktop and try again."
      exit 1
    fi
    echo "Docker is installed but not running. Trying sudo..."
    if sudo docker info >/dev/null 2>&1; then
      echo "✓ Docker is running (via sudo)"
      return
    fi
  fi

  if [ "$os" = "darwin" ]; then
    echo "Docker is required. Install Docker Desktop from:"
    echo "  https://www.docker.com/products/docker-desktop"
    exit 1
  fi

  echo "Installing Docker..."
  if is_root; then
    sh -c "$(curl -fsSL https://get.docker.com)" >/dev/null 2>&1
  else
    curl -fsSL https://get.docker.com | sudo sh >/dev/null 2>&1
    sudo usermod -aG docker "$USER" 2>/dev/null || true
  fi

  echo "✓ Docker installed"
}

install_binary() {
  os="$1"
  arch="$2"

  if command -v daoflow >/dev/null 2>&1; then
    current=$(daoflow --version 2>/dev/null || echo "unknown")
    echo "✓ daoflow is already installed (${current})"
    return
  fi

  echo "Downloading daoflow CLI..."

  binary="daoflow-${os}-${arch}"

  if [ "$DAOFLOW_VERSION" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/${binary}"
  else
    url="https://github.com/${REPO}/releases/download/v${DAOFLOW_VERSION}/${binary}"
  fi

  tmpfile=$(mktemp)
  if ! download "$url" "$tmpfile"; then
    echo "Failed to download daoflow binary from:"
    echo "  $url"
    echo ""
    echo "You can install manually:"
    echo "  Download from: https://github.com/${REPO}/releases"
    echo "  Place the binary in /usr/local/bin/daoflow"
    exit 1
  fi

  if is_root; then
    install -m 755 "$tmpfile" "${INSTALL_DIR}/daoflow"
  else
    sudo install -m 755 "$tmpfile" "${INSTALL_DIR}/daoflow"
  fi
  rm -f "$tmpfile"

  echo "✓ daoflow installed to ${INSTALL_DIR}/daoflow"
}

run_install() {
  echo ""
  echo "Running daoflow install..."
  echo ""
  daoflow install "$@" </dev/tty
}

# -- Helpers --

download() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$output" "$url"
  else
    echo "curl or wget is required" >&2
    exit 1
  fi
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

main "$@"
