# Lean Workflow Profile QA Evidence — 2026-07-18

This record captures one constrained-host acceptance run for the lean workflow profile. It is a
point-in-time result, not a universal minimum or a production capacity promise. The approved private
QA host address and all generated credentials are intentionally omitted.

## Tested artifacts

- Code revision: `a3422541dfe0f1907f75de913f13bd70a321aa8e`
- Runtime image: `ghcr.io/daoflow-dev/daoflow:qa-a342254-agent2`
- Runtime image ID: `sha256:f9d65d4a6895c812beed9359c21bdfdb8aa2ef54cc4a4e546733b70239f4861e`
- Runtime image size: `358866237` bytes
- Runtime build command: `docker build --target runtime`
- Linux x64 CLI SHA-256: `c11209f05801d9160097a31c974d34b1e6f76d286c27c5283f33ebd14ae93072`

## Host constraints

- 1 vCPU
- 1 GiB RAM
- Memory-plus-swap limit equal to 1 GiB, so no additional swap was available
- Fresh Docker-in-Docker environment with a new database and new named volumes

## Procedure

1. Ran the compiled CLI installer with `--workflow-profile lean --yes --json` while forcing the
   build-time embedded Compose file.
2. Confirmed Compose resolved exactly `postgres`, `redis`, and `daoflow`.
3. Removed only the disposable test instance and its fresh volumes, loaded the exact local runtime
   image, and started the stack from a clean database so the tested image performed first boot.
4. Confirmed startup readiness for migrations, initial owner, localhost server, and the legacy lean
   execution worker.
5. Logged in through the compiled CLI, listed projects, and confirmed the localhost server was ready
   and assigned to the initial owner's organization.
6. Created a project, environment, and image-backed Redis service, then deployed it through DaoFlow.
7. Confirmed the deployment reached `verified` / `Healthy` and the container was running.
8. Logged in through the web UI and confirmed the dashboard showed one ready server, one project, one
   deployment, one service, and the healthy Redis activity entry with no browser console errors.

## Observed results

| Check                                                     | Result                                        |
| --------------------------------------------------------- | --------------------------------------------- |
| Lean control-plane services                               | `daoflow`, `postgres`, `redis` only           |
| Temporal containers                                       | 0                                             |
| Temporal volumes                                          | 0                                             |
| Extra image deployment                                    | `redis:7-alpine`, verified healthy by DaoFlow |
| Aggregate constrained-host memory after deployment        | 777.0–777.2 MiB of 1 GiB (75.88–75.90%)       |
| Aggregate constrained-host CPU snapshots                  | 1.26–3.22%                                    |
| DaoFlow container memory snapshot                         | 254.1 MiB                                     |
| PostgreSQL container memory snapshot                      | 65.22 MiB                                     |
| Base Redis container memory snapshot                      | 9.848 MiB                                     |
| Deployed Redis container memory snapshot                  | 8.016 MiB                                     |
| OOM-killed containers                                     | 0                                             |
| Container restarts                                        | 0                                             |
| Browser console errors after authenticated dashboard load | 0                                             |

## Scope and limitations

- This proves the tested revision completed the specified lean install, login, registration, and
  image-deployment flow under one constrained run.
- It does not establish a universal minimum, sustained-load capacity, image-build capacity, backup
  capacity, or production sizing recommendation.
- The Temporal profile requires a separate measured run with exact Temporal worker readiness before
  any constrained-host claim is published for that profile.
