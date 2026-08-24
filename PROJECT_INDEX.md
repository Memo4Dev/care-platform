# Project Index

## Start
- `AGENTS.md`
- `.agent-system/indexes/project-index.yaml`
- `.agent-system/indexes/architecture-index.yaml`
- `.agent-system/indexes/agents-index.yaml`
- `.agent-system/indexes/routing.yaml`

## Architecture
`docs/architecture/` — load through routing, not wholesale.

## Design System
- Source of truth: `docs/design/DESIGN.md` — every UI implementation task reads this first.
- Tokens: `docs/design/tokens/` (colors, typography, spacing, motion)
- Components: `docs/design/components/` (buttons, forms, navigation, tables)
- Patterns: `docs/design/patterns/` (dashboard, data-table, forms, responsive)
- Load only the files relevant to the current UI task via `design_routing` in `.agent-system/indexes/routing.yaml`.
- Design Compliance Review Gate: `docs/design/review-checklist.md` — mandatory before any UI task is accepted (see `design_review_gate` in routing.yaml).
- Approved content: never modify design decisions under `docs/design/`.

## Agents
- Canonical manifests: `.agent-system/agents/`
- Portable Skills: `.agents/skills/`
- OpenCode wrappers: `.opencode/agents/`

## State
- `docs/state/STATE.md`
- `docs/state/TASKS.md`
- `docs/state/DECISIONS.md`
- `docs/state/MIGRATION_STATUS.md`

## ADRs
`docs/adr/`

## Human commands
- Start M0
- Start M1
- Next task
- Review current
- Prepare push

The orchestrator manages routing/loops. Push and merge require human approval.
