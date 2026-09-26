# TradeFlow Standard — Full Refinement Update

**Date:** 31 August 2026  
**Package scope:** TradeFlow Standard UI/runtime + TradeFlow public API.

## Implemented from the manual review

1. **Cache-first tab experience**
   - Operational screens render from the selected shop's already-cached IndexedDB-backed state.
   - Multi-Shop and Super Admin use business-scoped persistent IndexedDB caches.
   - Location catalogue and deployment URL also use cache-first/background-refresh behavior.
   - Navigation itself no longer presents a blocking server-progress state for cached views.

2. **Harvest-style Super Admin shop switcher**
   - Business-owner Super Admin sees the active shop in the top header.
   - Switching changes the authoritative shop context and uses the existing shop-scoped state/sync boundary.
   - Admin/Staff remain pinned to their assigned shop.

3. **Contrast correction**
   - Main content now sits on a stable light canvas rather than allowing page headings/subtitles/actions to disappear against the decorative navy background.
   - This directly addresses the Customer Orders title/subtitle/open-count/Sync visibility observed during manual review.

4. **Batch local product lookup**
   - Added `catalogue.batch_lookup`.
   - Max 50 lookup rows per request.
   - One shop per batch.
   - Supports local product ID, barcode, or text query.
   - Per-row `found`, `multiple_matches`, `not_found`, `invalid_lookup` results.

5. **Order API shape preserved and expanded safely**
   - `order.create` remains one customer basket and supports one or many product lines (max 25).
   - Added `order.batch_create` for up to 20 independent customer orders in one shop.
   - Every child order requires its own idempotency key.
   - Child failures are isolated; successful siblings are preserved.
   - Creation remains `requested` and does not reduce stock until fulfilment.

6. **Local TradeFlow catalogue remains operational truth**
   - Active products remain searchable/orderable even when NCPC is pending, local-only, missing, stale, or wrongly linked.
   - `(shop_id, business_product_id)` remains the order/product operational identity.

7. **Formal API v1 manual**
   - Added `Docs/API/TRADEFLOW_PUBLIC_API_V1.md` and a root convenience copy.
   - Documents every current public action, envelope, payload, response schema, errors, limits, privacy boundary, idempotency, best use cases, and batch semantics.

## Validation

- All Apps Script/JavaScript source parses.
- All 5 inline browser scripts parse.
- Mock batch lookup and batch customer-order tests pass.
- Mock requested-order creation leaves stock unchanged.
- Service-worker cache bumped to v7.

## Deployment note

This ZIP contains the updated source. The existing deployed Apps Script `/exec` URL does not receive these changes until the new files are copied/deployed to that Apps Script project and a new deployment version is published where required.

## 2026-09-01 API hardening + dashboard KPI correction

### Public API
- Request body cap reduced to 100 KB.
- Added configurable per-caller rate limits for health, reads, writes, batch lookup, and batch order creation.
- Added current + previous API token rotation support.
- Added constant-time token/signature comparison helper.
- Added optional HMAC-SHA256 signed-request mode with tenant binding, timestamp freshness, nonce replay protection, and canonical data hashing.
- Added payload-bound idempotency fingerprint for customer orders and handover requests; same key + different logical payload now rejects with `IDEMPOTENCY_KEY_REUSED`.
- Preserved Script Lock around write paths and safe public errors.
- Added sanitized security rejection logging without token/signature/payload values.
- Added security capability metadata to `health`.
- Fixed secondary-shop `business.hours` projection by retaining shop control-plane `config` in the public shop source.

### Dashboard / reporting
- All KPI row calculations are explicitly active-shop scoped.
- `Today's Expenses` renamed to `Today's Cash Out` to reflect cash-flow semantics.
- Added proper current-month Gross Profit, Net Profit, Cash Flow, Operating Expenses, and Inventory Loss.
- Sales COGS now excludes non-sale inventory loss; inventory loss is deducted separately from Net Profit.
- Inventory Value is active-shop remaining FIFO stock at cost.
- `Expected Profit Remaining` renamed to `Projected Margin on Stock` to avoid presenting a projection as realized profit.
- Month-over-month now compares the actual current calendar month to the immediately previous calendar month and zero-fills empty months.
- Dead stock uses latest receipt or latest sale rather than any manual stock correction.
- Reports use the same sales-COGS/inventory-loss separation as dashboard Net Profit.

### Customer Orders
- Includes the previously completed safe Customer Order action-ID fix for Accept, Cancel, and Fulfil buttons.
