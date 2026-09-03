# Resource Contention & Performance Hardening Roadmap

Status: Accepted — approved as the current additive resource-isolation roadmap.

> **Approval scope (authoritative).** Approved as a reference roadmap for future
> milestones only. It does **not** authorize implementation during M5; M5 remains
> scoped to its existing Sales/POS completion work. Sequence: **M6** observation
> (contention/DB-poll-pool saturation/lock-wait/queue-backlog/heavy-write-index
> review/alerts), **M7** workload & queue fairness (priority queues, bounded
> claims, worker concurrency controls), **M8** reporting/read separation (read
> replica where justified, partitioning/archival where justified, RLS as
> defense-in-depth), **M9** noisy-neighbor load testing, rate-limit tuning, and
> operational runbooks.
>
> Post-launch, prefer selective logical/resource isolation before physical tenant
> silos. Physical/database/infrastructure isolation is **not** an automatic
> roadmap step; it requires evidence from production/load metrics and a separate
> ADR plus human approval.

Purpose: Sequence additive performance/contention improvements inside the
current shared (pooled) multi-tenant architecture so they land in the right
development phase, remain maintainable, and **delay or avoid** physical
per-tenant isolation. This plan does not rewrite the schema, the bounding
context boundaries, or the deployment model.

Governance: each hardening item that touches a rule in `00-overview.md` or a
shared component recommendation in `82-scalability.md` must pass the normal
review/ADR flow before implementation.

---

## Principles

1. **Additive only.** No existing column, query, contract, or bounded-context
   boundary is removed or rewritten by this plan.
2. **Fit the phase.** Every item lands in the milestone where it delivers
   value and where it does not disturb concurrent domain work.
3. **Measure before scaling.** AGENTS note: current state is pre-launch
   (staging used for testing, no live tenants) and performance is acceptable.
   Therefore most "hardening" here is foundation, not reaction.
4. **Protect the shared state.** The server remains authoritative; these
   changes only reduce the chance one tenant's workload visibly degrades
   another's latency.
5. **Physical isolation is last** (explicitly deferred) per
   `82-scalability.md`: "Do not prematurely shard PostgreSQL by tenant."

---

## Where the real contention lives (per stakeholder + docs)

Based on the stakeholder's input, the heaviest future load is expected in
**concurrent writes and background jobs that make others wait**, not reads:

- inventory reservation/sale completion (row locks, `FOR UPDATE`)
- offline sync push / allocation overflow
- outbox relay claiming (`FOR UPDATE SKIP LOCKED` on `integration.outbox`)
- background BullMQ jobs (publishing, provider retries, expiry scans)
- large report/audit reads (secondary, but can contend for I/O)

These map to existing metrics in `83-observability.md` (lock waits, deadlocks,
replication lag, outbox backlog, sync backlog).

---

## Phase plan

### Phase M6 — Observation & pool hygiene (when M6 begins)

Goal: ensure we can _see_ contention before we tune it. Additive/monitoring
only; no schema change.

- [ ] **M6-O1 — Enable structured contention metrics.** Publish lock-wait
      times, deadlock counts, connection-pool utilization, and slow-query
      samples from the metrics endpoint (metrics already exist per
      `83-observability.md`; ensure they are exported from the connection
      layer).
- [ ] **M6-O2 — Alert thresholds.** Add runbook alerts for: pool saturation,
      outbox backlog, sync backlog, lock-wait spikes, and reservation-error
      spikes (symptom-based per `83-observability.md`).
- [ ] **M6-O3 — Index review for heavyweight writers.** Verify indexes on the
      busiest writer/consumer tables (`integration.outbox` relay claim,
      `integration.inbox` consumer claim, reservation/lock hot tables). Add
      only if a missing index is proven by plan analysis — no speculative
      index bloat.

Exit gate: dashboards show per-tenant latency and the contention metrics
listed above for current hot paths (POS sale, sync push, relay).

### Phase M7 — Queue & worker fairness (during/or after Storefront)

Goal: stop one tenant's job volume or a full queue from delaying others,
without adding microservices.

- [ ] **M7-Q1 — Per-bounded-context or per-priority BullMQ queues.**
      Separate high-throughput/low-latency work (sale completion, reservation
      release) from batch/heavy work (exports, report generation, archival)
      so a heavy job does not sit behind a sale. Additive worker config only.
- [ ] **M7-Q2 — Outbox relay fairness.** Ensure the `FOR UPDATE SKIP LOCKED`
      claim scans a bounded batch per pass (it already is batch-based) and add
      a max-claims-per-tick cap so one dense tenant cannot starve the relay.
      Additive; keep dedupe-by-EventId.
- [ ] **M7-Q3 — Job array/concurrency bounds per queue.** Bound worker
      concurrency per queue; add per-tenant operational guardrails (optional)
      so a single tenant's job storm cannot consume the shared worker
      concurrency.
- [ ] **M7-Q4 — Idempotency/index hygiene under retries.** Confirm
      `integration_outbox_relay_claim_idx` and `integration_inbox_claim_expiry_idx`
      remain effective under large retry volume; add where analysis proves it.

Exit gate: a storm in one tenant's queue no longer visibly delays another
tenant's sale/relay in the integration harness.

### Phase M8 — Read/write separation & large-table containment (offline/hardening)

Goal: shield hot transactional requests from heavy analytics reads and from
unbounded growth of immutable history.

- [ ] **M8-R1 — Read replica for heavy reads.** Move report/audit/analytics
      queries to a read replica; keep transactional writes on primary. This is
      additive infrastructure (a new DB node), not a code restructure. Guard:
      never read money/stock-authoritative decisions from the replica (mirror
      `82-scalability.md` + `87-caching.md`).
- [ ] **M8-R2 — Partition/archive immutable history.** For append-only
      high-volume tables (`inventory.ledger_entries`, `audit`, `integration.outbox`
      after publish, `integration.inbox` after completion), introduce
      partition-by-time + archival (per `82-scalability.md`). Additive schema
      change; existing readers unaffected.
- [ ] **M8-R3 — Optional RLS barrier.** Add PostgreSQL RLS as an extra barrier
      on high-risk tables only after application isolation is verified (per
      `71-multi-tenant-isolation.md` layer 5). Additive; not a substitute for
      existing checks.

Exit gate: heavy report queries no longer run on the same transaction path;
immutable tables are partition-pruned and bounded.

### Phase M9 — Load & security hardening (production readiness)

Goal: prove the shared model holds under expected load before go-live.

- [ ] **M9-L1 — Load tests for worst-case shared behavior.** Simulate multiple
      tenants, one "noisy" tenant doing heavy concurrent sales + sync + large
      report, and assert bounded p95/p99 latency for the quiet tenant (per
      `82-scalability.md` hot paths).
- [ ] **M9-L2 — Quota/guardrail refinement.** Tighten per-tenant rate limits
      (per `75-abuse-rate-limits.md`) and add export/report size limits.
- [ ] **M9-L3 — Runbook + rollback.** Document scaling knobs, replica
      failover, partition archiving, and queue backpressure procedures
      (extends `96-operational-runbooks.md`).

Exit gate: production-readiness checklist (`94-production-readiness.md`)
passes including connection pool, slow-query monitoring, and observability.

### Post-launch — data-driven escalation (only if real contention appears)

- [ ] **P-L1 — Prove, don't guess.** Re-run the M9 load test at current/expected
      tenant count; if a single tenant visibly degrades others despite the
      above, move to selective, per-tenant guardrails first.
- [ ] **P-L2 — Selective isolation before silo.** Prefer: per-tenant priority
      on queues, per-tenant connection pool partitions (PgBouncer pool modes),
      and RLS before database sharding.
- [ ] **P-L3 — ADR for physical isolation (last resort).** Only if selective
      measures fail: separate PostgreSQL/database instance per high-volume
      tenant (silo). This is a major architectural change (affects Outbox/Inbox
      distribution, offline sync, analytics, DR) and **must** be a separate
      human-approved ADR. Explicitly deferred.

---

## Decisions that must NOT be changed by this plan

- Bounded-context ownership and cross-context write rules stay intact.
- The single logical Postgres schema layout (`30-persistence-overview.md`)
  is preserved; partitioning/RLS are additive on top.
- Outbox/Inbox + idempotency + server-authority invariants are preserved.
- No microservice split for performance (per `82-scalability.md` and
  `80-infrastructure-architecture.md`).

---

## Maintenance & reversibility notes

- Every change is independently deployable and revertible (additive
  migrations, config-only queue changes, additive infra).
- Metrics from M6 make each later decision evidence-based, not speculative.
- The plan explicitly gates **physical isolation** behind a demonstrable need
  and a human-approved ADR, keeping the architecture maintainable now.
