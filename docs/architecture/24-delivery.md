# Delivery Context

## Owns
- Delivery
- DeliveryQuote
- DeliveryAttempt
- Tracking events
- ProofOfDelivery

## Methods
- Internal Delivery
- External Delivery

## Rules
- Delivery Context calculates shipping cost.
- Provider APIs sit behind adapters/ACL.
- Provider failure does not automatically fail Order.
- Retry/provider-switch behavior is policy-driven.
- Delivered state requires proof according to Organization Policy.
