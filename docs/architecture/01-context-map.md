# Context Map

Main Bounded Contexts:

```text
Organization
Identity & Access
Catalog
Pricing
Customers
Inventory
Purchasing
Cart
Orders
Sales
Fulfillment
Payments & Accounts
Cash Management
Returns
Delivery
Storefront
Offline Sync
Audit & Activity
```

High-level relationships:

```text
Catalog → Pricing → Cart → Orders → Fulfillment → Delivery
Catalog → Inventory ← Purchasing
Sales → Payments & Accounts → Cash Management
Returns → Inventory
Returns → Payments & Accounts
Storefront → Catalog/Pricing/Cart/Orders
Offline Sync → Sales/Inventory/Orders
Identity & Access → all protected operations
All important contexts → Audit & Activity
```

Important boundary rule:

```text
Context A must not directly mutate Context B persistence.
```

Use synchronous application interfaces for immediate decisions and events for downstream effects.


## SaaS Platform Contexts

```text
Platform Management
Subscription & Billing
Plans & Entitlements
Tenant Provisioning
```

Relationship:

```text
Plan → Subscription → Tenant Entitlements
                      ↓
                 Organization

Tenant Signup/Activation
        ↓
Tenant Provisioning
        ↓
Organization + Owner + defaults

Platform Admin
        ↓
Platform Management / Subscription / Entitlements
```

Tenant business modules query Entitlements by capability code when a subscription feature/limit matters.
