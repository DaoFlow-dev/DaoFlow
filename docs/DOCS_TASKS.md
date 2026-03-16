# Documentation Tasks (55 items)

Track progress writing DaoFlow docs at `./docs/`.

## Infrastructure (5)

- [ ] D-1. Install Docusaurus dependencies (`bun install` in `./docs`)
- [ ] D-2. Verify `bun start` runs docs site locally
- [ ] D-3. Add docs build step to CI pipeline
- [ ] D-4. Configure GitHub Pages or Vercel deployment for docs
- [ ] D-5. Add `docs:dev` and `docs:build` scripts to root `package.json`

## Getting Started (4)

- [ ] D-6. Write `getting-started/index.md` — overview and prerequisites
- [ ] D-7. Write `getting-started/installation.md` — step-by-step install guide
- [ ] D-8. Write `getting-started/first-deployment.md` — deploy a sample app end to end
- [ ] D-9. Write `getting-started/configuration.md` — config files, env vars, defaults

## Core Concepts (5)

- [ ] D-10. Write `concepts/architecture.md` — control plane vs execution plane, tech stack
- [ ] D-11. Write `concepts/projects-and-environments.md` — domain model hierarchy
- [ ] D-12. Write `concepts/servers.md` — SSH connectivity, health checks, Docker detection
- [ ] D-13. Write `concepts/deployments.md` — lifecycle, statuses, rollback model
- [ ] D-14. Write `concepts/services.md` — compose services, Dockerfile, image-based

## CLI Reference (11)

- [ ] D-15. Write `cli/index.md` — CLI overview, install, global flags (`--json`, `--quiet`, `--timeout`)
- [ ] D-16. Write `cli/auth.md` — `daoflow login`, token storage, contexts
- [ ] D-17. Write `cli/deploy.md` — `--compose`, `--server`, `--dry-run`, `--yes` flags
- [ ] D-18. Write `cli/status.md` — server health, deployment status, `--json` output
- [ ] D-19. Write `cli/rollback.md` — targeting previous deployment records
- [ ] D-20. Write `cli/logs.md` — streaming, filtering, structured log output
- [ ] D-21. Write `cli/env.md` — `env list`, `env set`, `env delete` subcommands
- [ ] D-22. Write `cli/plan.md` — deployment plan preview without execution
- [ ] D-23. Write `cli/doctor.md` — full diagnostic checks
- [ ] D-24. Write `cli/whoami.md` — principal identity and role display
- [ ] D-25. Write `cli/capabilities.md` — granted scopes listing

## API Reference (6)

- [ ] D-26. Write `api/index.md` — API overview, three-lane model (read/planning/command)
- [ ] D-27. Write `api/authentication.md` — session auth, API tokens, Bearer header
- [ ] D-28. Write `api/read-endpoints.md` — all read-only tRPC procedures with examples
- [ ] D-29. Write `api/planning-endpoints.md` — deployment plan, rollback plan, config diff
- [ ] D-30. Write `api/command-endpoints.md` — mutations, idempotency keys, dry-run
- [ ] D-31. Write `api/error-handling.md` — error codes, SCOPE_DENIED shape, exit codes

## Security & RBAC (6)

- [ ] D-32. Write `security/index.md` — security model overview
- [ ] D-33. Write `security/roles.md` — owner, admin, operator, developer, viewer, agent
- [ ] D-34. Write `security/scopes.md` — all 26 colon-delimited scopes with descriptions
- [ ] D-35. Write `security/api-tokens.md` — creating, revoking, lane mapping
- [ ] D-36. Write `security/agent-principals.md` — agent accounts, default permissions
- [ ] D-37. Write `security/audit-trail.md` — audit record schema, querying, retention

## Deployments (6)

- [ ] D-38. Write `deployments/index.md` — deployment model overview
- [ ] D-39. Write `deployments/compose.md` — Docker Compose deployment walkthrough
- [ ] D-40. Write `deployments/dockerfile.md` — build-from-repo deployment
- [ ] D-41. Write `deployments/image.md` — pre-built image deployment
- [ ] D-42. Write `deployments/rollback.md` — rollback targeting and safety
- [ ] D-43. Write `deployments/logs.md` — raw logs, structured timeline, agent summaries

## Backup & Restore (5)

- [ ] D-44. Write `backups/index.md` — backup model overview
- [ ] D-45. Write `backups/policies.md` — creating and managing backup policies
- [ ] D-46. Write `backups/runs.md` — manual and scheduled backup execution
- [ ] D-47. Write `backups/restore.md` — restore workflow and approval gates
- [ ] D-48. Write `backups/s3-storage.md` — S3-compatible remote storage config

## Agent Integration (6)

- [ ] D-49. Write `agents/index.md` — why agent-first, design philosophy
- [ ] D-50. Write `agents/getting-started.md` — create agent principal, get token, first call
- [ ] D-51. Write `agents/cli-for-agents.md` — using CLI from AI agent tool loops
- [ ] D-52. Write `agents/api-for-agents.md` — structured JSON output, error parsing
- [ ] D-53. Write `agents/safety-model.md` — read-only defaults, escalation, guardrails
- [ ] D-54. Write `agents/approval-gates.md` — gated actions, approval workflow

## Self-Hosting (6)

- [ ] D-55. Write `self-hosting/index.md` — self-hosting overview
- [ ] D-56. Write `self-hosting/requirements.md` — hardware/software requirements
- [ ] D-57. Write `self-hosting/docker-compose.md` — production compose file walkthrough
- [ ] D-58. Write `self-hosting/environment-variables.md` — all env vars documented
- [ ] D-59. Write `self-hosting/ssl-and-domains.md` — TLS, reverse proxy, custom domains
- [ ] D-60. Write `self-hosting/upgrading.md` — upgrade procedure and migration guide

## Contributing (5)

- [ ] D-61. Write `contributing/index.md` — contribution guidelines
- [ ] D-62. Write `contributing/development-setup.md` — dev environment setup
- [ ] D-63. Write `contributing/architecture-guide.md` — package structure, data flow
- [ ] D-64. Write `contributing/testing.md` — running tests, E2E, writing new tests
- [ ] D-65. Write `contributing/code-style.md` — linting, formatting, conventions
