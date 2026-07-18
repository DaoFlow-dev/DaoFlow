---
sidebar_position: 3
---

# DaoFlow vs Coolify and Dokploy

Coolify and Dokploy are the deployment-product references for DaoFlow. They demonstrate the breadth
operators expect from a self-hosted platform: a capable dashboard, Git integrations, repeatable
builds, deployment history, domains, databases, backups, and server maintenance.

DaoFlow is not positioned as feature-complete parity today. The immediate goal is narrower: make
the production deployment loop dependable first, then close the most important dashboard and source
control gaps without weakening permissions, audit evidence, or CLI contracts.

## Current Product Truth

| Area                         | DaoFlow today                                                                                                                                      | Coolify and Dokploy reference point                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Deployment sources           | Compose, Dockerfile, image, Nixpacks, and Buildpack paths share one deployment record and worker boundary                                          | Broad dashboard-driven source and build configuration                                          |
| Small-server operation       | Lean control-plane profile validated at 1 vCPU / 1 GB; production guidance starts higher                                                           | Mature operational guidance and larger field experience                                        |
| Build pressure               | Per-server build slots, oldest-first waiting, queue positions, same-service serialization, durable lease recovery, and image-only bypass           | Dokploy exposes per-server concurrent builds; Coolify supports separate build servers          |
| Queue safety                 | Claimed waiters remain bounded, long uploads renew admission, and queue-full API and CLI errors are stable                                         | Mature queue and deployment-history UX                                                         |
| GitHub                       | GitHub App setup, repository and branch sources, push deploys, approval-gated pull-request previews                                                | Mature GitHub App and pull-request deployment workflows                                        |
| GitLab                       | GitLab.com and self-hosted GitLab OAuth, push deploys, merge-request previews, and host-isolated repository identity                               | Coolify has direct GitLab integration; Dokploy supports GitLab sources and webhook auto-deploy |
| Provider-native build status | Deployment state is visible in DaoFlow; publishing complete commit/check status back to every GitHub and GitLab workflow is still a production gap | More established source-control feedback workflows                                             |
| Web dashboard breadth        | Core server, project, service, deployment, backup, and capacity operations exist; breadth and polish still trail the reference products            | Clear current lead                                                                             |
| CLI and automation           | Stable JSON envelopes, explicit scopes, confirmation, dry-run, and audit records                                                                   | Dashboard and API are the primary paths                                                        |
| Templates and ecosystem      | Curated Compose-first catalog                                                                                                                      | Much broader template catalogs and community history                                           |

## What DaoFlow Is Copying Deliberately

- **Per-server concurrency, not one global build switch.** Dokploy documents independent queues and
  concurrency for each server, with a safe default of one build. DaoFlow follows that operational
  model and also places a separate bound on queued deployments.
- **Build work should be separable from runtime servers.** Coolify documents dedicated build servers.
  DaoFlow does not yet claim equivalent build-server UX, but the worker and server-capacity boundaries
  should preserve that direction.
- **Disk cleanup must be an operator workflow.** Coolify documents automated Docker cleanup. DaoFlow
  currently exposes cleanup preview and execution with durable operation history; scheduling and
  policy depth remain areas to expand.
- **Preview deployments are part of the source-control loop.** Dokploy documents GitHub pull-request
  previews, while Coolify documents GitHub App and GitLab integrations. DaoFlow supports GitHub pull
  requests and GitLab merge requests, with explicit approval and fork trust checks before deployment.

## Remaining Production Gaps

The highest-value gaps are not generic “feature parity” epics. They are concrete operator outcomes:

1. Publish clear queued, building, deployed, failed, and cancelled status back to GitHub commits and
   pull requests and to GitLab commits and merge requests.
2. Finish dedicated build-server placement and isolation so low-spec runtime servers can pull images
   without compiling application source.
3. Add policy-driven Docker image, build-cache, log, preview, and backup retention with conservative
   defaults and reclaim previews.
4. Continue closing dashboard gaps for deployment diagnosis, rollback, source configuration, and
   recovery without requiring CLI-only knowledge.
5. Expand real upgrade, failure, and low-resource testing before claiming broad production parity.

## Reference Documentation

- [Dokploy concurrent builds](https://docs.dokploy.com/docs/core/concurrent-builds)
- [Dokploy preview deployments](https://docs.dokploy.com/docs/core/applications/preview-deployments)
- [Dokploy GitLab integration](https://docs.dokploy.com/docs/core/gitlab)
- [Coolify build servers](https://coolify.io/docs/knowledge-base/server/build-server)
- [Coolify automated Docker cleanup](https://coolify.io/docs/knowledge-base/server/automated-cleanup)
- [Coolify GitHub App setup](https://coolify.io/docs/applications/ci-cd/github/setup-app)
- [Coolify GitLab integration](https://coolify.io/docs/applications/ci-cd/gitlab/integration)

Choose Coolify or Dokploy today when dashboard breadth, template breadth, and ecosystem maturity are
the deciding factors. Choose DaoFlow when its current deployment paths meet the workload and the
team values stricter permissions, durable audit evidence, and a first-class CLI enough to accept the
remaining breadth gaps.
