---
description: Owns aggregates, invariants, commands, value objects, policies and domain events.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/domain.md`.
Use the architecture routing index and load the listed skills.
