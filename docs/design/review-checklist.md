# Design Compliance Review Checklist

Process document for the mandatory **Design Compliance Review Gate** applied to every UI/frontend task.
This checklist governs how reviews are performed; it does not modify any approved design decision in this directory.

## Scope and inputs

- Applies to every task matching `design_review_gate.trigger_keywords` in `.agent-system/indexes/routing.yaml`.
- The reviewer MUST compare the implementation against:
  - `docs/design/DESIGN.md` (always)
  - only the task-relevant token/component/pattern files selected via `design_routing` topics in `routing.yaml`
  - the actual diff under review

## Verification items (all mandatory)

1. **Design token usage** — semantic roles from `docs/design/tokens/colors.md`; no raw color values in components.
2. **Typography consistency** — sizes, weights, leading and tracking per `docs/design/tokens/typography.md`.
3. **Spacing consistency** — 4px scale, component gaps, panel/page padding per `docs/design/tokens/spacing.md`.
4. **Radius/elevation consistency** — radius steps and `shadow-sm`/`shadow-md`/`shadow-lg` semantics per `docs/design/tokens/spacing.md`.
5. **Component reuse** — existing components and patterns reused; specs followed (`docs/design/components/`).
6. **Layout consistency** — shell dimensions, containers and alignment per `docs/design/tokens/spacing.md` and navigation spec.
7. **Responsive behavior** — 900px/620px behavior, table overflow strategy and hit-area minimums per `docs/design/patterns/responsive.md`.
8. **Accessibility** — visible focus rings, labeled controls, contrast-safe hover states, reduced-motion respect.
9. **Light/dark mode compatibility** — identical status semantics and pairing of every status color with a written label or icon in both themes.
10. **No hardcoded visual values** — arbitrary colors/sizes/motion values only when explicitly justified in the change description.

## Reject the change if it contains

- invented colors or raw/unmapped color values
- invented spacing scales or off-scale dimensions
- unnecessary new components duplicating existing ones
- inconsistent typography (sizes, weights, tracking)
- arbitrary shadows or radii
- duplicate patterns reimplementing an approved one
- inaccessible interactions (no focus visibility, unlabeled controls, motion without reduced-motion fallback)
- responsive regressions (broken narrow layouts, shrunken numeric columns, horizontal page overflow)

## Gate acceptance

The gate passes only when ALL of the following are true:

```text
functional tests pass
design compliance review passes (this checklist)
accessibility checks pass where relevant
```

A UI task cannot be accepted with any of these unmet.

## Design Gap policy

If the design system does not cover a required case:

- Mark it explicitly as `Design Gap: <summary>` in the review output.
- Do not silently invent a permanent new pattern; at most allow a narrowly scoped, justified interim deviation.
- Request a human design decision when the gap is material (new token, new component class, or new pattern).
