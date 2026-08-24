---
description: Owns Tenant Admin and Platform Admin Next.js UI.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/frontend-admin.md`.
Use the architecture routing index and load the listed skills.
