# DTO & Contract Design

DTOs are boundary objects. Domain entities are not returned directly.

## Common identifiers

```text
id
version
createdAt
updatedAt
```

## Money DTO

```json
{
  "amount": "1250.5000",
  "currency": "EGP"
}
```

Use strings for decimal serialization to avoid client floating-point loss.

## Quantity DTO

```json
{
  "quantity": "3.00000000",
  "unitId": "...",
  "baseQuantity": "600.00000000",
  "baseUnitId": "..."
}
```

## Resource reference

```json
{
  "id": "...",
  "number": "SALE-000123"
}
```

## PriceQuote request

```json
{
  "branchId": "...",
  "customer": {
    "type": "BUSINESS",
    "id": "..."
  },
  "channel": "POS",
  "priceType": "WHOLESALE",
  "items": [
    {
      "variantId": "...",
      "unitId": "...",
      "quantity": "2"
    }
  ],
  "couponCode": null
}
```

## PriceQuote response

```json
{
  "currency": "EGP",
  "items": [
    {
      "variantId": "...",
      "unitPrice": "100.0000",
      "discount": "0.0000",
      "tax": "14.0000",
      "lineTotal": "214.0000"
    }
  ],
  "subtotal": "200.0000",
  "discountTotal": "0.0000",
  "taxTotal": "28.0000",
  "grandTotal": "228.0000",
  "quoteVersion": "..."
}
```

## Availability response

```json
{
  "variantId": "...",
  "branchId": "...",
  "warehouses": [
    {
      "warehouseId": "...",
      "onHand": "10",
      "reserved": "2",
      "allocated": "3",
      "available": "5"
    }
  ]
}
```

## Mutation response

Prefer returning the updated resource state or command result:

```json
{
  "id": "...",
  "version": 4,
  "status": "APPROVED",
  "correlationId": "..."
}
```

Do not return ORM objects.
