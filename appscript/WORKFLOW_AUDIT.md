# TradeFlow workflow audit - 2026-07-18

## Fixed

- **First-run login dead end:** a blank spreadsheet has no `SafeConfig` sheet, so secure login could not start. The login screen now detects an uninitialized workspace and launches a first-time wizard that creates all workflow Sheets, stores the business profile, creates the admin credential, and returns the first authenticated admin session under a script lock.
- **Search focus loss:** filtering re-rendered the active Restock/Inspection search input after each keystroke. The search refresh now restores the matching input and its cursor position after rendering.
- **Supplier receipt duplication:** a pending receipt could be confirmed more than once, adding the full quantity to stock each time. Receipts now apply only the outstanding quantity, preserve prior receipt totals, and reject repeat or over-receipts.
- **Invalid receipt quantities:** received and damaged quantities could exceed the remaining ordered quantity. The app now requires non-negative whole numbers whose combined value is within the remaining quantity.
- **Offline sync loss during an in-flight request:** a save made while a sync request was running was erased when that request succeeded. The queue now acknowledges only the operations actually sent and immediately syncs later operations.
- **Portal credential corruption:** changing an existing portal password wrote the username and hash into the Portal and Username columns. It now writes the Username and Password Hash columns, leaving the portal identifier intact.
- **Product price propagation:** a product price edit now reprices stock still on hand, open-cart lines, and current expected-margin reporting. FIFO allocations keep completed-sale revenue and margin historical.
- **Restock sheet projection:** planned quantity and cost now use the order's `expectedQty` and `cost` fields, rather than exporting zeros.
- **Unauthenticated state access:** app state, sync, imports/resets, sheet repair, and credential updates now require a short-lived server-issued session token. Logout revokes the token; browser session information is stored in `sessionStorage`.
- **Credential exposure:** staff passwords are hashed before normal state persistence, legacy plaintext staff credentials migrate after a successful login, and password/PIN fields are removed from returned state.
- **Malformed sync/import data:** every state save now validates record-array types and sizes, product identity/price/stock fields, unique barcodes, batch quantities/costs, budget amounts, and receipt limits before the AppState or workflow Sheets are rewritten.
- **Destructive reset:** reset is no longer a browser-only pair of confirmation dialogs. A signed-in admin must request a one-time server reset challenge, type `RESET <business name>`, and submit the matching five-minute challenge token. The token is consumed before state is cleared, preventing replay.
- **Inspection count overage accounting:** when a physical shop inspection finds more stock than recorded, the app now adds the overage as a stock entry and records the adjustment audit row with a positive quantity and zero COGS, so inventory increases do not inflate consumed-cost reporting.
- **Sprint-01 review refinement:** Standard now preserves explicitly entered/scanned barcode values, supports additional exact barcodes, checks local duplicates before Central Catalogue search, records local NCPC correction proposals, supports explicit public local fallback, and attributes stock, POS, customer orders, restock records, and adjustments to a Standard shop context with a three-shop cap.
- **Responsive 2/4/6 card grids:** summary and product-card grids now use an explicit `ui-grid-246` utility so Products coverage, POS product cards, inspection cards, pending receipt metrics, product drilldown metrics, and financial summary cards keep two columns on phones, four on tablets, and six on wide screens.
- **Harvest-style Standard multi-shop setup:** first-time setup now asks for 1–3 shops, a primary shop, each shop's canonical Zambia location and opening hours, business features, and the business-owner Super Admin credential; it creates a control spreadsheet plus one separate shop spreadsheet per configured shop, stores central users/assignments/sessions/audit in the control plane, and uses per-shop sync APIs so each shop owns its own products, stock, orders, staff, and settings. Runtime creation and Script Properties still require owner staging review.

## Critical issue requiring an authorization design decision

The core state boundary is now authenticated. Staff sessions are additionally projected without financial, cost, portal, and credential data. Staff sync now carries its source view and is server-authorized per view: Products may change only catalogue labels/targets (not prices, batches, or stock history), while Budget may change only the active budget. The staff navigation is limited to those server-backed workflows. Financial, settings, credentials, ownership, stock-history, and restock-order writes remain admin-only.

## Verification performed

- Parsed all inline JavaScript in `Index copy.html` and `code copy.gs` with Node's VM parser.
- Exercised the receipt guard: a five-unit receipt creates one batch; a second five-unit confirmation is rejected and creates no additional batch.
- Verified the source-level sync acknowledgement and SafeConfig column mapping fixes.
- Tested price accounting: two historic units sold at 10 retain revenue 20, while eight unsold units reprice to 12 and produce expected revenue 116.
- Tested staff authorization: a permitted product edit updates the product label but preserves selling price, FIFO batch cost, and revenue; a budget edit cannot alter financial data.
- Tested server validation: a valid state is accepted; duplicate barcodes and receipts exceeding their ordered quantity are rejected.
- Parsed the client and Apps Script reset flow; verified that reset requires admin authorization, typed phrase, and one-time challenge token.
- Historical note: this audit originally parsed `CaptureRuntime.html` when it existed locally. That file is no longer active Apps Script source. Barcode scanning now uses `CAPTURE_RUNTIME_URL` from Script Properties, with the current approved Render runtime `https://nds-capture-runtime.onrender.com`; source for that runtime lives under `packages/capture-runtime/`.
- Verified Sprint-01 review-refinement local/source behavior with `tests/tradeflow-review-refinement.test.mjs`; deployed Apps Script runtime, live Sheet projection, real Script Properties, and camera behavior remain pending owner runtime review.
- Verified Products coverage source markup and CSS keep `ui-grid-246` out of the mobile one-column override with `tests/products-tab-ncpc-actions.test.mjs`.
- Re-parse current active Apps Script sources (`Index copy.html`, `code copy.gs`, `NtheembaMapping.gs`, and any bundled `.gs` helpers) after changes; verify every navigation feature has a renderer, every inline click handler resolves to a defined client function, expected Apps Script RPC functions exist, and the inspection overage branch records positive quantity without increasing COGS.

## Not covered in this session

No interactive browser was available, so camera capture, service-worker installation, offline/online recovery, and deployed Apps Script access were not runtime-tested. No deployment or client spreadsheet was changed.

## 2026-08-31 multi-shop routing hardening

- Added a first-class Admin **Multi-Shop** tab; the Settings shop editor is replaced by a link to this surface. No spreadsheet IDs are requested in the UI.
- Removed the runtime `NTHEEMBA_LOCATION_API_URL` dependency. `getStandardLocationCatalogue()` now serves only the bundled V5 catalogue.
- Control `Shops` rows append `Location JSON` without shifting legacy columns; existing installations can recover the location snapshot from each shop state until the new control column is saved.
- Shop creation/update/deactivation now run server-side against the control registry and real shop spreadsheets.
- Browser local state and IndexedDB sync queues are keyed by shop. Legacy unscoped queues are partitioned by recorded shop ID before syncing.
- Shop switching loads `getSyncSnapshotForShop` instead of changing `activeShopId` inside the old state.
- Product/NCPC mapping, linked-product creation, pending submissions, status checks, corrections, unpublish, and removal are routed to the authorized active shop spreadsheet. Initial NCPC-created batches are shop-stamped.
- Public `shops.list` and `shop.get` were added. Catalogue reads, orders, order status, and handovers are shop-routed. Public product responses carry `shop_id`; `(shop_id, business_product_id)` is the safe identity.
- Staff login resolves the staff assignment from the control spreadsheet before verifying credentials in that shop workspace. Multi-Shop staff reassignment moves the credential record between shop workspaces and updates the control assignment atomically under the Apps Script lock boundary. Deactivating/resetting a shop disables its active staff assignments.
- Current-shop Repair Sheets, report export, and reset operations are routed to the active shop spreadsheet.
- Static JavaScript parsing passed after these changes. Deployed Apps Script, real Drive/Sheets creation, camera behavior, and multi-device runtime still require staging validation.

- Existing Standard installations that already have `AppState` but no control spreadsheet can use the Super Admin Multi-Shop upgrade action. It preserves the legacy root spreadsheet as recovery, creates the control/shop spreadsheets, copies shared product definitions, splits batches and operational history by recorded shop, and assigns unscoped legacy rows to the primary shop.

## Super Admin / first-time setup audit — 2026-08-31

The Standard app now uses the Harvest ownership rule: the **business owner is Super Admin**. Manager `admin` and `staff` users are central control-plane accounts assigned to one shop. Server-side shop resolution prevents an assigned Admin/Staff session from requesting another shop even if a browser request is modified.

Super Admin-only controls now cover shop lifecycle, primary-shop selection, account creation/assignment/password reset/activation, system and spreadsheet source visibility, sessions, audit, migration, repair, import, and reset. Existing legacy browser handlers that could locally create shops or staff are disabled/rerouted to the new control plane.

The first-time wizard now asks the required installation questions instead of assuming them: business identity and shared contact line; 1–3 shops; canonical embedded Zambia location per shop; separate Monday–Sunday hours per shop; primary shop; enabled TradeFlow modules; and the owner Super Admin credential. Reports remain included, NCPC is automatic, and Ntheemba is explicitly deferred.

Static checks do not replace deployment testing. Staging must verify fresh 1/2/3-shop setup, owner Super Admin login/reload, manager Admin isolation, Staff isolation, shop switching, account reassignment, per-shop hours through `business.hours`, and protected maintenance.



## Embedded Area suggestion update — 2026-08-31

The Standard embedded V5 location catalogue now carries the researched Area/Compound/Township/Village layer, not only Province/District/Town. The browser uses town-specific `areas` first and district `locality_hints` second, with Area always remaining manually enterable. This behavior is shared by first-time setup and the Super Admin Multi-Shop editor.

## Operational catalogue API correction — 2026-08-31

The general authenticated catalogue boundary no longer uses NCPC publication as a visibility gate. Active local TradeFlow products are searchable by name/product ID/barcode and are orderable by `(shop_id, business_product_id)` even when NCPC is pending, local-only, missing, stale, or wrong. `catalogue.barcode` was added as an explicit exact-barcode route. The signed NCPC-variant batch contract remains the canonical-only exception.


---

## 2026-08-31 focused UI/API refinement pass

This pass intentionally preserves the established shop/source architecture and concentrates on observed UI latency, Super Admin shop context, public API throughput, and contract documentation.

### Implemented

- Operational tab navigation is cache-first from the selected shop's IndexedDB-backed state.
- Multi-Shop and Super Admin contexts persist business-scoped IndexedDB caches and use stale-while-revalidate refresh.
- Location catalogue loading uses its embedded/cache copy immediately and refreshes safely.
- The Super Admin header now carries the active-shop selector, modeled on the Harvest interaction pattern.
- The content canvas uses a light surface so section titles/subtitles and controls no longer lose contrast against the decorative navy application background.
- `catalogue.batch_lookup` resolves up to 50 local TradeFlow product references per shop with per-row `found`, `multiple_matches`, `not_found`, or `invalid_lookup` results.
- `order.create` remains one customer's basket and accepts multiple product lines.
- `order.batch_create` accepts up to 20 independent customer orders for one shop, requires a child idempotency key per order, and returns per-order created/duplicate/rejected results.
- All batch customer orders remain requests; stock is unchanged until TradeFlow fulfilment.
- A formal v1 API manual now documents every public action, payload, response schema, privacy boundary, error semantics, limits, and best-use case.

### Preserved invariants

- Active local TradeFlow products remain searchable/orderable independently of NCPC identity status.
- `(shop_id, business_product_id)` remains the operational product identity boundary.
- Batch requests may not mix shops.
- Existing per-shop IndexedDB sync queues remain isolated.
- Public catalogue responses do not expose cost price, internal batch cost, spreadsheet IDs, staff credentials, or control-plane secrets.
