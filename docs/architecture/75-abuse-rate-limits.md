# Abuse Prevention & Rate Limits

Rate limiting should be based on route risk, principal, tenant and IP where appropriate.

## High-risk endpoints

Stricter controls:

```text
login
password reset
payment creation
refund
webhooks
POS device registration
offline sync push
support session creation
exports
```

## Suggested dimensions

```text
IP
userId
deviceId
organizationId
onlineCustomerId
provider
```

Do not rely on IP-only controls.

## Business Abuse

Monitor patterns such as:

- repeated refund overrides
- frequent inventory adjustments
- unusual credit overrides
- excessive cash differences
- repeated offline allocation overflow
- large failed-login burst
- repeated provider callback failures

These are detection signals, not automatic proof of fraud.
