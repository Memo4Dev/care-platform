# M1-010 Independent Test Gap Report

Date: 2026-08-25

## Native PostgreSQL coverage

| Scenario                                                     | Evidence                                                                                                                             | Status                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| TEN-001 Tenant B cannot read Tenant A sale                   | Sales does not exist until M5; no sale API or persistence is available in M1.                                                        | Deferred — M5 blocking scenario |
| TEN-002 Tenant B cannot inject Tenant A branch               | `m1-final.integration.spec.ts` sends Owner A's bearer token with Tenant B's branch ID and receives `RESOURCE_NOT_FOUND`.             | Covered                         |
| TEN-003 tenant foreign-key injection fails                   | `m1-final.integration.spec.ts` verifies the warehouse composite tenant FK rejects a raw cross-tenant insert (`23503`).               | Covered                         |
| TEN-004 platform support requires active support session     | `platform.integration.spec.ts` verifies wrong-operator and expired-session denial with persisted expiry audit.                       | Covered                         |
| SUB-001 inactive entitlement blocks feature                  | `entitlements.integration.spec.ts` resolves an inactive plan fail-closed.                                                            | Covered                         |
| SUB-002 plan resource limit blocks excess creation           | `m1-final.integration.spec.ts` verifies authenticated limit rejection and concurrent different-key requests serialize to one branch. | Covered                         |
| SUB-003 temporary override expires                           | `entitlements.integration.spec.ts` verifies expiry falls back to the plan value.                                                     | Covered                         |
| SUB-004 provisioning retry creates no duplicate defaults     | `provisioning.integration.spec.ts` verifies concurrent retries converge on exactly one owner, branch, and warehouse.                 | Covered                         |
| M1 E2E provisioning -> owner login -> branch/warehouse ready | `m1-final.integration.spec.ts` registers through Platform API, provisions, activates, then verifies Owner branch/warehouse access.   | Covered                         |
| Suspension business access                                   | `m1-final.integration.spec.ts` verifies a previously valid Owner bearer is denied with `TENANT_SUSPENDED`.                           | Covered                         |

## Remaining gaps and CI requirement

- TEN-001 is intentionally not substituted with a branch/warehouse test: its required Sale resource belongs to the M5 Sales context. Add the exact sale read-IDOR test when that context and endpoint exist.
- Native PostgreSQL validates all M1 database-backed integration coverage locally. Redis/BullMQ relay-worker tests are intentionally skipped without local Redis or Docker.
- CI must provide authenticated Redis and run `REDIS_INTEGRATION=true pnpm test:integration` before accepting M1. A local green result is not a substitute for that CI gate.
