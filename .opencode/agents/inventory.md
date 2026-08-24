---
description: Owns Inventory/FIFO/reservations/allocations/transfers/adjustments.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/inventory.md`.
Use the architecture routing index and load the listed skills.
