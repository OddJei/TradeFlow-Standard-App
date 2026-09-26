# Standard TradeFlow NCPC mapping lifecycle

Scope: Standard TradeFlow only. This is a manual, owner/admin-only reference link. TradeFlow remains the tenant system of record for every local product, price, stock, cost, supplier, batch, description, policy, and financial record.

## Reconciled baseline

This contract is baselined from the active Standard TradeFlow root after the 2026-08-22 production-reference reconciliation:

- `apps/tradeflow/standard/appscript/code copy.gs`
- `apps/tradeflow/standard/appscript/Index copy.html`
- `apps/tradeflow/standard/appscript/NtheembaMapping.gs`
- `apps/central-catalogue/Apps Script/Code.gs` for approved NCPC release and candidate-search contracts

Do not baseline Standard TradeFlow or Ntheemba product lookup from `apps/ntheemba/appscript-bridge/Index copy.html` or `apps/ntheemba/appscript-bridge/code copy.gs`. Those bridge-folder files are deprecated embedded copies and are not active TradeFlow source roots.

## Prerequisite: an approved NCPC release export

NCPC v2 is not a live TradeFlow API. An admin first exports an NCPC v2 catalogue with `publishedOnly: true`, then uses **Products → NCPC → Load approved release export** to explicitly load that JSON for this TradeFlow business. The load is rejected unless it is `ncpc-2.0`, marked `publishedOnly`, has a catalogue version, names a published release version, and contains active published product variants. The local `NcpcPublishedCatalogue` Sheet is only a searchable ID-validation cache; it must never be used as inventory or pricing data.

## NCPC client boundary

Standard TradeFlow accesses NCPC identity through a replaceable local client boundary. The current Sprint-01 implementation is `LocalApprovedReleaseNcpcClient`, backed only by the explicitly loaded `NcpcPublishedCatalogue` Sheet.

The client surface is:

- `searchCandidates`
- `getVariant`
- `verifyVariant`
- `submitProduct`
- `getSubmissionStatus`
- `submitCorrection`
- `getCorrectionStatus`

For Sprint-01, `submitProduct`, `getSubmissionStatus`, `submitCorrection`, and `getCorrectionStatus` use a fake/local pending-review lifecycle. They create and check local submission/correction metadata only; they do not call a live NCPC service. Future clients may replace this fake behavior without changing Product UI workflows or TradeFlow business fact ownership.

## Owner lifecycle

1. An authenticated admin opens a local product’s **NCPC** action.
2. They search the locally loaded approved release and select one variant.
3. The server verifies that the selected `PRD-*` and `VAR-*` pair exists in that release, then records the local product ID, NCPC product/variant IDs, catalogue/release versions, link time, and linking admin. The optional **Public for Ntheemba** flag is false unless the admin enables it.
4. The admin may replace the link by selecting another approved variant; unpublish it (keeps the reference but removes Ntheemba visibility); or remove it entirely.

All mutations require a current server-issued admin session and run under a Script Lock. Client input cannot supply the persisted version, link time, linking user, or arbitrary local product fields.

## Add Product catalogue selection

The Add Product modal can search the same approved-release client explicitly through **Find in Catalogue**. Selecting a candidate may fill blank identity fields such as display name, variant/unit text, and barcode. The owner still enters or confirms category, product type, cost price, selling price, initial stock, and max stock.

Before Central Catalogue search, Add Product checks this business's own products for likely local duplicates. Same-barcode conflicts are blocked. Similar names are warning context only and never auto-link products.

Products added from a selected candidate store the candidate identity in `product.ncpcMapping` with `publicForNtheemba: false`. The mapping must not carry or overwrite TradeFlow price, stock, cost, supplier, batches, descriptions, sales, or policy data. A product may have multiple local barcodes in `product.barcodes`; `product.barcode` remains the primary mirror for backwards compatibility.

Candidate-backed Add Product creation is saved through the backend under a Script Lock. The backend verifies the candidate against the approved release and rejects duplicate active NCPC VAR links before creating the local product, initial batch, notification, or mapping. If verification fails, no linked product is created and `nextId` is not advanced.

When no correct match exists, the admin chooses **Enter Product Manually**. The backend creates a usable local TradeFlow product, creates the initial batch from owner-entered cost and selling price, stores `product.ncpcMapping.status = AWAITING_NCPC_REVIEW`, stores a fake/local `submissionId`, and keeps `publicForNtheemba: false`. Brand and variant/size are optional. The fake submission is idempotent by `submissionRequestId`, so a repeated request from the same Add Product modal returns the existing awaiting-review product instead of creating a duplicate.

## Products tab row actions

The Products tab renders each product row's NCPC action from the locally stored `product.ncpcMapping` state. Opening the Products tab must not search the approved-release cache, verify every row, or call a future NCPC service. The row action is only a status-aware entry point into manual mapping management.

Current row labels:

- `NEEDS_LINK`: **Find Match**
- `MATCH_SUGGESTED`: **Review Match**
- `LINKED`: **Linked**
- `AWAITING_NCPC_REVIEW`: **Awaiting Review**
- `LINK_STALE`: **Needs Attention**
- `LINK_ERROR`: **Link Problem**
- `LOCAL_ONLY`: **Local Only**

Candidate lookup remains an explicit admin action from **Search** or **Find in Catalogue**. Staff rows do not expose NCPC mapping actions, and server-side Apps Script mapping mutations still require an admin session.

## Products tab catalogue coverage

The Products tab also renders a **Central Catalogue** summary from local `AppState.products` and stored `product.ncpcMapping` states. It counts linked products, products that need linking or match review, products awaiting Central Catalogue review, stale/error links needing attention, and local-only products.

Coverage is calculated as:

```text
LINKED / (LINKED + NEEDS_LINK + MATCH_SUGGESTED + AWAITING_NCPC_REVIEW + LINK_STALE + LINK_ERROR)
```

`LOCAL_ONLY` products are shown separately but excluded from the denominator. Inactive or deleted products are excluded. Opening the Products tab and rendering this summary must not call candidate search, variant verification, mapping lookup, submission status checks, or live services.

## Identity corrections and multiple barcodes

Barcodes are opaque strings. TradeFlow trims accidental outer whitespace only; it must not parse, shorten, reformat, drop leading zeroes, or silently replace a blank/scanned barcode with a generated `TF...` value. `Generate TradeFlow Barcode` remains allowed only as an explicit owner action.

One local sellable product may have multiple physical barcodes for flavour, packaging, or manufacturer-run variations while sharing the same local price and stock. Duplicate barcode checks consider all active product barcodes in this business. POS, Products search, restock, inspection, adjustment, and public item lookup can match alternate barcodes.

For linked products, identity edits such as a corrected name, alias, barcode, brand, or variant can create a pending Central Catalogue correction proposal through the replaceable client. Correction proposals are idempotent by `correctionRequestId` and project to `NcpcCorrectionRequests`.

TradeFlow-owned values must not be submitted as Central Catalogue corrections: selling price, cost, stock, max stock, supplier, FIFO batches, margin, revenue, expenses, or business policy.

## Operational catalogue API and shop context

TradeFlow's authenticated general catalogue API treats the shop's own active product catalogue as the operational source of truth. NCPC linkage improves identity, but it does not decide whether a product exists, can be searched, can be found by barcode, or can be ordered.

Therefore `catalogue.search`, `catalogue.item`, `catalogue.barcode`, `catalogue.batch_lookup`, `catalogue.categories`, legacy `search_catalogue`, and legacy `get_item` can return any active non-deleted TradeFlow product in the resolved shop, including products that are:

- correctly linked to NCPC,
- awaiting NCPC review,
- explicitly local-only,
- not linked yet,
- carrying stale/error mapping metadata,
- or locally correct even when the owner linked the wrong NCPC identity.

Search is based on local TradeFlow product facts first: local name, local aliases when present, local variant/brand/category/SKU, and all local barcodes. Exact `business_product_id` and exact barcode matches rank highest; exact/starts-with local-name matches rank above NCPC-link status. NCPC linkage is only a small tie-breaker after local relevance and in-stock status.

Responses return `business_product_id`, `shop_id`, local display labels, all safe local barcodes, public selling price/currency, safe availability status, and additive `identity_status` / `identity.status` metadata. NCPC IDs are blank when unavailable. Private cost, supplier, batch details, stock quantities, internal notes, and financial/economic fields are not exposed.

Ordering uses `(shop_id, business_product_id)` and does not require `PRD-*` or `VAR-*`. This allows Ntheemba or another approved caller to order the actual local TradeFlow product even while NCPC review is pending or missing. The signed `find_items_by_ncpc_variants` batch contract remains a separate canonical-identity route and still enforces the explicit NCPC publication flag.

For multi-shop businesses, every public product/order route resolves `shop_id` through the control registry before opening a shop spreadsheet. `order.create`, `order.batch_create`, `order.status`, and `handover.create` require a concrete shop scope when more than one shop exists. Catalogue search/item/barcode/batch/category/NCPC-variant lookups are shop-routed and return the resolved shop context. Batch requests are one-shop-only. Because each shop has its own local ID sequence, callers must treat `(shop_id, business_product_id)` as the unique TradeFlow product identity.

## Product/NCPC help

Product and NCPC workflows expose contextual help through stable keys:

- `products.add`
- `products.find-ncpc`
- `products.link`
- `products.review-match`
- `products.submit-new`
- `products.submission-status`
- `products.change-link`
- `products.ncpc-status`

The Apps Script-readable bundle is `TradeFlowHelpContent.gs`, and the canonical human-readable articles live under `Docs/tradeflow/user-playbook/products/`. Help can open from the browser-local bundle without NCPC or backend access, and backend usage is available through `getHelpArticle(key)`. Help content must not include secrets, deployment IDs, spreadsheet IDs, private URLs, tenant data, or customer data.

## Data protection and rollback

Mapping writes change only `product.ncpcMapping`. They do not copy or overwrite local price, stock, cost, supplier, batches, descriptions, sales, or other private business fields. `NcpcProductMappings` is a readable projection of only the link/audit fields.

- **Unpublish rollback:** use **Unpublish** to retain the NCPC link but set `publicForNtheemba` to false for the canonical signed NCPC-variant batch route. This does **not** hide an otherwise active local product from the general operational catalogue API.
- **Remove rollback:** use **Remove mapping** to delete only the link; all local product workflow data remains intact.
- **Restore after a mistaken replacement:** select the previous variant again from the same approved release. The regular `AppState` recovery snapshot and dedicated workflow Sheets remain the recovery path for a broader accidental state change; no deployment or production spreadsheet change is made by this source update.

## Source change record

- `code copy.gs`: adds the `NcpcProductMappings` readable identity/submission projection.
- `NtheembaMapping.gs`: adds manual approved-release loading/search, a replaceable local NCPC client boundary, server-side pair validation, fake/local submission and status checks, locked admin mutations, unpublish, and removal.
- `NtheembaMapping.gs`: general authenticated catalogue search/item/category/order resolution uses active local shop products regardless of NCPC publication; adds exact `catalogue.barcode`, `catalogue.batch_lookup`, `order.batch_create`, and identity-status metadata while retaining strict publication on the separate signed NCPC-variant route.
- `Index copy.html`: adds the admin-only Product → NCPC mapping UI.
- `Index copy.html`: adds explicit Add Product catalogue selection while preserving local-only product creation.
- `Index copy.html`: renders Products-tab NCPC row actions from local mapping state only.
- `Index copy.html`: renders Products-tab Central Catalogue coverage from local mapping state only.
- `Index copy.html`: adds Product/NCPC contextual help buttons and local help modal fallback.
- `TradeFlowHelpContent.gs`: adds bundled Product/NCPC help articles and `getHelpArticle(key)`.
- `tests/atomic-product-mapping.test.mjs`: exercises duplicate VAR rejection and atomic candidate-backed product creation.
- `tests/ncpc-submission-contract.test.mjs`: exercises fake/local pending submission creation, repeated-submission idempotency, status checks, and business-field ownership.
- `tests/products-tab-ncpc-actions.test.mjs`: exercises Products-tab NCPC labels, local-only page rendering, explicit search, and staff/admin affordance boundaries.
- `tests/products-tab-ncpc-actions.test.mjs`: exercises local catalogue coverage calculation and rendering without NCPC RPC calls.
- `tests/tradeflow-help-content.test.mjs`: exercises required help keys, read-more playbook files, offline help fallback, backend `getHelpArticle` support, and concrete sensitive-pattern exclusions.
- `tests/ntheemba-ncpc-mapping.test.mjs`: exercises the mapping authorization and protected-field contract.
- This document: records the lifecycle and rollback behavior.

## Ntheemba boundary

Set `NTHEEMBA_API_TOKEN`, `NTHEEMBA_BUSINESS_ID`, and (for the batch contract) `NTHEEMBA_API_SIGNING_SECRET` in Script Properties only for an approved deployment. The Standard v1 public API accepts operational catalogue actions including `catalogue.search`, `catalogue.item`, `catalogue.barcode`, and `catalogue.batch_lookup`; the legacy `search_catalogue` and `get_item` actions use the same active local-product principle. These general catalogue routes require the configured tenant/API credentials but do not require NCPC publication. The separate signed `find_items_by_ncpc_variants` contract remains canonical-only and continues to require explicit `publicForNtheemba` publication. Each tenant must use its own Apps Script deployment, spreadsheet, and Script Properties; this source change does not create or migrate those tenant installations. It must remain an independent deployment/security review gate.


## TradeFlow public batch operations

The normal TradeFlow public API now has two separate batch concepts:

- `catalogue.batch_lookup` — up to 50 local product lookups for one shop, with per-lookup `found`, `multiple_matches`, `not_found`, or `invalid_lookup` status. This is an operational local-catalogue optimization and does not require NCPC.
- `order.batch_create` — up to 20 independent customer-order requests for one shop. Every child order has its own idempotency key and returns `created`, `duplicate`, or `rejected`. Each child may contain up to 25 local TradeFlow product lines.

`order.create` remains the preferred contract for one customer basket and already supports multiple product lines. `order.batch_create` exists only for several independent customers/orders in a single network round trip. Neither action deducts stock; created orders remain requested until TradeFlow fulfilment.

The formal contract, request/response schemas, limits, privacy rules, and best-use guidance are documented in `Docs/API/TRADEFLOW_PUBLIC_API_V1.md`.

## Batch NCPC-variant lookup contract

`doPost` additionally accepts the versioned action `find_items_by_ncpc_variants` when `contract_version` is exactly `tradeflow.ntheemba.find_items_by_ncpc_variants.v1`. It is a single bounded lookup (1–50 unique `VAR-*` IDs), never a catalogue search.

The request must contain the configured `api_token`, the exact configured `business_id`, the action, contract version, a Unix-millisecond `request_timestamp`, a one-time 16–128 character `request_nonce`, an HMAC-SHA-256 `request_signature`, and `data.ncpc_variant_ids`. The signature is Base64-encoded over `contract_version`, business ID, timestamp, nonce, and the comma-joined ordered variant IDs (each field separated by a newline), using `NTHEEMBA_API_SIGNING_SECRET`. The timestamp may differ from the server clock by at most five minutes; the nonce is consumed server-side before the lookup, so a captured request cannot be replayed. Authentication establishes the business identity from the deployment configuration; the caller cannot select another tenant by sending a different ID. Invalid credentials, missing/unknown business or signing configuration, malformed bodies, invalid signatures, stale/replayed requests, empty lists, duplicate IDs, invalid IDs, and oversized lists receive the same safe rejected response.

The response returns only mapped products where `publicForNtheemba === true`: `business_item_id`, NCPC product/variant IDs, `display_name`, `public_price`, availability, stock status, and the contract version. It does not return stock quantities, costs, suppliers, batches, notes, customers, or application state. Unmapped and unpublished mappings are omitted.

Every batch-action response has a server-generated `request_id`. `NtheembaApiAudit` receives a best-effort event for every batch-action success or rejection and records only request ID, time, action, outcome, requested-candidate count, and result count—never tokens, nonces, variant IDs, product data, or application state. Audit failure fails a successful lookup closed rather than returning unaudited data.

## Shop discovery API

The Standard v1 public API now exposes `shops.list` and `shop.get`. These return only safe shop identity and location fields (country, province, district, town, area, landmark/address details, catalogue version). Spreadsheet IDs, Drive URLs, staff records, costs, internal notes, and control-plane metadata are never public.

All Product/NCPC mutations from the TradeFlow UI now pass the active `shopId`; the backend resolves the authorized shop spreadsheet before reading or writing mappings, products, initial batches, correction requests, or pending submissions.

## Shop hours and owner/control-plane privacy

Standard TradeFlow has one business Phone/WhatsApp line shared across all shops, but each shop has its own weekly opening-hours schedule. `business.hours` resolves `shop_id` to the relevant shop spreadsheet and returns only that shop's public schedule.

Super Admin/control-plane information is private. `Users`, `UserAssignments`, `Sessions`, `AuditLog`, control spreadsheet IDs/URLs, shop spreadsheet IDs/URLs, repair/migration status, and account credentials are never exposed through Ntheemba public APIs.
