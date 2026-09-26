# TradeFlow Standard — Cache-First Tabs & Super Admin Shop Switcher

## Locked UX behavior

TradeFlow should not feel like every tab opens a new web page.

Operational shop data is already held in shop-scoped `AppState` and mirrored to IndexedDB. The updated UI now treats that local state as the immediate render source and reserves backend calls for synchronization/background refresh.

### Operational tabs

Examples:

- Dashboard
- Products
- POS
- Quick Restock
- Inspection
- Budget
- Pending Receiving
- Inventory Ledger
- Stock Entries
- Purchase Orders
- Customer Orders
- Adjustments
- Reports
- Revenue
- Expenses
- Settings shop-level values

These render immediately from the current shop state. Navigation also writes a lightweight IndexedDB tab-cache marker tied to the current shop and state revision.

The full shop state remains mirrored under:

```text
state:<shop_id>
```

and sync queue under:

```text
syncQueue:<shop_id>
```

### Backend-heavy business-wide tabs

`Multi-Shop` and `Super Admin` now use persistent IndexedDB stale-while-revalidate caches:

```text
tabCache:v2:business:multishop
tabCache:v2:business:superadmin
```

Behavior:

```text
First visit
  no cache -> backend -> render -> IndexedDB

Later visit / browser restart
  IndexedDB -> immediate render
               -> background refresh
               -> update cache/UI if newer
```

The deployment URL in Settings and the Zambia location catalogue are also persisted in IndexedDB and refreshed in the background.

Navigation clicks are excluded from the global blocking backend-action progress overlay. Background refresh must not make a cached tab feel blocked.

## Super Admin top shop switcher

The business-owner Super Admin has an active-shop selector in the top header, following the Harvest interaction pattern.

The selector:

- lists active shops;
- marks the primary shop with `★`;
- always shows the current shop context when known;
- is disabled when there is only one active shop;
- is hidden from ordinary Admin/Staff sessions.

### Authoritative switch rule

Changing Shop A -> Shop B is not a visual filter. It changes the authoritative shop context:

- active shop ID;
- destination shop state;
- IndexedDB state namespace;
- sync queue namespace;
- backend shop spreadsheet/source;
- products;
- POS;
- stock;
- customer orders;
- revenue/expenses;
- reports/dashboard;
- all subsequent writes.

If Shop B already has a local cached state, it is rendered immediately. TradeFlow then refreshes Shop B from the backend. If no Shop B cache exists, the switch requires connectivity for the first load.

No Shop A queued operation may be flushed into Shop B.

## Cache invalidation

Business-wide cache entries are invalidated after Super Admin mutations such as:

- shop create/update/deactivate/reactivate;
- primary-shop changes;
- account creation/assignment/status changes;
- migration/architecture updates.

Shop operational writes continue to update the shop-scoped state cache and sync queue.

## Contrast correction

The content workspace now has its own light surface instead of allowing page titles/subtitles to sit directly on the decorative navy body gradient. This fixes the observed Customer Orders issue where dark text became readable only when selected/highlighted.

The correction applies across all pages that use the shared `.content` workspace.
