---
sidebar_position: 1
---

# Agent Integration

## The Core Idea

DaoFlow exists because we believe deployment should be as safe for AI agents as version control is for developers. An agent should be able to deploy, diagnose, and rollback — without being able to accidentally break production.

This isn't about "adding AI features" to a hosting platform. It's about building a hosting platform where AI agents are **first-class operators** with the same safety guarantees humans expect.

## Why This Matters

When an AI coding agent finishes building your feature, the current options are:

1. **Give it SSH access** → it can do anything, including `rm -rf /`
2. **Give it a cloud API** → it can spin up $10K in resources by accident
3. **Have a human deploy manually** → defeats the purpose of AI agents

DaoFlow is option 4: **give the agent scoped, auditable, reversible deployment access.**

## How It Works

```bash
# 1. Create an agent principal in DaoFlow settings
# 2. Generate a scoped API token
# 3. Configure your AI tool:

daoflow login --url https://deploy.example.com --token dfl_agent_token

# The agent can now safely:
daoflow status --json          # Read infrastructure state
daoflow deploy --dry-run       # Preview without executing  
daoflow deploy --yes --json    # Deploy with confirmation
daoflow rollback --dry-run     # Preview rollback
daoflow capabilities --json    # Check what it's allowed to do
```

## Agent Workflows

| Workflow | Commands | Risk Level |
|----------|----------|:----------:|
| **Observe** | `status`, `logs`, `doctor` | None |
| **Plan** | `plan`, `deploy --dry-run`, `rollback --dry-run` | None |
| **Deploy** | `deploy --yes` | Scoped |
| **Rollback** | `rollback --yes` | Scoped |
| **Configure** | `env push --yes` | Scoped |

Every command that mutates infrastructure requires both the `--yes` flag **and** the correct scope in the token. Without both, the command fails with a structured error telling the agent exactly what scope it needs.

## The Safety Contract

```
What agents CAN do (with correct scopes):
  ✓ Deploy services
  ✓ Rollback to previous deployments
  ✓ Read logs and diagnose failures
  ✓ Push environment variables
  ✓ View infrastructure state

What agents CANNOT do (ever):
  ✗ Elevate their own permissions
  ✗ Access unmasked secrets
  ✗ Open terminal sessions
  ✗ Override policy guardrails
  ✗ Approve their own requests
  ✗ Delete servers or projects
```

## Related

- [CLI for Agents](./cli-for-agents) — CLI best practices for AI agents
- [API for Agents](./api-for-agents) — Structured JSON output, error parsing
- [Safety Model](./safety-model) — Seven defense layers in detail
- [Approval Gates](./approval-gates) — Human-in-the-loop for high-risk actions
- [Getting Started](./getting-started) — Create your first agent principal
