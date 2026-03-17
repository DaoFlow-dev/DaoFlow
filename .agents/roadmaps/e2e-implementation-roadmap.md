# E2E Implementation Roadmap

This file holds the long-form milestone and task inventory for DaoFlow end-to-end coverage and product completion work.

Why this file exists:

- `AGENTS.md` should stay focused on durable operating rules, product constraints, and contribution policy.
- Long project tracking lists change often and create noisy diffs when they live in the main agent charter.
- Roadmaps belong under `.agents/roadmaps/` so agents can discover them without inflating the root operating contract.

Detailed tasks are grouped by milestone. Each task should be independently testable end-to-end.

## Milestone 1: Database Schema and Migrations

1. Drizzle schema defines all core domain tables (organization, member, principal, api_token, server, project, environment, service, deployment, deployment_step, volume, backup_policy, backup_run, event, audit_entry)
2. `bun run db:migrate` applies all migrations cleanly on a fresh Postgres 17
3. Seed script populates demo data for development and E2E testing
4. Schema supports JSON columns for flexible metadata (deployment input, resolved config)
5. All tables have `created_at` and `updated_at` timestamps with defaults
6. Foreign key constraints enforce referential integrity (cascade deletes where appropriate)
7. Indexes exist on frequently queried columns (deployment.status, event.timestamp, audit_entry.actor_id)
8. pgvector extension is enabled for future embedding features

## Milestone 2: Auth and Identity Foundation

9. First user sign-up gets `owner` role — verify via API and UI
10. Second user sign-up gets `viewer` role — verify restricted access
11. Owner can create API tokens with specific scopes — verify token works
12. Owner can create agent principal with read-only scopes
13. Agent token with `deploy:read` can list deployments but cannot start one
14. Token with expired TTL is rejected with structured error
15. `daoflow login` stores token in `~/.daoflow/config.json`
16. `daoflow whoami --json` returns principal, role, and scopes
17. `daoflow capabilities --json` lists all granted scopes
18. Password reset flow works via email link
19. Session expiry redirects to login page with return URL preserved

## Milestone 3: Server Management and SSH Execution

20. Register a server via UI — verify SSH connectivity check runs
21. Register a server via CLI — `daoflow server add --name vps1 --host 1.2.3.4 --yes`
22. `daoflow status --json` returns server health and Docker version
23. `daoflow doctor --json` runs full connectivity and Docker diagnostics
24. Server with failed SSH shows structured error in both UI and CLI
25. Agent token with `server:read` can view but not modify servers
26. SSH key pair generation and storage for server authentication
27. SSH connection pooling for multiple commands on same server
28. Remote command execution with timeout and output capture
29. Docker version detection on remote server via SSH
30. Docker Compose version detection on remote server via SSH
31. Server health check runs on configurable interval (default: 60s)
32. Server list shows last health check timestamp and latency

## Milestone 4: Project and Environment Management

33. Create project via UI with name, description, and git repo URL
34. Create project via API — verify tRPC mutation works
35. Projects belong to an organization — verify org scoping
36. Each project supports multiple environments (production, staging, dev)
37. Environment inherits project config but allows overrides
38. `daoflow projects --json` lists all projects with environment count
39. `daoflow projects create --name myapp --yes` creates a project
40. Delete project requires confirmation and cascades to environments
41. Project settings page shows git integration config

## Milestone 5: Docker Compose Deployment

42. Deploy from compose file via UI — verify deployment record created
43. `daoflow deploy --compose ./compose.yaml --server vps1 --dry-run` shows plan
44. `daoflow deploy --compose ./compose.yaml --server vps1 --yes` executes deployment
45. Deployment record includes: input, resolved config, actor, timestamps, outcome
46. `daoflow logs --deployment <id> --json` streams structured deployment logs
47. Failed deployment produces structured error with root cause and suggestion
48. `daoflow plan --compose ./compose.yaml --server vps1 --json` generates plan without executing
49. Compose file is stored as immutable artifact in deployment record
50. Resolved runtime spec (with env vars interpolated) is stored separately
51. Deployment steps are recorded individually: pull, build, create network, create volume, start container, health check
52. Each step has its own status, duration, and log output
53. Deploy from git repo + Dockerfile — clone, build, push, deploy
54. Deploy from Docker image reference — pull and deploy

## Milestone 6: Deployment Lifecycle

55. `daoflow services --json` lists all running services with status
56. `daoflow rollback --deployment <id> --dry-run` shows rollback plan
57. `daoflow rollback --deployment <id> --yes` executes rollback
58. Rollback creates its own deployment record with link to original
59. Deployment history is queryable: `daoflow deployments list --limit 10 --json`
60. Deploy with health check — verify health check outcome in deployment record
61. Deploy with failure — verify structured failure analysis available
62. Deployment can be cancelled mid-progress: `daoflow deploy cancel <id> --yes`
63. Cancelled deployment records partial progress and cleanup actions
64. Concurrent deploys to same service are blocked with queuing
65. Zero-downtime deployment via rolling update strategy

## Milestone 7: Environment Variables and Secrets

66. `daoflow env list --project myapp --json` shows keys with masked values
67. `daoflow env set KEY=value --project myapp --yes` creates env var
68. `daoflow env set SECRET=val --project myapp --secret --yes` creates masked secret
69. Agent with `env:read` sees keys and metadata but not secret values
70. Agent with `env:write` can create/update but not delete without explicit scope
71. Env var changes trigger audit record with before/after diff (values redacted)
72. Env vars can be scoped to environment (production vs staging)
73. Env var import from `.env` file: `daoflow env import --file .env --project myapp --yes`
74. Env var export: `daoflow env export --project myapp --json` (secrets redacted)
75. Build-time vs runtime env var distinction

## Milestone 8: Persistent Volumes and Backup

76. Named volume registration via UI and CLI
77. `daoflow volumes list --json` shows volumes with mount status
78. `daoflow volumes register --name pgdata --server vps1 --yes` registers volume
79. Create backup policy for a volume via UI
80. `daoflow backup list --json` shows policies and run history
81. `daoflow backup run --policy <id> --yes` triggers backup
82. Backup run record includes: start time, duration, size, storage location, outcome
83. `daoflow backup restore --run <id> --dry-run` shows restore plan
84. `daoflow backup restore --run <id> --yes` requires approval gate
85. Backup restore creates audit record and approval request
86. Failed backup produces structured error with next steps
87. S3-compatible storage configuration (endpoint, bucket, credentials)
88. Backup retention policies (keep last N, keep daily for N days)
89. Database logical dump backup for PostgreSQL/MySQL services
90. Volume archive snapshot via `docker cp` and tar
91. Backup verification — test restore to temporary container

## Milestone 9: Agentic Observability

92. `daoflow logs --service myapp --tail 100 --json` streams structured logs
93. `daoflow events --since 1h --json` returns normalized event timeline
94. `daoflow diagnose --deployment <id> --json` produces agent-ready failure summary
95. Diagnosis links to exact log lines and event IDs
96. `daoflow diff --deployment <id1> --deployment <id2> --json` compares two deployments
97. `daoflow drift --service myapp --json` shows config drift between desired and actual state
98. Log search with keyword filtering: `daoflow logs --service myapp --grep "error" --json`
99. Container resource usage: `daoflow stats --service myapp --json` (CPU, memory, network)
100.  Deployment timeline visualization in UI with step-by-step progress
101.  Real-time log streaming via SSE in both UI and CLI

## Milestone 10: Approval Gates and Audit

102. High-risk operations (restore, rollback, env secret write) require approval
103. `daoflow approvals list --json` shows pending approval requests
104. `daoflow approvals approve <id> --yes` approves a request (requires `approvals:decide`)
105. All mutations produce immutable audit records visible in UI and API
106. `daoflow audit --since 1h --json` returns audit trail
107. Audit records include: actor, action, resource, scope used, timestamp, outcome
108. Agent cannot approve its own approval requests
109. Approval expiry — unapproved requests expire after configurable TTL
110. Bulk audit export: `daoflow audit export --since 7d --format csv`

## Milestone 11: Temporal Workflow Integration

111. Temporal server runs alongside DaoFlow control plane (docker-compose service)
112. Deployment workflow defined as Temporal workflow with retries and timeouts
113. Backup workflow defined as Temporal workflow with scheduling
114. Long-running deploys survive control plane restart (Temporal durability)
115. Temporal Web UI accessible for workflow inspection and debugging
116. Failed activities retry with exponential backoff (configurable)
117. Workflow cancellation propagates to running activities
118. Scheduled backup policies create Temporal cron workflows
119. Deployment logging integrates with Temporal activity heartbeats
120. Health check workflow runs post-deploy with configurable timeout

## Milestone 12: Notifications and Webhooks

121. Notification channels: email, Slack webhook, Discord webhook, generic HTTP
122. Configure notification preferences per project/environment
123. Deploy success/failure triggers notification
124. Backup failure triggers notification
125. Approval request triggers notification to approvers
126. `daoflow notifications list --json` shows configured channels
127. `daoflow notifications test --channel <id>` sends test notification
128. Webhook payloads include structured JSON with event type, resource, actor, outcome

## Milestone 13: UI Feature Parity

129. Dashboard shows real-time stats (servers, projects, deployments) from API
130. Projects page shows project cards with services and status badges
131. Servers page shows connectivity status, Docker version, and resource usage
132. Deployments page shows full history with status, actor, duration, and step progress
133. Backups page shows policies, runs, and restore status
134. Settings page has functional tabs: General, Users, Tokens, Security, Notifications, Volumes
135. Login page with session management and redirect flow
136. Sidebar navigation works for all pages
137. Server registration form with SSH key upload
138. Deployment composer form (select project, environment, server, compose file)
139. Env var editor with add/edit/delete and secret masking
140. Token management table with scope selector and expiry
141. Audit trail table with filtering by actor, action, and resource
142. Approval queue with approve/reject buttons
143. Real-time deployment progress bar with step status indicators
144. Dark mode toggle (light mode default)
145. Mobile-responsive layout for all pages
146. Toast notifications for success/error feedback

## Milestone 14: CLI Hardening

147. Every CLI command supports `--json` flag — verify structured output shape
148. Every mutating command supports `--dry-run` — verify preview output
149. Every destructive command requires `--yes` — verify prompt without it
150. Permission denied returns exit code 2 with `requiredScope` in JSON
151. Dry-run returns exit code 3
152. `--quiet` / `-q` flag outputs bare values (deployment ID only, URL only)
153. `--timeout` flag configures API request timeout (default: 30s)
154. `--idempotency-key` flag prevents duplicate operations
155. Input validation rejects shell metacharacters in all string arguments
156. CLI binary builds for linux-x64, linux-arm64, darwin-x64, darwin-arm64
157. CLI self-update command: `daoflow update`
158. CLI version check: `daoflow --version` matches package.json
159. CLI config file validation on startup
160. CLI error messages include documentation links

## Milestone 15: CI/CD, Testing, and Documentation

161. E2E tests cover auth flow (sign-up, sign-in, sign-out, redirect)
162. E2E tests cover page navigation (all sidebar links)
163. E2E tests cover server management (register, view, connectivity)
164. E2E tests cover deployment lifecycle (create, dispatch, health check, rollback)
165. E2E tests cover backup workflows (create policy, run, restore)
166. E2E tests cover env var management (list, set, mask secrets)
167. E2E tests cover approval workflows (request, approve, reject)
168. E2E tests cover CLI commands (login, status, deploy, logs, env, backup)
169. CI pipeline runs typecheck, lint, format, and E2E on every push
170. CLI binary builds verified in CI for all target platforms
171. API integration tests cover all tRPC procedures
172. Permission tests verify every scope/role combination
173. Load test: 50 concurrent deployments do not corrupt state
174. README.md documents quickstart, architecture, and CLI usage
175. Contributing guide documents dev setup, testing, and PR process
176. CLI `--help` output documents required scopes for every command
177. OpenAPI-compatible schema generated from tRPC for external documentation
