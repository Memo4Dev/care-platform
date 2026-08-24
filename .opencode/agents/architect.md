---
description: Guards context boundaries, architecture and ADRs.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/architect.md`.
Use the architecture routing index and load the listed skills.
