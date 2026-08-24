# Platform Admin API

This API is exclusively for SaaS operator staff.

Base path:

```text
/api/v1/platform
```

Platform roles are separate from tenant Organization roles.

## Tenants

```text
GET    /tenants
POST   /tenants
GET    /tenants/{tenantId}
POST   /tenants/{tenantId}/activate
POST   /tenants/{tenantId}/suspend
POST   /tenants/{tenantId}/reactivate
POST   /tenants/{tenantId}/close
```

Filters:

```text
status
plan
subscriptionStatus
createdFrom
createdTo
search
```

## Subscriptions

```text
GET    /subscriptions
GET    /subscriptions/{subscriptionId}
POST   /subscriptions/{subscriptionId}/change-plan
POST   /subscriptions/{subscriptionId}/extend-trial
POST   /subscriptions/{subscriptionId}/schedule-cancellation
POST   /subscriptions/{subscriptionId}/reactivate
```

## Plans

```text
GET    /plans
POST   /plans
GET    /plans/{planId}
PATCH  /plans/{planId}
PUT    /plans/{planId}/entitlements
PUT    /plans/{planId}/limits
```

## Tenant Overrides

```text
GET    /tenants/{tenantId}/entitlements
POST   /tenants/{tenantId}/entitlement-overrides
DELETE /tenants/{tenantId}/entitlement-overrides/{overrideId}
```

## Usage

```text
GET /tenants/{tenantId}/usage
GET /tenants/{tenantId}/health
GET /tenants/{tenantId}/sync-health
```

Typical usage metrics:

```text
branches
users
posDevices
warehouses
orders
sales
storefrontUsage
storage
offlineConflictCount
```

## Provisioning

```text
GET  /tenants/{tenantId}/provisioning
POST /tenants/{tenantId}/provisioning/retry
```

## Support Access / Impersonation

```text
POST   /tenants/{tenantId}/support-sessions
GET    /support-sessions/{sessionId}
DELETE /support-sessions/{sessionId}
```

Requirements:

```text
reason required
time limit required
platform permission required
full audit required
visible support-session identity
```

Support session must never silently masquerade as the tenant user.

## Platform Audit

```text
GET /audit
GET /security-events
```
