# Organization & Configuration Context

## Owns
- Organization
- Branch
- Warehouse
- OrganizationPolicy

## Key rules
- Each Organization is fully isolated.
- Organization may contain multiple Branches.
- Branch may contain one or multiple Warehouses.
- Organization controls branch fulfillment priority.
- Policy changes are versioned and do not rewrite completed transactions.

## Key commands
CreateOrganization, ActivateOrganization, SuspendOrganization,
CreateBranch, ChangeBranchPriority,
CreateWarehouse, DeactivateWarehouse,
SetReturnPolicy, SetRefundPolicy, SetPurchasePolicy,
SetOrderApprovalPolicy, SetOfflinePolicy, SetCreditPolicy,
SetDeliveryPolicy, SetInventoryPolicy, SetCashSessionPolicy.

## Key events
OrganizationCreated, BranchCreated, WarehouseCreated,
OrganizationPolicyChanged, BranchPriorityChanged.

## Cash Session Policy

Organization policy controls cash session behavior:

```text
cashSession.requireReconciliationOnClose = true (default)
```

When set to false, mandatory cash count and reconciliation on session
close is disabled. Session close remains fully audited regardless of
this setting.
