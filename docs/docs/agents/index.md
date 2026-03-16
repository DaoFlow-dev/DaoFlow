---
sidebar_position: 1
---

# Agent Integration

DaoFlow is designed from day one for AI coding agents. This section covers how to configure agents, use safe APIs, and set up approval gates.

## Why Agent-First?

Most deployment tools treat AI as an afterthought. DaoFlow builds agent safety into the core:

- **Structured JSON output** on every CLI command
- **Three-lane API** (read → planning → command) so agents can observe without accidentally mutating
- **Scoped permissions** prevent agents from exceeding their authority
- **Dry-run previews** let agents see what would happen before committing
- **Audit trails** track every agent action for human review

## Getting Started

1. [Create an agent principal](/docs/security/agent-principals) in DaoFlow
2. Generate an API token with appropriate scopes
3. Configure your AI tool to use the DaoFlow CLI or API

```bash
# Configure CLI for agent
daoflow login --url https://deploy.example.com --token dfl_agent_token

# Verify identity
daoflow whoami --json

# Check permissions
daoflow capabilities --json
```

## Agent Workflows

| Workflow     | Steps                                                         |
| ------------ | ------------------------------------------------------------- |
| **Deploy**   | `capabilities` → `plan` → `deploy --dry-run` → `deploy --yes` |
| **Diagnose** | `status` → `logs` → `doctor`                                  |
| **Rollback** | `status` → `rollback --dry-run` → `rollback --yes`            |
| **Monitor**  | `status` → `logs --follow`                                    |

## Related

- [CLI for Agents](./cli-for-agents) — CLI best practices for AI agents
- [API for Agents](./api-for-agents) — API best practices
- [Safety Model](./safety-model) — how DaoFlow keeps agents safe
- [Approval Gates](./approval-gates) — human-in-the-loop for risky actions
