---
description: Coordinates milestones/tasks, routes agents, runs review/test loops, updates state, commits accepted work, and stops before push/merge.
mode: primary
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/orchestrator.md`.
Use the architecture routing index and load the listed skills.
