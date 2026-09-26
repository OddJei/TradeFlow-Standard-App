import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appscriptDir = path.resolve(__dirname, '..');
const codeSource = fs.readFileSync(path.join(appscriptDir, 'code.gs'), 'utf8');
const htmlSource = fs.readFileSync(path.join(appscriptDir, 'Index.html'), 'utf8');

function extract(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

const serverSource = extract(codeSource, 'const APP_STATE_CHUNK_SIZE', 'function getSentryDsn_');
let scriptProperties = {};
const serverSandbox = {
  URL,
  JSON,
  String,
  Number,
  Object,
  Array,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return scriptProperties[key] || ''; },
      };
    },
  },
  requirePortalSession_() { return { role: 'super_admin' }; },
};
vm.createContext(serverSandbox);
vm.runInContext(serverSource, serverSandbox, { filename: 'code.gs setup preflight helpers' });

let preflight = serverSandbox.getTradeFlowSetupPreflight_();
assert.equal(preflight.ready, false, 'missing Script Properties must block first-time setup');
assert.equal(preflight.public.ready, false);
assert.equal(preflight.public.supportCode, 'SETUP_CONFIG_NOT_READY');
assert.equal(preflight.public.ownerChecks.find(check => check.id === 'centralCatalogue').ready, false);
assert.deepEqual(preflight.missing.includes('Central Catalogue API token'), true);

scriptProperties = {
  TRADEFLOW_APP_VERSION: '2.0.0',
  TRADEFLOW_EDITION: 'Standard v2',
  TRADEFLOW_CLIENT_ID: 'CLIENT-CODE-0001',
  TRADEFLOW_CLIENT_NAME: 'TradeFlow Demo Workspace',
  TRADEFLOW_INSTALLATION_ID: 'tf-demo-installation',
  TRADEFLOW_ENVIRONMENT: 'staging',
  CAPTURE_RUNTIME_URL: 'https://nds-capture-runtime.onrender.com',
  NCPC_ENABLED: 'true',
  NCPC_BASE_URL: 'https://semimonarchically-unidealistic-winfred.ngrok-free.dev',
  NCPC_API_TOKEN: 'test-token-value-with-safe-length',
  NCPC_API_VERSION: 'v1',
  NCPC_TIMEOUT_MS: '7000',
};
preflight = serverSandbox.getTradeFlowSetupPreflight_();
assert.equal(preflight.ready, true, 'complete Script Properties should allow first-time setup');
assert.equal(preflight.public.ready, true);
assert.equal(preflight.ncpc.enabled, true);
assert.equal(preflight.ncpc.ready, true);
assert.equal(preflight.ncpc.baseUrlConfigured, true);
assert.equal(preflight.ncpc.tokenConfigured, true);
assert.equal(JSON.stringify(preflight.public).includes(scriptProperties.NCPC_API_TOKEN), false, 'public setup status must not leak NCPC token value');
assert.equal(JSON.stringify(preflight.public).includes(scriptProperties.NCPC_BASE_URL), false, 'owner setup status must not expose NCPC base URL');

scriptProperties.TRADEFLOW_NTHEEMBA_ENABLED = 'true';
scriptProperties.TRADEFLOW_TERMS_VERSION = 'terms-v1';
scriptProperties.TRADEFLOW_PRIVACY_VERSION = 'privacy-v1';
scriptProperties.TRADEFLOW_NTHEEMBA_TERMS_ACCEPTED_VERSION = 'terms-v1';
scriptProperties.TRADEFLOW_NTHEEMBA_PRIVACY_ACCEPTED_VERSION = 'privacy-v1';
scriptProperties.TRADEFLOW_NTHEEMBA_CAPABILITIES = 'catalogue.read,order.create';
const connectionStatus = serverSandbox.getTradeFlowNtheembaConnectionStatus('session');
assert.equal(connectionStatus.enabled, true);
assert.equal(connectionStatus.policy.status, 'accepted');
assert.equal(connectionStatus.chat.status, 'ready');
assert.equal(connectionStatus.gateway.status, 'not_configured');
assert.equal(JSON.stringify(connectionStatus).includes(scriptProperties.NCPC_API_TOKEN), false, 'connection status must not leak protected configuration');

scriptProperties.NCPC_EXTRA_HEADERS_JSON = '{"ngrok-skip-browser-warning":"true"}';
preflight = serverSandbox.getTradeFlowSetupPreflight_();
assert.equal(preflight.ready, true, 'valid optional gateway headers should not block setup');
assert.equal(preflight.ncpc.extraHeadersConfigured, true);

scriptProperties.NCPC_EXTRA_HEADERS_JSON = '{"bad":true}';
preflight = serverSandbox.getTradeFlowSetupPreflight_();
assert.equal(preflight.ready, false, 'invalid optional gateway headers should block setup');
assert.equal(preflight.public.ownerChecks.find(check => check.id === 'gatewayHeaders').ready, false);

assert.match(codeSource, /function getFirstTimeSetupStatus\(\)[\s\S]*setupBlocked: required && !setupPreflight\.ready/, 'first-time status must report setupBlocked');
assert.match(codeSource, /function completeFirstTimeSetup\(data\)[\s\S]*getTradeFlowSetupPreflight_\(\)[\s\S]*not ready for business setup/, 'completion must re-check server-side setup preflight before writing sheets');
assert.equal(typeof serverSandbox.testNcpcConnectionBeforeFirstTimeSetup, 'function', 'support function must exist for NCPC pre-setup connection tests');
assert.equal(typeof serverSandbox.testNcpcConnectionBeforeFirstTimeSetupPretty, 'function', 'pretty support function must exist for Apps Script execution logs');
assert.equal(typeof serverSandbox.setupNcpcTokenBeforeFirstTimeSetup, 'function', 'support function must exist for NCPC token setup before connection tests');
assert.equal(typeof serverSandbox.setupNcpcTokenBeforeFirstTimeSetupPretty, 'function', 'pretty token setup function must exist for Apps Script execution logs');
assert.equal(typeof serverSandbox.setupAndTestNcpcBeforeFirstTimeSetupPretty, 'function', 'combined setup-and-test support function must exist');
assert.equal(typeof serverSandbox.normalizeNcpcClientId_, 'function', 'token setup must normalize NCPC client IDs before API validation');
assert.equal(serverSandbox.normalizeNcpcClientId_('', 'tradeflow:CLIENT-CODE 0001'), 'tradeflow:CLIENT-CODE-0001', 'generated NCPC client IDs must replace spaces with hyphens');
assert.match(codeSource, /NCPC_PROVISIONING_TOKEN/, 'token setup must use a temporary provisioning token property');
assert.match(codeSource, /normalizeNcpcClientId_\(rawClientId, 'tradeflow:' \+ businessId\)/, 'token setup must use a NCPC-safe generated client ID');
assert.match(codeSource, /deleteProperty\('NCPC_PROVISIONING_TOKEN'\)/, 'token setup must remove the temporary provisioning token after success');
assert.match(codeSource, /TOKEN_SETUP_SAVED/, 'token setup must log a redacted save result');
assert.match(codeSource, /mode: allowMutation \? 'synthetic_mutating_import_probe' : 'safe_non_mutating_contract_probe'/, 'NCPC setup tester must default to non-mutating mode');
assert.match(codeSource, /Product import API validation probe/, 'NCPC setup tester must include product import API contract probe');
assert.match(codeSource, /Correction import API permission\/readiness probe/, 'NCPC setup tester must include correction import API readiness probe');
assert.match(codeSource, /function logNcpcSetupProbe_/, 'NCPC setup tester must log runtime execution details');
assert.match(codeSource, /FINAL_REPORT/, 'NCPC setup tester must write the final redacted report to Apps Script logs');
assert.match(htmlSource, /let firstTimeSetupBlocked = false;/, 'browser must track blocked first-time setup status');
assert.match(htmlSource, /function openFirstTimeSetupBlockedModal\(\)/, 'browser must show a support modal when setup is blocked');
assert.match(htmlSource, /No token or base URL is shown here\./, 'owner-facing blocked state must hide technical secrets');
assert.doesNotMatch(htmlSource, /NCPC_API_TOKEN/, 'browser source must not mention the NCPC token property key');
assert.match(htmlSource, /id: 'connections'/, 'Admin navigation includes the Connections view');
assert.match(htmlSource, /function renderConnections\(container\)/, 'Connections view is rendered locally');
assert.match(htmlSource, /getTradeFlowNtheembaConnectionStatus\(getAuthToken\(\)\)/, 'Connections view requests only the server-safe status projection');

console.log('First-time setup preflight tests passed: missing/invalid protected properties block setup, ready properties allow setup, and owner UI hides NCPC secrets.');
