---
name: event-contracts
description: Version integration events with stable IDs, correlation/causation, additive compatibility, and data minimization.
---

# event-contracts

## Instructions

Version integration events with stable IDs, correlation/causation and additive compatibility.

## Envelope

Every integration event uses a single envelope structure with `eventScope`:
- `TENANT`: requires non-null `organizationId`
- `GLOBAL`: requires `organizationId: null`; only explicitly global platform-level events

Producers and consumers validate `eventScope` before publishing or handling.

## Compatibility Rules

- never silently change meaning of existing fields
- additive optional fields preferred
- breaking change → new eventVersion
- consumers must ignore unknown optional fields
- IDs remain stable

## Data Minimization

Integration events are ID-first/minimized by default.
Do not broadcast:
- email
- name
- phone
- unnecessary profile/PII

unless a specific approved event contract genuinely requires it.
Prefer IDs and authorized read models/contracts.

When PII is genuinely required:
- document the justification in the event contract
- limit to the minimum necessary fields
- add to the event contract review checklist

## Naming

Prefer `context.entity-action` format.

## Always

- Read `AGENTS.md`.
- Use the architecture routing index.
- Do not silently change architecture.
- Run relevant quality gates.
- Never push/merge without human approval.
