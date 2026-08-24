# Pricing Context

## Owns
- PriceBook
- Price entries
- Promotion
- Coupon
- Tax/pricing rule outcomes

## Standard price types
- CASH
- WHOLESALE
- CREDIT
- ONLINE

## Price dimensions
Organization + Branch + Variant + Unit + PriceType + Channel + EffectiveDate

## Rules
- Branch prices may differ.
- Online price may differ from POS.
- Completed Order/Sale stores a price snapshot.
- Price override requires permission + reason + audit.
