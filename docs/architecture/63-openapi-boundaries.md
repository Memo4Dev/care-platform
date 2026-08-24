# OpenAPI Boundaries

Do not produce one giant OpenAPI document for every client.

Recommended specs:

```text
openapi/platform-admin.yaml
openapi/admin.yaml
openapi/pos.yaml
openapi/storefront.yaml
openapi/sync.yaml
openapi/webhooks.yaml
```

## Why split them

- different authentication models
- different rate limits
- different consumers
- smaller agent context
- easier SDK generation
- easier security review
- public Storefront must not accidentally expose Admin operations

## Shared reusable schemas

Keep common boundary schemas in:

```text
openapi/components/common.yaml
```

Examples:

```text
Money
Quantity
Error
PageInfo
ResourceVersion
CorrelationId
```

## Versioning

Externally consumed APIs:

```text
/api/v1/...
```

Internal module contracts are versioned by code contract/event version rather than forcing HTTP versioning everywhere.

## Security boundaries

Platform Admin:
- platform staff authentication
- platform roles only

Tenant Admin:
- organization user
- organization/branch authorization

POS:
- user identity + registered device identity

Storefront:
- public anonymous read endpoints
- authenticated OnlineCustomer for account/order actions

Sync:
- registered device credential
- optional current user/session context for user-attributable operations

Webhooks:
- provider signature authentication
