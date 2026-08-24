# Subscription & Billing Context

This context manages SaaS commercial subscription state for each tenant.

## Owns

- Subscription
- BillingCycle
- SubscriptionStatus
- Trial
- Renewal state
- Billing invoices/receipts for SaaS subscription
- Failed renewal state

## Aggregate: Subscription

```text
Subscription
├── SubscriptionId
├── OrganizationId
├── PlanId
├── Status
├── BillingCycle
├── StartedAt
├── CurrentPeriodStart
├── CurrentPeriodEnd
├── TrialEndsAt?
├── CancelAtPeriodEnd
└── BillingProviderReference?
```

## Status

```text
TRIAL
ACTIVE
PAST_DUE
SUSPENDED
CANCELLED
EXPIRED
```

## Commands

```text
StartTrial
ActivateSubscription
ChangePlan
ScheduleCancellation
CancelSubscription
RenewSubscription
MarkPastDue
SuspendSubscription
ReactivateSubscription
ExtendTrial
```

## Invariants

- One active commercial subscription per Organization in v1.
- Subscription changes do not rewrite historical periods.
- Plan change records effective time.
- Failed billing may move subscription to PAST_DUE before suspension according to platform policy.
- Tenant business data is never deleted merely because subscription expires.
- Manual admin extensions/overrides are audited.

## Events

```text
TrialStarted
TrialExtended
SubscriptionActivated
SubscriptionPlanChanged
SubscriptionRenewed
SubscriptionPastDue
SubscriptionSuspended
SubscriptionReactivated
SubscriptionCancellationScheduled
SubscriptionCancelled
```
