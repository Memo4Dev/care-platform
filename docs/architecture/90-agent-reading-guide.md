# Agent Reading Guide

Do not load the entire architecture into one agent unless performing a global architecture review.

Recommended context loading:

## Inventory task
Load:
- 00-overview.md
- 01-context-map.md
- 15-inventory.md
- 31-inventory-persistence.md
- 34-reliability.md
- 40-workflows.md
- 51-api-conventions.md

## POS / Offline task
Load:
- 00-overview.md
- 11-identity-access.md
- 15-inventory.md
- 17-cart.md
- 19-sales.md
- 21-payments-accounts.md
- 22-cash-management.md
- 26-offline-sync.md
- 33-offline-persistence.md
- 34-reliability.md
- 40-workflows.md
- 50-api-overview.md
- 51-api-conventions.md
- 52-api-use-cases.md

## Storefront task
Load:
- 00-overview.md
- 12-catalog.md
- 13-pricing.md
- 14-customers.md
- 17-cart.md
- 18-orders.md
- 20-fulfillment.md
- 21-payments-accounts.md
- 24-delivery.md
- 25-storefront.md
- 40-workflows.md
- API files

## Purchasing task
Load:
- 00-overview.md
- 12-catalog.md
- 15-inventory.md
- 16-purchasing.md
- 31-inventory-persistence.md
- 34-reliability.md
- 40-workflows.md

## Finance task
Load:
- 00-overview.md
- 19-sales.md
- 21-payments-accounts.md
- 22-cash-management.md
- 23-returns.md
- 27-audit-activity.md
- 32-financial-persistence.md
- 34-reliability.md

## Global architecture review
Load:
- 00-overview.md
- 01-context-map.md
- 30-persistence-overview.md
- 34-reliability.md
- 40-workflows.md
Then pull only the specific context files needed.

Rule for agents:
Prefer narrow context first. Expand only when a dependency is directly involved.

## API implementation agent

Start with:
- `00-overview.md`
- relevant Context file(s)
- relevant persistence file
- `34-reliability.md`
- `50-api-overview.md`
- `51-api-conventions.md`
- one detailed API file (`53`-`57`)
- `58-event-contracts.md`
- `59-application-use-cases.md`

Do not load every API file unless performing a cross-platform contract review.

## Platform Admin / SaaS billing task

Load:
- `00-overview.md`
- `01-context-map.md`
- `08-platform-management.md`
- `09-subscription-billing.md`
- `09a-plans-entitlements.md`
- `09b-tenant-provisioning.md`
- `30a-platform-persistence.md`
- `34-reliability.md`
- `53a-platform-admin-api.md`
- `60-module-contracts.md`
- `62-error-codes.md`

Do not load tenant Inventory/Sales details unless investigating a tenant-support case or usage metric dependency.

## Security agent

Start with:
- `00-overview.md`
- `01-context-map.md`
- `70-security-architecture.md`
- `71-multi-tenant-isolation.md`
- `72-authorization-matrix.md`
- `73-threat-model.md`
- `74-security-test-checklist.md`
- `76-data-classification.md`
- `34-reliability.md`

Then load only the affected Context/API/Persistence files.

## Authorization agent

Load:
- `11-identity-access.md`
- `72-authorization-matrix.md`
- `62-error-codes.md`
- relevant API file
- relevant Context file

## Infrastructure / DevOps agent

Load:
- `89-infrastructure-agent-guide.md`

Then pull only the specific architecture/security/persistence files listed there.

## QA / Release agent

Load:
- `91-testing-architecture.md`
- `92-quality-gates.md`
- `93-release-strategy.md`
- `94-production-readiness.md`
- `95-test-scenario-catalog.md`
- `97-definition-of-done.md`

Then load only the Context/API/Persistence files affected by the release.

## Production operations agent

Load:
- `83-observability.md`
- `85-backup-dr.md`
- `86-background-jobs.md`
- `94-production-readiness.md`
- `96-operational-runbooks.md`

## Orchestrator / Implementation planner

Load:
- `98-implementation-roadmap.md`
- `99-module-dependency-graph.md`
- `102-milestones.md`
- `103-workstream-plan.md`
- `105-agent-orchestration-plan.md`
- `106-task-template.md`

For refactor work also load:
- `100-refactor-migration-strategy.md`
- `101-data-migration-plan.md`
- `107-migration-status-template.md`
