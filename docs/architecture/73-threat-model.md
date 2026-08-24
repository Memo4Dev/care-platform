# Threat Model

## Assets

High-value assets:

- organization data
- customer PII
- inventory quantities/cost
- sales/invoices
- wallet balances
- customer debt
- cash-register balances
- payment/refund operations
- provider credentials
- platform-admin functions
- audit history

## Main Threat Categories

### 1. Cross-Tenant Data Access

Threat:
Attacker manipulates IDs to access another organization.

Controls:

- tenant-aware repositories
- composite tenant constraints
- authorization
- negative isolation tests
- optional RLS

### 2. Broken Object-Level Authorization / IDOR

Threat:
Authorized user accesses a resource outside their branch/role scope.

Controls:

- resource-level authorization
- branch scope checks
- never rely only on UI hiding

### 3. Privilege Escalation

Threat:
User grants themselves manager/override rights.

Controls:

- permission-management permissions
- role-change audit
- prevent self-escalation unless explicitly allowed
- platform vs tenant role separation

### 4. Refund / Credit Fraud

Threat:
Employee abuses refund or credit override.

Controls:

- explicit override capabilities
- thresholds/policies
- reason required
- audit
- manager approval where configured
- anomaly reporting later

### 5. Inventory Manipulation

Threat:
Direct quantity changes hide theft/loss.

Controls:

- immutable Inventory Ledger
- Adjustment workflow
- approval/audit
- no direct stock edit endpoints

### 6. Cash Register Fraud

Threat:
Cashier modifies drawer balance or hides discrepancy.

Controls:

- append-only Cash Ledger
- session opening/closing
- reconciliation
- difference audit
- restricted adjustment permissions

### 7. Offline Replay / Duplicate Sales

Threat:
Device sends same offline sale multiple times.

Controls:

- OperationId
- per-device sequence
- server inbox/idempotency
- immutable sync result

### 8. Compromised POS Device

Threat:
Stolen/revoked device continues submitting operations.

Controls:

- device credentials
- credential rotation
- revocation
- last-seen monitoring
- device/branch binding
- encrypted local secrets
- minimal local data scope

### 9. Payment Webhook Spoofing

Threat:
Fake callback marks payment completed.

Controls:

- provider signature verification
- provider event deduplication
- reference/amount matching
- separate webhook authentication path

### 10. Delivery Webhook Spoofing

Controls mirror payment webhooks and use provider ACL normalization.

### 11. Injection

Controls:

- parameterized SQL
- strict DTO validation
- output encoding
- safe search/filter construction

### 12. XSS / Storefront Content Abuse

Threat:
Tenant-controlled product/store content injects script.

Controls:

- sanitize rich text
- escape output
- CSP
- restrict unsafe HTML

### 13. CSRF

Relevant when cookie authentication is used.

Controls:

- SameSite
- CSRF tokens for unsafe methods
- origin checks

### 14. Credential Stuffing / Brute Force

Controls:

- rate limiting
- login throttling
- MFA for privileged users
- suspicious-login monitoring

### 15. Platform Admin Compromise

High impact.

Controls:

- mandatory MFA
- stronger session policy
- hardware/security key support if possible
- separate platform domain/app
- support-session workflow
- detailed platform audit

### 16. Data Exfiltration through Reports/Exports

Controls:

- authorization on export
- tenant/branch scoping
- rate/size limits
- audit export generation
- signed expiring download links

### 17. Mass Assignment

Controls:

- explicit command DTOs
- never bind request directly to persistence/domain entity

### 18. Race Conditions

Threat:
Concurrent reservations/credits/refunds exceed limits.

Controls:

- DB transactions
- row locks
- optimistic concurrency
- unique/idempotency constraints

### 19. Event Replay / Duplicate Consumers

Controls:

- EventId
- Inbox
- idempotent handlers

### 20. Audit Tampering

Controls:

- append-only access
- restricted DB permissions
- optional hash chaining
- backup/archive controls
