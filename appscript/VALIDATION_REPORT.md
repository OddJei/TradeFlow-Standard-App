# Validation Report — Standard TradeFlow Super Admin & First-Time Setup

Static validation completed on 2026-08-31 after aligning Standard TradeFlow with the Harvest business-owner Super Admin model.

## Parse / source validation

- `code copy.gs`: JavaScript syntax parse passed.
- `NtheembaMapping.gs`: JavaScript syntax parse passed.
- `LocationCatalogueFallback.gs`: JavaScript syntax parse passed.
- `sw.js`: JavaScript syntax parse passed.
- `Index copy.html`: all inline JavaScript blocks parsed successfully.
- New Super Admin / Multi-Shop browser RPCs checked: 17/17 have matching backend function definitions.
- Architecture/setup invariants: **75/75 passed**.

## Static invariants covered

- Business owner is `super_admin`; manager `admin` and `staff` accounts are each pinned to one assigned shop.
- Dedicated Super Admin and Multi-Shop screens are hidden and server-protected from ordinary Admin/Staff sessions.
- Super Admin owns shop lifecycle, primary-shop selection, account management, spreadsheet/system visibility, sessions, audit, migration, repair, import, and reset.
- Legacy local shop/staff creation handlers are disabled/rerouted so they cannot bypass the control plane.
- First-time setup is seven steps and creates 1–3 shop spreadsheets immediately.
- Every setup shop has its own embedded-Zambia canonical location and Monday–Sunday business hours.
- Embedded V5 retains all **407 town-specific Area suggestions** and **285 district locality hints** from the researched compact catalogue.
- Area is an editable autocomplete, not a closed dropdown; town-specific suggestions have priority, district locality hints provide fallback coverage, and arbitrary manual values remain accepted.
- The primary shop is explicitly selected.
- Setup asks which Standard modules are enabled; Reports remain included.
- NCPC is forced on; Ntheemba is deferred for later add-on configuration.
- Setup creates only the business-owner Super Admin account; Admin/Staff accounts are created afterward.
- One business Phone/WhatsApp line is shared across all shops.
- Fresh-browser login bootstrap reads central account/login policy so a configured business does not fall back to the legacy passwordless Admin shell.
- Control `Users`, `UserAssignments`, `Sessions`, `AuditLog`, `Shops`, and compatibility `StaffAssignments` are present.
- Shop switching, localStorage, IndexedDB queues, snapshots, mutations, and legacy compatibility APIs remain shop-routed.
- Existing unscoped IndexedDB sync queues have a one-time shop partition migration.
- Embedded V5 Zambia location data remains the only location source; no `NTHEEMBA_LOCATION_API_URL` runtime dependency exists.
- Public `shops.list`, `shop.get`, shop-aware `business.hours`, catalogue/product identity paths, orders, and handovers remain shop-scoped.
- Local public product identity remains `(shop_id, business_product_id)`.
- Reset remains two-stage with server challenge plus typed confirmation.
- Service-worker cache version is `tradeflow-standard-operational-catalogue-shell-v6`.

## Runtime validation still required

Static checks cannot prove Google Apps Script, Drive, Sheets, browser storage, or real deployment behavior. Before production rollout, validate in staging:

1. Fresh setup with exactly 1, 2, and 3 shops.
2. Province → District → Town picker plus Area autocomplete and address/landmark capture for every shop. Confirm Mufulira/Kitwe town suggestions, a district-fallback example such as Chilubi, and an arbitrary unlisted Area value.
3. Different opening hours for Shop A and Shop B, including closed days.
4. Explicit primary-shop selection and Super Admin default login into that shop.
5. New-browser Super Admin sign-in with no previous cache/session.
6. Super Admin shop switching while Shop A has pending offline operations.
7. Create a manager Admin assigned to Shop A; confirm it cannot see Multi-Shop/Super Admin or read/write Shop B even with a modified RPC request.
8. Create Staff assigned to Shop A; confirm Staff Tab Access and Shop B isolation.
9. Reassign Admin and Staff between shops; confirm old sessions are invalidated.
10. Deactivate/reactivate an account and deactivate/reactivate a shop; confirm inactive assignments cannot log in.
11. Super Admin system view: control sheet, all shop spreadsheet sources, sessions, audit, NCPC status.
12. Two-stage reset and repair/migration controls from Super Admin only.
13. Existing one-spreadsheet Standard installation migration with the legacy root preserved.
14. Same local product ID existing independently in two shops.
15. NCPC-linked and Awaiting Review product creation in two shops.
16. Ntheemba `shops.list`, `shop.get`, and `business.hours` returning the correct shop location/hours without exposing spreadsheet/control metadata.
17. Catalogue, order, order-status, and handover calls for two shops.
18. Barcode camera/capture runtime and multi-device synchronization after the new service-worker shell update.

## Embedded Area suggestion refinement validation — 2026-08-31

This package was revalidated after embedding the researched V5 Area layer.

- Embedded catalogue counts: **10 provinces / 116 districts / 131 towns-settlements / 407 town-specific Area suggestions / 285 district locality hints**.
- Embedded catalogue UI contract is `free_text_with_suggestions` with `allow_unlisted_area: true`.
- Backend `normalizeStandardLocationCatalogue_()` preserves town `areas`, district `locality_hints`, town aliases, release/coverage metadata, and suggestion priority.
- First-time setup and Multi-Shop both reuse the same canonical location picker, so both receive the Area autocomplete behavior.
- Town-specific suggestions are inserted before district fallback hints and are de-duplicated case-insensitively.
- Changing Province, District, or Town refreshes the Area datalist immediately.
- Saving still persists the user's Area text value; an Area does not have to match a suggestion.
- Mufulira static sample: 27 town-specific suggestions, including `Kalukanya`.
- Chilubi static fallback sample: no town-specific areas, then 3 district locality hints (`Chinkundu`, `Kanama`, `Mubemba`).
- `code copy.gs`, `NtheembaMapping.gs`, `LocationCatalogueFallback.gs`, and `sw.js` all pass JavaScript syntax parsing after this change.
- All current inline JavaScript blocks in `Index copy.html` pass syntax parsing after this change.
- The Area-suggestion build previously used the v5 shell; this package advances to `tradeflow-standard-cache-first-batch-api-shell-v7` so clients pick up the latest cache-first UI, shop-switcher, and batch-API changes.

## Operational local-product API validation — 2026-08-31

The package was revalidated after removing NCPC publication as a visibility gate for the general authenticated catalogue API.

- `catalogue.search` now reads active non-deleted products from the resolved shop regardless of NCPC status.
- `catalogue.item` resolves active products by `(shop_id, business_product_id)` or exact local barcode without requiring NCPC publication.
- New `catalogue.barcode` action resolves primary and alternate local barcodes exactly.
- `catalogue.categories` reflects active operational products, including local-only/pending rows.
- `order.create` order-line resolution uses the active local product catalogue, so NCPC IDs are not required.
- General product responses add `identity.status`, `identity.linked`, `identity_status`, `catalogue_source`, and the safe local `barcodes` list.
- Search ranking gives exact product ID/barcode and local name relevance priority; NCPC-linked state is only a low-weight tie-breaker.
- The signed `find_items_by_ncpc_variants` route still explicitly checks `_productIsPublicForNtheemba_()` and remains canonical/publication-gated.
- Mock integration validation passed for an `Anjoy Flavoured Drink` product in `AWAITING_NCPC_REVIEW` with `publicForNtheemba:false`: name search and barcode search both returned the local product.
- Mock validation passed for a `LOCAL_ONLY` product: dedicated barcode lookup, direct item lookup, categories, and order-line creation all succeeded without NCPC IDs.
- Inactive products remained excluded.
- `NtheembaMapping.gs`, `code copy.gs`, `LocationCatalogueFallback.gs`, `TradeFlowHelpContent.gs`, and `sw.js` pass JavaScript syntax parsing.
- All current inline JavaScript blocks in `Index copy.html` pass syntax parsing.

Runtime Apps Script deployment behavior still depends on the deployed source/version and Script Properties. This package does not claim that an older deployed `/exec` URL has been updated until these source files are deployed.


---

# Full cache-first / batch-API refinement validation — 31 Aug 2026

## Implemented surface

- Light content canvas / dark-header contrast correction.
- Harvest-style top Super Admin shop selector.
- IndexedDB cache-first/stale-while-revalidate handling for Multi-Shop, Super Admin, deployment URL, location catalogue, and shop-state-backed operational tab revisits.
- `catalogue.batch_lookup` (max 50 lookups, one shop, partial results).
- `order.batch_create` (max 20 independent orders, one shop, max 25 lines/order, child idempotency required).
- `order.create` preserved as one customer basket with one-or-many products.
- Complete `Docs/API/TRADEFLOW_PUBLIC_API_V1.md` contract manual.
- Service-worker application shell version bumped to `tradeflow-standard-cache-first-batch-api-shell-v7`.

## Static and mock checks — PASS

- **PASS:** `code copy.gs`, `NtheembaMapping.gs`, `LocationCatalogueFallback.gs`, `TradeFlowHelpContent.gs`, and `sw.js` parse as JavaScript.
- **PASS:** all 5 current inline JavaScript blocks in `Index copy.html` parse.
- **PASS:** top Super Admin shop-switcher markup/routing exists.
- **PASS:** IndexedDB shop/business cache helpers and v2 cache namespace exist.
- **PASS:** `catalogue.batch_lookup` and `order.batch_create` are both dispatched and implemented.
- **PASS:** limits remain 50 lookup rows / 20 child orders / 25 lines per order.
- **PASS:** batch child orders call the order builder without any batch-level idempotency fallback; every child therefore requires its own idempotency key.
- **PASS:** child `shop_id` is normalized and must match the one resolved batch shop.
- **PASS:** mock partial-result batch lookup returned two `found`, one `multiple_matches`, one `not_found`, and one `invalid_lookup` result without failing the batch.
- **PASS:** mock multi-customer order batch created two valid requested orders, rejected one bad product, preserved duplicate-idempotency behavior on retry, and left Anjoy stock unchanged at 72.
- **PASS:** no runtime source file contains `NTHEEMBA_LOCATION_API_URL`; shop setup remains embedded-location-only.
- **PASS:** service worker uses `tradeflow-standard-cache-first-batch-api-shell-v7`.

## Runtime boundary

Static/mock validation cannot prove deployed Apps Script/Drive/session behavior. After deployment, the remaining acceptance work is browser/runtime verification of cache refresh timing, Super Admin switching across two real shops, `order.create` idempotency, `order.status`, and the new batch actions against real shop data.

## 2026-09-01 API hardening + KPI validation

### Static/source validation
- `NtheembaMapping.gs`: JavaScript parse PASS.
- `code copy.gs`: JavaScript parse PASS.
- `TradeFlowHelpContent.gs`: JavaScript parse PASS.
- `LocationCatalogueFallback.gs`: JavaScript parse PASS.
- `Index copy.html`: all inline JavaScript parse PASS.
- Customer Order safe action argument fix remains present for Accept / Cancel / Fulfil.
- Service worker cache version bumped to `tradeflow-standard-cache-first-api-hardening-kpi-v8`.

### Security helper smoke tests
- Canonical order idempotency fingerprint is stable when object key order changes: PASS.
- HMAC-SHA256 signed request validates with correct business ID/secret: PASS.
- Reusing the same signed nonce is rejected as `REPLAY_DETECTED`: PASS.
- Configured write rate limit rejects the next request after the allowed window count and reports retry seconds: PASS.

### KPI source invariants
- Dashboard revenue/expense/COGS calculations use active-shop-scoped rows.
- Sales COGS includes POS Sale / Customer Order stock reductions only.
- Non-sale inventory cost loss is separated and deducted from Net Profit.
- Current-month Net Profit formula is `Revenue - Sales COGS - Operating Expenses - Inventory Loss`.
- Current-month Cash Flow formula is `Revenue - Cash Out`.
- Inventory Value uses remaining active-shop FIFO batch quantity at cost.
- Month-over-month uses actual current and immediately previous calendar month, with zero-filled months.
- Dead-stock age uses latest receipt or latest sale, not arbitrary manual stock correction.

### Runtime still required
The source is not considered deployed/production-proven until the Apps Script project is updated, a new deployment version is published, rate-limit behavior is checked against the deployment, signed-request mode is exercised with a configured signing secret, and the dashboard is visually reviewed with known test transactions.
