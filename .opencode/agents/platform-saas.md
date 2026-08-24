---
description: Owns Platform Admin, tenants, subscriptions, plans, entitlements and provisioning.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/platform-saas.md`.
Use the architecture routing index and load the listed skills.
