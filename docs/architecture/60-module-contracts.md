# Module Contracts

Module contracts define what one bounded context may request from another.

They are not database repositories.

## Organization

Provides:

```text
GetOrganizationPolicy
GetBranch
GetWarehouse
GetBranchPriority
```

Consumes no tenant business state.

## Identity & Access

Provides:

```text
Authorize(action, organization, branch?, resource?)
GetEffectivePermissions
ValidatePOSDevice
```

## Catalog

Provides:

```text
GetProduct
GetVariant
ResolveBarcode
ConvertUnit
ValidateSellableVariant
```

## Pricing

Provides:

```text
GetPriceQuote
ValidateCoupon
EvaluatePromotion
CalculateTaxPricingResult
```

## Inventory

Provides:

```text
GetAvailability
CreateReservation
ReleaseReservation
ConsumeReservation
CreateAllocation
ConsumeAllocation
CreateTransfer
ReceiveStock
ConsumeStock
```

## Purchasing

Provides:

```text
CreatePurchaseOrder
ConfirmGoodsReceipt
```

Publishes stock receipt requests instead of directly editing Inventory tables.

## Customers

Provides:

```text
CreateBusinessCustomer
GetBusinessCustomer
SearchBusinessCustomers
```

Sales consumes only customer references/views, never Customer persistence.

## Cart

Provides:

```text
CreateCart
ModifyCart
ValidateCart
ConvertCart
```

## Orders

Provides:

```text
CreateOrder
ApproveOrder
RejectOrder
CancelOrder
ModifyOrder
```

## Sales

Provides:

```text
CreateSale
CompleteSale
CompleteSaleAfterPayment
GetSaleForReturn
IssueInvoice
```

## Fulfillment

Provides:

```text
CreateFulfillmentPlan
GetFulfillmentProposal
ApproveFulfillment
ReportPickingDiscrepancy
```

## Payments & Accounts

Provides:

```text
RequestPayment
RequestRefund
GetWalletBalance
GetCreditAccount
ConsumeCredit
ResolveRefundDestination
```

## Cash Management

Provides:

```text
OpenCashSession
RecordCashMovement
ReconcileCashSession
```

## Returns

Provides:

```text
RequestReturn
ApproveReturn
CompleteReturn
```

## Delivery

Provides:

```text
CreateDeliveryQuote
CreateDelivery
GetTracking
```

## Storefront

Provides public store configuration and publication views; it delegates commercial truth to Catalog/Pricing/Inventory.

## Offline Sync

Provides:

```text
BootstrapDevice
PushOperations
PullChanges
GetConflict
ResolveConflict
```

## Audit

Consumes events; does not participate in normal business decisions.

## Platform / Entitlements

Provides:

```text
GetTenantStatus
GetSubscriptionStatus
CanUseFeature
CheckLimit
GetLimitUsage
```

Business modules must ask capability codes, not inspect plan names.
