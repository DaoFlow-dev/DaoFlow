---
sidebar_position: 4
---

# Multi-Factor Authentication

DaoFlow supports TOTP MFA for human operator accounts through Better Auth's two-factor plugin.

## What Is Protected

- Users can enroll, verify, disable, and rotate recovery codes from Settings → Security.
- Recovery codes are shown only when MFA is first enrolled or when codes are rotated.
- Team policy can require MFA for privileged roles or all human users.
- Privileged tRPC routes fail closed with `MFA_REQUIRED` when policy requires MFA and the session has not enrolled.
- API tokens and agent/service principals are not prompted for TOTP; their protection comes from scoped token policy and token usage logs.

## Policy Values

| Value        | Effect                                     |
| ------------ | ------------------------------------------ |
| `optional`   | MFA is available but not enforced          |
| `privileged` | Owners, admins, and operators must use MFA |
| `all`        | All non-agent human users must use MFA     |

## Audit Events

DaoFlow records audit entries for MFA enrollment starts, TOTP challenges, recovery-code use, recovery-code rotation, disable actions, and policy changes.

## CLI Login

```bash
daoflow login --url https://deploy.example.com \
  --email owner@example.com \
  --password "$DAOFLOW_PASSWORD" \
  --totp-code 123456
```

Recovery-code login uses `--recovery-code` instead of `--totp-code`.
