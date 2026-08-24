---
name: postgres-locking
description: Use deterministic row locks for reservations/FIFO/balances; prevent read-then-write races and deadlocks.
---

# postgres-locking

## Instructions
Use deterministic row locks for reservations/FIFO/balances; prevent read-then-write races and deadlocks.

## Always
- Read `AGENTS.md`.
- Use the architecture routing index.
- Do not silently change architecture.
- Run relevant quality gates.
- Never push/merge without human approval.
