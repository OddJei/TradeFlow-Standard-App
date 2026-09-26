# TradeFlow Standard — Operational Catalogue API

## Locked rule

TradeFlow's local shop catalogue is the operational truth for what the shop actually has, sells, prices, and can receive orders for.

NCPC is the canonical identity/enrichment layer. A missing, pending, stale, local-only, or incorrect NCPC mapping must not make a real active TradeFlow product disappear from general catalogue search, barcode lookup, item lookup, or order creation.

## Product identity

For multi-shop-safe integrations, the operational product key is:

```text
(shop_id, business_product_id)
```

NCPC IDs are optional metadata:

```text
identity.status
identity.linked
identity.ncpc_prd_id
identity.ncpc_var_id
```

Possible `identity.status` values include:

- `linked`
- `awaiting_ncpc_review`
- `local_only`
- `needs_link`
- `match_suggested`
- `link_stale`
- `link_error`
- `unlinked`

## Search actions

### `catalogue.search`

Searches active local products in the resolved shop by local name, aliases, variant, brand, category, SKU, and all barcodes. It can also filter by `business_product_id`, `barcode`, or `ncpc_variant_id`.

Exact local product ID and exact barcode matches rank highest. Local exact/starts-with name relevance ranks ahead of NCPC-link status.

Example:

```json
{
  "version": "v1",
  "action": "catalogue.search",
  "request_id": "anjoy-name-test",
  "api_token": "<configured token>",
  "data": {
    "shop_id": "shop-main",
    "query": "Anjoy"
  }
}
```

Exact barcode filter:

```json
{
  "version": "v1",
  "action": "catalogue.search",
  "request_id": "anjoy-barcode-search",
  "api_token": "<configured token>",
  "data": {
    "shop_id": "shop-main",
    "barcode": "6009644921652"
  }
}
```

### `catalogue.barcode`

Dedicated exact barcode lookup. It checks the local product's primary and alternate barcodes and returns the active TradeFlow product even when NCPC is pending or absent.

```json
{
  "version": "v1",
  "action": "catalogue.barcode",
  "request_id": "anjoy-barcode-item",
  "api_token": "<configured token>",
  "data": {
    "shop_id": "shop-main",
    "barcode": "6009644921652"
  }
}
```

### `catalogue.item`

Direct lookup by `business_product_id` or barcode. NCPC linkage is not required.

```json
{
  "version": "v1",
  "action": "catalogue.item",
  "request_id": "anjoy-item",
  "api_token": "<configured token>",
  "data": {
    "shop_id": "shop-main",
    "business_product_id": "1001"
  }
}
```

## Safe product response

General catalogue actions return safe operational fields only. Example:

```json
{
  "business_product_id": "1001",
  "shop_id": "shop-main",
  "identity": {
    "status": "awaiting_ncpc_review",
    "linked": false,
    "ncpc_prd_id": "",
    "ncpc_var_id": ""
  },
  "identity_status": "awaiting_ncpc_review",
  "catalogue_source": "tradeflow_local_catalogue",
  "name": "Anjoy Flavoured Drink",
  "category": "General Merchandise",
  "barcode": "6009644921652",
  "barcodes": ["6009644921652"],
  "selling_price": 1,
  "currency": "ZMW",
  "availability": {
    "status": "in_stock"
  }
}
```

The API does not expose cost price, supplier data, batch details, stock quantities, internal notes, spreadsheet IDs, or control-plane data.

## Ordering

`order.create` uses the TradeFlow `business_product_id` returned by catalogue search. NCPC IDs are not required.

This means a customer can order a real shop product while it is:

- awaiting NCPC review,
- local-only,
- not linked yet,
- or carrying a wrong NCPC mapping that the owner still needs to correct.

The order remains shop-scoped and uses `(shop_id, business_product_id)`.

## Canonical NCPC batch route remains strict

`find_items_by_ncpc_variants` is deliberately different from general operational catalogue search. It is a signed canonical-identity route and still returns only products explicitly published for Ntheemba through the NCPC mapping lifecycle.

Do not use that strict batch route as the only way to decide whether a shop has a product.

## Batch lookup

`catalogue.batch_lookup` resolves up to 50 local product references for one shop in one round trip. Each lookup returns its own status (`found`, `multiple_matches`, `not_found`, or `invalid_lookup`) so one bad row does not fail successful siblings.

Use it when a caller already has a list of barcodes/product IDs or needs to validate many basket lines efficiently. Do not mix shops in one batch.

## Batch customer-order ingestion

`order.create` remains the normal endpoint for **one customer order containing one or many product lines**.

`order.batch_create` is separate and accepts up to 20 independent customer orders for one shop. Every child order has its own idempotency key and can independently return `created`, `duplicate`, or `rejected`.

Both single and batch order creation create `requested` orders only. They do not reduce inventory until TradeFlow fulfilment.

## Formal API contract

See:

```text
Docs/API/TRADEFLOW_PUBLIC_API_V1.md
```

A root copy named `TRADEFLOW_PUBLIC_API_V1.md` is also included in the package for quick access. It documents every current action, request/response contract, best use case, error behavior, batch limit, privacy rule, and versioning rule.
