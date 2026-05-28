# @daoflow/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
DaoFlow's agent-safe surface to AI agents over stdio. It is the native way for an
AI coding assistant (Claude Code, etc.) to **observe, plan, and deploy** through
DaoFlow without shelling out to the CLI.

It is a thin, decoupled client over the DaoFlow tRPC API — the control plane
remains the single source of truth for authentication, scopes, audit, and
approval gates.

## Design

Tools are organized into the same three lanes as the DaoFlow API:

- **read** — observe servers, projects, services, deployments, logs, events,
  audit trail, backups, drift, and config diffs. Marked `readOnlyHint`.
- **planning** — preview deploys, rollbacks, and restores **without executing**.
- **command** — mutating actions. Each requires an explicit `confirm: true`
  (mirroring the CLI's `--yes`) **and** the API token must hold the matching
  scope. The server enforces scopes independently, so an under-scoped token is
  rejected even when `confirm` is set. Marked `destructiveHint`.

This preserves DaoFlow's core principle: **read-heavy agent access before
write-heavy access**, with humans in control through scopes and approvals.

## Configuration

The server resolves credentials in this order:

1. `DAOFLOW_URL` and `DAOFLOW_TOKEN` environment variables (both required).
2. The current context in `~/.daoflow/config.json` (written by `daoflow login`).

Use a scoped **agent token** (read-only by default) so the agent can only do
what you have explicitly granted.

### Claude Code / Claude Desktop

```jsonc
{
  "mcpServers": {
    "daoflow": {
      "command": "bun",
      "args": ["run", "/path/to/daoflow/packages/mcp/src/index.ts"],
      "env": {
        "DAOFLOW_URL": "https://daoflow.example.com",
        "DAOFLOW_TOKEN": "dfl_your_scoped_agent_token"
      }
    }
  }
}
```

Or use a compiled binary built with `bun run build` (`dist/daoflow-mcp`).

## Tools

Read: `daoflow_whoami`, `daoflow_server_readiness`, `daoflow_projects`,
`daoflow_project_details`, `daoflow_services`, `daoflow_service_details`,
`daoflow_deployment_details`, `daoflow_deployment_logs`,
`daoflow_event_timeline`, `daoflow_audit_trail`, `daoflow_backup_overview`,
`daoflow_persistent_volumes`, `daoflow_rollback_targets`,
`daoflow_compose_drift`, `daoflow_config_diff`, `daoflow_approval_queue`.

Planning: `daoflow_deployment_plan`, `daoflow_rollback_plan`,
`daoflow_backup_restore_plan`.

Command (require `confirm: true`): `daoflow_trigger_deploy`,
`daoflow_execute_rollback`, `daoflow_cancel_deployment`,
`daoflow_trigger_backup`, `daoflow_queue_backup_restore`,
`daoflow_set_env_var`, `daoflow_approve_request`.

## Development

```bash
bun run dev        # run the server on stdio
bun run test       # unit tests
bun run typecheck  # type check
```
