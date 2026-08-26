# Security Architecture

## Goals

Protect:

- tenant isolation
- customer/business data
- inventory integrity
- payments and refunds
- cash custody
- offline POS operations
- subscription/platform administration
- audit integrity
- provider credentials
- user identities and sessions

## Trust Boundaries

```text
Internet
  ↓
Edge / API Gateway
  ↓
Application APIs
  ↓
Application Services
  ↓
Domain Modules
  ↓
Persistence

External Providers
  ↔ Payment Adapter
  ↔ Delivery Adapter

POS Device
  ↔ POS API
  ↔ Offline Sync API

Platform Admin
  ↔ Platform Admin API

Tenant Admin/User
  ↔ Tenant Admin API

Online Customer
  ↔ Storefront API
```

Every boundary must authenticate, authorize, validate input, and emit trace/audit metadata.

## Authentication Model

Separate principal types:

```text
PLATFORM_USER
ORGANIZATION_USER
ONLINE_CUSTOMER
POS_DEVICE
EXTERNAL_PROVIDER
SYSTEM_SERVICE
```

Never overload one credential model across all principal types.

## POS Operator Authentication

POS quick operator authentication uses Employee Card/Barcode + PIN:

- Barcode/card alone is never sufficient for operator identification.
- Employee barcode/card identifiers must be opaque credential identifiers.
  Do not encode email, role, organizationId, or permissions in the card.
- Authentication proves identity; authorization (server-side RBAC, branch scope,
  POS permissions) is resolved separately after successful authentication.
- Manager approval may use Manager Card + PIN without replacing or logging
  out the active cashier. Both actors are recorded:
  `performedBy = active cashier`, `approvedBy = manager`.
- POS authentication must remain compatible with offline operation.

## Session / Token Principles

- short-lived access tokens
- refresh/session rotation
- revocation support
- device/session binding where appropriate
- token audience restrictions
- platform-admin tokens cannot be accepted by tenant/public endpoints unless intentionally supported
- online-customer tokens cannot call admin APIs
- device credentials are separate from user credentials
- POS operator credentials (employee card + PIN) are separate from device credentials

## Secrets

Store externally from source code:

- DB credentials
- JWT signing keys
- provider API secrets
- webhook secrets
- encryption keys

Use a secret manager in production.

## Encryption

In transit:

```text
TLS everywhere
```

At rest:

- database/storage encryption
- encrypted backups
- secret-managed sensitive credentials

Highly sensitive application fields can use application-level encryption where justified.

## Security Headers / Web

For web surfaces:

- CSP
- HSTS
- X-Content-Type-Options
- Referrer-Policy
- secure cookies
- SameSite
- HttpOnly
- CSRF protection when cookie-authenticated state changes are used

## Input Handling

- schema validation at API boundary
- reject unknown dangerous fields where practical
- server derives tenant/user/device identity from authenticated context
- never trust organizationId/branchId from client without authorization validation
- parameterized SQL only
- upload validation for images/documents
- file MIME/type/size controls

## Logging

Never log:

- passwords
- full access/refresh tokens
- provider secrets
- raw card data
- sensitive authentication payloads

Use structured logging with:

```text
correlationId
organizationId
actorId
branchId?
deviceId?
resourceType
resourceId
```
