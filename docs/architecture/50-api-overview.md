# API & Application Use-Case Design

API design must expose use cases, not raw database tables.

Main API surfaces:

```text
/api/admin/*
/api/pos/*
/api/storefront/*
/api/mobile/*
/api/internal/*
/api/webhooks/*
```

Shared conventions:

- JSON over HTTPS
- versioned externally stable APIs
- tenant context derived from authenticated principal/domain, not blindly trusted body fields
- Idempotency-Key for retriable write operations
- optimistic concurrency via version / If-Match where useful
- cursor pagination for large datasets
- standard error envelope
- Correlation-Id on every request
