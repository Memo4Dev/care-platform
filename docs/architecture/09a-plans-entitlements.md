# Plans & Entitlements Context

This context answers:

> What features and limits may this Organization use?

Do not scatter checks such as:

```text
if plan == PRO
```

inside business modules.

Use EntitlementService / FeatureAccessService.

## Aggregate: Plan

```text
Plan
├── PlanId
├── Name
├── Status
├── Entitlements[]
└── Limits[]
```

## Example entitlements

```text
storefront.enabled
offline-pos.enabled
advanced-reports.enabled
delivery.external.enabled
custom-domain.enabled
multi-warehouse.enabled
```

## Example limits

```text
branches.max
users.max
pos-devices.max
warehouses.max
storefront-products.max
monthly-orders.max
```

## TenantEntitlementOverride

Platform Admin may temporarily override a plan entitlement.

```text
TenantEntitlementOverride
├── OrganizationId
├── EntitlementCode
├── Value
├── EffectiveFrom
├── EffectiveTo?
├── Reason
└── GrantedBy
```

## Commands

```text
CreatePlan
UpdatePlan
ActivatePlan
DeactivatePlan
SetPlanEntitlement
SetPlanLimit
GrantTenantEntitlementOverride
RevokeTenantEntitlementOverride
```

## Invariants

- Entitlements are evaluated by Organization + active Subscription + Plan + valid override.
- Overrides are explicit and audited.
- Business modules ask for capabilities, not plan names.
- Limit checks happen before creating constrained resources.

## Events

```text
PlanCreated
PlanUpdated
PlanActivated
PlanEntitlementChanged
TenantEntitlementOverrideGranted
TenantEntitlementOverrideRevoked
```
