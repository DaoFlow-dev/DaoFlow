# DaoFlow Production Readiness

> Generated from `.agents/references/production-readiness.yml`. Check it with `bun run readiness:check`.

## Current status

DaoFlow is not yet verified for unqualified production-readiness claims. The unverified items below remain goals or current limitations until their required evidence is current and passing.

## Evidence freshness limits

| Evidence area       | Maximum age |
| ------------------- | ----------- |
| real infrastructure | 14 days     |
| restore             | 14 days     |
| audit               | 30 days     |
| agent safety        | 30 days     |
| contract            | 30 days     |
| source availability | 365 days    |

## Verified repository facts

### Agent-facing CLI contract

**Verified in this repository:** The CLI publishes structured JSON contracts, scoped permission metadata, and dry-run behavior in the generated [CLI contract](./docs/static/contracts/cli-contract.json).

- Required fresh evidence: contract (30 days)
- Repository citation: `docs/static/contracts/cli-contract.json`
- Executed evidence: `cli-contract` checks `docs/static/contracts/cli-contract.json` for the current checkout (freshness limit: 30 days)

### Read, planning, and command API lanes

**Verified in this repository:** The API separates read, planning, and command procedures under the documented [command audit contract](./.agents/references/command-audit-contract.md).

- Required fresh evidence: contract (30 days)
- Repository citation: `.agents/references/command-audit-contract.md`
- Executed evidence: `api-lanes` checks `scripts/readiness/api-lanes.test.mjs` for the current checkout (freshness limit: 30 days)

### Source-control webhook delivery recovery

**Verified in this repository:** GitHub and GitLab push deliveries are authenticated before entering a payload-bound recovery ledger. Expiring attempt leases and per-target outcomes allow only failed or interrupted targets to retry, while unique delivery-target keys prevent duplicate deployment records. Operators can inspect recent delivery outcomes without raw webhook bodies, signatures, or provider tokens. See the [webhook recovery tests](https://github.com/DaoFlow-dev/DaoFlow/blob/main/packages/server/src/db/services/webhook-delivery-recovery.test.ts).

- Required fresh evidence: contract (30 days)
- Repository citation: `packages/server/src/db/services/webhook-delivery-recovery.test.ts`
- Executed evidence: `webhook-recovery` checks `packages/server/src/db/services/webhook-delivery-recovery.test.ts` for the current checkout (freshness limit: 30 days)

### Open-source license availability

**Verified in this repository:** DaoFlow is published under the [Apache License 2.0](https://github.com/DaoFlow-dev/DaoFlow/blob/main/LICENSE), and the repository source is available for inspection.

- Required fresh evidence: source availability (365 days)
- Repository citation: `LICENSE`
- Executed evidence: `license-source` checks `scripts/readiness/license-evidence.test.mjs` for the current checkout (freshness limit: 365 days)

## Goals and current limitations

### Production deployment readiness

**Goal:** DaoFlow aims to make self-hosted Docker Compose deployments dependable enough for a small team to operate without a dedicated platform team.

- Required fresh evidence: real infrastructure (14 days)
- Unverified dependencies: [#207](https://github.com/DaoFlow-dev/DaoFlow/issues/207), [#208](https://github.com/DaoFlow-dev/DaoFlow/issues/208), [#209](https://github.com/DaoFlow-dev/DaoFlow/issues/209), [#217](https://github.com/DaoFlow-dev/DaoFlow/issues/217), [#234](https://github.com/DaoFlow-dev/DaoFlow/issues/234), [#236](https://github.com/DaoFlow-dev/DaoFlow/issues/236), [#242](https://github.com/DaoFlow-dev/DaoFlow/issues/242)

### Compose lifecycle evidence

**Current limitation:** Compose deployment records and recovery behavior are not yet independently verified across a real remote deployment, failure, and rollback lifecycle.

- Required fresh evidence: real infrastructure (14 days)
- Unverified dependencies: [#207](https://github.com/DaoFlow-dev/DaoFlow/issues/207), [#209](https://github.com/DaoFlow-dev/DaoFlow/issues/209), [#233](https://github.com/DaoFlow-dev/DaoFlow/issues/233), [#238](https://github.com/DaoFlow-dev/DaoFlow/issues/238)

### Agent-safety controls

**Current limitation:** Agent permissions and destructive-action controls are under active verification and are not yet an unconditional production-safety guarantee.

- Required fresh evidence: agent safety (30 days)
- Unverified dependencies: [#202](https://github.com/DaoFlow-dev/DaoFlow/issues/202), [#208](https://github.com/DaoFlow-dev/DaoFlow/issues/208), [#236](https://github.com/DaoFlow-dev/DaoFlow/issues/236), [#241](https://github.com/DaoFlow-dev/DaoFlow/issues/241), [#242](https://github.com/DaoFlow-dev/DaoFlow/issues/242)

### Command audit completeness

**Current limitation:** DaoFlow has not yet proved that every command-lane mutation creates a complete immutable audit record.

- Required fresh evidence: audit (30 days)
- Unverified dependencies: [#208](https://github.com/DaoFlow-dev/DaoFlow/issues/208)

### Backup and restore assurance

**Current limitation:** Backup and restore workflows have not yet been proven through a current real-infrastructure round trip with verified data integrity.

- Required fresh evidence: restore (14 days)
- Unverified dependencies: [#217](https://github.com/DaoFlow-dev/DaoFlow/issues/217), [#218](https://github.com/DaoFlow-dev/DaoFlow/issues/218), [#234](https://github.com/DaoFlow-dev/DaoFlow/issues/234), [#235](https://github.com/DaoFlow-dev/DaoFlow/issues/235), [#239](https://github.com/DaoFlow-dev/DaoFlow/issues/239), [#240](https://github.com/DaoFlow-dev/DaoFlow/issues/240)

### Source-control team isolation

**Current limitation:** GitHub and GitLab provider, installation, callback, and checkout boundaries are not yet fully verified as team-isolated.

- Required fresh evidence: agent safety (30 days)
- Unverified dependencies: [#225](https://github.com/DaoFlow-dev/DaoFlow/issues/225), [#226](https://github.com/DaoFlow-dev/DaoFlow/issues/226), [#227](https://github.com/DaoFlow-dev/DaoFlow/issues/227), [#228](https://github.com/DaoFlow-dev/DaoFlow/issues/228), [#229](https://github.com/DaoFlow-dev/DaoFlow/issues/229), [#242](https://github.com/DaoFlow-dev/DaoFlow/issues/242)

### Operator data control

**Goal:** Keep deployment state, backups, and operational decisions under the operator's explicit control.

- Required fresh evidence: restore (14 days)
- Unverified dependencies: [#217](https://github.com/DaoFlow-dev/DaoFlow/issues/217), [#218](https://github.com/DaoFlow-dev/DaoFlow/issues/218), [#234](https://github.com/DaoFlow-dev/DaoFlow/issues/234), [#235](https://github.com/DaoFlow-dev/DaoFlow/issues/235), [#239](https://github.com/DaoFlow-dev/DaoFlow/issues/239)

### Deterministic deployment contract

**Current limitation:** DaoFlow has not yet independently proven deterministic deployment and recovery outcomes across the complete production lifecycle.

- Required fresh evidence: real infrastructure (14 days)
- Unverified dependencies: [#207](https://github.com/DaoFlow-dev/DaoFlow/issues/207), [#209](https://github.com/DaoFlow-dev/DaoFlow/issues/209), [#212](https://github.com/DaoFlow-dev/DaoFlow/issues/212), [#216](https://github.com/DaoFlow-dev/DaoFlow/issues/216), [#222](https://github.com/DaoFlow-dev/DaoFlow/issues/222), [#233](https://github.com/DaoFlow-dev/DaoFlow/issues/233), [#238](https://github.com/DaoFlow-dev/DaoFlow/issues/238), [#240](https://github.com/DaoFlow-dev/DaoFlow/issues/240)

### Web, CLI, and automation parity

**Goal:** Provide one evidence-backed deployment contract for the Web UI, CLI, CI, and constrained automation.

- Required fresh evidence: audit (30 days); agent safety (30 days)
- Unverified dependencies: [#202](https://github.com/DaoFlow-dev/DaoFlow/issues/202), [#208](https://github.com/DaoFlow-dev/DaoFlow/issues/208), [#214](https://github.com/DaoFlow-dev/DaoFlow/issues/214), [#215](https://github.com/DaoFlow-dev/DaoFlow/issues/215), [#218](https://github.com/DaoFlow-dev/DaoFlow/issues/218), [#225](https://github.com/DaoFlow-dev/DaoFlow/issues/225), [#228](https://github.com/DaoFlow-dev/DaoFlow/issues/228), [#229](https://github.com/DaoFlow-dev/DaoFlow/issues/229), [#241](https://github.com/DaoFlow-dev/DaoFlow/issues/241), [#242](https://github.com/DaoFlow-dev/DaoFlow/issues/242)

## How to update this report

Add passing, fresh test or workflow evidence to the matrix, update the matching marked public statement, run `bun run readiness:report`, and then run `bun run readiness:check`. The release workflow attaches this report as a public release asset; it intentionally contains claim status and repository evidence references only, never workflow logs or credentials.
