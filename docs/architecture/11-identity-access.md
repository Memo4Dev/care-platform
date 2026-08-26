# Identity & Access Context

## Owns
- User
- Role
- Permission assignments
- BranchAccess
- POSDeviceIdentity

## Rules
- User belongs to one Organization.
- User may access one or multiple Branches.
- Role/permissions may differ per Branch.
- Authorization = organization policy + permission + resource scope.
- Override actions require explicit permission and audit.
- POS device is bound to a branch.

## POS Operator Authentication

POS quick operator authentication uses Employee Card/Barcode + PIN.

- Barcode/card alone is never sufficient for operator identification.
- Employee barcode/card identifiers must be opaque credential identifiers.
- Do not encode email, role, organizationId, or permissions in the card.
- Operator authentication is separate from authorization:
  after successful Card + PIN authentication, resolve current server-side RBAC,
  branch scope, and POS permissions. Authentication proves identity;
  authorization determines what the authenticated operator may do.

### Manager approval

Manager approval at POS may use Manager Card + PIN without replacing or
logging out the active cashier. Record both actors:

```text
performedBy = active cashier
approvedBy  = manager
```

## Important permissions
sales.create
sales.edit
sales.cancel
price.override
discount.override
refund.create
refund.override
inventory.adjust
inventory.transfer
purchase.approve
order.approve
credit.use
credit.override
offline.resolve
delivery.manage
