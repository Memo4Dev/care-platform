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
- `M0-003` local Docker services baseline for PostgreSQL and Redis

Still deferred to later M0 tasks:

- CI baseline (`M0-004`)
- richer API modular-monolith shell (`M0-005`)

## Notes

- Turborepo remains the monorepo orchestrator baseline for the repository.
- The current quality scripts target the bootstrapped API shell directly so they remain runnable before broader workspace scaffolding is added.
- Local Docker services intentionally cover only PostgreSQL and Redis at this stage.

## Local infrastructure

1. Copy `.env.local.example` to `.env.local`.
2. Adjust local credentials/ports if needed.
3. Start services with `scripts/dev-services.sh up`.
4. Inspect status with `scripts/dev-services.sh ps`.
5. Stop services with `scripts/dev-services.sh down`.

Services started by `docker-compose.local.yml`:

- PostgreSQL 17
- Redis 7

## Workspace layout

- `apps/api` — initial TypeScript API workspace shell
- `apps/admin` — placeholder for future Next.js admin app
- `apps/platform-admin` — placeholder for future Next.js platform admin app
- `apps/storefront` — placeholder for future Next.js storefront app
- `apps/pos` — placeholder for future Tauri POS app
- `packages/config` — shared configuration package
- other `packages/*` — reserved placeholders for later milestones
