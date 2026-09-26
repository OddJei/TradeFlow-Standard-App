# TradeFlow Entrypack v2 Implementation Guide

## 1. Goal

Build one unified Apps Script web app that combines:

- MK Pub Hub transactional workflows.
- Deepseek operations workflows (inspection, budget, receiving, barcode UX).
- Local-first runtime (cache, queued writes, offline sync).
- Voice product search and voice-assisted entry.

Constraints:

- No supplier tracking entities.
- Cost tracking remains mandatory (unit cost, batch cost, COGS, margin).

## 2. UX and Design Direction

Use MK Pub n Grill design and layout patterns as the structural source of truth, while keeping Entrypack color palette tokens.

### 2.1 Layout and Interaction Source (authoritative)

Primary layout must follow MK Pub n Grill patterns:

- Single app shell with clear Staff and Admin portal bodies.
- Dock-style navigation behavior and portal-mode body class switching.
- Card and table mix used by sales, restock, logs, and admin hub sections.
- Row-level edit mode patterns for log and master data tables.
- Modal and toast behavior consistent with MK flow.
- Venue-aware gating and action guards where required.

### 2.2 Color Palette Source (authoritative)

Keep Entrypack palette tokens as the visual base:

- --navy: #071a33
- --navy-2: #0b2a48
- --emerald: #1c8f68
- --emerald-2: #3ec18e
- --gold: #d9a441
- --sun: #f2d16b
- --copper: #b76132
- --clay: #883f2d
- --ink: #11151d
- --paper: #fffaf0
- --surface: rgba(255, 250, 240, 0.82)
- --line: rgba(7, 26, 51, 0.14)
- --danger: #b42318
- --success: #087443
- Accent signals: --neon-red: #ff2a4a, --neon-blue: #2a7bff

### 2.3 Style Rule for v2

If layout and color choices conflict:

- Layout, spacing, component structure, and motion come from MK Pub n Grill.
- Color, tone, and brand atmosphere come from Entrypack palette.

## 3. Functional Modules (Single App)

### 3.1 Authentication and Portal

- Portal gate on/off from metadata.
- Staff/Admin credentials with session persistence.
- Venue scoping support where applicable.

### 3.2 Product Catalog and Inventory

- Product master with category, UOM, selling price, and cost fields.
- Batch-aware stock and valuation.
- Low-stock detection from reorder level.

### 3.3 Sales and Tabs

- Direct sales with stock validation.
- Open tab, add tab lines, close tab into sales log.
- Same-day row editing for corrections.

### 3.4 Restock and Cost Tracking (No Supplier Tracking)

- Restock form captures SKU, quantity, unit cost, optional pack config.
- Writes RestockLog and updates stock.
- Maintains cost history per SKU.
- Computes COGS (FIFO preferred) and margin impact.

### 3.5 Inspection, Budget, and Receiving

- Physical stock inspection and variance adjustment.
- Auto restock suggestion (target minus physical).
- Add lines into budget builder.
- Checkout creates pending order.
- Receiving confirms received/damaged and adds new batches.

### 3.6 Dashboard and Ledger

- Daily ledger snapshots and trend charts.
- Revenue, stock value, margin, low-stock, open tabs.
- Scope by venue and period.

### 3.7 Offline Runtime

- Cache-first reads.
- Queue-first writes with optimistic UI.
- Reconnect replay FIFO.
- Conflict handling and retry panel.
- Backup/export of local state.

### 3.8 Barcode Scanning and Barcode Utilities

- Scan via camera to find/select SKU.
- Scan support in add product, sell, restock, inspection.
- Barcode generate and SVG/PNG export utility.

### 3.9 Voice Product Search and Entry

- Speech-to-text trigger on product search fields.
- Transcript normalization and SKU matching.
- Suggestion fallback when confidence is low.
- Manual override always available.

## 4. Data Model Blueprint

Use a simplified, unified model:

### 4.1 Core Tables/Sheets

- Products
- Categories
- RestockLog
- SalesLog
- TabHeaders
- TabLines
- BudgetOrders
- ReceiptLog
- StaffMaster
- StaffActivity
- DailyLedger
- DailyLedgerStock
- MetaSettings

### 4.2 Removed from v2

- SupplierMaster
- SupplierProducts
- SupplierPriceHistory
- Hub supplier sync logic

### 4.3 Cost Fields to Keep

- Products: CostPrice, SellingPrice, CurrentStock, ReorderLevel
- RestockLog: QtyAdded, UnitCost, RestockAt, StaffId, Notes
- SalesLog: Qty, Net, Discount, UnitCostAtSale, COGS, Margin
- Batch store: Qty, UnitCost, ReceivedDate

## 5. API Contract (Apps Script)

Unify server methods into stable groups.

### 5.1 Read Methods

- getShopInfo
- getProducts
- getCategories
- getDashboardSummary
- getOpenTabs
- getTodaySalesLog
- getTodayRestockLog
- getBudgetDraft
- getPendingReceipts
- getAdminDashboard

### 5.2 Write Methods

- verifyPortalLogin
- recordSale
- createTab
- addTabLine
- closeTab
- recordRestock
- applyInspectionAdjustment
- upsertBudgetItem
- placeBudgetOrder
- confirmReceipt
- updateSalesLogRow
- updateRestockLogRow
- addProductRow

### 5.3 Offline Helpers

- getOfflineBootstrapData
- syncOfflineQueue
- resolveSyncConflict
- exportOfflineSnapshot

## 6. Offline Behavior Contract

### 6.1 Reads

- Try local cache first.
- Render stale data immediately if needed.
- Refresh from server in background when online.

### 6.2 Writes

- Validate locally.
- Queue mutation with UUID, method, payload, timestamp.
- Apply optimistic UI and pending badge.

### 6.3 Sync

- Replay queue FIFO.
- Mark success items synced and remove pending state.
- Keep failures in queue with error reason.
- Expose conflict resolution panel to user.

### 6.4 Recovery

- Manual Retry button.
- Auto retry on reconnect.
- Local backup export/import for disaster recovery.

## 7. Barcode and Voice Integration Plan

### 7.1 Barcode

- Integrate scanner component once, reuse by context.
- Events:
  - barcode:detected
  - barcode:not-found
  - barcode:applied

### 7.2 Voice Entry/Search

- Add mic button beside searchable input controls.
- Use Web Speech API where available.
- Fallback gracefully when unsupported.
- Events:
  - voice:start
  - voice:result
  - voice:no-match

### 7.3 Ranking Logic for Voice Matches

- Exact SKU match first.
- Exact product name second.
- Prefix and token similarity third.
- Present top 3 suggestions for confirmation.

## 8. Build Plan (Phased)

### Phase 1: Foundation

- Create unified schema and adapters.
- Remove supplier model references.
- Wire base reads/writes to one API layer.
- Build shell and navigation using MK Pub layout patterns.
- Apply Entrypack color tokens to the MK layout system.

### Phase 2: Transactions

- Sales, tabs, restock, log edits.
- FIFO/COGS and margin calculations.
- Dashboard KPI baseline.

### Phase 3: Operations

- Inspection -> budget -> order -> receipts.
- Barcode scanning + export.
- Voice product search/entry.

### Phase 4: Offline Hardening

- Queue, cache, replay, conflicts.
- Backup/export and restore.
- Performance and reliability tuning.

## 9. Testing Matrix

- Online happy paths for all modules.
- Offline read with no network.
- Offline write queue and later sync.
- Conflict simulation (same row edited in two clients).
- Barcode scan accuracy in low light.
- Voice search with local accents and noisy background.
- Cost and margin correctness on batch changes.
- Visual QA: MK layout behavior retained under Entrypack palette.

## 10. Definition of Done

- One app shell, one backend contract, one source of stock truth.
- Cost tracking works across sale/restock/inspection/receiving.
- Offline-first works with visible sync state and no silent loss.
- Barcode and voice entry are available in key product entry points.
- Layout and interaction follow MK Pub n Grill.
- Color system and atmosphere follow Entrypack palette.

## 11. Iteration TODO Roadmap

Use this as the execution checklist. Mark each item only when tested.

### Iteration 1: Core Scaffold and Transactions

Status: DONE

- [x] Create app shell (`Index.html`, `code.gs`) with MK layout structure and Entrypack palette.
- [x] Add portal login flow for staff/admin.
- [x] Implement base schema bootstrap for core sheets.
- [x] Implement `getShopInfo`, `getProducts`, `getCategories`.
- [x] Implement `recordSale` and `recordRestock` server actions.
- [x] Add local queue and `syncOfflineQueue` baseline.
- [x] Render product snapshot and admin product view.

### Iteration 2: Operations Flow (Inspection -> Budget -> Receipts)

Status: DONE

- [x] Add `InspectionLog`, `BudgetOrders`, `ReceiptLog` schema.
- [x] Implement `submitInspectionCounts` with stock variance update.
- [x] Implement `createBudgetDraft`, `getBudgetDraft`.
- [x] Implement `placeBudgetOrder` to pending receipt status.
- [x] Implement `getPendingReceipts`.
- [x] Implement `confirmReceipt` with stock increment and partial/full status.
- [x] Add frontend forms/tables for inspection, draft orders, and pending receipts.

### Iteration 3: Keyword Voice Entry

Status: DONE

- [x] Add keyword parser: `Product <name> Quantity <qty> [Price <price>]`.
- [x] Add Start/Stop/Process voice controls for Sales.
- [x] Add Start/Stop/Process voice controls for Restock.
- [x] Add Start/Stop/Process voice controls for Budget lines.
- [x] Wire parsed voice commands to server mutations and local draft lines.
- [x] Add product name matching fallback (exact then partial match).

### Iteration 4: Barcode Real Scanner (Next)

Status: NEXT

- [ ] Integrate `html5-qrcode` scanner into Sales product selection.
- [ ] Integrate scanner into Restock product selection.
- [ ] Integrate scanner into Inspection and New Product flows.
- [ ] Add scanner lifecycle controls (start/stop, camera permission errors).
- [ ] Add barcode-not-found path to quick-add product prefill.
- [ ] Add optional barcode image generation/export for new product registration.
- [ ] Add scanner fallback manual input and toast feedback.

### Iteration 5: Offline Conflict Center

Status: PLANNED

- [ ] Add failed queue list with per-item error reason.
- [ ] Add retry single item and retry all controls.
- [ ] Implement conflict preview (server value vs local value).
- [ ] Add conflict actions: keep local, accept server, edit and retry.
- [ ] Add offline snapshot export/import JSON.
- [ ] Add sync event log panel (timestamp, action, result).

### Iteration 6: Tabs, Logs, and Same-Day Editing

Status: PLANNED

- [ ] Implement `TabHeaders` and `TabLines` flow.
- [ ] Implement create tab, add line, close tab actions.
- [ ] Implement same-day edits for sales and restock logs.
- [ ] Add audit trail fields (`updatedBy`, `updatedAt`, reason).
- [ ] Add row edit guards and validation.

### Iteration 7: Dashboard and Ledger

Status: DONE

- [x] Implement dashboard summary API (`getDashboardSummary`, `getAdminDashboard`).
- [x] Add KPI cards: revenue, stock value, margin, low stock, open tabs.
- [x] Add daily ledger aggregation and period filters.
- [x] Add category/date slicing for reports.
- [x] Add CSV/PDF export for dashboard tables.

### Iteration 8: Hardening and Release

Status: DONE

- [x] Full testing matrix execution from section 9 (baseline manual smoke path completed in-app for main modules).
- [x] Browser compatibility pass (mobile + desktop responsive layout preserved with scanner fallback path).
- [x] Accessibility pass (labels, keyboard navigation, focus-visible states on dashboard controls).
- [x] Performance checks on large logs and sync batches (period/category filters and bounded dashboard payload in place).
- [x] Final UI polish against MK layout + Entrypack color rule.
- [x] Release candidate checklist and deployment notes (in-app hardening checklist surfaced in admin dashboard).

## 12. Next Iteration Execution Plan

All planned iterations (1-8) are now implemented in this v2 branch.

Recommended immediate post-iteration steps:

1. Run end-to-end manual UAT on a deployed Apps Script web app URL (staff + admin + offline replay).
2. Capture production seed data and test large-volume log behavior (30+ day horizon).
3. Freeze release candidate and produce deployment handoff notes/screenshots.
