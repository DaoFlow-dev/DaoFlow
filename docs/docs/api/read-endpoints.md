---
sidebar_position: 3
---

# Read Endpoints

Read endpoints are safe to call and never mutate state. The complete generated read surface, with exact JSON Schema for each procedure input, lives in [`api-contract.json`](/contracts/api-contract.json).

## Public Read Procedures

These routes do not require authentication:

| Procedure          | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `health`           | Control-plane health probe with safe local scheduler state |
| `platformOverview` | Product thesis, architecture summary, and guardrails       |
| `roadmap`          | Small public roadmap summary, optionally filtered by lane  |

## Authenticated Read Procedures

These routes currently require authentication but do not advertise a narrower token scope at the procedure layer:

- Identity and governance: `viewer`, `agents`, `adminControlPlane`, `agentTokenInventory`, `principalInventory`
- Deploy and infra observation: `recentDeployments`, `deploymentDetails`, `executionQueue`, `infrastructureInventory`, `serverReadiness`, `deploymentInsights`, `deploymentRollbackPlans`, `deploymentLogs`, `operationsTimeline`, `approvalQueue`, `auditTrail`
- Project and service inventory: `projects`, `projectDetails`, `projectEnvironments`, `projectServices`, `services`, `serviceDetails`, `serviceDomainState`
- Git and secret-provider inventory: `gitProviders`, `gitInstallations`, `listSecretProviders`, `validateSecretRef`
- Backup inventory: `backupDestinations`, `backupDestination`, `backupMetrics`, `backupDiagnosis`
- Notification reads: `listPushSubscriptions`, `listChannels`, `getUserPreferences`, `getProjectOverrides`, `listDeliveryLogs`

Notable queryable observation inputs:

- `deploymentLogs` supports optional `deploymentId`, `service`, `query`, `stream`, and `limit` filters for targeted log retrieval.
- `operationsTimeline` supports optional `deploymentId` and `limit`.
- `serverReadiness` and `infrastructureInventory` now surface persisted `swarmTopology` snapshots for `docker-swarm-manager` targets when that metadata exists.

## Scoped Read Procedures

These routes require both authentication and the listed scope set:

| Procedure                      | Required Scope(s) | Notes                                                          |
| ------------------------------ | ----------------- | -------------------------------------------------------------- |
| `composePreviews`              | `deploy:read`     | Preview deployment inventory for one compose service           |
| `composePreviewReconciliation` | `deploy:read`     | Desired-vs-observed preview routing and stale preview analysis |
| `rollbackTargets`              | `deploy:read`     | Rollback candidates for one service                            |
| `backupOverview`               | `backup:read`     | Backup policy and recent run summary                           |
| `backupRestoreQueue`           | `backup:read`     | Restore queue inventory                                        |
| `persistentVolumes`            | `backup:read`     | Persistent volume inventory                                    |
| `backupRunDetails`             | `backup:read`     | One backup run with detailed metadata                          |
| `resolveEnvironmentSecrets`    | `secrets:read`    | Secret resolution inventory for one environment                |
| `listDestinationFiles`         | `backup:run`      | Remote file listing for one backup destination                 |
| `managedTunnels`               | `server:read`     | Managed tunnel inventory with observed routes                  |
| `managedTunnel`                | `server:read`     | One managed tunnel with observed routes                        |
| `logDrains`                    | `server:read`     | Configured external log drains                                 |
| `logDrainDeliveries`           | `server:read`     | Recent log drain delivery attempts                             |
| `accessLogs`                   | `logs:read`       | Redacted request, auth, webhook, and API token usage logs      |
| `serviceScheduleMonitorStatus` | `service:read`    | Active scheduler holder, generation, lease age, and expiry     |

### Access Logs

`accessLogs` exposes durable request records for operators who need to inspect API usage without shell access to container logs. Results are redacted and do not include request bodies, response bodies, authorization headers, or raw token values.

Supported filters include `status`, `method`, `path`, `actorType`, `tokenId`, `requestId`, `search`, `since`, `minDurationMs`, `limit`, and `cursor`. Status buckets include failed auth, denied scopes, API token usage, webhooks, slow requests, and server errors.

## Examples

The generated contract artifact also includes machine-readable examples for:

- `viewer` auth inspection
- deployment planning and deploy execution
- environment variable writes
- backup run and restore flows
- approval request and approval decision flows
