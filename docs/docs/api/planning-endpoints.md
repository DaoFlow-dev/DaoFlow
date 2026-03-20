---
sidebar_position: 4
---

# Planning Endpoints

Planning endpoints generate previews without executing changes. The authoritative input schemas and example payloads live in [`api-contract.json`](/contracts/api-contract.json).

| Procedure               | Required Scope(s) | Purpose                                                                                   |
| ----------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `composeDeploymentPlan` | `deploy:read`     | Preview a direct Compose upload, including bundle metadata and env interpolation analysis |
| `deploymentPlan`        | `deploy:read`     | Preview a registered service deployment, including preview-target modeling                |
| `rollbackPlan`          | `deploy:read`     | Preview rollback steps and available rollback targets                                     |
| `configDiff`            | `deploy:read`     | Compare two deployment snapshots and summarize config differences                         |
| `deploymentDiff`        | `deploy:read`     | Compatibility alias for config comparison during CLI and agent transitions                |

## Notes

- `composeDeploymentPlan` is the planning-lane contract used by direct `daoflow deploy --compose ... --dry-run` and `daoflow plan --compose ...`.
- `deploymentPlan` models service-based deploys, preview deploys, and preview cleanup without executing them.
- `rollbackPlan` is the non-mutating companion to `executeRollback`.
- The generated contract artifact includes machine-readable example payloads for the planning lane, so external consumers do not need to reverse-engineer request shapes from source.
