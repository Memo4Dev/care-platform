# ADR-0001: Error Code to HTTP Status Mapping

Status: Proposed (pending human ratification)

Date: 2026-08-24

## Context

`docs/architecture/62-error-codes.md` defines the stable machine-readable error catalog, and
`docs/architecture/51-api-conventions.md` defines a standard error envelope, but neither assigns
HTTP statuses per code. Every API surface needs one deterministic mapping so clients can rely on
stable transport semantics while matching on `error.code`.

Implemented in `packages/contracts/src/errors.ts` (`ERROR_HTTP_STATUS`, compile-time exhaustive
`Record<ErrorCode, number>`).

## Decision

Mapping rules:

1. Authentication failures (missing/invalid credentials, unregistered/revoked device) → `401`.
2. Authorization failures (permissions, branch scope, tenant suspended, entitlement/plan gating,
   approval required by policy) → `403`. Quota/limit gating never uses `402`.
3. `PAYMENT_REQUIRED` / `PAYMENT_FAILED` → `402` (reason-phrase-exact cases only).
4. Not found → `404`; validation of request content → `422`; malformed syntax → `400`.
5. Optimistic-concurrency conflicts and idempotency conflicts → `409`.
6. State-family conflicts (invalid transition, already-completed, expired reservation,
   insufficient balance/stock/allocation) → `409`.
7. Business-window expirations that depend on request content (e.g. `RETURN_WINDOW_EXPIRED`) →
   `422`; time-based resource states (e.g. `RESERVATION_EXPIRED`) → `409`.
8. Upstream provider unavailable/failed → `502`; unexpected errors → `500`.

Notable deliberate choices:

- `REFUND_DESTINATION_UNAVAILABLE` → `409` (refundable state exists but destination is currently
  unavailable; retry may succeed) rather than `502`.
- Subscription/quota codes (`SUBSCRIPTION_INACTIVE`, `PLAN_LIMIT_REACHED`,
  `FEATURE_NOT_ENTITLED`) → `403`, never monetized via `402`.

## Alternatives considered

- Map everything not-found/validation generically without a table — rejected: unstable client
  behavior across modules.
- Use `402` for all subscription limits — rejected: `402` semantics are payment-specific;
  plan-limit denial is an authorization outcome.

## Consequences

- Clients match on `code` first; HTTP status is transport guidance.
- The table lives in code as an exhaustive record; a doc-sync check in the error catalog tests
  pins catalog size, and this ADR documents intent for the human-reviewed architecture docs.
- If ratified, promote the table into `docs/architecture/62-error-codes.md` (additive).
