---
sidebar_position: 1
---

# Security & RBAC

DaoFlow uses a layered security model with roles, scopes, and API tokens. This ensures AI agents and humans operate with appropriate permissions.

## Design Principles

- **Agent-first safety** — agents default to read-only until explicitly granted write scopes
- **Granular scopes** — 26 colon-delimited scopes covering every operation
- **Audit everything** — every mutation creates an immutable audit record
- **Least privilege** — tokens get only the scopes they need
- **Transparent denials** — permission errors tell you exactly which scope is required

## Security Layers

```
Principal (user/agent/service account)
  → Role (owner/admin/operator/developer/viewer/agent)
    → Capabilities (scopes granted by role)
      → API Token (optional scope restriction)
        → Effective Permissions (intersection of role + token scopes)
```

## Quick Reference

| Topic | Description |
|-------|-------------|
| [Roles](./roles) | 6 built-in roles with different capability levels |
| [Scopes](./scopes) | 26 colon-delimited permission scopes |
| [API Tokens](./api-tokens) | Creating and managing scoped tokens |
| [Agent Principals](./agent-principals) | Dedicated identities for AI systems |
| [Audit Trail](./audit-trail) | Immutable log of all write operations |
