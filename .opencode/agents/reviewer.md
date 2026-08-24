---
description: Independent read-only correctness/architecture/concurrency reviewer.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
  - action: edit
    resource: "*"
    effect: deny
---
Read `AGENTS.md`, then `.agent-system/agents/reviewer.md`.
Use the architecture routing index and load the listed skills.
