# Command Audit Contract

DaoFlow command-lane mutations use one enforced audit boundary. A command must not rely only on an audit write inside its handler.

## Required sequence

1. Persist a safe `attempted` event before input parsing, authorization, or external work.
2. Parse and authorize the command.
3. Persist a failure or immediate-success outcome, or an `accepted` event when work was queued.
4. Use `accepted` only for queue acceptance; never use it as proof that remote execution succeeded.
5. Link accepted work to the returned deployment, job, run, restore, task, or operation identifier when one exists.
6. Persist a later `succeeded` or `execution_failed` outcome from durable operation state.
7. Operational maintenance reconstructs missing deployment acceptance/final events and marks abandoned intents `incomplete`.

## Safe data rules

- Store field names and allowlisted resource identifiers, not request bodies.
- Never store environment values, private keys, access tokens, passwords, provider credentials, or raw shell input.
- Hash idempotency keys before persistence.
- Record the requested permission scope even when access is denied.

## Database rules

- Command intent and outcome events carry the same `attemptId`.
- Each attempt has at most one intent and one outcome event.
- Rows marked `metadata.immutable = true` cannot be updated or deleted at the database boundary.
- An audit outcome write failure after external work must not turn a possibly successful command into a retryable response. The durable intent is reconciled instead.

## Coverage rule

Every mutation exported from the command router must inherit command audit metadata. The coverage test must fail when a new command mutation bypasses the enforced boundary.
