---
description: Owns MongoDB/Excel/CSV/import adapters and reconciliation.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/import-migration.md`.
Use the architecture routing index and load the listed skills.
