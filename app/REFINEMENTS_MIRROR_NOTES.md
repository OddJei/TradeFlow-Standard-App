# Refinements Mirror Notes

Source reviewed: `../../../Apps Script/REFINEMENTS_LOG.txt`

## Mirrored into the standard reference app

- ZMW currency formatting with two-decimal price and cost display.
- Net profit excludes inventory/restock purchase expenses from operating expenses, preventing COGS double-counting. Cash-out reporting still includes every expense.
- The report summary uses Operating Expenses as the top-level value; COGS remains available in the detailed stock-adjustment table and CSV export.
- Revenue cards show filtered total, this month, average entry, and largest entry.
- Expense cards show filtered total, this month, average entry, and top category.
- Product drilldown uses Total Remaining Margin and Restock Frequency.
- Budget rows support editing both restock quantity and unit cost.
- Budget rows can be purchased individually, creating a Pending Receipt and an Owner Restock expense before removing the row from the active budget.
- Sync operations carry `baseRevision`, and the server rejects an untimestamped stale save when a newer server revision exists.
- Reports export to PDF (through the browser print dialog), CSV, Word DOC, Word DOCX, and an authenticated Google Sheets report tab.
- PDF and Word report documents include the active restock budget as a styled visual table with its grand total.
- Settings now displays a protected Super Admin account alongside staff accounts. Admin can reset a staff password; the next synced state is protected by the existing server credential-hashing and role enforcement.
- Budget Builder includes a print-ready PDF export with a business header, budget reference/date, item table, and grand total.
- The signed-in TradeFlow Pro admin can change their own password by confirming the current password. Active portal sessions are revoked after the change; staff password resets remain admin-only.

## Already present in this edition

The target already had IndexedDB queueing, debounced/throttled sync, server locks, staff write enforcement, staff state projection, batch accounting, selling-price snapshots, damaged receipt accounting, recurring expenses, filtered financial tables, inspection focus restoration, and an all-screen sidebar drawer.

## Edition-specific refinements not copied

The Harvest custom edition's multi-shop bootstrap, Harvest branding, password/session model, sheet ownership rules, and Script Properties values were not copied. As approved, the standard app retains its own portal-session, business-profile, sheet-schema, and deployment configuration contracts.

## Data and rollback

No migration is required. Existing expense rows are classified at calculation time. To roll back, revert the corresponding changes in `Index copy.html` and `code copy.gs`; no stored records need rewriting.

## Validation

- Apps Script backend JavaScript syntax: passed with Node syntax check.
- Browser inline scripts: both inline scripts parsed successfully.
- Static presence checks passed for currency, decimal precision, profit math, budget row edit/purchase, stale-save revision guard, and revised KPI labels.

Runtime barcode/camera, Apps Script deployment, and multi-device tests were not run.
