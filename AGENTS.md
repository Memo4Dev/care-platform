# Project Agent Instructions

## Source of truth
Before editing:
1. read `.agent-system/indexes/project-index.yaml`
2. read `.agent-system/indexes/architecture-index.yaml`
3. read your agent manifest in `.agent-system/agents/`
4. load only routed architecture files
5. load relevant skills from `.agents/skills/`

Do not load all architecture files by default.

## Persistent Milestone Todo & Session Recovery

### Authoritative state model
Use these sources in this precedence order (never the reverse):
1. Actual committed implementation and tests
2. Git history
3. `docs/state/TASKS.md` (persistent milestone/task ledger)
4. `docs/state/STATE.md` (milestone-level state)
5. Current runtime/OpenCode Todo state

The runtime Todo list is NOT authoritative by itself. It is a projection
reconstructed from the repository, never a source of truth.

### Persistent Todo source
`docs/state/TASKS.md` is the persistent milestone/task ledger. Every
actionable milestone task carries a stable ID (e.g. `M6-001`, `M6-002`,
`M5-SEC-001`). Never create a replacement anonymous Todo list when stable
task IDs already exist. New work is ADDED as a new stable ID, never as an
unnamed replacement list.

### Status model
Use only: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.
Optional metadata: owner, milestone, dependencies, blocker reason, commit
SHA, verification status.

### Reconciliation rule (run at every new prompt / session / context reset)
DO NOT:
- clear the Todo list
- recreate all tasks
- mark everything pending
- restart milestone planning
- infer completion from memory alone

INSTEAD:
1. Read `docs/state/TASKS.md`.
2. Read `docs/state/STATE.md`.
3. Inspect `git status`/`git log` for the current branch.
4. Inspect implementation/tests for ambiguous tasks.
5. Compare repository state with the runtime Todo.
6. Reconstruct the runtime Todo from persistent task IDs.
7. Preserve `DONE` tasks.
8. Preserve `BLOCKED` tasks unless the blocker is actually resolved.
9. Preserve an `IN_PROGRESS` task if work is partially implemented.
10. Add only genuinely new tasks (with stable new IDs).
11. Remove/merge duplicate runtime Todos.
12. Resume the first unfinished task.

### Merge, never replace
A new prompt may add requirements, change priority, resolve a blocker,
add a task, or explicitly cancel a task. It must NOT implicitly replace
the existing Todo list. Interpret every new prompt as a PATCH against the
persistent Todo state. Existing tasks (and their IDs/statuses) are
preserved; new prompts only add/merge/cancel.

### Completion rule
A task may be marked `DONE` only when its acceptance criteria are
satisfied. If code is committed but remote/staging verification is still
required, record the appropriate verification state instead of pretending
the task is fully accepted. Do not reopen a `DONE` task merely because a
new prompt mentions the same area. If evidence shows a `DONE` task is
actually incomplete, reopen that exact task and record the reason.

### Atomic state update
Whenever a task status changes:
1. Update the runtime Todo.
2. Update `docs/state/TASKS.md`.
3. Update `docs/state/STATE.md` when milestone-level state changes.
4. Include the state update in the appropriate focused commit.
Do not allow runtime Todo and repository state to intentionally diverge.

### Session recovery
If context/token/session is reset, start with "Reconcile milestone state",
then reconstruct from the repository. Do not ask "where were we?" when the
repository can answer it.

### Milestone transition
When a milestone becomes COMPLETE: keep its tasks in `TASKS.md` as `DONE`
(do not delete them), mark the milestone COMPLETE in `STATE.md`, and
initialize the next milestone's tasks separately. Historical completed
tasks remain available for audit but should not clutter the active runtime
Todo. The runtime Todo normally shows: current-milestone unfinished tasks,
active cross-milestone follow-ons, and genuine blockers — not every
historical `DONE` item.

### Prompt interruption
If a new prompt arrives while a task is `IN_PROGRESS`, incorporate the new
instruction, reconcile whether it changes the active task, and continue
from the current implementation state — do not discard the existing task.

### Autonomous execution
After reconciliation, drive `TODO → IN_PROGRESS → implement → test →
review → fix → re-test → update docs/state → commit → DONE` and immediately
move to the next Todo. Do not stop after every subtask. STOP only for:
genuine business/architecture/security decisions, destructive
infrastructure/data actions, push approval, merge approval, deploy
approval, or a milestone-completion checkpoint that is explicitly required.

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
State is repository-backed and updated atomically with each accepted loop. Do
not let the runtime Todo diverge from repository state.
- `docs/state/TASKS.md` is the persistent milestone/task ledger with stable
  IDs (e.g. `M6-001`, `M5-SEC-001`) and the status model `TODO`/`IN_PROGRESS`/
  `BLOCKED`/`DONE`. It is the source of truth for the active runtime Todo.
- `docs/state/STATE.md` — milestone-level state (updated when a milestone
  transitions or its phase changes).
- `docs/state/DECISIONS.md` — decisions and follow-on observations.
- `docs/state/MIGRATION_STATUS.md` — migration ledger, when relevant.
See "Persistent Milestone Todo & Session Recovery" above for the full
reconciliation and update procedure.

## Language
Code, comments, commits, ADRs and technical docs are English.

## Tech baseline
Read `docs/architecture/108-tech-stack.md`.
Changing a major technology requires ADR + human approval.
