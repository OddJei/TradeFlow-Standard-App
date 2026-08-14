# TradeFlow Sheets workflow schema

`code copy.gs` keeps `AppState` as a recovery snapshot, then writes the same accepted state into the following readable operational tables. The app's **Repair/Create Sheets** action creates missing tables, repairs headers, and backfills them from the current snapshot.

| Workflow | Sheet | What it records |
| --- | --- | --- |
| Business setup | `BusinessProfile`, `BusinessSettings` | Business identity and configuration |
| Product and inventory | `Products`, `InventoryBatches` | Product setup, stock batches, costs, prices, and remaining quantities |
| Supplier stock receiving | `SupplierDeliveries` | Direct and inspection-count deliveries with quantity and supplier cost |
| Owner restocking | `RestockOrders`, `RestockOrderItems` | Planned purchases, actual quantities, costs, and receipt status |
| Stock corrections | `StockAdjustments` | Damage, expiry, missing stock, and count corrections |
| Point of sale | `POSSales`, `POSSaleItems` | Completed sale header, payment method, line items, and FIFO batch allocations |
| Financial visibility | `RevenueEntries`, `ExpenseEntries` | Daily revenue and business expenses |
| Planning | `BudgetHeader`, `BudgetItems` | Current restock budget and its planned items |
| People and configuration | `Staff`, `CustomUnits`, `Notifications` | Staff records, units, and app alerts |
| Audit | `SyncAudit` | Each accepted browser sync operation, once per operation ID |

## Operational behavior

- A normal browser save is accepted through `pushSyncOps`, deduplicated by operation ID, written to `AppState`, projected to the workflow tables, and recorded in `SyncAudit`.
- POS checkout records the sale header, all sale lines, linked stock allocations, revenue entry, and notification in one browser-state change before it is queued for sync. The payment method currently defaults to `Cash`.
- The workflow tables are snapshots of the current operational state. They should be edited through TradeFlow; direct sheet edits are not imported back into the browser state.
- Repair/Create Sheets creates only this current workflow schema, plus `AppState` for recovery and `SafeConfig` for portal credentials. Deleted legacy tables such as `ProductMaster`, `SalesLog`, and `RestockProductLog` are not recreated.
- When `AppState` is absent, Repair/Create Sheets starts a clean app state and clears any queued browser sync so old local data cannot restore the deleted records.
