# Swarm Post-MVP Roadmap

This roadmap turns DaoFlow's vague Docker Swarm future into concrete release slices.

## Current Baseline

DaoFlow already ships a narrow `docker-swarm-manager` slice:

- server registration accepts `docker-swarm-manager` in API, CLI, and read models
- readiness inspection reports the stored target kind back to operators
- the main Servers surface can register and inspect manager targets explicitly
- manager targets persist a typed `swarmTopology` snapshot for cluster identity and node membership

DaoFlow does **not** yet ship cluster-aware execution semantics:

- deployment planning and worker dispatch do not branch on target kind
- deploy and rollback flows still assume standalone Docker/Compose execution
- no stack-level audit vocabulary or approval language exists yet

## Release Slices

> Note: earlier drafts cited GitHub issues `#108` and `#110` for these slices.
> Those issues do not exist in this repository. Do not begin a slice until its
> tracking issue is actually filed and linked here. Per charter §3, Swarm work
> must not begin until the standalone Docker/Compose path is proven solid in
> production — see the 1.0 exit criteria in `e2e-implementation-roadmap.md`.

1. Swarm execution and rollback semantics
   - Tracking issue: not yet filed.
   - branch deployment planning by target kind
   - add `docker stack deploy` / rollback execution with auditable step models
   - preserve standalone Docker behavior without regression

2. Operator and agent affordances
   - Tracking issue: not yet filed.
   - expose Swarm-specific deploy and rollback previews in CLI and UI
   - gate mutations behind explicit scopes and approval language
   - document coexistence and failure recovery

## Exit Criteria

- operators can register and inspect Swarm manager targets without hidden or contradictory UI
- the roadmap to real multi-node execution is represented by concrete GitHub issues instead of a
  vague umbrella
- public docs describe the current experimental boundary accurately
