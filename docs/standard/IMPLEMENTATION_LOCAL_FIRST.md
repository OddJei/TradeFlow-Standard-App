# TradeFlow Entrypack v2 Local-First Implementation

## 1. Goal

Build a local-first TradeFlow app that behaves like a POS-centered inventory OS.

The system should support:

- Fast sales entry.
- Low-stock driven restocking.
- Budget building from prior cost price.
- Purchase placement with editable quantities and costs.
- Staff receipt confirmation that updates stock automatically.
- Barcode and voice-assisted product lookup.

This document is the implementation companion to the local workflow spec. It does not replace the broader v2 implementation guide.

## 2. Product Direction

### 2.1 Primary Flow

The core operating sequence is:

1. Add or maintain a product.
2. Sell product from POS.
3. Watch low-stock alerts.
4. Build a budget from low-stock items.
5. Place a purchase.
6. Receive stock.
7. Confirm receipt and update inventory.

### 2.2 What Replaces Inspection

Manual inspection is not the main daily trigger.

Use low-stock detection, barcode lookup, and search-first product entry instead.

### 2.3 Cost Rule

Cost tracking remains mandatory.

Always preserve:

- Unit cost.
- Last known cost.
- Batch cost.
- Sale-time cost basis.
- Margin / COGS outputs.

## 3. UI and Interaction Rules

### 3.1 Layout

Keep the existing TradeFlow app shell and portal structure.

Use the following interaction priorities:

- Search-first inputs.
- Barcode-first selection where available.
- Voice as a fast fallback.
- Modal-based confirmation for receipt and purchase actions.
- Table rows editable in place for same-day corrections.

### 3.2 Color Palette

Use the Entrypack palette tokens as the visual source of truth:

- --navy: #071a33
- --navy-2: #0b2a48
- --emerald: #1c8f68
- --emerald-2: #3ec18e
- --gold: #d9a441
- --sun: #f2d16b
- --copper: #b76132
- --clay: #883f2d
- --ink: #11151d
- --muted: #667085
- --paper: #fffaf0
- --surface: rgba(255, 250, 240, 0.82)
- --line: rgba(7, 26, 51, 0.14)
- --danger: #b42318
- --success: #087443
- --neon-red: #ff2a4a
- --neon-blue: #2a7bff

Style rule:

- Keep the MK-style layout, spacing, card structure, and portal behavior.
- Use the Entrypack palette for brand tone, contrast, alerts, buttons, and surfaces.
- Do not introduce a new color system for v2 unless it is derived from these tokens.

### 3.2 Required Surfaces

- Staff POS screen.
- Low-stock panel.
- Budget builder.
- Purchase summary.
- Pending receipts view.
- Product master editor.
- Dashboard and stock summary views.

## 4. Functional Modules

### 4.1 Product Master

Each product should support:

- Name.
- Barcode.
- Category.
- Unit.
- Selling price.
- Cost price.
- Min stock.
- Max stock.
- Current stock.

Optional helpers:

- Image or label reference.
- Voice-friendly aliases.
- Reorder note.

### 4.2 Sales / POS

Sales must support:

- Product lookup by dropdown.
- Product lookup by barcode.
- Product lookup by voice.
- Quantity entry.
- Discount entry.
- Staff attribution.

Sale confirmation must:

- Reduce stock.
- Write sale log row.
- Store cost basis at sale time.
- Update dashboard totals.

### 4.3 Low-Stock Watch

Low-stock watch should:

- Compare current stock to reorder level or min stock.
- Surface alert cards or a watch list.
- Allow quick add into budget lines.
- Support filtering by category and search term.

### 4.4 Budget Builder

Budget creation should:

- Default line cost from last known cost price.
- Allow quantity editing.
- Allow unit cost override.
- Calculate totals live.
- Preserve audit trail for changes.

### 4.5 Purchase and Receiving

Purchase placement should:

- Create a pending order state.
- Store expected quantity and expected cost.
- Remain editable before final submission.

Receiving should:

- Capture received quantity.
- Capture damaged or missing quantity.
- Confirm line by line or in batch.
- Increase stock only on confirmation.
- Record receipt logs and batch details.

### 4.6 Barcode and Voice

Barcode features should support:

- Scan to find product.
- Scan to prefill add-product fields.
- Scan to accelerate sale and restock entry.

Voice features should support:

- Search by product name.
- Search by known alias.
- Guided entry for quantity and cost.
- Fallback to manual selection when confidence is low.

## 5. Data Model

### 5.1 Core Sheets / Tables

- Products.
- Categories.
- SalesLog.
- RestockLog.
- BudgetOrders.
- ReceiptLog.
- StaffMaster.
- StaffActivity.
- DailyLedger.
- DailyLedgerStock.
- MetaSettings.

### 5.2 Cost and Stock Fields

- Products: CostPrice, SellingPrice, CurrentStock, ReorderLevel, MaxStock.
- SalesLog: Qty, Net, Discount, UnitCostAtSale, COGS, Margin.
- RestockLog: QtyAdded, UnitCost, RestockAt, StaffId, Notes.
- BudgetOrders: ExpectedQty, ExpectedUnitCost, Status.
- ReceiptLog: ReceivedQty, DamagedQty, ConfirmedAt.

### 5.3 Explicitly Not Required

- SupplierMaster.
- SupplierProducts.
- SupplierPriceHistory.
- Supplier sync logic.

## 6. Server Contract

### 6.1 Read Methods

- getShopInfo.
- getProducts.
- getCategories.
- getDashboardSummary.
- getTodaySalesLog.
- getTodayRestockLog.
- getBudgetDraft.
- getPendingReceipts.
- getAdminDashboard.

### 6.2 Write Methods

- verifyPortalLogin.
- recordSale.
- addProductRow.
- recordRestock.
- upsertBudgetItem.
- placeBudgetOrder.
- confirmReceipt.
- updateSalesLogRow.
- updateRestockLogRow.

### 6.3 Offline Helpers

- getOfflineBootstrapData.
- syncOfflineQueue.
- resolveSyncConflict.
- exportOfflineSnapshot.

## 7. Offline Behavior

### 7.1 Read Path

- Load cached data first.
- Render immediately even when stale.
- Refresh from server in the background when online.

### 7.2 Write Path

- Validate locally before sending.
- Queue writes with UUID and timestamp.
- Apply optimistic UI updates.
- Mark pending state visibly.

### 7.3 Sync Path

- Replay writes FIFO.
- Remove completed items from queue.
- Keep failed items with error reason.
- Show retry controls for the user.

## 8. Build Phases

### Phase 1: Local POS and Catalog

- Product master editing.
- POS sales flow.
- Stock decrement on sale.
- Search, barcode, and voice lookup.

### Phase 2: Low-Stock and Budgeting

- Low-stock watch.
- Budget builder seeded from last cost.
- Editable quantity and cost.
- Purchase summary and draft order state.

### Phase 3: Receiving and Stock Update

- Pending receipt list.
- Receive and damage capture.
- Confirm receipt to update stock.
- Receipt history and batch detail.

### Phase 4: Offline Hardening

- Queue replay.
- Conflict resolution.
- Snapshot export/import.
- Retry and recovery UI.

### Phase 5: Reporting and Polish

- Dashboard totals.
- Margin and COGS summaries.
- Stock value reporting.
- Final responsive layout polish.

## 9. Acceptance Criteria

The local-first implementation is complete when:

- Sales can be completed quickly from POS.
- Stock decreases only on confirmed sale.
- Low-stock alerts trigger restock actions.
- Budget lines default to last cost price.
- Purchase details can be edited before placement.
- Receipt confirmation updates stock automatically.
- Barcode and voice lookup work in product entry surfaces.
- Offline queue and replay do not lose writes silently.

## 10. Implementation Notes

- Keep the UI responsive and low-friction.
- Prefer one source of stock truth.
- Keep edit history for log corrections.
- Never require manual inspection as the default operational path.
- Use low-stock, search, barcode, and voice as the main operators' tools.

## 11. Next Work Items

1. Align frontend labels with the local workflow spec.
2. Wire the POS, low-stock, budget, and receipt views to the same stock source.
3. Add or tighten barcode and voice lookup hooks.
4. Validate receipt confirmation behavior end to end.
5. Run offline queue and replay checks on the main transaction paths.
