---
description: Owns PostgreSQL/Drizzle persistence, migrations, locks and DB tests.
mode: subagent
permissions:
  - action: shell
    resource: "git push *"
    effect: ask
  - action: shell
    resource: "git merge *"
    effect: ask
---
Read `AGENTS.md`, then `.agent-system/agents/database.md`.
Use the architecture routing index and load the listed skills.
