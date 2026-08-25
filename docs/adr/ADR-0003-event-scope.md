# ADR-0003: Integration Event Scope

Status: Accepted

## Context

The integration envelope originally implied every event belonged to an
Organization. Plans are platform-global aggregates, while tenant overrides and
business aggregates are tenant-scoped. Consumers need an explicit, validated
distinction so a null organization ID cannot silently bypass tenant handling.

## Decision

Architecture-58 envelopes include `eventScope` with one of `TENANT` or
`GLOBAL`.

- `TENANT` requires a non-null `organizationId`.
- `GLOBAL` requires `organizationId: null`.

Producers validate the pairing before persisting an outbox record and consumers
validate it before handling one. Plan events are `GLOBAL`; tenant overrides and
existing tenant-context events are `TENANT`. The generic outbox continues to
store the complete envelope in its JSON payload. Envelopes are ID-first
integration contracts, not aggregate snapshots: producers allowlist only IDs,
codes, status/priority and event metadata required by consumers. Display names
and policy values remain in their owning context.

## Alternatives

- Make `organizationId` nullable without a scope: rejected because consumers
  could treat missing tenant IDs as an implicit global bypass.
- Put global plans under a synthetic organization: rejected because it breaks
  tenant isolation semantics and obscures aggregate ownership.
- Use separate global and tenant envelope formats: rejected because a single
  versioned integration contract is simpler for relays and consumers.

## Consequences

Consumers must not assume an organization ID exists. New event producers must
choose and validate scope explicitly. The additive field remains compatible
with consumers that safely ignore unknown optional fields, while tenant-aware
consumers fail closed on invalid scope/organization combinations.
