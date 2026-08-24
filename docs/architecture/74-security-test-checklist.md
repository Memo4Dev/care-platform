# Security Test Checklist

## Tenant Isolation

- cross-tenant GET
- cross-tenant PATCH
- cross-tenant nested resource reference
- cross-tenant branch ID injection
- cross-tenant warehouse ID injection
- cross-tenant customer ID injection

## Authorization

- user without branch access
- revoked role permission
- override without permission
- self-role escalation
- manager limited to selected branches
- POS user on wrong device/branch

## Authentication

- expired access token
- revoked refresh/session
- suspended account
- revoked POS device
- wrong token audience

## Offline Sync

- duplicate OperationId
- duplicate sequence
- sequence gap
- replay after device revocation
- operation branch mismatch
- conflict resolved twice
- forged actor metadata

## Inventory

- concurrent reservation race
- transfer double dispatch
- transfer double receive
- inventory adjustment without approval
- direct stock mutation endpoint does not exist

## Payments

- duplicate payment callback
- spoofed webhook signature
- refund greater than paid/refundable
- online customer attempts credit
- disabled payment method

## Wallet/Credit

- duplicate ledger reference
- negative wallet attempt
- credit over limit without override
- override without reason

## Cash

- movement after session closed
- duplicate cash payment event
- reconcile without count
- unauthorized cash adjustment

## Returns

- return same sold quantity twice
- return after window without override
- cross-customer return reference

## Web

- XSS in product/store fields
- CSRF on cookie-authenticated mutations
- unsafe file upload
- rate limit bypass
- export authorization

## Platform Admin

- tenant support without SupportSession
- expired SupportSession
- billing admin attempts tenant suspension
- platform support attempts entitlement override
- MFA/session controls
