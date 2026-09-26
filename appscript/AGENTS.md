# TradeFlow — Standard Reference App

This directory is the actual current standard/reference TradeFlow app. Use it to establish reusable patterns before adapting changes to client-specific editions; do not assume that it may overwrite a customised client app.

- Treat `code.gs`, `Index.html`, and `sw.js` as coordinated Apps Script source. Barcode scanning uses `CAPTURE_RUNTIME_URL` from Script Properties or approved runtime config; the current configured Render value is `https://nds-capture-runtime.onrender.com`. Capture runtime source lives under `packages/capture-runtime/`, not in an Apps Script `CaptureRuntime.html` file.
- Validate Google Apps Script boundaries server-side, keep browser UI from acting as the only permission check, and preserve inventory/budget/inspection workflows without adding mandatory POS or automatic stock deductions.
- Test barcode/camera input, service-worker/offline behavior, and sync paths in runtime when they are affected. Syntax-only checks are insufficient for a claim that the flow works.
- When propagating a standard change to a custom edition, prepare a compatibility note: affected files, intended behavior, configuration dependencies, data migration needs, and rollback path.
- Keep all Ntheemba-facing contracts public-data-only, explicit, authenticated, idempotent, and tenant-scoped.

- Standard multi-shop is a hard data boundary: control spreadsheet owns the shop registry/assignments; each shop spreadsheet owns operational state. New APIs and mutations must resolve `shopId` before reading or writing shop data.
- Zambia shop locations are embedded-only. Do not add or restore `NTHEEMBA_LOCATION_API_URL`, geocoding, or a runtime location-service dependency.
- Local product IDs are shop-local. At external/public boundaries use `shop_id` together with `business_product_id`.

## Standard role and setup contract

- `super_admin` is the business owner. This is the only role allowed to access all shops, switch shops, create/deactivate shops, manage central accounts/assignments, inspect spreadsheet sources/sessions/audit, run architecture migration/repair, import state, or reset a shop.
- `admin` is a manager/administrator assigned to exactly one shop. It may perform that shop's normal business operations and shop-specific settings, but it cannot access Multi-Shop or Super Admin control-plane screens.
- `staff` is assigned to exactly one shop and remains subject to Staff Tab Access permissions.
- First-time setup creates only the business-owner Super Admin account. Manager Admin and Staff accounts are created afterward from Super Admin.
- First-time setup asks for 1–3 shops, each shop's embedded Zambia location and its own weekly opening hours, explicitly asks which shop is primary, asks which Standard modules are enabled, always enables NCPC, and leaves Ntheemba for later add-on configuration.
- The business Phone/WhatsApp line is business-wide and shared by all shops. Do not add separate shop phone-line questions to Standard setup.

## UI help and review rule

- Every Standard UI refinement must use the `tradeflow-ui-playbook-reviewer` before completion. It verifies that plain-language **Show me how** guidance is present for affected important operations, remains available offline, does not disclose secrets or tenant data, and has keyboard/mobile evidence.
- User-facing wording is **Show me how**. Internal documentation may use the word "playbook". `?` opens help for the current operation and `!` shows its important caution; neither shortcut runs while a user is typing in a form.
