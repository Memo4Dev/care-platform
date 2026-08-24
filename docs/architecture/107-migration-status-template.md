# Migration Status Template

Track each legacy capability.

| Capability | Legacy Owner | Target Context | Read Migrated | Write Migrated | Reconciled | Legacy Disabled |
|---|---|---|---:|---:|---:|---:|
| Product | | Catalog | ❌ | ❌ | ❌ | ❌ |
| Pricing | | Pricing | ❌ | ❌ | ❌ | ❌ |
| Stock | | Inventory | ❌ | ❌ | ❌ | ❌ |
| Sales | | Sales | ❌ | ❌ | ❌ | ❌ |
| Payments | | Payments | ❌ | ❌ | ❌ | ❌ |

## Status values

```text
NOT_STARTED
DISCOVERY
SHADOW_READ
PARTIAL_WRITE
AUTHORITATIVE_NEW
RECONCILING
LEGACY_DISABLED
DONE
```

Every migration must have an owner and rollback/forward-fix plan.
