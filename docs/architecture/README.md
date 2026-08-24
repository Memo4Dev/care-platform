# POS / Commerce Architecture Documentation

This folder is intentionally split into small files to reduce agent context size.

## Start here

1. `00-overview.md`
2. `01-context-map.md`
3. `90-agent-reading-guide.md`

## Domain Contexts

- `10-organization.md`
- `11-identity-access.md`
- `12-catalog.md`
- `13-pricing.md`
- `14-customers.md`
- `15-inventory.md`
- `16-purchasing.md`
- `17-cart.md`
- `18-orders.md`
- `19-sales.md`
- `20-fulfillment.md`
- `21-payments-accounts.md`
- `22-cash-management.md`
- `23-returns.md`
- `24-delivery.md`
- `25-storefront.md`
- `26-offline-sync.md`
- `27-audit-activity.md`

## Persistence / Reliability

- `30-persistence-overview.md`
- `31-inventory-persistence.md`
- `32-financial-persistence.md`
- `33-offline-persistence.md`
- `34-reliability.md`

## Workflows

- `40-workflows.md`

## API Design

- `50-api-overview.md`
- `51-api-conventions.md`
- `52-api-use-cases.md`

## Original full reference

The original full architecture file remains available separately for human/global review, but agents should normally use the split files.

### Detailed API files

- `53-admin-api.md`
- `54-pos-api.md`
- `55-storefront-api.md`
- `56-offline-sync-api.md`
- `57-webhooks.md`
- `58-event-contracts.md`
- `59-application-use-cases.md`

## SaaS Platform Management

- `08-platform-management.md`
- `09-subscription-billing.md`
- `09a-plans-entitlements.md`
- `09b-tenant-provisioning.md`
- `30a-platform-persistence.md`
- `53a-platform-admin-api.md`

## Contracts

- `60-module-contracts.md`
- `61-dto-contracts.md`
- `62-error-codes.md`
- `63-openapi-boundaries.md`

## Security

- `70-security-architecture.md`
- `71-multi-tenant-isolation.md`
- `72-authorization-matrix.md`
- `73-threat-model.md`
- `74-security-test-checklist.md`
- `75-abuse-rate-limits.md`
- `76-data-classification.md`

## Infrastructure / Operations

- `80-infrastructure-architecture.md`
- `81-environments.md`
- `82-scalability.md`
- `83-observability.md`
- `84-cicd.md`
- `85-backup-dr.md`
- `86-background-jobs.md`
- `87-caching.md`
- `88-performance-testing.md`
- `89-infrastructure-agent-guide.md`

## Testing / Release / Production Readiness

- `91-testing-architecture.md`
- `92-quality-gates.md`
- `93-release-strategy.md`
- `94-production-readiness.md`
- `95-test-scenario-catalog.md`
- `96-operational-runbooks.md`
- `97-definition-of-done.md`

## Implementation / Migration

- `98-implementation-roadmap.md`
- `99-module-dependency-graph.md`
- `100-refactor-migration-strategy.md`
- `101-data-migration-plan.md`
- `102-milestones.md`
- `103-workstream-plan.md`
- `104-git-branch-strategy.md`
- `105-agent-orchestration-plan.md`
- `106-task-template.md`
- `107-migration-status-template.md`
