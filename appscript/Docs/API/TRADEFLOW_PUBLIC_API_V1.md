# TradeFlow Standard Public API v1

**Status:** implemented contract for TradeFlow Standard public boundary
**API name:** `tradeflow.standard.public`
**Contract version:** `v1`
**Primary purpose:** safe shop discovery, Ntheemba-facing product discovery, barcode lookup, customer-order requests, order status, and human-handover requests.

> TradeFlow remains operational without NCPC or Ntheemba, but this public API applies the Ntheemba catalogue-visibility policy. Internal TradeFlow products that are not eligible for Ntheemba visibility remain fully usable inside TradeFlow while appearing absent at this boundary.

---

## 1. Core rules

1. **TradeFlow's local shop catalogue is operational truth, but the public integration catalogue is a safe projection.**
   - `linked` products are visible only when the business explicitly publishes them for Ntheemba.
   - `awaiting_ncpc_review` products are provisionally visible within this same business and may have empty NCPC PRD/VAR IDs.
   - `local_only`, unsubmitted/unlinked, `needs_link`, `link_stale`, `link_error`, and `rejected` products remain operational inside TradeFlow but are hidden from Ntheemba-facing catalogue/order APIs.
   - A hidden product returns the same `PRODUCT_NOT_FOUND` behavior as an absent product so the public boundary does not leak private catalogue existence.

2. **Public product identity is shop-scoped.**
   - Treat `(shop_id, business_product_id)` as the stable TradeFlow product reference at the public boundary.
   - Local numeric/string product IDs may repeat between different shop spreadsheets.

3. **One `order.create` request represents one customer order.**
   - One order may contain **one or many product lines**.
   - Do not create one order per product when the products belong to the same customer basket.

4. **Order creation is non-destructive.**
   - `order.create` and `order.batch_create` create `requested` customer orders.
   - They do **not** reduce stock.
   - Stock moves only later through TradeFlow's acceptance/fulfilment workflow.

5. **Batch requests are one-shop requests.**
   - `catalogue.batch_lookup` resolves many product references for one shop.
   - `order.batch_create` ingests several independent customer orders for one shop.
   - A caller working with multiple shops must send one batch per shop.

6. **Public responses never expose private operational internals.**
   - No cost price, margins, batch costs, spreadsheet IDs, Drive URLs, passwords, API tokens, private staff information, or internal control-plane configuration in catalogue/order responses.

---

## 2. Base request envelope

Every v1 public request uses this envelope:

```json
{
  "version": "v1",
  "action": "catalogue.search",
  "request_id": "caller-generated-request-id",
  "api_token": "configured-token",
  "data": {}
}
```

### Fields

| Field | Required | Type | Notes |
|---|---:|---|---|
| `version` | yes | string | Must be `v1`. |
| `action` | yes | string | Public API action. |
| `request_id` | recommended | string | 1–128 chars; letters, digits, `_ . : -`. Echoed in the response. |
| `correlation_id` | no | string | Same safe character set; echoed when supplied. |
| `api_token` | yes except open actions | string | Application-level API credential. `health` is open. |
| `business_id` | no | string | Optional tenant assertion when configured. If supplied it must match the deployment. |
| `data` | action-dependent | object | Action-specific payload. |

### Maximum request body

`100,000` bytes for the public v1 envelope.

---

## 3. Standard success response

```json
{
  "ok": true,
  "version": "v1",
  "request_id": "caller-generated-request-id",
  "data": {}
}
```

When supplied, `correlation_id` is also returned.

---

## 4. Standard error response

```json
{
  "ok": false,
  "version": "v1",
  "request_id": "caller-generated-request-id",
  "error": {
    "code": "REQUEST_REJECTED",
    "message": "Request rejected."
  }
}
```

### Common top-level error codes

| Code | Meaning |
|---|---|
| `UNSUPPORTED_VERSION` | Request version is not supported. |
| `MISSING_ACTION` | No action supplied. |
| `UNKNOWN_ACTION` | Action does not exist. |
| `PAYLOAD_TOO_LARGE` | Request body exceeds the v1 public limit. |
| `INVALID_REQUEST_ID` | Request ID format is invalid. |
| `INVALID_CORRELATION_ID` | Correlation ID format is invalid. |
| `INVALID_DATA` | `data` is not an object. |
| `UNAUTHORIZED` | API token is missing/incorrect. |
| `TENANT_SCOPE_UNCONFIGURED` | Caller supplied a business ID but deployment is not configured for one. |
| `TENANT_MISMATCH` | Supplied business ID does not match the deployment. |
| `INVALID_BATCH_SIZE` | Batch contains zero items or exceeds its limit. |
| `INVALID_IDEMPOTENCY_KEY` | Order idempotency key is missing or malformed. |
| `INVALID_ORDER_ITEMS` | An order has zero product lines or exceeds the line limit. |
| `INVALID_ORDER_ITEM` | One order line is malformed or has an invalid quantity. |
| `INVALID_BARCODE` | Barcode value is missing or malformed for an exact barcode action. |
| `PRODUCT_NOT_FOUND` | No Ntheemba-visible product matched the requested product reference. Hidden TradeFlow-only products deliberately use the same result. |
| `MISSING_PRODUCT_REFERENCE` | Direct product lookup omitted both local product ID and barcode. |
| `MISSING_ORDER_REFERENCE` | Order status lookup omitted both order ID and idempotency key. |
| `ORDER_NOT_FOUND` | No customer order matched the supplied order reference in the selected shop. |
| `REQUEST_REJECTED` | Safe generic rejection for an invalid action-specific request. |

---

# 5. Shared public product schema

Catalogue actions return this safe product shape:

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
  "variant": "",
  "brand": "",
  "category": "General Merchandise",
  "unit": "sachet",
  "barcode": "6009644921652",
  "barcodes": ["6009644921652"],
  "product_type": "packed",
  "selling_price": 1,
  "currency": "ZMW",
  "availability": {
    "status": "in_stock"
  },
  "shop_availability": {
    "shop_id": "shop-main",
    "shop_name": "Main Shop",
    "status": "in_stock"
  }
}
```

### `identity_status`

The field describes product-identity quality/state. Visibility is separately guarded by the public projection. Public responses currently surface `linked` products that are explicitly published and `awaiting_ncpc_review` products provisionally. Other identity states can exist inside TradeFlow without appearing through this API.

Internal identity states may include:

- `linked`
- `awaiting_ncpc_review`
- `local_only`
- `needs_link`
- `match_suggested`
- `link_stale`
- `link_error`
- `rejected`
- `unlinked`

### Availability

Current v1 exposes a safe availability classification:

```json
{ "status": "in_stock" }
```

or:

```json
{ "status": "out_of_stock" }
```

The public product response intentionally does not expose batch costs or cost price.

---

# 6. `health`

## Purpose

Verify that the deployed TradeFlow public API is responding and discover supported batch limits/capabilities.

## Best use case

- deployment health check;
- integration startup check;
- automated diagnostics before catalogue/order calls.

## Authentication

No API token required.

## Request

```json
{
  "version": "v1",
  "action": "health",
  "request_id": "health-001",
  "data": {}
}
```

## Success response

```json
{
  "ok": true,
  "version": "v1",
  "request_id": "health-001",
  "data": {
    "status": "ok",
    "api": "tradeflow.standard.public",
    "version": "v1",
    "product": "TradeFlow",
    "edition": "Standard v1",
    "app_version": "...",
    "capabilities": {
      "local_catalogue_search": true,
      "barcode_lookup": true,
      "batch_catalogue_lookup": true,
      "customer_order_create": true,
      "batch_customer_order_create": true,
      "order_status": true
    },
    "limits": {
      "max_body_bytes": 100000,
      "max_batch_lookups": 50,
      "max_batch_orders": 20,
      "max_order_items": 25
    },
    "security": {
      "token_auth": true,
      "tenant_scope": true,
      "rate_limiting": true,
      "idempotency_payload_binding": true,
      "signed_requests_supported": true,
      "signed_requests_required": false
    }
  }
}
```

---

# 7. `business.profile`

## Purpose

Return safe public business identity/contact information and branch summaries.

## Best use case

- business-info screen;
- integration confirmation that the correct TradeFlow deployment is being called.

## Do not use for

- staff/admin discovery;
- spreadsheet/control information.

## Request

```json
{
  "version": "v1",
  "action": "business.profile",
  "request_id": "business-profile-001",
  "api_token": "...",
  "data": {}
}
```

## Response data

```json
{
  "business_name": "Example Business",
  "business_type": "retail_supermarket",
  "public_contact": {
    "whatsapp": "+260...",
    "address": "..."
  },
  "shops": [
    {
      "shop_id": "shop-main",
      "name": "Main Shop",
      "primary": true,
      "location": {}
    }
  ]
}
```

---

# 8. `shops.list`

## Purpose

Discover active/configured TradeFlow shop identities and safe location data.

## Best use case

- resolve `shop_id` before shop-specific catalogue/order calls;
- branch selector for an external client.

## Request

```json
{
  "version": "v1",
  "action": "shops.list",
  "request_id": "shops-001",
  "api_token": "...",
  "data": {}
}
```

## Response data

```json
{
  "shops": [
    {
      "shop_id": "shop-main",
      "name": "Main Shop",
      "primary": true,
      "location": {
        "country_id": "ZM",
        "country_name": "Zambia",
        "province_id": "...",
        "province_name": "Copperbelt",
        "district_id": "...",
        "district_name": "Mufulira",
        "town_id": "...",
        "town_name": "Mufulira",
        "town_other": "",
        "area": "Kantanshi",
        "landmark": "",
        "address_details": "",
        "catalogue_version": "5.0"
      }
    }
  ]
}
```

### Privacy rule

Never expose spreadsheet IDs/URLs, staff assignments, private notes, credentials, or control JSON from this public action.

---

# 9. `shop.get`

## Purpose

Get one shop's safe identity/location record.

## Best use case

- caller already knows `shop_id` and needs branch details.

## Request

```json
{
  "version": "v1",
  "action": "shop.get",
  "request_id": "shop-get-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main"
  }
}
```

## Response data

```json
{
  "shop": {
    "shop_id": "shop-main",
    "name": "Main Shop",
    "primary": true,
    "location": {}
  }
}
```

---

# 10. `business.hours`

## Purpose

Read opening hours for one shop.

## Best use case

- determine whether a shop is normally open on a given day;
- display branch hours.

## Request

```json
{
  "version": "v1",
  "action": "business.hours",
  "request_id": "hours-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main"
  }
}
```

## Response data

```json
{
  "shop_id": "shop-main",
  "hours": [
    { "day": "Monday", "open": "08:00", "close": "17:00", "closed": false }
  ]
}
```

---

# 11. `catalogue.search`

## Purpose

Search the customer-safe Ntheemba-facing projection of one TradeFlow shop catalogue.

## Best use case

- customer/user enters words such as `Anjoy`, `sugar`, `drink`;
- optional exact barcode or local TradeFlow product filtering;
- browse a small result set.

## Do not use when

- you already have dozens of exact references: use `catalogue.batch_lookup`;
- you have one exact scanner barcode: `catalogue.barcode` is clearer.

## Request fields

| Field | Required | Notes |
|---|---:|---|
| `shop_id` | required for multi-shop; recommended always | Public shop ID. |
| `query` | no | Text search, maximum 100 chars. |
| `business_product_id` | no | Exact local TradeFlow product ID. |
| `barcode` | no | Exact stored primary/alternate barcode. |
| `ncpc_variant_id` | no | Optional future identity filter; not required for normal TradeFlow lookup. |

At least one search/filter criterion is recommended. Empty criteria can return a small ranked catalogue slice.

## Example: name search

```json
{
  "version": "v1",
  "action": "catalogue.search",
  "request_id": "anjoy-search-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "query": "Anjoy"
  }
}
```

## Example response data

```json
{
  "shop_id": "shop-main",
  "items": [
    {
      "business_product_id": "1001",
      "shop_id": "shop-main",
      "identity_status": "awaiting_ncpc_review",
      "catalogue_source": "tradeflow_local_catalogue",
      "name": "Anjoy Flavoured Drink",
      "barcode": "6009644921652",
      "selling_price": 1,
      "currency": "ZMW",
      "availability": { "status": "in_stock" }
    }
  ]
}
```

### Result limit

Up to 12 products per search call.

---

# 12. `catalogue.barcode`

## Purpose

Exact barcode lookup against the Ntheemba-visible projection of the selected TradeFlow shop catalogue.

## Best use case

- barcode scanner;
- external client has one exact barcode and wants the shop's current product reference/price/availability.

## Request

```json
{
  "version": "v1",
  "action": "catalogue.barcode",
  "request_id": "barcode-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "barcode": "6009644921652"
  }
}
```

## Response data

```json
{
  "shop_id": "shop-main",
  "barcode": "6009644921652",
  "item": {
    "business_product_id": "1001",
    "name": "Anjoy Flavoured Drink",
    "barcode": "6009644921652",
    "selling_price": 1,
    "currency": "ZMW",
    "availability": { "status": "in_stock" }
  }
}
```

### Important

A review-pending product can match by exact barcode provisionally. Unsubmitted/local-only/rejected/private products remain hidden even when the exact barcode exists inside TradeFlow.

---

# 13. `catalogue.item`

## Purpose

Direct public product lookup when the caller already has the TradeFlow product ID or exact barcode. Hidden TradeFlow-only products are returned as `PRODUCT_NOT_FOUND`.

## Best use case

- refresh a known product before adding it to a basket/order;
- dereference `(shop_id, business_product_id)`.

## Request by ID

```json
{
  "version": "v1",
  "action": "catalogue.item",
  "request_id": "item-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "business_product_id": "1001"
  }
}
```

## Request by barcode

```json
{
  "version": "v1",
  "action": "catalogue.item",
  "request_id": "item-barcode-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "barcode": "6009644921652"
  }
}
```

## Response data

```json
{
  "shop_id": "shop-main",
  "item": { "...": "shared public product schema" }
}
```

---

# 14. `catalogue.categories`

## Purpose

List unique categories from Ntheemba-visible products in one shop.

## Best use case

- category navigation/filter UI.

## Request

```json
{
  "version": "v1",
  "action": "catalogue.categories",
  "request_id": "categories-001",
  "api_token": "...",
  "data": { "shop_id": "shop-main" }
}
```

## Response data

```json
{
  "shop_id": "shop-main",
  "categories": ["Beverages", "General Merchandise"]
}
```

---

# 15. `catalogue.batch_lookup`

## Purpose

Resolve many Ntheemba-visible TradeFlow product references in one network round trip.

## Best use case

- external client has a basket/list of many barcodes or local product IDs;
- bulk validation before building one customer order;
- connectivity-sensitive environments where repeated Apps Script round trips are expensive.

## Do not use for

- multi-shop mixed batches;
- one normal text search;
- cross-business discovery.

## Limit

Maximum **50 lookups** per request.

## Request

```json
{
  "version": "v1",
  "action": "catalogue.batch_lookup",
  "request_id": "batch-products-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "lookups": [
      {
        "lookup_id": "line-1",
        "barcode": "6009644921652"
      },
      {
        "lookup_id": "line-2",
        "business_product_id": "1017"
      },
      {
        "lookup_id": "line-3",
        "query": "Sugar"
      }
    ]
  }
}
```

### Lookup fields

Each lookup may contain:

- `lookup_id` — recommended correlation ID, unique within the batch;
- `business_product_id` — exact local product ID;
- `barcode` — exact primary/alternate barcode;
- `query` — text search, max 100 chars.

Criteria may be combined to narrow a result.

## Response data

```json
{
  "shop_id": "shop-main",
  "results": [
    {
      "lookup_id": "line-1",
      "status": "found",
      "items": [
        { "business_product_id": "1001", "name": "Anjoy Flavoured Drink" }
      ]
    },
    {
      "lookup_id": "line-2",
      "status": "not_found",
      "items": []
    },
    {
      "lookup_id": "line-3",
      "status": "multiple_matches",
      "items": ["..."]
    }
  ],
  "summary": {
    "requested": 3,
    "found": 1,
    "multiple_matches": 1,
    "not_found": 1,
    "invalid": 0
  },
  "limits": {
    "max_lookups": 50
  }
}
```

### Per-lookup statuses

| Status | Meaning |
|---|---|
| `found` | Exactly one match. |
| `multiple_matches` | More than one possible match. Caller should resolve/select. |
| `not_found` | No Ntheemba-visible product matched. Hidden TradeFlow-only products deliberately look absent. |
| `invalid_lookup` | That lookup row is malformed. Other rows still process. |

### Per-lookup errors

Possible safe codes include:

- `INVALID_LOOKUP_ID`
- `DUPLICATE_LOOKUP_ID`
- `MISSING_LOOKUP_CRITERIA`
- `QUERY_TOO_LONG`

A bad lookup row does not fail the whole batch.

---

# 16. `catalogue.by_ncpc_variant`

## Purpose

Future integration-specific lookup by canonical NCPC variant identity.

## Current environment note

NCPC is not live in the current TradeFlow-only acceptance environment. Do **not** use this action to judge whether normal TradeFlow product search works.

## Normal product discovery alternative

Use:

- `catalogue.search`
- `catalogue.barcode`
- `catalogue.item`
- `catalogue.batch_lookup`

Those work from TradeFlow's customer-safe Ntheemba-facing catalogue projection.

---

# 17. Shared order-line rules

A customer order line uses the local TradeFlow product identity:

```json
{
  "business_product_id": "1001",
  "quantity": 2
}
```

### Quantity rules

- numeric;
- greater than `0`;
- maximum `999` per line.

### Maximum product lines

Maximum **25 product lines per customer order**.

### Important

One customer order may contain multiple products. Example:

```json
"items": [
  { "business_product_id": "1001", "quantity": 2 },
  { "business_product_id": "1017", "quantity": 1 },
  { "business_product_id": "1042", "quantity": 3 }
]
```

---

# 18. `order.create`

## Purpose

Create one external customer order request for one shop.

## Best use case

- one customer has completed one basket containing one or many TradeFlow products.

## Do not use for

- several unrelated customers in one call: use `order.batch_create`;
- immediate stock deduction/sale settlement: fulfilment remains inside TradeFlow.

## Idempotency

Required.

`idempotency_key` must:

- be 8–128 chars;
- contain letters, digits, `_ . : -`;
- remain the same when retrying the same logical customer order.

A repeated key returns the existing order with `duplicate: true` rather than creating another order.

For orders created by the hardened implementation, the idempotency key is also bound to a fingerprint of the logical request (`shop_id`, customer identity fields, product IDs and quantities). Reusing the same key for different order content is rejected with `IDEMPOTENCY_KEY_REUSED` instead of silently returning the wrong order.

## Request

```json
{
  "version": "v1",
  "action": "order.create",
  "request_id": "order-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "idempotency_key": "customer-order-20260831-001",
    "customer": {
      "display_name": "TradeFlow API Review",
      "phone": "0970000000"
    },
    "items": [
      {
        "business_product_id": "1001",
        "quantity": 1
      }
    ]
  }
}
```

## Success response data

```json
{
  "order": {
    "order_id": "TF-ORDER-1003",
    "status": "requested",
    "created_at": "2026-08-31T14:31:47.928Z",
    "updated_at": "2026-08-31T14:31:47.928Z",
    "items": [
      {
        "business_product_id": "1001",
        "identity_status": "awaiting_ncpc_review",
        "name": "Anjoy Flavoured Drink",
        "quantity": 1,
        "selling_price": 1,
        "currency": "ZMW",
        "line_total": 1,
        "availability": { "status": "in_stock" },
        "shop_id": "shop-main",
        "shop_name": "Main Shop"
      }
    ],
    "totals": {
      "currency": "ZMW",
      "item_count": 1,
      "total": 1
    },
    "shop_id": "shop-main",
    "shop_name": "Main Shop"
  },
  "duplicate": false
}
```

## Retry response

Same logical order + same idempotency key:

```json
{
  "order": { "order_id": "TF-ORDER-1003", "status": "requested" },
  "duplicate": true
}
```

### Side effect

Adds a requested customer-order record to the target shop only.

### Does not

- reduce stock;
- create a completed POS sale;
- create fulfilled revenue;
- call NCPC.

---

# 19. `order.batch_create`

## Purpose

Submit several **independent customer orders** for one shop in one request.

## Best use case

- offline/queued gateway flush;
- marketplace/import adapter;
- accumulated customer requests after connectivity returns;
- server-to-TradeFlow integration that already has several complete customer baskets.

## Do not use when

- one customer has many products — use one `order.create` with many `items`;
- orders belong to different shops — send one batch per shop.

## Limits

- maximum **20 customer orders per batch**;
- maximum **25 product lines per child order**.

## Idempotency

Every child order requires its own `idempotency_key`.

The same key must not appear twice in the same batch.

## Request

```json
{
  "version": "v1",
  "action": "order.batch_create",
  "request_id": "batch-orders-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "orders": [
      {
        "idempotency_key": "customer-a-20260831-001",
        "customer": {
          "display_name": "Customer A",
          "phone": "0971111111"
        },
        "items": [
          { "business_product_id": "1001", "quantity": 2 }
        ]
      },
      {
        "idempotency_key": "customer-b-20260831-001",
        "customer": {
          "display_name": "Customer B",
          "phone": "0972222222"
        },
        "items": [
          { "business_product_id": "1001", "quantity": 1 },
          { "business_product_id": "1017", "quantity": 3 }
        ]
      }
    ]
  }
}
```

## Response data

```json
{
  "shop_id": "shop-main",
  "results": [
    {
      "index": 0,
      "idempotency_key": "customer-a-20260831-001",
      "status": "created",
      "order": {
        "order_id": "TF-ORDER-1010",
        "status": "requested"
      }
    },
    {
      "index": 1,
      "idempotency_key": "customer-b-20260831-001",
      "status": "duplicate",
      "order": {
        "order_id": "TF-ORDER-1008",
        "status": "requested"
      }
    }
  ],
  "summary": {
    "requested": 2,
    "created": 1,
    "duplicate": 1,
    "rejected": 0
  },
  "limits": {
    "max_orders": 20,
    "max_items_per_order": 25
  }
}
```

### Child statuses

| Status | Meaning |
|---|---|
| `created` | New requested order created. |
| `duplicate` | Existing order returned because its idempotency key already existed. |
| `rejected` | This child order failed validation. Other child orders continue. |

### Child error examples

- `SHOP_SCOPE_MISMATCH`
- `DUPLICATE_BATCH_IDEMPOTENCY_KEY`
- `INVALID_IDEMPOTENCY_KEY`
- `INVALID_ORDER_ITEMS`
- `REQUEST_REJECTED`

### Transaction behavior

The batch is processed under one TradeFlow script lock and successful newly created orders are saved together to the selected shop state. A malformed child order is reported as `rejected` without erasing successful siblings.

### Inventory behavior

Every created child remains `requested`. No inventory reduction happens during batch ingestion.

---

# 20. `order.status`

## Purpose

Retrieve a previously created customer order from the correct shop.

## Best use case

- check whether an external order is still requested, accepted, cancelled, or fulfilled;
- retry/reconciliation using an idempotency key.

## Request by order ID

```json
{
  "version": "v1",
  "action": "order.status",
  "request_id": "order-status-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "order_id": "TF-ORDER-1003"
  }
}
```

## Request by idempotency key

```json
{
  "version": "v1",
  "action": "order.status",
  "request_id": "order-status-002",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "idempotency_key": "customer-order-20260831-001"
  }
}
```

## Response data

```json
{
  "shop_id": "shop-main",
  "order": {
    "order_id": "TF-ORDER-1003",
    "status": "requested",
    "items": [],
    "totals": {}
  }
}
```

---

# 21. `handover.create`

## Purpose

Create a safe human-handover request for one shop.

## Best use case

- future automated channel decides a person should continue the conversation/process;
- customer explicitly asks for a human.

## Key behavior

- idempotent;
- shop-scoped;
- creates a requested handover record only.

## Request

```json
{
  "version": "v1",
  "action": "handover.create",
  "request_id": "handover-001",
  "api_token": "...",
  "data": {
    "shop_id": "shop-main",
    "idempotency_key": "handover-customer-001",
    "channel": "api",
    "reason": "Customer requested a person",
    "customer": {
      "display_name": "Customer",
      "phone": "097..."
    }
  }
}
```

---

# 22. Action selection guide

| Need | Use |
|---|---|
| Is TradeFlow API alive? | `health` |
| Confirm business identity | `business.profile` |
| Discover branches | `shops.list` |
| Get one branch/location | `shop.get` |
| Get shop opening hours | `business.hours` |
| Search words such as “Anjoy” or “sugar” | `catalogue.search` |
| One exact scanned barcode | `catalogue.barcode` |
| Caller already knows local TradeFlow product ID | `catalogue.item` |
| Resolve 2–50 known product references efficiently | `catalogue.batch_lookup` |
| Build category navigation | `catalogue.categories` |
| Future canonical NCPC variant lookup | `catalogue.by_ncpc_variant` |
| One customer basket, one or many products | `order.create` |
| Several independent customers/orders in one shop | `order.batch_create` |
| Check one previous order | `order.status` |
| Request human follow-up | `handover.create` |

---

# 23. Multi-shop rules

For a multi-shop Standard TradeFlow installation:

- callers should always supply `shop_id` for catalogue and order operations;
- `order.create`, `order.batch_create`, `order.status`, and handover operations are resolved against one shop spreadsheet;
- never assume that product ID `1001` in Shop A means the same product as `1001` in Shop B;
- use `(shop_id, business_product_id)`;
- batch APIs reject/mask attempts to mix shops in one batch.

---

# 24. Idempotency recommendations

Good keys:

```text
whatsapp-26097xxxxxxx-20260831-000123
checkout-session-41e83f
marketplace-order-778122
```

Bad keys:

```text
123
same-key-for-every-customer
```

Store the caller's idempotency key together with the external transaction/order reference and reuse it only for retries of the same logical order.

---

# 25. Public-data privacy matrix

| Data | Public API |
|---|---:|
| Product name | yes |
| Category/unit | yes |
| Selling price | yes |
| Public availability classification | yes |
| Barcode/alternate barcodes | yes |
| TradeFlow local product ID | yes |
| Safe NCPC identity metadata when present | yes |
| Cost price | **no** |
| Margin | **no** |
| Batch cost/FIFO layers | **no** |
| Supplier details | **no** |
| Spreadsheet ID/URL | **no** |
| Drive folder | **no** |
| Staff credentials | **no** |
| Staff private information | **no** |
| API tokens | **no** |
| Internal Super Admin control JSON | **no** |

---

# 26. Versioning policy

Within `v1`:

- existing field meanings should not be silently changed;
- existing required fields should not be removed;
- optional additive response fields are allowed;
- new actions such as batch actions can be added when they preserve v1 envelope/error semantics;
- incompatible payload/meaning changes require a version decision.

---

# 27. Confirmed TradeFlow-only acceptance example

The following local product behavior has been manually demonstrated against the deployed TradeFlow Standard API:

```text
Name: Anjoy Flavoured Drink
TradeFlow business_product_id: 1001
Shop: shop-main
Barcode: 6009644921652
Selling price: K1
Identity status: awaiting_ncpc_review
Catalogue source: tradeflow_local_catalogue
Availability: in_stock
```

The product was successfully returned through:

- `catalogue.search` by name;
- `catalogue.search` by barcode;
- `catalogue.barcode`;
- `catalogue.item` by TradeFlow product ID;
- `catalogue.item` by barcode.

A TradeFlow customer order was then created successfully as a `requested` order using the local `(shop_id, business_product_id)` reference. Stock remained available for fulfilment rather than being deducted at request creation.

This confirms the intended rule: **normal TradeFlow public product/order APIs do not depend on NCPC being live.**


---

# 27. Public API security hardening

## Active protections

The hardened Standard `v1` boundary applies the following controls before business services run:

1. **100 KB request-body cap**.
2. **Action/request/correlation/business-ID validation**.
3. **Configured token authentication** for every action except `health`.
4. **Tenant scope enforcement** against the configured `TRADEFLOW_BUSINESS_ID`.
5. **Short token-rotation window** through `TRADEFLOW_PUBLIC_API_TOKEN_PREVIOUS`.
6. **Per-caller fixed-window rate limiting** using Apps Script cache plus a script lock.
7. **Payload-bound idempotency** for `order.create`, child orders in `order.batch_create`, and `handover.create`.
8. **Optional HMAC-SHA256 request signing**, timestamp freshness, and one-time nonce replay protection.
9. **Script locks around order/handover writes**.
10. **Safe public error envelopes** without raw exceptions or secrets.
11. **Allowlisted response DTOs** so cost, FIFO layers, spreadsheet metadata, credentials, and other private state are not returned.
12. **Shop-scoped order/catalogue resolution** using `(shop_id, business_product_id)`.

## Default rate limits

Unless overridden in Script Properties:

| Group/action | Default |
|---|---:|
| `health` | 60 requests/minute |
| normal reads | 120 requests/minute |
| write actions | 30 requests/minute |
| `catalogue.batch_lookup` | 30 requests/minute |
| `order.batch_create` | 12 requests/minute |

A rejected rate-limited request returns:

```json
{
  "ok": false,
  "version": "v1",
  "request_id": "...",
  "error": {
    "code": "RATE_LIMITED",
    "message": "Request rejected.",
    "retry_after_seconds": 17
  }
}
```

The limiter is per authenticated caller token inside one TradeFlow deployment. `health` uses the anonymous deployment bucket because Apps Script does not expose a trustworthy client IP at this boundary.

## Signed-request mode

Signed mode is supported by the source but is only mandatory when:

```text
TRADEFLOW_PUBLIC_API_REQUIRE_SIGNATURE=true
```

The caller must send:

```json
{
  "business_id": "configured-business-id",
  "request_timestamp": 1788210000000,
  "request_nonce": "at-least-16-random-url-safe-chars",
  "request_signature": "base64-hmac-sha256..."
}
```

The signature material is:

```text
v1
<business_id>
<request_id>
<correlation_id or empty>
<action>
<request_timestamp epoch milliseconds>
<request_nonce>
<SHA256 hex of canonical data JSON>
```

The canonical `data` JSON recursively sorts object keys while preserving array order.

The server rejects:

- stale timestamps with `STALE_REQUEST`;
- invalid or reused nonces with `INVALID_NONCE` / `REPLAY_DETECTED`;
- bad signatures with `INVALID_SIGNATURE`;
- missing signing configuration with `SIGNING_NOT_CONFIGURED`.

For a retry of a write request, reuse the **same idempotency key**, but create a **fresh request ID, timestamp, nonce and signature**.

## Production token rule

Do not use short values such as staging/demo tokens in production. Generate independent high-entropy values for:

- `TRADEFLOW_PUBLIC_API_TOKEN`
- `TRADEFLOW_PUBLIC_API_SIGNING_SECRET`

Keep both only in Apps Script Script Properties and the approved calling service's secret store.
