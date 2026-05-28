# E2E Coverage and Real-Infra Validation

This reference records, honestly, how much of DaoFlow's deployment execution path
the automated test suite actually exercises — and what it does **not**. Green CI
should never be mistaken for proof that real deployments work.

## Current reality

There are two distinct E2E jobs in `.github/workflows/ci.yml`:

### 1. Main E2E suite — execution plane is MOCKED

- Runs with `DISABLE_WORKER=true` (see `packages/server/src/index.ts`,
  `shouldStartWorker()`).
- With the worker disabled, no SSH connection and no `docker`/`docker compose`
  process is ever spawned.
- Deployment specs (e.g. `e2e/deployments.spec.ts`) drive state transitions by
  calling `triggerDeploy` → `dispatchExecutionJob` → `completeExecutionJob`
  directly. The "healthy" assertion checks **database state**, not a real
  container.
- This suite validates the control plane: API contracts, RBAC, UI rendering,
  audit/event records, deployment bookkeeping. That is genuinely valuable — but it
  is white-box mocking of the execution plane.

### 2. `e2e-worker` job — execution plane is REAL, but narrow

- Runs with the worker enabled and `DAOFLOW_ENABLE_TEMPORAL=true`.
- `e2e/workflow-e2e.spec.ts` runs a real Temporal workflow that spawns the real
  `docker` CLI via `packages/server/src/worker/docker-executor.ts`.
- **Limitations:**
  - Targets `localhost` only — the **remote SSH path is never exercised in CI**.
    `packages/server/src/worker/ssh-connection.ts` (`execRemote`, real `ssh`
    spawn) has unit coverage with a mocked `execImpl`, but no end-to-end run
    against a real remote host.
  - Happy-path only — no failure injection (SSH auth failure, Docker daemon
    down, mid-deploy crash, network partition).
  - No backup→restore round-trip against real storage.
  - No rollback-to-prior-deployment against a real running stack.

## The honest gap

| Path                                                    | Covered in CI?                   |
| ------------------------------------------------------- | -------------------------------- |
| Control-plane logic, RBAC, audit, UI                    | Yes (main E2E)                   |
| Local Docker deploy happy path                          | Yes (`e2e-worker`)               |
| **Remote SSH deploy**                                   | **No**                           |
| **Deploy failure / rollback against real stack**        | **No**                           |
| **Backup + restore round-trip against real storage**    | **No**                           |
| **50-concurrent-deploy state-integrity (roadmap #173)** | **No (not against real Docker)** |

Charter §20 defines success as "the one a small team can trust to run production
workloads." None of the rows marked **No** above are currently proven.

## Injection seam (for building a real-infra harness)

The execution layer does **not** use a DI framework. Production code imports the
SSH/Docker modules directly; unit tests swap them with `vi.mock()` (which does not
work in Playwright). The local-vs-remote branch is:

- `packages/server/src/worker/execution-target.ts` — `resolveExecutionTarget()`
  returns `{ mode: "local" }` for localhost or `{ mode: "remote", ssh, ... }`.
- `packages/server/src/worker/compose-deploy-operations.ts` — switches between
  `dockerStackRemove` (local) and `remoteDockerStackRemove` (SSH) on `target.mode`.

To validate the remote path without a refactor, the cheapest approach is a real
SSH target rather than a code seam: bring up an SSH-reachable Docker host (a
sibling container running `sshd` + Docker, or a throwaway VPS) and register it as
a `remote` server.

## Proposed real-infra harness (opt-in, not in default CI gate)

A new Playwright project, **skipped unless `DAOFLOW_REAL_INFRA=1`**, that runs the
full lifecycle against a real remote-style target:

1. Provision an SSH-reachable Docker host (compose sidecar `sshd`+`dind`, or a
   tagged ephemeral VPS).
2. Register it as a `remote` server; assert SSH connectivity check passes.
3. Deploy a real compose stack; assert the container is actually running
   (`docker compose ps` over SSH), not just a DB row.
4. Inject a failure (bad image tag); assert structured failure analysis and that
   `daoflow diagnose` cites real log/event IDs.
5. Roll back to the prior deployment record; assert the previous container is
   restored.
6. Register a volume, run a backup to MinIO (S3-compatible), restore it, and
   verify data integrity.
7. Run the concurrency stress (roadmap #173) against real Docker.

This harness is intentionally **out of the required PR gate** (it needs real
infra and is slow). It should run nightly and pre-release. Until it exists and is
green, treat remote deploy, rollback, and backup/restore as **unverified against
real infrastructure**.
