import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingSource = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');
const backendSource = fs.readFileSync(path.resolve(__dirname, '..', 'code copy.gs'), 'utf8');

const state = {
  nextId: 9100,
  currency: 'ZMW',
  settings: { currency: 'ZMW' },
  products: [],
  customerOrders: [],
  handoverRequests: [],
  sales: [],
  revenue: [],
  stockAdjustments: [],
};
let saved = 0;
let lockCount = 0;

const sandbox = {
  Utilities: {
    getUuid: () => '12345678-1234-1234-1234-123456789abc',
    computeDigest: (_algorithm, value) => Array.from(String(value ?? ''), char => char.charCodeAt(0) & 255),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    base64Encode: () => 'signature',
    computeHmacSha256Signature: () => [1, 2, 3],
  },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({
    TRADEFLOW_PUBLIC_API_TOKEN: 'tf-public-token',
    TRADEFLOW_BUSINESS_ID: 'STANDARD_STAGING_BUSINESS_ID',
    TRADEFLOW_NTHEEMBA_ENABLED: 'true',
    TRADEFLOW_TERMS_VERSION: 'test-terms-v1',
    TRADEFLOW_PRIVACY_VERSION: 'test-privacy-v1',
    TRADEFLOW_NTHEEMBA_TERMS_ACCEPTED_VERSION: 'test-terms-v1',
    TRADEFLOW_NTHEEMBA_PRIVACY_ACCEPTED_VERSION: 'test-privacy-v1',
    TRADEFLOW_NTHEEMBA_CAPABILITIES: 'catalogue.read,order.create,handover.create',
  }[key] || '') }) },
  LockService: { getScriptLock: () => ({ waitLock() { lockCount++; }, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
  getTradeFlowRuntimeConfig_: () => ({ product: 'TradeFlow', edition: 'Standard v1', appVersion: '1.0.0' }),
  getAppStateInternal_: () => state,
  saveAppStateInternal_: value => {
    saved++;
    assert.equal(value, state);
    return { success: true, state: value };
  },
  _ensureSheet: () => ({ sheet: {} }),
  _appendRow: () => {},
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
vm.runInContext(mappingSource, sandbox, { filename: 'NtheembaMapping.gs' });

const call = body => {
  const request = { ...body };
  if (request.version === 'v1' && request.action !== 'health' && !request.api_token) {
    request.api_token = 'tf-public-token';
    request.business_id = 'STANDARD_STAGING_BUSINESS_ID';
  }
  return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(request) } }).text);
};

const assertSafeHandover = handover => {
  assert.deepEqual(Object.keys(handover).sort(), ['channel', 'created_at', 'handover_id', 'shop_id', 'shop_name', 'status', 'updated_at']);
  const text = JSON.stringify(handover);
  for (const key of ['customer', 'display_name', 'phone', 'reason', 'message', 'notes', 'api_token', 'secret', 'AppState']) {
    assert.equal(text.includes(key), false, `handover response leaked ${key}`);
  }
};

let result = call({
  version: 'v1',
  action: 'handover.create',
  request_id: 'handover-create-1',
  data: {
    idempotency_key: 'handover-req-0001',
    channel: 'whatsapp',
    customer: { name: 'Private Customer', phone: '+260000000001', notes: 'do not expose' },
    reason: 'Please let a human follow up.',
  },
});
assert.equal(result.ok, true);
assert.equal(result.request_id, 'handover-create-1');
assert.equal(result.data.duplicate, false);
assert.equal(state.handoverRequests.length, 1);
assert.equal(state.customerOrders.length, 0, 'handover.create must not create an order');
assert.equal(state.sales.length, 0, 'handover.create must not create a completed POS sale');
assert.equal(state.revenue.length, 0, 'handover.create must not create revenue');
assert.equal(state.stockAdjustments.length, 0, 'handover.create must not move stock');
assert.equal(saved, 1);
assert.equal(lockCount, 1);
assertSafeHandover(result.data.handover);
assert.equal(result.data.handover.handover_id, 'TF-HANDOVER-9101');
assert.equal(result.data.handover.status, 'requested');
assert.equal(result.data.handover.channel, 'whatsapp');
assert.equal(state.handoverRequests[0].customer.display_name, 'Private Customer');
assert.equal(state.handoverRequests[0].customer.phone, '+260000000001');
assert.equal(state.handoverRequests[0].reason, 'Please let a human follow up.');

result = call({
  version: 'v1',
  action: 'handover.create',
  request_id: 'handover-create-retry',
  data: {
    idempotency_key: 'handover-req-0001',
    channel: 'whatsapp',
    customer: { name: 'Private Customer', phone: '+260000000001', notes: 'do not expose' },
    reason: 'Please let a human follow up.',
  },
});
assert.equal(result.ok, true);
assert.equal(result.data.duplicate, true);
assert.equal(result.data.handover.handover_id, 'TF-HANDOVER-9101');
assert.equal(result.data.handover.channel, 'whatsapp', 'same logical retry returns the original handover');
assert.equal(state.handoverRequests.length, 1);
assert.equal(state.nextId, 9101, 'idempotent retry does not allocate another ID');
assert.equal(saved, 1, 'idempotent retry does not save a second mutation');
assertSafeHandover(result.data.handover);

result = call({
  version: 'v1',
  action: 'handover.create',
  request_id: 'handover-key-reuse',
  data: {
    idempotency_key: 'handover-req-0001',
    channel: 'api',
    customer: { name: 'Different Customer', phone: '+260000000099' },
    reason: 'Changed retry body',
  },
});
assert.equal(result.ok, false, 'reusing a handover idempotency key for different content is rejected');
assert.equal(result.error.code, 'IDEMPOTENCY_KEY_REUSED');

result = call({ version: 'v1', action: 'handover.create', request_id: 'invalid-key', data: { idempotency_key: 'short' } });
assert.equal(result.ok, false, 'invalid idempotency key fails safely');
assert.equal(result.error.message, 'Request rejected.');

result = call({
  version: 'v1',
  action: 'handover.create',
  request_id: 'tenant-mismatch',
  api_token: 'tf-public-token',
  business_id: 'OTHER_BUSINESS',
  data: { idempotency_key: 'handover-req-0002' },
});
assert.equal(result.ok, false, 'handover.create keeps configured tenant boundary');
assert.equal(result.error.code, 'TENANT_MISMATCH');

assert.match(mappingSource, /handover\.create/);
assert.match(mappingSource, /handoverCreate: _tradeFlowPublicApiHandoverCreate_/);
assert.match(backendSource, /handoverRequests/);
assert.match(backendSource, /HandoverRequests/);

console.log('TradeFlow handover API tests passed: handover.create is authenticated, idempotent, stored separately, has no POS/order side effects, and returns safe public output.');
