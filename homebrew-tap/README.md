# Homebrew Tap for DaoFlow

Official [Homebrew](https://brew.sh) tap for [DaoFlow](https://github.com/DaoFlow-dev/DaoFlow) — self-hosted deployment platform.

## Install

```bash
brew install daoflow-dev/daoflow/daoflow
```

Or tap first, then install:

```bash
brew tap daoflow-dev/daoflow
brew install daoflow
```

## Upgrade

```bash
brew upgrade daoflow
```

## Uninstall

```bash
brew uninstall daoflow
brew untap daoflow-dev/daoflow
```

## About

This tap is automatically updated by GitHub Actions when a new DaoFlow CLI release is published.

The formula downloads pre-compiled binaries for your platform:

| Platform | Architecture          |
| -------- | --------------------- |
| macOS    | Apple Silicon (arm64) |
| macOS    | Intel (x64)           |
| Linux    | arm64                 |
| Linux    | x64                   |
