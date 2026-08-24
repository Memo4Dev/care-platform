# Fulfillment Context

## Owns
- Fulfillment
- FulfillmentItem
- Fulfillment warehouse allocations
- PickTask
- Package

## Rules
- Organization defines Branch priority.
- Multi-warehouse fulfillment inside same Branch is allowed.
- Picking shortage searches another Warehouse in same Branch first.
- If one Branch cannot fulfill, system can recommend alternatives.
- Cross-branch split affecting customer deal goes to Sales resolution.
- Shipping cost does not belong here; Delivery owns it.
