# @commerce-platform/contracts

Shared, dependency-free contract primitives for every bounded context module:
the stable machine-readable error catalog, standard API envelopes, cursor
pagination primitives and common DTO schemas.

The only runtime dependency is `zod` for schema validation helpers. No other
runtime dependencies are allowed in this package.

## Sources of truth

- `docs/architecture/62-error-codes.md` — the error catalog implemented verbatim
- `docs/architecture/51-api-conventions.md` — envelope + pagination + idempotency conventions
- `docs/architecture/61-dto-contracts.md` — DTO rules (money is a string!)
- `docs/architecture/63-openapi-boundaries.md` — API surface split and shared component schemas

## Error codes (`src/errors.ts`)

- `ERROR_CODES` lists every code from `62-error-codes.md`, grouped by the doc's
  sections. Codes are a **stable contract**: clients branch on `code`, never on
  message text or HTTP status.
- `PlatformError(code, message, { details?, correlationId?, cause? })` carries
  the code plus its conventional `httpStatus`; throw it from use cases.
- Static factories exist for the common cases: `PlatformError.notFound()`,
  `.validationFailed()`, `.permissionDenied()`, `.invalidCredentials()`,
  `.branchAccessDenied()`, `.tenantSuspended()`, `.planLimitReached()`,
  `.featureNotEntitled()`, `.versionConflict()`, `.idempotencyConflict()`, …
- `isPlatformError()` recognizes instances even across duplicate package copies.
- `httpStatusFor(code)` resolves the conventional HTTP status; unknown values
  fall back to `500`.

### HTTP status convention table

| Status | Meaning                                                                                                                                            | Codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401    | Authentication boundary failure (device registration/revocation is part of the POS device credential factor)                                       | `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `DEVICE_NOT_REGISTERED`, `DEVICE_REVOKED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 402    | Payment execution outcomes only — reason phrase exact match; subscription/quota gating deliberately avoids 402                                     | `PAYMENT_REQUIRED`, `PAYMENT_FAILED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 403    | Authorization, policy, approval gates, subscription/quota limits                                                                                   | `PERMISSION_DENIED`, `BRANCH_ACCESS_DENIED`, `OVERRIDE_PERMISSION_REQUIRED`, `ACCOUNT_SUSPENDED`, `TENANT_SUSPENDED`, `SUBSCRIPTION_INACTIVE`, `SUBSCRIPTION_PAST_DUE`, `FEATURE_NOT_ENTITLED`, `PLAN_LIMIT_REACHED`, `PRICE_OVERRIDE_NOT_ALLOWED`, `STOCK_ADJUSTMENT_APPROVAL_REQUIRED`, `ORDER_APPROVAL_REQUIRED`, `PAYMENT_METHOD_DISABLED`, `CREDIT_NOT_ALLOWED`, `OPERATION_NOT_ALLOWED`, `POLICY_VIOLATION`                                                                                                                                                                                                                                                                                       |
| 404    | Addressed resource does not exist                                                                                                                  | `RESOURCE_NOT_FOUND`, `BARCODE_NOT_FOUND`, `INVENTORY_POSITION_NOT_FOUND`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 409    | Aggregate/state conflicts: version conflicts, duplicates, already-consumed operations, insufficient stock/balance families, workflow preconditions | `RESOURCE_VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `TENANT_PROVISIONING_INCOMPLETE`, `VARIANT_NOT_SELLABLE`, `INVENTORY_INSUFFICIENT`, `RESERVATION_*`, `ALLOCATION_INSUFFICIENT`, `TRANSFER_*`, `ORDER_INVALID_STATE`, `ORDER_MODIFICATION_NOT_ALLOWED`, `SALE_INVALID_STATE`, `SALE_ALREADY_COMPLETED`, `OFFLINE_VERIFICATION_REQUIRED`, `PAYMENT_ALREADY_COMPLETED`, `REFUND_AMOUNT_EXCEEDED`, `REFUND_DESTINATION_UNAVAILABLE`, `CREDIT_LIMIT_EXCEEDED`, `WALLET_BALANCE_INSUFFICIENT`, `CASH_*`, `RETURN_QUANTITY_EXCEEDED`, `RETURN_INSPECTION_REQUIRED`, `DELIVERY_INVALID_STATE`, `DELIVERY_RETRY_LIMIT_REACHED`, `OFFLINE_SEQUENCE_GAP`, `OFFLINE_OPERATION_DUPLICATE`, `OFFLINE_CONFLICT_*` |
| 422    | Well-formed request whose content violates business rules                                                                                          | `VALIDATION_FAILED`, `INVALID_UNIT_CONVERSION`, `PRICE_NOT_AVAILABLE`, `COUPON_INVALID`, `COUPON_EXPIRED`, `PROMOTION_NOT_APPLICABLE`, `RETURN_NOT_ELIGIBLE`, `RETURN_WINDOW_EXPIRED`, `OFFLINE_OPERATION_REJECTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 502    | Downstream provider unavailability/failure                                                                                                         | `DELIVERY_QUOTE_UNAVAILABLE`, `DELIVERY_PROVIDER_UNAVAILABLE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Note: `RESERVATION_EXPIRED` is 409 because it invalidates held state inside an
active reservation workflow, while `RETURN_WINDOW_EXPIRED` is an eligibility
rule over the submitted request (422).

## API envelope (`src/api.ts`)

Success:

```json
{ "data": { "id": "...", "version": 4 } }
```

List success (cursor-based):

```json
{
  "data": [],
  "page": { "nextCursor": null, "hasMore": false }
}
```

Error:

```json
{
  "error": {
    "code": "INVENTORY_INSUFFICIENT",
    "message": "Requested quantity is not available.",
    "details": {},
    "correlationId": "..."
  }
}
```

Rules:

- Adapters emit `ApiSuccess<T>` / `ApiPaginatedSuccess<TItem>` / `ApiErrorBody`
  (union: `ApiEnvelope<TData>`); HTTP status decides which half applies.
- Clients branch on `error.code`; `message` may change without notice.
- Pagination requests use `?limit=50&after=<cursor>`
  (`CursorPageRequest.after` mirrors the wire/query field; the schema coerces
  string query params, default limit 50, max 200). Modules produce
  `CursorPage<TItem>` internally; map it to the wire `page` field with
  `toPageInfo`.
- Correlation ids are branded (`CorrelationId`). Generation is strict (UUID),
  inbound acceptance is lenient so foreign gateway trace parents are preserved.

## Shared scalar schemas (`src/schemas.ts`)

- `uuidSchema`, `organizationIdSchema`, `branchIdSchema`, `warehouseIdSchema`
- `positiveIntSchema`
- `moneyAmountSchema` — decimal **string** only (`"1250.5000"`). Numbers are
  rejected by design: JSON floats lose precision and must never cross the
  boundary (see `61-dto-contracts.md`).
- `timestampSchema` — ISO 8601 UTC (`Z`) only, so ordering is canonical.

## Usage rules for modules

1. Throw `PlatformError` with a catalog code; never invent ad-hoc code strings.
2. Serialize errors only through `toApiError()` / the standard envelope.
3. Validate inbound DTOs with these zod schemas; do not re-declare local copies.
4. Adding a new code = update `62-error-codes.md` first, then this package
   (catalog size is pinned by unit test).
