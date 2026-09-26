import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');

const state = {
  businessName: 'Standard Test Shop',
  businessType: 'retail_supermarket',
  settings: { openingHours: [] },
  products: [
    {
      id: '701',
      name: 'Public Juice',
      category: 'Drinks',
      barcode: 'JUICE-250',
      sellingPrice: 12,
      supplier: 'Private Supplier',
      privateDescription: 'owner only',
      batches: [{ quantityRemaining: 5, unitCost: 6 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-701', ncpcVariantId: 'VAR-701', publicForNtheemba: true },
    },
  ],
};

const scriptProperties = {
  TRADEFLOW_PUBLIC_API_TOKEN: 'tf-public-token',
  TRADEFLOW_BUSINESS_ID: 'STANDARD_STAGING_BUSINESS_ID',
  TRADEFLOW_NTHEEMBA_ENABLED: 'true',
  TRADEFLOW_TERMS_VERSION: 'test-terms-v1',
  TRADEFLOW_PRIVACY_VERSION: 'test-privacy-v1',
  TRADEFLOW_NTHEEMBA_TERMS_ACCEPTED_VERSION: 'test-terms-v1',
  TRADEFLOW_NTHEEMBA_PRIVACY_ACCEPTED_VERSION: 'test-privacy-v1',
  TRADEFLOW_NTHEEMBA_CAPABILITIES: 'catalogue.read,order.create,handover.create',
};
let ntheembaAuditTouched = false;

const sandbox = {
  Utilities: {
    getUuid: () => '12345678-1234-1234-1234-123456789abc',
    computeDigest: (_algorithm, value) => Array.from(String(value ?? ''), char => char.charCodeAt(0) & 255),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    base64Encode: () => 'signature',
    computeHmacSha256Signature: () => [1, 2, 3],
  },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, mimeType: '', setMimeType(value) { this.mimeType = value; return this; } }) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => scriptProperties[key] || '',
    }),
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
  getTradeFlowRuntimeConfig_: () => ({ product: 'TradeFlow', edition: 'Standard v1', appVersion: '1.0.0' }),
  getAppStateInternal_: () => state,
  _ensureSheet: () => {
    ntheembaAuditTouched = true;
    return { sheet: {} };
  },
  _appendRow: () => {
    ntheembaAuditTouched = true;
  },
  _normalizeString: value => String(value ?? '').trim(),
  _bytesToHex: bytes => bytes.map(value => (`0${value.toString(16)}`).slice(-2)).join(''),
  Date,
  JSON,
  Array,
  String,
  Number,
  RegExp,
  Object,
  Math,
  Error,
  isFinite,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'NtheembaMapping.gs' });

function postRaw(contents) {
  const response = sandbox.doPost({ postData: { contents } });
  assert.equal(response.mimeType, 'application/json');
  return JSON.parse(response.text);
}

function call(body) {
  return postRaw(JSON.stringify(body));
}

function assertSafeRejected(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
  assert.equal(result.error.message, 'Request rejected.');
  const text = JSON.stringify(result);
  for (const forbidden of ['tf-public-token', 'wrong-token', 'Private Supplier', 'owner only', 'unitCost', 'batches', 'TRADEFLOW_PUBLIC_API_TOKEN', 'AppState']) {
    assert.equal(text.includes(forbidden), false, `rejection leaked ${forbidden}`);
  }
}

let result = call({ version: 'v1', action: 'health', request_id: 'health-open' });
assert.equal(result.ok, true, 'health remains open for operational checks');
assert.equal(result.request_id, 'health-open');

result = call({ version: 'v1', action: 'business.profile', request_id: 'missing-token' });
assertSafeRejected(result, 'UNAUTHORIZED');

result = call({ version: 'v1', action: 'business.profile', request_id: 'bad-token', api_token: 'wrong-token' });
assertSafeRejected(result, 'UNAUTHORIZED');

result = call({
  version: 'v1',
  action: 'catalogue.search',
  request_id: 'wrong-business',
  api_token: 'tf-public-token',
  business_id: 'OTHER_BUSINESS',
  data: { query: 'juice' },
});
assertSafeRejected(result, 'TENANT_MISMATCH');

delete scriptProperties.TRADEFLOW_BUSINESS_ID;
result = call({
  version: 'v1',
  action: 'catalogue.search',
  request_id: 'tenant-not-configured',
  api_token: 'tf-public-token',
  business_id: 'STANDARD_STAGING_BUSINESS_ID',
  data: { query: 'juice' },
});
assertSafeRejected(result, 'TENANT_SCOPE_UNCONFIGURED');
scriptProperties.TRADEFLOW_BUSINESS_ID = 'STANDARD_STAGING_BUSINESS_ID';

result = call({
  version: 'v1',
  action: 'catalogue.search',
  request_id: 'valid-correlation',
  correlation_id: 'corr-001',
  api_token: 'tf-public-token',
  business_id: 'STANDARD_STAGING_BUSINESS_ID',
  data: { query: 'juice' },
});
assert.equal(result.ok, true);
assert.equal(result.correlation_id, 'corr-001');

result = call({
  version: 'v1',
  action: 'catalogue.search',
  request_id: 'bad data id',
  api_token: 'tf-public-token',
  business_id: 'STANDARD_STAGING_BUSINESS_ID',
  data: { query: 'juice' },
});
assertSafeRejected(result, 'INVALID_REQUEST_ID');
assert.equal(result.request_id, 'ntf_12345678123412341234123456789abc', 'invalid request IDs are replaced with a server ID');

result = call({
  version: 'v1',
  action: 'catalogue.search',
  request_id: 'invalid-data',
  api_token: 'tf-public-token',
  business_id: 'STANDARD_STAGING_BUSINESS_ID',
  data: ['juice'],
});
assertSafeRejected(result, 'INVALID_DATA');

result = call({
  version: 'v1',
  action: 'unknown.operation',
  request_id: 'unknown-action',
  api_token: 'tf-public-token',
  business_id: 'STANDARD_STAGING_BUSINESS_ID',
});
assert.equal(result.ok, false);
assert.equal(result.error.code, 'UNKNOWN_ACTION');
assert.equal(result.error.message, 'Unsupported action.');

result = call({
  version: 'v1',
  action: 'catalogue.search',
  request_id: 'oversized',
  api_token: 'tf-public-token',
  business_id: 'STANDARD_STAGING_BUSINESS_ID',
  data: { query: 'x'.repeat(101000) },
});
assertSafeRejected(result, 'PAYLOAD_TOO_LARGE');

result = postRaw('{"version":"v1","action":"catalogue.search",bad');
assert.equal(result.ok, false);
assert.equal(result.error.code, 'MALFORMED_REQUEST');
assert.equal(result.error.message, 'Malformed request.');

assert.equal(ntheembaAuditTouched, false, 'Standard v1 public API failures do not write legacy Ntheemba audit rows');

console.log('TradeFlow public API auth/validation tests passed: configured-token auth, tenant mismatch rejection, request validation, payload limits, correlation IDs, unknown actions, and safe errors are covered.');
