---
description: Owns Docker/VPS/GitHub Actions/OTel/backups/release engineering.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/devops-observability.md`.
Use the architecture routing index and load the listed skills.
