# POS Offline Sync API

Base path:

```text
/api/v1/pos/sync
```

This API is separate from normal POS transactional endpoints.

## Bootstrap

```text
GET /bootstrap
```

Returns:

```text
device identity
branch
sync checkpoint
catalog projection
pricing projection
customer subset
inventory projection
allocations
policies
```

## Push Operations

```text
POST /operations
```

Request:

```json
{
  "deviceId": "...",
  "lastCheckpoint": "...",
  "operations": [
    {
      "operationId": "...",
      "sequenceNumber": 1001,
      "occurredAt": "...",
      "operationType": "COMPLETE_OFFLINE_SALE",
      "aggregateId": "...",
      "payload": {}
    }
  ]
}
```

Response:

```json
{
  "accepted": [],
  "rejected": [],
  "conflicts": [],
  "newCheckpoint": "...",
  "projectionUpdates": []
}
```

## Pull Changes

```text
GET /changes?after=<checkpoint>
```

Returns compact projection changes only.

## Conflict detail

```text
GET /conflicts
GET /conflicts/{conflictId}
POST /conflicts/{conflictId}/resolve
```

Manager resolution command examples:

```text
TRANSFER_STOCK
PARTIAL_FULFILLMENT
CANCEL_SALE
APPROVE_WITH_ADJUSTMENT
```

## Sync invariants

- same OperationId is processed at most once
- per-device sequence is checked
- device must be active
- operation branch must match device branch
- original offline operation is never rewritten
- conflict resolution is a new command/event
- same-branch automatic recovery runs before escalation
