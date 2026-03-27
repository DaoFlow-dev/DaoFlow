# typed: false
# frozen_string_literal: true

class Daoflow < Formula
  desc "Self-hosted deployment platform — Docker Compose made production-ready"
  homepage "https://daoflow.dev"
  version "0.5.17"
  license "AGPL-3.0-only"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/DaoFlow-dev/DaoFlow/releases/download/v#{version}/daoflow-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_ARM64_SHA256"
    end
    if Hardware::CPU.intel?
      url "https://github.com/DaoFlow-dev/DaoFlow/releases/download/v#{version}/daoflow-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_X64_SHA256"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/DaoFlow-dev/DaoFlow/releases/download/v#{version}/daoflow-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_ARM64_SHA256"
    end
    if Hardware::CPU.intel?
      url "https://github.com/DaoFlow-dev/DaoFlow/releases/download/v#{version}/daoflow-linux-x64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_X64_SHA256"
    end
  end

  def install
    bin.install "daoflow"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/daoflow --cli-version")
  end
end
