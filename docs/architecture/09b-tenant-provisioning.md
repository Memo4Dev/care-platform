# Tenant Provisioning Context

This context coordinates creation of a new tenant after signup/subscription activation.

## Responsibility

Provision:

- Organization shell
- initial Owner user
- default Branch when policy requires
- default Warehouse when policy requires
- default Units
- default Roles/Permissions
- default Policies
- Storefront shell if entitlement enables it
- initial subscription link

## Aggregate / Process Manager: TenantProvisioning

```text
Requested
→ CreatingOrganization
→ CreatingIdentityDefaults
→ CreatingBusinessDefaults
→ CreatingStorefront
→ Completed
```

Failure:

```text
ProvisioningFailed
```

## Commands

```text
StartTenantProvisioning
RetryTenantProvisioning
CompleteTenantProvisioning
FailTenantProvisioning
```

## Invariants

- Provisioning must be idempotent.
- Re-running provisioning must not create duplicate defaults.
- Each step records completion checkpoint.
- Failure does not leave an untraceable half-created tenant.
- Platform Tenant remains unavailable until mandatory provisioning completes.

## Events

```text
TenantProvisioningStarted
OrganizationProvisioned
IdentityDefaultsProvisioned
BusinessDefaultsProvisioned
StorefrontProvisioned
TenantProvisioningCompleted
TenantProvisioningFailed
```
