# Authorization Matrix

This file describes capability families. Exact role templates are organization-configurable.

## Platform Roles

| Capability | Platform Owner | Platform Support | Billing Admin |
|---|---:|---:|---:|
| tenant.view | ✅ | ✅ | ✅ |
| tenant.suspend | ✅ | ❌ | ❌ |
| subscription.change | ✅ | ❌ | ✅ |
| entitlement.override | ✅ | ❌ | ✅ |
| support.session | ✅ | ✅ | ❌ |
| platform.audit | ✅ | limited | limited |

## Tenant Role Templates

Suggested templates:

```text
Owner
Manager
Sales
Cashier
Warehouse
Purchasing
Delivery
```

These are templates, not hard-coded authorization.

## Capability Matrix

| Capability | Owner | Manager | Sales | Cashier | Warehouse | Purchasing |
|---|---:|---:|---:|---:|---:|---:|
| sales.create | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| sales.cancel | ✅ | ✅ | configurable | configurable | ❌ | ❌ |
| price.override | ✅ | configurable | configurable | ❌ | ❌ | ❌ |
| discount.override | ✅ | configurable | configurable | ❌ | ❌ | ❌ |
| order.approve | ✅ | ✅ | configurable | ❌ | ❌ | ❌ |
| refund.create | ✅ | ✅ | configurable | configurable | ❌ | ❌ |
| refund.override | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |
| inventory.view | ✅ | ✅ | configurable | configurable | ✅ | ✅ |
| inventory.create | ✅ | configurable | ❌ | ❌ | configurable | ❌ |
| inventory.adjust | ✅ | configurable | ❌ | ❌ | configurable | ❌ |
| inventory.transfer | ✅ | configurable | ❌ | ❌ | ✅ | ❌ |
| purchase.create | ✅ | configurable | ❌ | ❌ | ❌ | ✅ |
| purchase.approve | ✅ | configurable | ❌ | ❌ | ❌ | configurable |
| credit.use | ✅ | ✅ | configurable | configurable | ❌ | ❌ |
| credit.override | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |
| offline.resolve | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| cash.session.open | ✅ | ✅ | configurable | configurable | ❌ | ❌ |
| cash.reconcile | ✅ | configurable | ❌ | configurable | ❌ | ❌ |
| delivery.manage | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |
| users.manage | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |
| catalog.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| catalog.create | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| catalog.edit | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| catalog.delete | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |
| pricing.view | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| pricing.create | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |
| pricing.edit | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |
| pricing.delete | ✅ | configurable | ❌ | ❌ | ❌ | ❌ |

## Scope Evaluation

Final authorization:

```text
Permission allowed
AND Organization Policy allows action
AND Branch scope includes target Branch
AND Device scope is valid where relevant
AND Resource state allows command
```

## Override Rules

Any override must include:

```text
overridePermission
reason
actor
timestamp
originalRule
decision
correlationId
```
