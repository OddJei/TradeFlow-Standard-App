# TradeFlow Sheets workflow schema

`code copy.gs` keeps `AppState` as a recovery snapshot, then writes the same accepted state into the following readable operational tables. The app's **Repair/Create Sheets** action creates missing tables, repairs headers, and backfills them from the current snapshot.

In Standard multi-shop source mode, first-time setup creates a separate control spreadsheet plus one shop spreadsheet per configured shop. The control spreadsheet owns shop source metadata, central Users, Admin/Staff shop assignments, Sessions, legacy StaffAssignments compatibility rows, and AuditLog. Each shop spreadsheet owns that shop's `AppState`, products, stock, orders, staff, settings, and readable workflow projections.

| Workflow | Sheet | What it records |
| --- | --- | --- |
| Business setup | `BusinessProfile`, `BusinessSettings`, `Shops` | Business identity, configuration, up to three Standard shops, per-shop spreadsheet identity, per-shop config, and local Zambia location snapshots |
| Product and inventory | `Products`, `ProductBarcodes`, `InventoryBatches` | Product setup, primary and alternate barcodes, shop-attributed stock batches, costs, prices, and remaining quantities |
| Supplier stock receiving | `SupplierDeliveries` | Shop-attributed direct and inspection-count deliveries with quantity and supplier cost |
| Owner restocking | `RestockOrders`, `RestockOrderItems` | Shop-attributed planned purchases, actual quantities, costs, and receipt status |
| Stock corrections | `StockAdjustments` | Shop-attributed damage, expiry, missing stock, and count corrections |
| Point of sale | `POSSales`, `POSSaleItems` | Shop-attributed completed sale header, payment method, line items, and FIFO batch allocations |
| Customer order requests | `CustomerOrders`, `CustomerOrderItems` | API-created customer order requests, shop assignment where applicable, idempotency keys, public product snapshots, requested quantities, and totals |
| Customer handover requests | `HandoverRequests` | Shop-attributed API-created customer handover/contact requests, idempotency keys, source channel, private contact details for staff follow-up, and request reason |
| Financial visibility | `RevenueEntries`, `ExpenseEntries` | Daily revenue and business expenses |
| Planning | `BudgetHeader`, `BudgetItems` | Current restock budget and its planned items |
| People and configuration | `Staff`, `CustomUnits`, `Notifications` | Staff records, units, and app alerts |
| Catalogue identity | `NcpcProductMappings`, `NcpcCorrectionRequests` | Local product identity links, fake/local pending NCPC submission metadata, and fake/local correction proposals, without price, stock, cost, supplier, or batch columns |
| Audit | `SyncAudit` | Each accepted browser sync operation, once per operation ID |

## Operational behavior

- A normal browser save is accepted through `pushSyncOps`, deduplicated by operation ID, written to `AppState`, projected to the workflow tables, and recorded in `SyncAudit`.
- In multi-shop source mode, browser refresh/save uses `getSyncSnapshotForShop` and `pushSyncOpsForShop` so the active shop reads and writes its own shop spreadsheet. The legacy `getSyncSnapshot` and `pushSyncOps` paths remain for one-spreadsheet compatibility.
- POS checkout records the sale header, all sale lines, linked stock allocations, revenue entry, and notification in one browser-state change before it is queued for sync. The payment method currently defaults to `Cash`.
- Customer order requests are stored separately from POS sales. `order.create` records requested customer intent, snapshots public product identity and selling price, deduplicates by idempotency key, and does not deduct stock or create revenue.
- Customer handover requests are stored separately from orders and POS sales. `handover.create` records customer follow-up intent, deduplicates by idempotency key, and returns only a safe public handover ID/status/channel response.
- Customer Orders fulfilment is an online-only browser workflow. Users accept external requests, confirm final quantities, mark payment as Paid, and then fulfil. Fulfilment uses FIFO stock reduction and writes sale, revenue, stock adjustment, customer order status, and notification records.
- Legacy one-shop state is normalized into `shop-main` with no reset. New stock batches, POS sales, customer-order fulfilment, stock entries, adjustments, revenue, and expenses carry `shopId`/`shopName`; queued sync operations keep the originating shop in immutable action metadata.
- Standard Sprint-01 supports at most three shops. The fourth shop is rejected in the UI and server state validation. Inter-shop transfer accounting is deferred; stock movement between shops must not be faked by editing batches directly.
- First-time setup and the Multi-Shop tab use only the embedded V5 Zambia location catalogue. Province, District, and Town are dependent canonical dropdowns; Area/Compound/Township/Village is a free-text autocomplete backed by researched V5 suggestions (town areas first, then district locality hints), and address details remain manual inputs. Unlisted Area values are always allowed. There is no `NTHEEMBA_LOCATION_API_URL` or network lookup for shop setup.
- Standard setup supports one to three shops. Runtime setup creates a control spreadsheet and one separate shop spreadsheet per configured shop. The control `Shops` registry stores safe labels plus full `Location JSON`; spreadsheet IDs remain private runtime metadata and are never exposed by the public API.
- Manager Admin and Staff accounts are each assigned to exactly one shop. Login resolves the central control-plane user and assignment first, then reads/writes only that shop spreadsheet. The business-owner Super Admin is not shop-pinned and can switch across all active shops.
- `ProductBarcodes` is the readable projection of `product.barcodes`. `Products.Barcode` remains the primary barcode mirror for backwards compatibility. Empty barcodes are allowed, and `TF...` generation happens only through explicit user action.
- The workflow tables are snapshots of the current operational state. They should be edited through TradeFlow; direct sheet edits are not imported back into the browser state.
- `NcpcProductMappings` is a readable projection of `product.ncpcMapping`; linked and pending-submission rows are identity/audit metadata only and never become the authority for local selling price, cost, stock, supplier, or batch values.
- `NcpcCorrectionRequests` records fake/local pending correction proposals for identity fields such as barcode, alias, brand, name, or variant. TradeFlow-owned fields such as selling price, stock, cost, supplier, batches, revenue, expenses, and business policy are rejected before proposal storage.
- Repair/Create Sheets creates only this current workflow schema, plus `AppState` for recovery and `SafeConfig` for portal credentials. Deleted legacy tables such as `ProductMaster`, `SalesLog`, and `RestockProductLog` are not recreated.
- When `AppState` is absent, Repair/Create Sheets starts a clean app state and clears any queued browser sync so old local data cannot restore the deleted records.

## Multi-shop public boundary

- `shops.list` exposes active shop IDs, names, primary flag, and safe location snapshots.
- `shop.get` exposes one safe shop/location record.
- In a multi-shop business, order and handover creation require `shop_id`; catalogue reads are shop-routed and may default to the primary shop only when the caller does not specify one.
- A numeric/local `business_product_id` is only unique inside its shop workspace. Public callers must treat `(shop_id, business_product_id)` as the product identity.
- Browser localStorage and IndexedDB queues are shop-keyed. A one-time migration partitions the old unscoped queue by each operation's recorded shop before syncing.
- The Super Admin control plane can reassign Admin/Staff accounts between shops. Staff reassignment also moves the shop-state credential mirror and updates central assignment rows. Inactive shops can be reactivated, but the total Standard shop registry remains capped at three.

- Existing Standard installations that already have `AppState` but no control spreadsheet can use the Super Admin Multi-Shop upgrade action. It preserves the legacy root spreadsheet as recovery, creates the control/shop spreadsheets, copies shared product definitions, splits batches and operational history by recorded shop, and assigns unscoped legacy rows to the primary shop.

## Super Admin and first-time setup contract

The Standard control plane follows the Harvest role pattern with one additional manager role:

- **Super Admin** — the business owner. All shops and control-plane visibility.
- **Admin** — a manager assigned to exactly one shop.
- **Staff** — an employee assigned to exactly one shop and further constrained by Staff Tab Access.

The first-time wizard is an installation/bootstrap flow. It collects business name, owner/contact, shared Phone/WhatsApp, optional email, business type, 1–3 shop locations, each shop's weekly opening hours, the primary shop, enabled Standard modules, and the owner's Super Admin credential. It then creates the control spreadsheet and all selected shop spreadsheets immediately. Only the Super Admin account is created during bootstrap.

The control spreadsheet includes `Shops`, `Users`, `UserAssignments`, `Sessions`, `AuditLog`, and the backwards-compatible `StaffAssignments` table. Spreadsheet IDs and session/control metadata never cross the public Ntheemba API boundary.

NCPC is always enabled for Standard. Ntheemba is not configured during bootstrap and remains a later add-on. Each shop's business hours are shop-owned and `business.hours` resolves the requested shop before returning them.



---

## 2026-08-31 UI cache, shop switcher, and public batch API refinement

### Cache-first browser behavior

TradeFlow Standard now treats the selected shop's IndexedDB state mirror as the immediate rendering source for normal operational tabs. Business-wide Super Admin and Multi-Shop contexts use business-scoped persistent caches. Returning to a previously loaded tab must render without waiting for another blocking Apps Script round-trip; a background refresh may then replace stale cached content.

Required scope boundaries remain:

- shop state: `state:<shop_id>`
- shop sync queue: `syncQueue:<shop_id>`
- shop view/cache markers: shop-scoped
- Super Admin / Multi-Shop context: business-scoped

Changing shops invalidates the visual context immediately and must never display or flush another shop's data.

### Super Admin top shop context

The business-owner Super Admin has a Harvest-style shop selector in the application header. Selecting a shop changes the authoritative shop context, not just a UI filter. Products, POS, inventory, orders, restocking, revenue, expenses, dashboard, reports, browser cache, sync queue, and backend spreadsheet routing follow the selected shop. Single-shop Admin/Staff sessions remain pinned to their assignment.

### Public API batch contract

- `catalogue.batch_lookup`: up to 50 product lookups for one shop; partial-result semantics.
- `order.create`: exactly one customer order, containing one or many product lines (max 25).
- `order.batch_create`: up to 20 independent customer orders for one shop; every child order requires its own idempotency key and may contain up to 25 product lines.
- Batch order creation creates `requested` orders only and never deducts stock.
- Multi-shop callers submit one batch per shop.

The formal external contract is documented in `Docs/API/TRADEFLOW_PUBLIC_API_V1.md`.
