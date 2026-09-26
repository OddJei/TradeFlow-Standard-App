# TradeFlow Standard Public API Hardening

Status: SOURCE UPDATED — DEPLOYMENT AND SIGNED-RUNTIME VALIDATION REQUIRED

## Protections implemented

- 100 KB JSON body cap.
- Strict action/request/correlation/business ID validation.
- Token authentication from Script Properties; no token in browser code.
- Optional previous-token slot for controlled rotation.
- Tenant/business ID scope enforcement.
- Rate limiting with separate read/write/batch/health budgets.
- Payload-bound idempotency for order and handover writes.
- Script locks around order/handover mutation.
- Optional HMAC-SHA256 request signing.
- Timestamp freshness and nonce replay protection when signing is enabled.
- Stable safe errors and no raw exception details.
- Sanitized rejection logging with no token/signature/payload secrets.
- Shop-scoped catalogue/order resolution.
- Public DTO allowlists.

## Important deployment note

Rate limiting and payload-bound idempotency become active after the new source is deployed.

HMAC replay protection is supported but becomes mandatory only after these Script Properties are set:

```text
TRADEFLOW_PUBLIC_API_SIGNING_SECRET=<high entropy secret>
TRADEFLOW_PUBLIC_API_REQUIRE_SIGNATURE=true
```

Use a fresh nonce/signature for every HTTP attempt. Reuse only the logical write `idempotency_key` when retrying the same order/handover.

See `SCRIPT_PROPERTIES.md` and `TRADEFLOW_API_POWERSHELL_SIGNED_CLIENT.ps1`.
