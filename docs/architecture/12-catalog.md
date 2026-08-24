# Catalog Context

## Owns
- Product
- Variant
- Category
- UnitDefinition
- Barcode metadata

## Rules
- Variant has stable identity.
- Barcode is optional.
- Barcode must be unique inside Organization when used.
- Variant has one Base Unit.
- Base Unit cannot change after inventory movement begins.
- Units/packages support conversions, e.g. Carton → Box → Piece.
- Conversion history must be versioned, not retroactively rewritten.

## Important events
ProductCreated
ProductUpdated
VariantAdded
VariantUpdated
VariantDiscontinued
UnitCreated
PackagingDefinitionCreated
