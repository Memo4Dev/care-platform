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
