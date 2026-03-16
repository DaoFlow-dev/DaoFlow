---
sidebar_position: 3
---

# Scopes

DaoFlow uses 26 colon-delimited scopes to control access to every operation.

## Scope Format

Scopes follow the pattern `resource:action`:

- `server:read` — read server data
- `deploy:start` — start a deployment
- `backup:restore` — restore from backup

## Complete Scope Reference

### Infrastructure

| Scope          | Description                            |
| -------------- | -------------------------------------- |
| `server:read`  | List servers, view connectivity status |
| `server:write` | Register, update, or remove servers    |

### Deployment

| Scope             | Description                                |
| ----------------- | ------------------------------------------ |
| `deploy:read`     | View deployment history, steps, and status |
| `deploy:start`    | Queue a new deployment                     |
| `deploy:cancel`   | Cancel an in-progress deployment           |
| `deploy:rollback` | Roll back to a previous deployment         |
| `service:read`    | List services, view service config         |
| `service:update`  | Update service configuration               |

### Data and Secrets

| Scope            | Description                                     |
| ---------------- | ----------------------------------------------- |
| `env:read`       | List environment variable keys (values masked)  |
| `env:write`      | Create, update, or delete environment variables |
| `secrets:read`   | Read unmasked secret values (highly restricted) |
| `secrets:write`  | Create or rotate secrets                        |
| `volumes:read`   | List persistent volumes and mount status        |
| `volumes:write`  | Register or remove volumes                      |
| `backup:read`    | View backup policies and run history            |
| `backup:run`     | Trigger a backup                                |
| `backup:restore` | Restore from a backup artifact                  |

### Observability

| Scope              | Description                                     |
| ------------------ | ----------------------------------------------- |
| `logs:read`        | Stream and search deployment and container logs |
| `events:read`      | View structured event timeline                  |
| `diagnostics:read` | View agent-generated failure analysis           |

### Administration

| Scope              | Description                                        |
| ------------------ | -------------------------------------------------- |
| `members:manage`   | Invite, remove, and change roles                   |
| `tokens:manage`    | Create and revoke API tokens                       |
| `approvals:create` | Request approval for a gated action                |
| `approvals:decide` | Approve or reject pending approval requests        |
| `terminal:open`    | Open an interactive terminal session (exceptional) |
| `policy:override`  | Override policy-enforced guardrails                |

## Scope Enforcement

Scopes are checked at two levels:

1. **Role capabilities** — what the principal's role allows
2. **Token scopes** — what the API token explicitly grants

The effective permissions are the **intersection** of role capabilities and token scopes. A token can never exceed the capabilities of its principal's role.
