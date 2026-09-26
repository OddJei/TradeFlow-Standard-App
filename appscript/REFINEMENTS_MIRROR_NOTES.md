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
- The business owner is the protected Super Admin. Account creation, shop assignment, password reset, activation/deactivation, sessions and audit now live in the dedicated Super Admin control plane; ordinary manager Admins remain restricted to their assigned shop.
- Budget Builder includes a print-ready PDF export with a business header, budget reference/date, item table, and grand total.
- The signed-in TradeFlow Pro admin can change their own password by confirming the current password. Active portal sessions are revoked after the change; staff password resets remain admin-only.

## Already present in this edition

The target already had IndexedDB queueing, debounced/throttled sync, server locks, staff write enforcement, staff state projection, batch accounting, selling-price snapshots, damaged receipt accounting, recurring expenses, filtered financial tables, inspection focus restoration, and an all-screen sidebar drawer.

## Edition-specific refinements not copied

Harvest branding and Harvest-specific password/session contracts remain edition-specific. Standard now adopts the proven control-spreadsheet + per-shop-spreadsheet multi-shop pattern, while retaining Standard's own portal sessions, three-shop limit, business profile, sheet schema, NCPC mapping contract, and deployment configuration.

## Data and rollback

No migration is required. Existing expense rows are classified at calculation time. To roll back, revert the corresponding changes in `Index copy.html` and `code copy.gs`; no stored records need rewriting.

## Validation

- Apps Script backend JavaScript syntax: passed with Node syntax check.
- Browser inline scripts: both inline scripts parsed successfully.
- Static presence checks passed for currency, decimal precision, profit math, budget row edit/purchase, stale-save revision guard, and revised KPI labels.

Runtime barcode/camera, Apps Script deployment, and multi-device tests were not run.


---

## 31 Aug 2026 — manual review refinements

Working decisions implemented in the current package:

1. Normal tab revisits should feel immediate. Render from IndexedDB-backed cached state and refresh quietly instead of blocking on the server on every click.
2. Super Admin gets a top-header active-shop selector following the Harvest interaction. The selection changes the real shop context.
3. Fix low-contrast text over the dark/navy content band by using a stable light content canvas and high-contrast header treatment.
4. Add `catalogue.batch_lookup` for efficient local-product resolution.
5. Keep `order.create` as one customer basket with multiple items.
6. Add separate `order.batch_create` for independent orders from multiple customers, one shop per batch, with child-level idempotency.
7. Maintain request-before-fulfilment semantics: customer-order creation does not reduce stock.
8. Maintain local TradeFlow catalogue independence from NCPC linkage for operational search/order.
9. Publish a complete v1 API contract manual with payloads, response schemas, limits, errors, privacy rules, and best-use cases.
