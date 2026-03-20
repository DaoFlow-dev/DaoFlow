---
sidebar_position: 5
---

# Command Endpoints

Command endpoints mutate infrastructure. The complete generated command surface, including the exact input JSON Schema for every mutation, lives in [`api-contract.json`](/contracts/api-contract.json).

## Scope-Gated Commands

| Required Scope(s)  | Procedures                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server:write`     | `registerServer`, `deleteServer`                                                                                                                                                                        |
| `deploy:start`     | `createProject`, `createEnvironment`, `createDeploymentRecord`, `queueComposeRelease`, `dispatchExecutionJob`, `completeExecutionJob`, `failExecutionJob`, `triggerDeploy`, `reconcileComposePreviews`  |
| `deploy:cancel`    | `cancelDeployment`                                                                                                                                                                                      |
| `deploy:rollback`  | `executeRollback`                                                                                                                                                                                       |
| `service:update`   | `updateProject`, `updateEnvironment`, `createService`, `updateService`, `updateServiceRuntimeConfig`, `addServiceDomain`, `removeServiceDomain`, `setPrimaryServiceDomain`, `updateServicePortMappings` |
| `env:write`        | `upsertEnvironmentVariable`, `deleteEnvironmentVariable`                                                                                                                                                |
| `approvals:create` | `requestApproval`                                                                                                                                                                                       |
| `approvals:decide` | `approveApprovalRequest`, `rejectApprovalRequest`                                                                                                                                                       |
| `tokens:manage`    | `generateAgentToken`, `revokeAgentToken`                                                                                                                                                                |
| `backup:run`       | `triggerBackupRun`, `createBackupDestination`, `updateBackupDestination`, `deleteBackupDestination`, `testBackupDestination`, `enableBackupSchedule`, `disableBackupSchedule`, `triggerBackupNow`       |
| `backup:restore`   | `queueBackupRestore`, `triggerTestRestore`                                                                                                                                                              |

## Authenticated Or Role-Gated Commands

These commands are exported in the API contract but are not currently tied to a narrower published scope:

- Authenticated command procedures: `createChannel`, `deleteChannel`, `updateChannel`, `toggleChannel`, `setUserPreference`, `setProjectOverride`
- Admin-role procedures: `createAgent`, `registerGitProvider`, `deleteGitProvider`, `createGitInstallation`, `exchangeGitLabCode`, `createSecretProvider`, `testSecretProvider`, `deleteSecretProvider`, `deleteProject`, `deleteEnvironment`, `deleteService`

## Common External Flows

The generated contract artifact includes machine-readable examples for:

- `triggerDeploy`
- `upsertEnvironmentVariable`
- `triggerBackupNow`
- `queueBackupRestore`
- `requestApproval`
- `approveApprovalRequest`
