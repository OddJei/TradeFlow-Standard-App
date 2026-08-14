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
- Re-parsed all inline JavaScript in `Index copy.html`, `CaptureRuntime.html`, and `code copy.gs`; verified every navigation feature has a renderer, every inline click handler resolves to a defined client function, expected Apps Script RPC functions exist, and the inspection overage branch records positive quantity without increasing COGS.

## Not covered in this session

No interactive browser was available, so camera capture, service-worker installation, offline/online recovery, and deployed Apps Script access were not runtime-tested. No deployment or client spreadsheet was changed.
