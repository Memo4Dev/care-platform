---
description: Owns suppliers, POs, goods receipts and landed cost.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/purchasing.md`.
Use the architecture routing index and load the listed skills.
