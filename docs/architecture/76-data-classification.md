# Data Classification & Privacy

Classify data before implementation.

## Public

- public Storefront product content
- public Store branding

## Internal Business

- product cost
- inventory levels
- branch operations
- internal notes

## Confidential

- customer contact details
- employee identity data
- supplier details
- credit/debt
- wallet balances
- sales financial details

## Highly Sensitive / Secrets

- passwords/password hashes
- access/refresh tokens
- provider API secrets
- webhook secrets
- encryption/signing keys
- payment credentials/tokens

## Rules

- highly sensitive secrets never appear in logs
- expose only fields required by each API
- Storefront never exposes internal cost/FIFO data
- POS receives only the local data scope required
- exports require authorization and audit
- retention/deletion must respect accounting/legal record requirements
