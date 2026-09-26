# Standard TradeFlow Multi-Shop Refactor — 2026-08-31

## Locked decisions

- Standard supports 1–3 shops.
- The business-owner **Super Admin** has dedicated **Multi-Shop** and **Super Admin** tabs. Multi-Shop owns shop creation, switching, location/hours configuration, primary-shop selection, and activation/deactivation. Super Admin owns accounts/assignments, system sources, sessions, audit, repair/migration, and protected reset.
- The control spreadsheet owns the shop registry, Users, UserAssignments, Sessions, AuditLog, and legacy StaffAssignments compatibility data.
- Each shop spreadsheet owns its own operational state: products, barcodes, NCPC mappings, batches, stock, POS, customer orders, handovers, restock, adjustments, revenue, expenses, budget, notifications, staff credentials, and shop settings.
- Zambia location selection uses only the bundled V5 catalogue in `LocationCatalogueFallback.gs`; there is no runtime location URL. The embedded catalogue now includes the researched Area layer: 407 town-specific suggestions plus 285 district locality hints. Area remains free text with suggestions rather than a closed dropdown.
- Public product identity is `(shop_id, business_product_id)`.

## Public API changes

- Added `shops.list`.
- Added `shop.get`.
- `catalogue.search`, `catalogue.categories`, `catalogue.item`, and `catalogue.by_ncpc_variant` resolve a shop workspace before reading products.
- `order.create`, `order.status`, and `handover.create` require explicit `shop_id` when more than one shop is configured and persist to that shop workspace.
- Public product and handover responses include shop context.

## Browser isolation

- LocalStorage state is keyed by shop.
- IndexedDB sync queues are keyed by shop.
- Legacy unscoped queue entries are partitioned by their recorded shop ID before syncing.
- Shop switching loads `getSyncSnapshotForShop`; it no longer changes only `activeShopId` inside the existing state.

## Product / NCPC isolation

All mapping and product-identity mutations now include the active shop and resolve the authorized shop spreadsheet server-side before any read/write. NCPC-created initial batches are shop-stamped.

## Runtime validation still required

Static JavaScript parsing is included in this package validation. Before production rollout, test real Apps Script deployment behavior, control/shop spreadsheet creation, Drive permissions, shop switching with pending offline changes, staff reassignment/login, public API calls for two shops containing the same local product ID, barcode camera flow, and multi-device sync.

- Existing Standard installations that already have `AppState` but no control spreadsheet can use the Super Admin Multi-Shop upgrade action. It preserves the legacy root spreadsheet as recovery, creates the control/shop spreadsheets, copies shared product definitions, splits batches and operational history by recorded shop, and assigns unscoped legacy rows to the primary shop.

## 2026-08-31 Super Admin / setup refinement

- Business owner is the only `super_admin`, matching the Harvest ownership model.
- Added dedicated **Super Admin** navigation separate from **Multi-Shop**.
- Super Admin sees all shops, all Admin/Staff assignments, control/shop spreadsheet sources, recent sessions, recent audit events, architecture readiness, NCPC status, and protected maintenance.
- Super Admin creates ordinary Admin or Staff accounts after installation. Every ordinary Admin/Staff account is pinned to one shop and cannot switch to another shop.
- Destructive shop reset remains two-stage: server-generated challenge plus typed confirmation.
- Legacy Settings shop/staff creation handlers are disabled/rerouted so they cannot bypass the control plane.
- First-time setup is a seven-step wizard: Business Details → Shop Count → Shop Details/Hours → Primary Shop → Features → Super Admin → Review/Create.
- Setup creates 1–3 shop spreadsheets immediately, stores separate weekly hours per shop, uses one business Phone/WhatsApp line across shops, enables NCPC automatically, and does not configure Ntheemba.


## 2026-08-31 embedded Area suggestion refinement

- Rebuilt `LocationCatalogueFallback.gs` from the approved `zambia_location_catalogue_v5_compact.json` rather than the previous Province/District/Town-only projection.
- Backend catalogue normalization now preserves `town.areas`, `district.locality_hints`, town aliases, coverage metadata, and the V5 free-text-with-suggestions UI contract.
- Every canonical location picker used by first-time setup and Multi-Shop now renders Area / Compound / Township / Village as an editable autocomplete.
- Suggestion priority is: selected Town areas → selected District locality hints → manual user entry.
- Changing Province, District, or Town immediately refreshes the Area suggestion list.
- The exact compact V5 JSON used to generate the embedded source is included in this package for audit/update traceability.

## Operational catalogue fallback (2026-08-31)

- General catalogue search/item/barcode routes now read all active non-deleted products in the resolved shop, not only NCPC-published rows.
- Added exact `catalogue.barcode` lookup for primary/alternate local barcodes.
- `order.create` accepts the local `business_product_id` returned by those routes without requiring NCPC IDs.
- NCPC identity status is returned as metadata; the signed NCPC-variant batch route remains strict/canonical.
- Search ranking prioritizes exact local product/barcode/name relevance before NCPC-link status, preventing a wrong mapping from hiding the correct local row.

## 2026-08-31 cache-first UI + top shop switcher refinement

- Added a Harvest-style top-header active-shop selector for the business-owner Super Admin.
- The selector is business-wide, marks the primary shop, and switches the authoritative shop workspace rather than filtering one in-memory dataset.
- Ordinary Admin/Staff sessions do not receive cross-shop switching.
- Multi-Shop and Super Admin contexts are persisted in IndexedDB and render cache-first with background revalidation.
- Operational tabs continue to render from shop-scoped local state; navigation records tab/cache revision metadata in IndexedDB.
- Zambia location catalogue and deployment URL are cached in IndexedDB for faster repeat use.
- Background tab revalidation no longer triggers the blocking button/server progress treatment for navigation clicks.
- The shared content workspace uses a light surface so page headings and controls never lose contrast against the decorative navy body background.
