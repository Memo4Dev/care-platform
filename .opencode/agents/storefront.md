---
description: Owns Storefront SEO/themes/custom domains and presentation flows.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/storefront.md`.
Use the architecture routing index and load the listed skills.
