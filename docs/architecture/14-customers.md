# Customers Context

## Owns
- BusinessCustomer
- OnlineCustomer
- Online customer addresses/profile

## Customer model
BusinessCustomer may be a person or company.
OnlineCustomer is logically separate from business/POS customer.

## Rules
- Online customer cannot buy on credit/debt.
- Business customer may use cash, wholesale or credit flows.
- Wallet/debt/loyalty live in Payments & Accounts, not here.
