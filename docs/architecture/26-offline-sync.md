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
