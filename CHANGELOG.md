# Changelog

All notable changes to DaoFlow are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file was reconstructed from the git tag history (`v0.5.x` – `v0.9.2`). Entries
predating this reconstruction are summarized at the release level rather than
per-commit. Going forward, update this file in the same PR as the change.

## [Unreleased]

## [0.11.0] - 2026-07-19

### Added

- GitHub and GitLab deployments now publish commit status throughout the
  rollout and maintain one durable pull-request or merge-request note with the
  active preview URL.
- GitLab connections now support secure OAuth with PKCE, API tokens,
  clone-only deploy tokens, serialized token refresh, and separate public and
  internal URLs for self-hosted installations.
- GitHub and GitLab connections can now use provider-scoped custom CA
  certificates for private source-control servers without weakening global TLS
  verification.
- Durable server monitoring now stores collection policy, metric history,
  alert state, and delivery state for operator visibility.
- Managed services now have configurable Docker log rotation to keep long-lived
  hosts from filling their disks.

### Changed

- Source-control feedback is delivered through a leased, retryable outbox so a
  provider outage cannot change the deployment result or create duplicate
  comments.
- Startup now rejects stale or ambiguous migration lineages before serving
  traffic.

### Fixed

- Server metric scheduling now compares timestamps correctly across time zones
  instead of failing every polling cycle on PostgreSQL.
- CI now restarts after confirmed native Bun E2E crashes and retries the whole
  lane once, while preserving ordinary test failures and a strict retry budget.
- Homebrew formula updates can be dispatched explicitly and follow successful
  CLI releases reliably.

## [0.10.0] - 2026-07-18

### Added

- Recoverable GitHub and GitLab webhook delivery attempts with per-target
  outcomes, replay controls, and operator visibility without storing webhook
  secrets or duplicating successful deployments.
- Durable approval dispatch intents with leased retries, reconciliation, and
  operator requeue controls for approved deploy and restore actions.
- Verified, encrypted control-plane recovery bundles with isolated verification
  runs and offline restore support.
- Per-server deployment and build capacity controls for safer operation on
  smaller hosts.
- A lean installation profile and direct Docker Compose project creation from
  the CLI.
- An MCP server for permission-aware, agent-native access to DaoFlow.
- A production-readiness evidence gate and generated plain-language readiness
  report for releases.
- `CHANGELOG.md` and an explicit **1.0 exit criteria** section in the e2e roadmap.
- `.agents/references/e2e-coverage-and-real-infra.md` documenting exactly which
  parts of the test suite exercise real Docker/SSH versus mocked execution, and a
  design for a real-infra validation harness.
- Top-level audit entry for `managed_database.create` so managed-database
  provisioning is auditable as a single operation (charter §14).

### Changed

- Deployments, approvals, and source-control connections now enforce team scope
  and stronger trust boundaries.
- Destination credentials are encrypted before persistence.
- The dependency baseline now uses TypeScript 7-compatible tooling and a stable
  Bun CI configuration.
- Database migrations were consolidated into a replay-safe production lineage
  for clean installs and upgrades from supported pre-release schemas.
- Deployment watchdog diagnosis now links its evidence to the exact persisted
  `events` and `deployment_logs` row IDs instead of an opaque static identifier
  (charter §10: "any AI-generated diagnosis must link back to exact log lines or
  event IDs").

### Fixed

- Initial-owner bootstrap, approval authorization, recovery verification, and
  E2E isolation failures that could make production validation unreliable.
- Production image and release workflows now validate readiness against a real
  PostgreSQL service before publishing.

### Known gaps (documented, not yet fixed)

- **Config drift (`daoflow drift`) is not live.** It reads pre-computed reports
  from `environment.config.composeDriftReports`; nothing currently populates them
  from the running server. See the e2e roadmap "Known Gaps" section.
- **Main E2E suite mocks the execution plane** (`DISABLE_WORKER=true`). Only the
  separate `e2e-worker` job exercises real Docker, and only against localhost. See
  the real-infra coverage reference above.

## [0.9.2] - 2026-05-14

### Fixed

- Bun baseline segfault in E2E CI.

## [0.9.1] - 2026-05-14

### Added

- SSRF protection.
- Server metrics UI and system-level server metrics collection.

### Fixed

- CPU metrics script now uses a two-line `printf` for correct `awk` parsing.

## [0.9.0] - 2026-05-14

### Added

- Buildpack deploys; Docker cleanup configuration; Traefik `redirect-regex`
  middleware.
- Port-conflict detection for deployment targets.
- Notification channels; Traefik middleware; Bitbucket/Gitea providers; Nixpacks
  builds.
- Observability CLI commands.

### Fixed

- Assorted backup and deploy bugs.

## [0.8.x] - 2026

Stabilization and refactor series. Highlights:

- One-click GitHub App manifest flow (`0.8.3`).
- Profile session revocation; signup/profile hardening.
- Development-task runner hardening: fail stalled tasks, permission gating,
  unusable-sandbox-runner diagnostics.
- Install/upgrade robustness: stale volume handling, TTY redirect, timeout
  diagnostics, readiness-timeout failures, tunnel sidecar preservation.
- Numerous client-side load-failure surfaces and a dashboard UX audit.
- Large refactors splitting oversized modules (backups, notifications, CLI
  install flow, dev tasks) per the 300/500-line hygiene rules.

## [0.5.x – 0.7.x] - 2026

Early control-plane, CLI, deployment, and backup foundations. See git history
(`git log v0.5.0..v0.8.0`) for detail.

[Unreleased]: https://github.com/DaoFlow-dev/DaoFlow/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/DaoFlow-dev/DaoFlow/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/DaoFlow-dev/DaoFlow/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/daoflow/daoflow/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/daoflow/daoflow/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/daoflow/daoflow/compare/v0.8.8...v0.9.0
