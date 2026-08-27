# Customers Context

## Owns

- BusinessCustomer
- OnlineCustomer
- Online customer addresses/profile

## M5 Sales baseline

M5 implements only the narrow BusinessCustomer capability required by POS Sales:

- customer type: `INDIVIDUAL` or `BUSINESS`
- create, get, and organization-scoped search
- reference the customer from a Cart or Sale

Customer is optional for a walk-in POS sale. Sales persists its customer
reference/snapshot facts but does not own Customer persistence. Addresses,
credit, loyalty, segmentation, customer ledgers, and CRM behavior remain outside
this baseline.

## Customer model

BusinessCustomer may be a person or company.
OnlineCustomer is logically separate from business/POS customer.

## Rules

- Online customer cannot buy on credit/debt.
- Business customer may use cash, wholesale or credit flows.
- Wallet/debt/loyalty live in Payments & Accounts, not here.
