---
sidebar_position: 2
---

# Roles

DaoFlow has 6 built-in roles, each with a predefined set of capabilities.

## Role Hierarchy

| Role        | Description                                     | Default For     |
| ----------- | ----------------------------------------------- | --------------- |
| `owner`     | Full access to everything                       | First user      |
| `admin`     | All operational permissions, no policy override | Promoted users  |
| `operator`  | Deploy, manage servers, run backups             | Operations team |
| `developer` | Deploy, view logs, manage env vars              | Dev team        |
| `viewer`    | Read-only access to all data                    | New users       |
| `agent`     | Read-only by default, scoped write via tokens   | AI agents       |

## Capabilities by Role

### owner

All 26 scopes — full system control including `policy:override` and `terminal:open`.

### admin

All scopes except `policy:override` and `terminal:open`.

### operator

`server:read`, `server:write`, `deploy:read`, `deploy:start`, `deploy:cancel`, `deploy:rollback`, `service:read`, `service:update`, `env:read`, `env:write`, `volumes:read`, `volumes:write`, `backup:read`, `backup:run`, `backup:restore`, `logs:read`, `events:read`, `diagnostics:read`

### developer

`server:read`, `deploy:read`, `deploy:start`, `service:read`, `env:read`, `env:write`, `logs:read`, `events:read`, `diagnostics:read`

### viewer

`server:read`, `deploy:read`, `service:read`, `env:read`, `logs:read`, `events:read`

### agent

`server:read`, `deploy:read`, `service:read`, `logs:read`, `events:read`, `diagnostics:read`

## Role Assignment

- The first user to sign up gets `owner`
- Subsequent users get `viewer` by default
- Owners and admins can change roles via Settings → Users
- Agent principals always start with the `agent` role
