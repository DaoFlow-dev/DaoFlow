# Agent Development Task Runner Design

Issue: [#185](https://github.com/DaoFlow-dev/DaoFlow/issues/185)

## Goal

Build a DaoFlow-managed development task runner that can pick up GitHub issues
or GitLab issues, run Codex CLI in an isolated development sandbox, open a pull
request or merge request, deploy a preview URL, and hand the result back to a
human for review and merge.

The target product loop is:

1. A GitHub or GitLab issue is assigned to DaoFlow through the installed app,
   a label, or an issue command.
2. DaoFlow records the request, queues it, and replies on the issue when it is
   accepted.
3. When a runner starts work, DaoFlow replies again with the run status.
4. Codex CLI develops the change in a sandboxed checkout.
5. DaoFlow opens a pull request or merge request, deploys a preview URL, and
   replies on the issue with the review link and preview link.
6. A human reviews, requests changes, approves, and merges.

## Existing DaoFlow Pieces To Reuse

- Agent principals, API tokens, scope presets, and audit trails.
- GitHub/GitLab provider records, installation records, project repository
  links, webhook signature verification, and webhook delivery dedupe.
- Approval requests for gated actions.
- Worker and Temporal execution boundaries for long-running work.
- Project preview deployment support for pull request and merge request events.

Do not create a separate identity system or a general-purpose shell gateway.
The task runner should be another agent-safe workflow inside DaoFlow's existing
control plane and execution plane.

## Reference Project Takeaways

### Wanman

Useful patterns:

- Supervisor-owned state instead of agents inventing workflow state ad hoc.
- Explicit task, message, artifact, and change-capsule concepts.
- Per-agent worktrees and per-agent home directories.
- Codex/Claude runtime adapters behind one process contract.
- Interrupt or steer messages for human correction.

Avoid copying:

- Prompt-only GitHub behavior. DaoFlow should use typed GitHub/GitLab API
  operations, durable state, audit logs, and idempotent issue comments.
- Local worktree isolation as the only boundary. It is useful, but not enough
  for a hosted development runner.

### Sandbank

Useful patterns:

- Use Sandbank's provider interface as the preferred sandbox abstraction for
  DaoFlow's development runner so the worker talks to one create/get/list/destroy
  and sandbox exec/files/archive shape.
- Provider capability checks instead of assuming every sandbox supports every
  operation.
- Core sandbox operations: create, destroy, exec, stream logs, read/write files,
  upload/download archives.
- Non-root sandbox user setup and operation observation hooks.
- Optional capabilities: port exposure, snapshots, terminal sessions, sleep.
- `@sandbank.dev/boxlite` as the preferred later adapter for stronger
  self-hosted isolation through BoxLite remote or local mode.

Avoid copying:

- A broad multi-cloud sandbox abstraction as the first DaoFlow surface.
  DaoFlow should stay Docker-first and Compose-first. The MVP operational
  default is still host-managed Docker on a selected registered DaoFlow host
  server.

## User-Facing Workflow

### Intake

Supported triggers:

- GitHub issue label, for example `daoflow:run`.
- GitHub issue comment, for example `/daoflow run`.
- GitLab issue label.
- GitLab issue note command.
- Manual start from the DaoFlow UI.

DaoFlow should ignore unsupported events but persist enough metadata to explain
why they were ignored when debugging.

### Queue Acknowledgement

After accepting a task, DaoFlow posts one durable issue comment:

```md
DaoFlow accepted this task.

Status: queued
Run: <DaoFlow run URL>
Project: <project>
```

That same comment should be updated through the run instead of posting noisy
new comments for every state change.

### Start Work

When a worker claims the task:

```md
DaoFlow started work.

Status: running
Runner: <runner label>
Started: <timestamp>
Run: <DaoFlow run URL>
```

The issue or merge request must make it clear that work has been picked up, so
humans do not duplicate effort.

### Development

The worker:

- Creates an isolated sandbox.
- Checks out the repository using a short-lived GitHub App installation token
  or GitLab project access token.
- Creates a branch named `daoflow/issue-<number>-<short-run-id>`.
- Writes a run-specific Codex config and credential home.
- Runs Codex CLI with a bounded prompt, budget, timeout, and command policy.
- Streams logs and structured events back to DaoFlow.
- Runs the configured validation commands.
- Produces a change summary and artifact bundle.

### PR/MR And Preview

If the sandbox produces a valid diff:

- Push the branch.
- Open a pull request or merge request.
- Link it back to the issue.
- Trigger an existing DaoFlow preview deployment for the PR/MR branch.
- Wait for the preview URL or record that preview failed.
- Update the issue comment with PR/MR link, preview URL, validation result, and
  next human action.

If no valid diff is produced, update the issue with the failure reason and the
DaoFlow run link.

### Human Review And Merge

DaoFlow should not auto-merge in MVP. Human reviewers remain responsible for:

- Reviewing the PR/MR.
- Asking for changes.
- Re-running the task if needed.
- Merging.

Later, auto-merge can be a separate approval-gated feature.

## Data Model

Add a first-class task runner model rather than overloading deployments.

### `development_tasks`

One row per accepted issue-driven task.

- `id`
- `provider_type`: `github` or `gitlab`
- `provider_installation_id`
- `project_id`
- `repo_full_name`
- `external_issue_id`
- `issue_number`
- `issue_url`
- `issue_title`
- `issue_author`
- `base_branch`
- `status`: `queued`, `running`, `waiting_review`, `blocked`, `failed`,
  `canceled`, `completed`
- `priority`
- `requested_by_external_user`
- `requested_by_principal_id`
- `current_run_id`
- `created_at`
- `updated_at`

Uniqueness:

- `(provider_type, repo_full_name, external_issue_id)` should be unique for the
  active task unless a human explicitly requests a new run.

### `development_task_runs`

One row per attempt.

- `id`
- `task_id`
- `status`: `queued`, `claimed`, `preparing`, `coding`, `validating`,
  `opening_pr`, `deploying_preview`, `waiting_review`, `failed`, `canceled`,
  `completed`
- `runner_id`
- `sandbox_provider`: initially `host_docker`, later `sandbank_boxlite`
- `sandbox_id`
- `codex_profile`
- `model`
- `reasoning_effort`
- `branch_name`
- `commit_sha`
- `pull_request_number`
- `pull_request_url`
- `preview_deployment_id`
- `preview_url`
- `failure_category`
- `failure_message`
- `started_at`
- `finished_at`

### `development_task_events`

Append-only activity timeline.

- `id`
- `task_id`
- `run_id`
- `kind`: `queued`, `comment.posted`, `sandbox.created`, `codex.event`,
  `validation.started`, `validation.failed`, `pr.opened`, `preview.ready`
- `summary`
- `detail`
- `metadata`
- `created_at`

### `development_task_comments`

Idempotency record for issue comments and PR comments.

- `id`
- `task_id`
- `run_id`
- `provider_type`
- `external_comment_id`
- `comment_kind`: `status`, `failure`, `review`
- `last_body_hash`
- `created_at`
- `updated_at`

### `sandbox_runner_profiles`

Operator-defined runner profiles.

- `id`
- `name`
- `provider`: `host_docker`, `sandbank_boxlite`
- `image`
- `cpu_limit`
- `memory_limit_mb`
- `disk_limit_mb`
- `network_policy`
- `allowed_commands`
- `validation_commands`
- `timeout_minutes`
- `codex_auth_mode`: `api_key`, `chatgpt_auth_json`, `custom_provider_env`
- `codex_config_template`
- `status`

## Control Plane API

Read lane:

- List development tasks.
- Read a task timeline.
- Read a run log.
- Read PR/MR and preview links.
- Read sandbox capability status.

Planning lane:

- Queue a task from an issue.
- Re-run a failed task.
- Request human approval for risky runner profile changes.

Command lane:

- Cancel a run.
- Retry a run.
- Approve a blocked action.
- Archive/delete old sandbox artifacts.

All write paths must create audit entries. Permission denied responses should
name the exact scope needed.

## GitHub/GitLab App Behavior

### GitHub

Required app permissions:

- Issues: read/write.
- Pull requests: read/write.
- Contents: read/write.
- Metadata: read.
- Checks or commit statuses: read/write if DaoFlow reports validation status.

Webhook events:

- `issues`
- `issue_comment`
- `pull_request`
- Existing `push` and `pull_request` preview events remain supported.

GitHub operations:

- Read issue body and comments.
- Post or update the durable DaoFlow status comment.
- Create a branch.
- Push commits.
- Open a PR.
- Add labels or status checks.
- Link PR to issue with `Closes #<number>` only when the task should close the
  issue after merge.

### GitLab

Required app or token permissions:

- Issues read/write.
- Merge requests read/write.
- Repository read/write.
- Pipeline/status permissions when reporting validation.

Webhook events:

- Issue events.
- Note events.
- Merge request events.
- Existing push and merge request preview events remain supported.

## Worker And Sandbox Architecture

Add a development runner worker under the existing worker boundary:

```text
GitHub/GitLab webhook
  -> DaoFlow control plane
  -> development_tasks row
  -> durable issue comment
  -> development runner queue
  -> sandbox provider
  -> Codex CLI
  -> branch + PR/MR
  -> preview deployment
  -> issue comment update
```

MVP sandbox provider:

- `host_docker`: self-hosted Docker container managed on a selected registered
  DaoFlow host server.
- Local Docker is only the single-machine development/default install case.
- The selected host server owns sandbox lifecycle, workspace volumes, resource
  limits, and cleanup; the web/API process only queues and observes work.
- Non-root user inside the container.
- No host Docker socket by default.
- Scratch volume per run.
- Read/write access only to the checkout and runner home.
- Egress allowed by default in MVP, with later allowlist support.
- CPU, memory, disk, and timeout limits.
- Logs streamed back to `development_task_events`.

Preferred abstraction:

- Implement DaoFlow's runner boundary around the Sandbank provider contract:
  create/get/list/destroy, exec, files, archive upload/download, capabilities,
  non-root user creation, and observer events.
- Keep DaoFlow's first adapter narrow: `host_docker` maps that contract onto a
  registered DaoFlow host server and local Docker for development.
- Do not expose arbitrary Sandbank cloud providers in MVP.

Later provider:

- `sandbank_boxlite`: use `@sandbank.dev/boxlite` running against a BoxRun REST
  API on the selected host server, or local mode only for trusted development
  machines.
- Use it for stronger self-hosted sandbox lifecycle, snapshots, sleep, port
  exposure, terminal sessions, and streaming.

Sandbox capabilities should be explicit:

- `exec`
- `exec.stream`
- `files.read`
- `files.write`
- `archive.upload`
- `archive.download`
- `snapshot`
- `port.expose`
- `terminal`

DaoFlow should check capabilities before enabling UI actions or workflow steps.

## Codex CLI Runtime

Each run gets an isolated `CODEX_HOME`, for example:

```text
/runner/work/<run-id>/
  repo/
  home/
    .codex/
      config.toml
      auth.json    # only when using managed ChatGPT auth
  artifacts/
  logs/
```

The generated `config.toml` should use a named profile:

```toml
model = "gpt-5.4"
approval_policy = "never"
sandbox_mode = "workspace-write"
default_permissions = ":workspace"
cli_auth_credentials_store = "file"

[profiles.daoflow-run]
model = "gpt-5.4"
model_reasoning_effort = "high"
approval_policy = "never"
sandbox_mode = "workspace-write"

[shell_environment_policy]
include_only = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "DAOFLOW_URL",
  "DAOFLOW_TOKEN",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN"
]
```

For custom providers:

```toml
model_provider = "internal-proxy"

[model_providers.internal-proxy]
base_url = "https://llm-proxy.example.com/v1"
env_key = "INTERNAL_LLM_API_KEY"
```

Supported auth modes:

- `api_key`: recommended for automation. Inject `OPENAI_API_KEY` as a secret
  environment variable.
- `chatgpt_auth_json`: allowed only on trusted private runners. Store the
  refreshed `auth.json` in DaoFlow secret storage or a dedicated runner secret
  store. Do not run concurrent jobs against the same auth file.
- `custom_provider_env`: use a configured model provider and inject the
  provider-specific env var.

Codex command shape:

```bash
CODEX_HOME=/runner/work/<run-id>/home/.codex \
codex exec \
  --json \
  --profile daoflow-run \
  --cd /runner/work/<run-id>/repo \
  "<bounded task prompt>"
```

Avoid `--dangerously-bypass-approvals-and-sandbox` as the default. If a runner
profile allows it, the surrounding host Docker or Sandbank/BoxLite sandbox must
still provide the hard isolation boundary, and the profile must be admin-only.

## Prompt Contract

The task prompt should be generated by DaoFlow, not copied directly from the
issue. Include:

- Issue title, body, and selected comments.
- Repository and base branch.
- Project-specific instructions.
- Validation commands.
- Required output contract.
- Safety rules: do not expose secrets, do not force-push default branch, do not
  merge, do not deploy production.

Expected Codex output:

- Summary.
- Files changed.
- Validation commands run.
- Validation result.
- Known risks.
- PR body draft.

The worker should verify the actual git diff and validation result rather than
trusting the text summary.

## Preview Deployment

Use existing DaoFlow preview deployment concepts when possible:

- A PR/MR opened by the runner should trigger preview deploy through existing
  pull request / merge request webhook handling.
- If webhook timing is unreliable, the development runner can explicitly call a
  preview deploy service after opening the PR/MR.
- The preview URL should be written to the task run and issue comment.

Preview failure should not hide the PR. The issue comment should say:

- PR/MR is ready.
- Preview failed or is still pending.
- Link to DaoFlow run logs.

## UI Surfaces

Add a Development Tasks page:

- Queue status.
- Running tasks.
- Failed tasks.
- Waiting review tasks.
- PR/MR link.
- Preview URL.
- Last event.
- Cancel/retry actions based on permissions.

Add a task detail page:

- Issue summary.
- Timeline.
- Codex logs.
- Validation output.
- Diff summary.
- PR/MR and preview links.
- Sandbox metadata.

Extend Git provider settings:

- Enable issue task runner per project.
- Choose trigger mode: label, command, manual, or disabled.
- Choose runner profile.
- Choose validation commands.
- Choose Codex auth profile.

## Safety Rules

- Do not expose arbitrary shell access from GitHub/GitLab comments.
- Do not pass raw issue comments as shell commands.
- Do not allow agents to create or edit their own permission scopes.
- Do not give sandbox containers the host Docker socket by default.
- Do not mount production secrets unless the task explicitly needs them and a
  human approves.
- Do not auto-merge in MVP.
- Do not re-use a dirty sandbox after a failed run unless it is explicitly kept
  for debugging.
- Keep every GitHub/GitLab write idempotent.

## Rollout Plan

### Phase 1: Design And State Foundation

- Add database tables for tasks, runs, events, comments, and runner profiles.
- Add read APIs and seed one disabled default runner profile.
- Add audit entries for task creation, run claim, cancel, retry, PR creation,
  and preview result.

### Phase 2: GitHub MVP

- Accept GitHub issue label and `/daoflow run` comments.
- Queue a task and update one durable issue comment.
- Add a worker that claims tasks and transitions status without running Codex.
- Add UI list/detail pages.

### Phase 3: Host Docker Codex Runner

- Implement Docker sandbox creation and cleanup, defaulting to a selected
  registered DaoFlow host server.
- Shape the implementation around the Sandbank provider contract, but keep the
  shipped provider `host_docker`.
- Clone repo using GitHub App installation token.
- Generate isolated `CODEX_HOME` and `config.toml`.
- Run Codex CLI with streaming logs.
- Run validation commands.
- Persist artifacts and diff summary.

### Phase 4: PR And Preview

- Push branch.
- Open PR.
- Trigger or observe preview deployment.
- Update issue comment with PR and preview URL.
- Mark task `waiting_review`.

### Phase 5: GitLab

- Add GitLab issue and note triggers.
- Add merge request creation.
- Add GitLab preview URL reporting.

### Phase 6: Stronger Sandboxes

- Add `sandbank_boxlite` using `@sandbank.dev/boxlite` against a BoxRun REST API
  on a registered DaoFlow host server by default.
- Add optional snapshots, port exposure, terminal sessions, and sleep.
- Add explicit capability checks in UI and worker.

## Validation Strategy

Unit tests:

- Trigger parsing.
- Idempotent task creation.
- Issue comment body rendering and update behavior.
- Status transitions.
- Runner profile validation.
- Codex config generation.

Integration tests:

- GitHub webhook fixture creates a queued task.
- Duplicate webhook does not duplicate the task.
- Worker claims exactly one task.
- Failed sandbox updates task and issue comment.
- Successful fake runner opens a fake PR and records preview URL.

Manual end-to-end test:

1. Install DaoFlow GitHub App on a test repository.
2. Create an issue.
3. Add the trigger label or comment `/daoflow run`.
4. Confirm DaoFlow replies with queued status.
5. Confirm worker starts and updates status.
6. Confirm PR opens.
7. Confirm preview URL is posted.
8. Confirm human can merge manually.

## Open Questions

- Should MVP require explicit `/daoflow run`, or is label-based intake enough?
- Should DaoFlow create one runner agent principal per project, per repository,
  or per run?
- Which preview deploy behavior should be canonical: webhook-triggered or
  runner-triggered?
- How long should failed sandboxes be retained for debugging?
- Should GitHub issue comments support steering a running Codex task in MVP, or
  should steering wait until the base loop is stable?
