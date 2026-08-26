# Offline Sync Context

## Owns
- LocalOperation
- Device sequence/checkpoint
- Sync queue state
- OfflineConflict

## Core rules
- Server is authority for shared state.
- POS local DB is an operational projection.
- OperationId is globally unique.
- Device sequence is monotonic per device.
- Sync processing is idempotent.
- Original offline operation is immutable.
- Allocation overflow can become OfflinePendingVerification.
- Same-branch automatic recovery is attempted first.
- Unresolved conflicts require Manager/Sales resolution.

## Offline POS Authentication

POS operator authentication (Employee Card/Barcode + PIN) must remain
compatible with offline operation. When the device is offline:

- Operator identity is verified against locally cached credentials.
- Authorization (RBAC, branch scope, POS permissions) uses the last
  synced permission snapshot.
- Cash Session operations (open/close/movements) queue locally and
  reconcile with the server on sync.
- Manager approvals (Manager Card + PIN) record both `performedBy`
  (active cashier) and `approvedBy` (manager) for later server audit.
