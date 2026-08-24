# Platform Management Context

This context is owned by the SaaS operator, not by tenant organizations.

## Responsibility

- manage tenant Organizations at platform level
- activate/suspend tenants
- platform-level metadata
- support access
- platform operational status
- organization lifecycle

## Aggregate: PlatformTenant

```text
PlatformTenant
├── TenantId
├── OrganizationId
├── Status
├── ProvisioningStatus
├── SubscriptionId
├── CreatedAt
└── SuspendedReason?
```

## Commands

```text
RegisterTenant
ActivateTenant
SuspendTenant
ReactivateTenant
CloseTenant
RequestSupportAccess
EndSupportAccess
```

## Invariants

- Platform Tenant identity is separate from business Organization profile.
- Suspending tenant must not delete its business history.
- Platform operators must not directly edit tenant business data through normal support flows.
- Support access must be explicit, time-bounded, reasoned, and audited.
- Platform-level actions require platform roles, not tenant roles.

## Events

```text
TenantRegistered
TenantActivated
TenantSuspended
TenantReactivated
TenantClosed
SupportAccessRequested
SupportAccessStarted
SupportAccessEnded
```
