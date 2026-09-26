# TradeFlow Pro v2 — Business Time + Order Organization Update

## Business-time correction
- Canonical audit timestamps remain UTC ISO timestamps.
- Business/accounting day uses `Africa/Lusaka` by default.
- Automatic POS and Customer Order revenue, sales, and COGS use the Zambia business date.
- Existing customer-order records created around midnight are reconciled for reporting from their fulfillment timestamp; customer-order COGS can infer the matching fulfilled order where older adjustment rows lack timestamps.
- Dashboard Today/Month KPIs, Reports month grouping, report charts, Revenue filters, and report date ranges use the effective business date.

## Customer Orders
- Default view: Open / needs action.
- Filters: Status, From, To, Sort.
- Status counts: New, Accepted, Fulfilled, Cancelled.
- Organization: Needs Action and Order History.
- Lifecycle timestamps displayed: Created, Accepted, Fulfilled, Cancelled.
- Existing Accept / Cancel / Fulfil safe order-ID handling preserved.

## Restock Orders
- Filters: Status, From, To, Sort.
- Statuses: Active, Partially received, Needs receiving, Complete.
- Organization: Active / Receiving and Completed History.
- Created and Last Updated timestamps shown.

## Validation
- Inline JavaScript parsed successfully with Node `vm.Script`.
- Static checks confirmed business timezone, filters, lifecycle labels, and grouped sections are present.

## Deployment
Replace the current `Index.html` with `TradeFlow_Pro_v2_Time_Consistent_Order_Filters.html`, keep the hardened API backend, save, and deploy a new Apps Script web-app version.
