---
description: Owns POS cart/sales/invoice and POS-facing workflows.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/sales-pos.md`.
Use the architecture routing index and load the listed skills.
