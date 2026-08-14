# TradeFlow — Standard Reference App

This directory is the actual current standard/reference TradeFlow app. Use it to establish reusable patterns before adapting changes to client-specific editions; do not assume that it may overwrite a customised client app.

- Treat `code copy.gs`, `Index copy.html`, `CaptureRuntime.html`, and `sw.js` as coordinated source. Keep naming and operational behavior stable unless a documented baseline upgrade is intended.
- Validate Google Apps Script boundaries server-side, keep browser UI from acting as the only permission check, and preserve inventory/budget/inspection workflows without adding mandatory POS or automatic stock deductions.
- Test barcode/camera input, service-worker/offline behavior, and sync paths in runtime when they are affected. Syntax-only checks are insufficient for a claim that the flow works.
- When propagating a standard change to a custom edition, prepare a compatibility note: affected files, intended behavior, configuration dependencies, data migration needs, and rollback path.
- Keep all Ntheemba-facing contracts public-data-only, explicit, authenticated, idempotent, and tenant-scoped.
