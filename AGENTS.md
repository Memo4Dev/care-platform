# Project Agent Instructions

## Source of truth
Before editing:
1. read `.agent-system/indexes/project-index.yaml`
2. read `.agent-system/indexes/architecture-index.yaml`
3. read your agent manifest in `.agent-system/agents/`
4. load only routed architecture files
5. load relevant skills from `.agents/skills/`

Do not load all architecture files by default.

## Session Reconciliation
At the start of every session (new or resumed), reconcile repository
state before planning or editing. See the orchestrator manifest for
the full reconciliation procedure and source-of-truth priority.

## Architecture governance
`docs/architecture/` is authoritative for bounded contexts, ownership, domain rules, persistence, APIs, security, testing and rollout.
Do not invent or silently change a business/domain rule.
If a required decision is absent or conflicts with architecture, propose an ADR and stop that decision for human review.

## Design system compliance (mandatory for UI work)
1. `docs/design/DESIGN.md` is the single source of truth for UI. Every UI implementation task reads it before writing any UI code.
2. After reading it, load only the token/component/pattern files relevant to the current task via `design_routing` in `.agent-system/indexes/routing.yaml`. Never load the whole `docs/design/` directory.
3. Never modify approved design decisions under `docs/design/`. If a UI requirement conflicts with them, stop and escalate for human review. Exception: `docs/design/review-checklist.md` is a process document owned through the normal orchestration change flow, not an approved design decision.
4. Consume semantic tokens; never hardcode raw colors, sizes, or motion values in components.
5. Pair every status color with a written label or icon; keep light/dark semantics identical.
6. UI changes follow the component and pattern specs in `docs/design/` and are reviewed against accessibility plus web design guidelines before gates pass.
7. Every UI/frontend task matching `design_review_gate.trigger_keywords` must pass the Design Compliance Review Gate (`docs/design/review-checklist.md`, enforced by reviewer): functional tests pass + design compliance review passes + accessibility checks pass where relevant. A UI task cannot be accepted otherwise. If the design system does not cover a case, mark a `Design Gap`; never silently invent a permanent new pattern.

## Cross-context
Never directly mutate another bounded context's persistence.
Use module contracts, commands, events, Outbox/Inbox and anti-corruption adapters.

## Tenant safety
Every tenant read/write is `organizationId` scoped.
Branch-scoped actions enforce branch access.
Do not trust tenant/branch IDs from request bodies without authorization.

## Host mutation safety
Agents must not install host-level system services/tools merely to satisfy tests.
Do not automatically execute `brew install`, `brew services start`, host PostgreSQL installation, or system-wide daemon changes without explicit user approval.

Preferred hierarchy:
1. existing project dependency (`pnpm add`)
2. existing project infrastructure (Docker Compose)
3. Testcontainers
4. GitHub Actions service containers
5. staging infrastructure
6. host mutation only with explicit user approval

Package dependencies (`pnpm add bullmq`) are different from host-level
installations and may be performed when task-scoped and appropriate.

## MCP / external tool safety
Supabase MCP or other external tool integrations may be used by relevant agents.
Rules:
- use only when task-relevant
- do not load for unrelated agents
- no destructive operations without explicit approval
- no production configuration changes without approval
- no secret exposure
- no architecture changes merely because capabilities exist

External tool availability does not change accepted architecture decisions.

## Secrets / runtime configuration
Secrets must never be hardcoded or printed.
Explicitly classify: CI ephemeral, STAGING, PRODUCTION.
CI may use ephemeral test-only credentials.
Never reuse CI credentials for staging/production.

## Work loop
Task intake → route → plan → implement → test → independent review (including Design Compliance Review Gate for UI tasks) → security review if triggered → fix loop → all relevant gates green → update state → commit → STOP before push/merge.

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
Tests must declare environment requirements (LOCAL/CI).
Skipped-required tests are CI obligations, not acceptance.

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
