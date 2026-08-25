---
name: idempotency
description: Retriable writes store idempotency outcome so duplicates cannot repeat side effects.
---

# idempotency

## Instructions

Every externally exposed mutation endpoint must explicitly declare an idempotency classification.
Never silently omit idempotency consideration for POST/PATCH/PUT/DELETE where retries could repeat side effects.

## Classification

Every mutation endpoint declares one of:

### A. LOCAL_ATOMIC

Single bounded-context PostgreSQL transaction containing:

```
BEGIN
  claim/check Idempotency-Key
  validate request fingerprint (SHA-256 of canonicalized body)
  execute business mutation
  persist business state + outbox events
  persist completed idempotency outcome (HTTP status + response)
COMMIT
```

Business mutation and idempotency outcome share the same transaction.
A crash before commit rolls back both. No separate interceptor transaction.

Required tests:
- first execution returns expected status
- same key + same payload replays stored outcome
- same key + different payload returns IDEMPOTENCY_CONFLICT
- concurrent duplicate with distinct keys: at most one succeeds
- IN_PROGRESS duplicate blocks second execution
- simulated crash/rollback before commit: no state or outcome persisted
- replay from a new application/request instance returns same outcome

Never implement as:
```
business commit
→ separate interceptor transaction
→ save outcome
```

Do not reintroduce a global split idempotency interceptor.

### B. WORKFLOW_IDEMPOTENT

Cross-context mutation spanning bounded contexts:

```
idempotent workflow acceptance (same tx as workflow request + outbox)
→ local transaction
→ Outbox
→ durable delivery (BullMQ/Redis)
→ Process Manager/Saga
→ checkpoints
→ idempotent consumers
→ convergent execution
```

HTTP idempotency protects acceptance of the workflow request,
not atomic completion of every downstream side effect.

Required characteristics:
- stable workflow/execution ID
- checkpointing at each durable step
- retry-safe execution per step
- resumability after worker crash
- no parallel duplicate workflow for same execution
- replay convergence

Worker crash after a step commits but before message completion:
redelivery detects persisted checkpoint, does not repeat completed
side effects, continues from next incomplete step.

### C. NOT_REQUIRED

Requires documented justification. Examples:
- idempotent read operations (GET/HEAD)
- operations where duplicate execution is safe by design
- operations protected by a higher-level workflow idempotency

## Inbox / Consumer Semantics

Inbox uniqueness is consumer-aware: `(event_id, consumer)`.
Do not globally dedupe an event across unrelated consumers.

Processing requires:
- atomic claim/lease semantics with opaque lease ID
- lease expiry check on completion/release
- duplicate delivery tolerance
- worker crash recovery
- safe replay

Inbox acknowledgement must not create a crash window where
side effects commit but the system loses knowledge of completed progress.
Bind event processing to durable workflow execution/checkpoint state.

## Event Data Minimization

Integration events are ID-first/minimized by default.
Do not broadcast email, name, phone, or unnecessary profile/PII
unless a specific approved event contract genuinely requires it.
Prefer IDs and authorized read models/contracts.

## Always

- Read `AGENTS.md`.
- Use the architecture routing index.
- Do not silently change architecture.
- Run relevant quality gates.
- Never push/merge without human approval.
