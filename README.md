# Commerce Platform Monorepo

This repository is bootstrapped as a `pnpm` + Turborepo workspace.

## M0 status

Implemented:

- `M0-001` root workspace configuration
- `M0-001` shared TypeScript baseline
- `M0-001` shared config package for TypeScript presets
- `M0-001` initial API shell workspace
- `M0-001` explicit placeholders for later apps and packages
- `M0-002` baseline formatting, lint, typecheck, and unit-test wiring for the current workspace

Still deferred to later M0 tasks:

- Docker local services (`M0-003`)
- CI baseline (`M0-004`)
- richer API modular-monolith shell (`M0-005`)

## Notes

- Turborepo remains the monorepo orchestrator baseline for the repository.
- The current quality scripts target the bootstrapped API shell directly so they remain runnable before broader workspace scaffolding is added.

## Workspace layout

- `apps/api` — initial TypeScript API workspace shell
- `apps/admin` — placeholder for future Next.js admin app
- `apps/platform-admin` — placeholder for future Next.js platform admin app
- `apps/storefront` — placeholder for future Next.js storefront app
- `apps/pos` — placeholder for future Tauri POS app
- `packages/config` — shared configuration package
- other `packages/*` — reserved placeholders for later milestones
