# Commerce Platform Monorepo

This repository is bootstrapped as a `pnpm` + Turborepo workspace.

## M0-001 scope

Implemented in this task:
- root workspace configuration
- shared TypeScript baseline
- shared config package for TypeScript presets
- initial API shell workspace
- explicit placeholders for later apps and packages

Intentionally deferred to later M0 tasks:
- quality tooling wiring (`M0-002`)
- Docker local services (`M0-003`)
- CI baseline (`M0-004`)
- richer API modular-monolith shell (`M0-005`)

## Workspace layout

- `apps/api` — initial TypeScript API workspace shell
- `apps/admin` — placeholder for future Next.js admin app
- `apps/platform-admin` — placeholder for future Next.js platform admin app
- `apps/storefront` — placeholder for future Next.js storefront app
- `apps/pos` — placeholder for future Tauri POS app
- `packages/config` — shared configuration package
- other `packages/*` — reserved placeholders for later milestones
