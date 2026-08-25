# ADR-0007: Tenant Provisioning Execution Capability

Status: Accepted

## Context

Tenant provisioning creates privileged cross-context defaults. Caller-provided tenant, organization, owner, and trace values would permit confused-deputy and owner-substitution attacks. Retried workers can also race and diverge Platform completion from provisioning state.

## Decision

Platform registration persists the authoritative requested organization and verified owner identity snapshot. Only a trusted Platform registration principal/resolver may create that snapshot. Tenant Provisioning receives an opaque, server-issued, in-memory execution capability derived from the registration reference; it is tenant/provisioning scoped, short lived, correlation/audit bound, non-serializable, and invalid after terminal completion. The process derives all identity and tenant values from the snapshot.

Provisioning holds a PostgreSQL transaction-scoped advisory lock per tenant. Completion updates Platform and provisioning state in one database transaction and emits its provisioning outbox event in that transaction. Terminal provisioning records are immutable.

## Alternatives

- Accept public provisioning DTO fields: rejected; enables tenant/owner substitution.
- Use a generic SYSTEM principal: rejected; it is not least privilege or tenant scoped.
- Use only optimistic concurrency: rejected; it does not serialize external default creation.

## Consequences

Registration snapshots are retained as audit evidence. Execution capabilities cannot cross a request boundary; worker dispatch must use a trusted registration/provisioning reference to issue a fresh capability. Retried work is serialized and terminal completion cannot be changed to failure.
