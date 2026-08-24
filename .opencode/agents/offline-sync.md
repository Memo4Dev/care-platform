---
description: Owns local POS persistence, sequencing, sync, conflicts and encryption.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/offline-sync.md`.
Use the architecture routing index and load the listed skills.
