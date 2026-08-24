# Technology Stack Decision

Status: Accepted baseline.

## Monorepo
- pnpm workspaces
- Turborepo

## Backend
- Node.js current LTS (pinned in repo)
- TypeScript strict
- NestJS
- Fastify adapter
- Modular Monolith first
- REST + OpenAPI
- separate API / Worker / Scheduler processes from the same codebase

## Persistence
- PostgreSQL
- Drizzle ORM + Drizzle Kit
- explicit raw SQL for correctness-critical locking/FIFO queries
- Redis
- BullMQ

## Authentication
- Supabase Auth for identity
- application Identity & Access Context owns authorization/RBAC
- Next.js uses SSR cookie auth
- Backend validates bearer JWTs
- POS device credentials are separate from user identity

## Web
- React
- Next.js App Router
- TypeScript
- Tailwind CSS
- reusable project Design System
- Admin app
- Platform Admin app
- Storefront app

## Storefront
- template/theme support
- strong SEO
- SSR for dynamic public pages
- ISR/on-demand revalidation for safe public catalog pages
- custom domains
- never use ISR for authenticated session-refresh routes

## POS
- Tauri 2
- React + TypeScript UI
- Rust native layer
- Windows first; portable architecture for macOS/Linux
- Barcode Scanner
- Receipt Printer
- Cash Drawer
- Scale
- hardware behind native adapter interfaces

## POS Local Storage
- encrypted SQLite-compatible local DB using SQLCipher/native Rust integration
- key material stored in secure native storage / Stronghold-style strategy
- local DB stores projections/operations only, never central truth

## Mobile
- Flutter
- deferred until backend is stable

## Object Storage
- Cloudflare R2
- S3-compatible API
- signed URLs

## Payments
Provider abstraction from day one.
Initial priority:
1. Paymob
2. InstaPay manual
3. Vodafone Cash manual
4. Fawry
5. Stripe

## Delivery
- Internal Delivery first
- DeliveryProvider interface from day one
- external adapters later

## Observability
- OpenTelemetry
- Pino structured logs
- Prometheus
- Grafana
- Loki
- Tempo
- Sentry

## Testing
- Vitest
- Testcontainers Node (PostgreSQL + Redis)
- Playwright
- OpenAPI/event contract tests

## Infrastructure
- Docker
- Docker Compose
- VPS first
- GitHub Actions
- staging before production

## Code Quality
- strict TypeScript
- ESLint
- Prettier
- Conventional Commits
- Commitlint
- lint-staged
- every required gate green

## Import
Support MongoDB, Excel/CSV, and future DB adapters through:
Parse → Normalize → Map → Validate → Preview → Domain Commands → Reconcile.
Never bypass domain rules with direct import inserts.
