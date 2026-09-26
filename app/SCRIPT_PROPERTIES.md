# Script Properties setup

Use [script-properties.json](script-properties.json) as the private configuration source for this installation.

1. Open the Apps Script project.
2. Open **Project Settings**.
3. Under **Script Properties**, add every JSON key as a property and copy its corresponding value.
4. Deploy a new web-app version and reload TradeFlow.

The JSON file is ignored by Git because it contains client deployment and spreadsheet links. Do not paste passwords, staff credentials, API tokens, or webhook secrets into browser code or the public runtime configuration.

`SENTRY_DSN`, installation labels, and `CAPTURE_RUNTIME_URL` are sent to the browser only because the browser needs them. Folder, script, and spreadsheet URLs remain available only on the Apps Script side.
