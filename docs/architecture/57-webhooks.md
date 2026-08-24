# External Webhooks & Provider Callbacks

Base path:

```text
/api/v1/webhooks
```

## Payment providers

```text
POST /payments/{provider}
```

Rules:

- verify provider signature before parsing business payload
- persist raw provider event identifier
- deduplicate by provider event/reference
- return success for already-processed valid duplicate
- never trust amount/reference without matching internal Payment

Flow:

```text
Provider Callback
→ Signature Verification
→ Inbox/Deduplication
→ Match Payment
→ Payment command
→ Outbox
```

## Delivery providers

```text
POST /delivery/{provider}
```

Flow:

```text
Provider status
→ verify
→ deduplicate
→ normalize through Anti-Corruption Layer
→ append DeliveryTrackingEvent
→ transition Delivery if valid
```

## Security

- separate webhook rate limits
- provider IP rules only as secondary controls
- signature/HMAC/certificate verification is primary
- log correlation/provider event IDs
- never expose internal stack traces
