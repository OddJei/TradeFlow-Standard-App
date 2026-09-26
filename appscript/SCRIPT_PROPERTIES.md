# Script Properties setup

Use the checked-in public template [config/standard-runtime-config.json](config/standard-runtime-config.json) as the setup checklist, then copy the approved per-installation values into a private `script-properties.json` file or directly into Apps Script Project Settings.

`config/standard-runtime-config.json` may include public defaults such as:

```json
{
  "TRADEFLOW_BUSINESS_ID": "STANDARD_STAGING_BUSINESS_ID",
  "CAPTURE_RUNTIME_URL": "https://nds-capture-runtime.onrender.com",
  "TRADEFLOW_PUBLIC_API_TOKEN": "<set only in Script Properties for approved Standard API callers>",
  "CAPTURE_RUNTIME_SOURCE": "packages/capture-runtime/"
}
```

Do not put real deployment URLs, Sentry DSNs, tokens, webhook secrets, spreadsheet IDs, or customer data in the checked-in JSON template.

1. Open the Apps Script project.
2. Open **Project Settings**.
3. Under **Script Properties**, add every JSON key as a property and copy its corresponding value.
4. Deploy a new web-app version and reload TradeFlow.

The checked-in template is safe to version because it uses public defaults and placeholders. Any private per-installation `script-properties.json` must stay untracked because it contains client deployment links, spreadsheet links, telemetry DSNs, tokens, or other tenant-specific values. Do not paste passwords, staff credentials, API tokens, or webhook secrets into browser code or the public runtime configuration.

`SENTRY_DSN`, installation labels, and `CAPTURE_RUNTIME_URL` are sent to the browser only because the browser needs them. Folder, script, and spreadsheet URLs remain available only on the Apps Script side.

Barcode scanning requires `CAPTURE_RUNTIME_URL` to be set in Script Properties. The current approved Render-hosted capture runtime URL is `https://nds-capture-runtime.onrender.com`, and its source lives in `packages/capture-runtime/`.

Standard `v1` public API actions other than `health` require `TRADEFLOW_PUBLIC_API_TOKEN`. `TRADEFLOW_BUSINESS_ID` establishes the configured tenant identity; caller-supplied `business_id` must match it when provided. These values must be set per deployment in Script Properties, not in browser code.

### Public API hardening properties

The hardened Standard API supports token rotation, per-caller rate limiting, payload-bound idempotency, and optional HMAC request signing.

Recommended production properties:

```text
TRADEFLOW_PUBLIC_API_TOKEN=<high-entropy active token>
TRADEFLOW_PUBLIC_API_TOKEN_PREVIOUS=<optional previous token during a short rotation window>
TRADEFLOW_BUSINESS_ID=<stable tenant/business id>

TRADEFLOW_PUBLIC_API_REQUIRE_SIGNATURE=true
TRADEFLOW_PUBLIC_API_SIGNING_SECRET=<independent high-entropy signing secret>
TRADEFLOW_PUBLIC_API_MAX_CLOCK_SKEW_SECONDS=300

TRADEFLOW_PUBLIC_API_RATE_LIMIT_READ_PER_MINUTE=120
TRADEFLOW_PUBLIC_API_RATE_LIMIT_WRITE_PER_MINUTE=30
TRADEFLOW_PUBLIC_API_RATE_LIMIT_BATCH_PER_MINUTE=12
TRADEFLOW_PUBLIC_API_RATE_LIMIT_BATCH_LOOKUP_PER_MINUTE=30
TRADEFLOW_PUBLIC_API_RATE_LIMIT_HEALTH_PER_MINUTE=60
```

Deployment sequence:

1. Deploy the hardened source with `TRADEFLOW_PUBLIC_API_REQUIRE_SIGNATURE=false` or unset.
2. Rotate the current test token to a random production-strength value.
3. Configure `TRADEFLOW_PUBLIC_API_SIGNING_SECRET`.
4. Validate signed requests from the approved caller using the bundled PowerShell example.
5. Set `TRADEFLOW_PUBLIC_API_REQUIRE_SIGNATURE=true`.
6. Deploy a new Apps Script version.
7. Remove `TRADEFLOW_PUBLIC_API_TOKEN_PREVIOUS` after the planned rotation window.

Do not reuse the API token as the signing secret. Do not place either value in HTML, source control, screenshots, or public documentation.

Standard multi-shop source mode uses these private runtime properties after approved first-time setup. Shop location selection has no URL/property dependency: Province, District, Town, and researched Area suggestions come only from the embedded V5 Zambia catalogue bundled in `LocationCatalogueFallback.gs`; Area/Compound/Township/Village remains a free-text autocomplete that accepts unlisted values, while address details remain manual inputs:

- `TRADEFLOW_STANDARD_MULTI_SHOP_READY_V1`: set to `true` by approved setup after the control/shop sheets are created.
- `TRADEFLOW_STANDARD_CONTROL_SHEET_ID_V1`: private control spreadsheet ID for shop source metadata and staff assignments.
- `TRADEFLOW_STANDARD_SHOP_SHEETS_FOLDER_URL`: optional Drive folder URL/ID where automatically created shop spreadsheets should be moved.

Do not commit real control spreadsheet IDs, shop spreadsheet IDs, folder URLs, or private API URLs.

## Role/setup note

No Script Property selects the Super Admin. The business owner account is created in the first-time wizard and stored in the private Standard control spreadsheet `Users` table. Admin/Staff assignments and sessions are also control-plane data, not Script Properties.

NCPC is enabled by product policy rather than by a first-time wizard switch. Ntheemba remains separately configured later through its own approved credentials/properties.

## NTheemba connection properties

The NTheemba tab is initiated only by the TradeFlow Super Admin. Configure these
values only in the private Apps Script properties for that one business; do not
put them in browser code or checked-in configuration:

```text
TRADEFLOW_NTHEEMBA_ENABLED=true
TRADEFLOW_NTHEEMBA_BASE_URL=<approved Ntheemba HTTPS URL>
```

In local self-service mode, Ntheemba generates the business credential and
managed secret reference. TradeFlow receives the token only within its
server-side Apps Script action and saves it in private Script Properties; the
browser never receives a token. Initial registration is deliberately disabled/
pending verification; customer WhatsApp workflows stay disabled while WAHA is
offline.

On the first NTheemba connection, the Super Admin accepts the displayed
connection terms and privacy notice in TradeFlow. The app records the current
policy versions in private Script Properties; no separate policy-acceptance
property setup is required.

The NTheemba connection reuses the existing `DEPLOYMENT_URL` property as the
TradeFlow callback address. `TRADEFLOW_PUBLIC_API_BASE_URL` is optional only
when a distinct approved public API URL is intentionally required.
