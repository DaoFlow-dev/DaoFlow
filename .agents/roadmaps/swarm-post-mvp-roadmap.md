# Swarm Post-MVP Roadmap

This roadmap turns DaoFlow's vague Docker Swarm future into concrete release slices.

## Current Baseline

DaoFlow already ships a narrow `docker-swarm-manager` slice:

- server registration accepts `docker-swarm-manager` in API, CLI, and read models
- readiness inspection reports the stored target kind back to operators
- the main Servers surface can register and inspect manager targets explicitly

DaoFlow does **not** yet ship cluster-aware execution semantics:

- deployment planning and worker dispatch do not branch on target kind
- deploy and rollback flows still assume standalone Docker/Compose execution
- no stack-level audit vocabulary or approval language exists yet

## Release Slices

1. Swarm cluster domain model
   - GitHub issue: `#109`
   - define managers, workers, stack identity, and placement metadata
   - lock the persistence and API contract for target inspection

2. Swarm execution and rollback semantics
   - GitHub issue: `#108`
   - branch deployment planning by target kind
   - add `docker stack deploy` / rollback execution with auditable step models
   - preserve standalone Docker behavior without regression

3. Operator and agent affordances
   - GitHub issue: `#110`
   - expose Swarm-specific deploy and rollback previews in CLI and UI
   - gate mutations behind explicit scopes and approval language
   - document coexistence and failure recovery

## Exit Criteria

- operators can register and inspect Swarm manager targets without hidden or contradictory UI
- the roadmap to real multi-node execution is represented by concrete GitHub issues instead of a
  vague umbrella
- public docs describe the current experimental boundary accurately
