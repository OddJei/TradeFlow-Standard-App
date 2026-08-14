# TradeFlow Product Instructions

TradeFlow is the client-owned Google Apps Script and Google Sheets business operating system. Preserve the existing owner/employee split and the documented workflows for visibility, inventory planning, supplier deliveries, owner restock, shop inspection, inventory valuation, and estimated profit.

- The client deployment and its Sheets are the business authority. Do not introduce POS, mandatory sales recording, or automatic stock deduction from sales unless the applicable product blueprint explicitly changes that rule.
- Enforce role, shop, and business authorization on the server; browser UI controls are not authorization.
- Validate Sheets writes, use locking/idempotency for concurrent business events, retain auditable adjustment history, and protect cost, payroll, supplier, staff, and configuration data.
- Ntheemba integration must use an explicit, authenticated, public-data-only boundary. It must not expose restricted information or perform payment/stock mutation without an approved confirmation workflow.
- Before completion, check affected Apps Script/HTML syntax, relevant workflow behavior, and blueprint alignment. Escalate cross-client deployment, data migration, or production Sheet actions for approval.
