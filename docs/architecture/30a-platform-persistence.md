# Platform SaaS Persistence

Recommended logical schemas:

```text
platform
subscription
entitlements
provisioning
```

## platform.tenants

```text
id
organization_id
status
provisioning_status
created_at
updated_at
version
```

`organization_id` uniquely maps platform tenant to business Organization.

## subscription.subscriptions

```text
id
organization_id
plan_id
status
billing_cycle
started_at
current_period_start
current_period_end
trial_ends_at
cancel_at_period_end
billing_provider
billing_provider_reference
version
```

Index:

```text
organization_id
status
current_period_end
```

## subscription.subscription_periods

Append-oriented historical periods:

```text
id
subscription_id
plan_id
period_start
period_end
status
amount
currency
billing_reference
```

## entitlements.plans

```text
id
code
name
status
created_at
updated_at
version
```

## entitlements.plan_entitlements

```text
plan_id
entitlement_code
value_json
```

## entitlements.tenant_overrides

```text
id
organization_id
entitlement_code
value_json
effective_from
effective_to
reason
granted_by
created_at
```

## provisioning.tenant_provisioning

```text
id
organization_id
status
current_step
checkpoints_json
last_error
started_at
completed_at
version
```

Provisioning records must be idempotent and resumable.
