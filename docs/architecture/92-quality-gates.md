# Quality Gates

A change cannot be considered production-ready only because it compiles.

## Pull Request Gate

Required:

```text
format/lint
typecheck
unit/domain tests
affected integration tests
API contract validation
migration validation
security/static checks
dependency checks
```

## Domain Change Gate

When a business rule changes, PR must include:

- updated domain tests
- updated Context documentation
- event/API contract review if affected
- migration plan if persistence changes
- backward compatibility assessment

## Database Gate

Reject migrations that casually:

- drop populated columns
- rewrite huge tables synchronously
- remove constraints before replacement
- change money precision unsafely
- mutate immutable ledger history

## API Gate

Breaking public contract changes require explicit version strategy.

## Design Compliance Gate

Mandatory for every UI/frontend task matching `design_review_gate.trigger_keywords` in `.agent-system/indexes/routing.yaml`. A UI task cannot be accepted unless:

- functional tests pass
- design compliance review passes (`docs/design/review-checklist.md`)
- accessibility checks pass where relevant

The reviewer compares the implementation against `docs/design/DESIGN.md` plus only the task-relevant token/component/pattern files selected via `design_routing` topics, and rejects invented colors, invented spacing scales, unnecessary new components, inconsistent typography, arbitrary shadows/radii, duplicate patterns, inaccessible interactions and responsive regressions.

If the design system does not cover a required case: mark a `Design Gap`, never silently invent a permanent new pattern, and request a human design decision when the gap is material.

## Security Gate

High-risk changes require targeted review:

```text
authentication
authorization
tenant isolation
payments/refunds
wallet/credit
cash
inventory adjustments
support impersonation
offline sync
file uploads
webhooks
```

## Performance Gate

Critical hot-path changes require benchmark/load comparison when they affect:

```text
product search
pricing
availability
reservation
sale completion
checkout
sync
reports
```
