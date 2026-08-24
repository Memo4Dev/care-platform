# Implementation Task Template

Use this template for agent tasks.

## Goal

What business capability must be implemented?

## Context

Target bounded context:

```text
<Context>
```

Direct dependencies:

```text
<Context A>
<Context B>
```

## Architecture References

Load:

```text
<file list>
```

## Scope

In:
- ...

Out:
- ...

## Domain Rules

- ...

## API / Contract

- ...

## Persistence

- ...

## Security

- tenant scope
- permissions
- audit
- idempotency if needed

## Tests Required

```text
scenario IDs
```

## Acceptance Criteria

- [ ] behavior correct
- [ ] domain tests pass
- [ ] integration tests pass
- [ ] no cross-context persistence mutation
- [ ] migration safe
- [ ] docs updated
- [ ] quality gate passes

## Deliverable

- changed files
- test output
- migration notes
- risks/known gaps
