---
description: Owns Supabase identity integration, RBAC, branch scopes and POS device identity.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/identity-auth.md`.
Use the architecture routing index and load the listed skills.
