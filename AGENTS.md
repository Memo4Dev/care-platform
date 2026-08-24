# Project Agent Instructions

## Source of truth
Before editing:
1. read `.agent-system/indexes/project-index.yaml`
2. read `.agent-system/indexes/architecture-index.yaml`
3. read your agent manifest in `.agent-system/agents/`
4. load only routed architecture files
5. load relevant skills from `.agents/skills/`

Do not load all architecture files by default.

## Architecture governance
`docs/architecture/` is authoritative for bounded contexts, ownership, domain rules, persistence, APIs, security, testing and rollout.
Do not invent or silently change a business/domain rule.
If a required decision is absent or conflicts with architecture, propose an ADR and stop that decision for human review.

## Cross-context
Never directly mutate another bounded context's persistence.
Use module contracts, commands, events, Outbox/Inbox and anti-corruption adapters.

## Tenant safety
Every tenant read/write is `organizationId` scoped.
Branch-scoped actions enforce branch access.
Do not trust tenant/branch IDs from request bodies without authorization.

## Work loop
Task intake → route → plan → implement → test → independent review → security review if triggered → fix loop → all relevant gates green → update state → commit → STOP before push/merge.

## Human checkpoints
Stop only for:
- new business decision
- destructive migration
- breaking public API
- security tradeoff
- production deploy
- major scope expansion
- git push
- git merge

## Git
Agents may create branches/worktrees, edit, run tests/migrations locally, and commit.
Agents must never push, merge to main, or deploy production without explicit human approval.
Use Conventional Commits.

## Quality
All required format/lint/typecheck/unit/integration/contract/security tests must be green.
Do not weaken tests to obtain green.

## State
After each completed loop update:
- `docs/state/STATE.md`
- `docs/state/TASKS.md`
- `docs/state/DECISIONS.md`
- `docs/state/MIGRATION_STATUS.md` if relevant

## Language
Code, comments, commits, ADRs and technical docs are English.

## Tech baseline
Read `docs/architecture/108-tech-stack.md`.
Changing a major technology requires ADR + human approval.
