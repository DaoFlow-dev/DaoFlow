---
sidebar_position: 5
---

# Safety Model

DaoFlow's safety model ensures AI agents can be useful without being dangerous.

## Core Principles

| Principle                  | Implementation                                    |
| -------------------------- | ------------------------------------------------- |
| **Read-only by default**   | Agent role has no write scopes                    |
| **Explicit elevation**     | Write scopes must be explicitly granted per-token |
| **No self-elevation**      | Agents cannot modify their own permissions        |
| **Preview before execute** | `--dry-run` and planning APIs available           |
| **Confirmation required**  | `--yes` flag required for mutations               |
| **Full audit trail**       | Every action logged with agent identity           |
| **Structured denials**     | Permission errors include required scopes         |
| **Rate limiting**          | Token-level rate limits prevent runaway loops     |

## Defense Layers

```
Layer 1: Role-based access (agent role = read-only default)
Layer 2: Token scope restriction (intersection with role)
Layer 3: CLI guardrails (--yes required, --dry-run available)
Layer 4: API lane separation (read / planning / command)
Layer 5: Approval gates (human-in-the-loop for risky actions)
Layer 6: Audit trail (immutable log of all actions)
Layer 7: Rate limiting (prevent automation bugs)
```

## What Agents Cannot Do

By default, agents **cannot**:

- Deploy without explicit `deploy:start` scope
- Access unmasked secrets
- Modify their own permissions
- Open terminal sessions
- Override policy guardrails
- Delete servers, projects, or backups
- Approve their own requests

## Adversarial Input Protection

The CLI and API protect against malicious input:

- Shell metacharacters are rejected
- Path traversals are blocked
- Control characters are stripped
- Excessively long inputs are truncated with clear errors
- User input is never interpolated into shell commands
