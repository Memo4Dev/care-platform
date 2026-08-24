---
description: Owns test architecture, scenario coverage and all quality gates.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/qa.md`.
Use the architecture routing index and load the listed skills.
