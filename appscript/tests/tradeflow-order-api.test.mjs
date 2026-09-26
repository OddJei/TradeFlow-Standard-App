import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingSource = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');
const backendSource = fs.readFileSync(path.resolve(__dirname, '..', 'code copy.gs'), 'utf8');

const state = {
  nextId: 9000,
  currency: 'ZMW',
  settings: { currency: 'ZMW' },
  products: [
    {
      id: '501',
      name: 'Local Cola',
      brand: 'Local Brand',
      variantName: '500 ml',
      category: 'Drinks',
      unit: 'bottle',
      barcode: 'COLA-500',
      productType: 'packed',
      sellingPrice: 25,
      cost: 12,
      supplier: 'Private Supplier',
      privateDescription: 'owner note',
      batches: [{ id: 1, quantityRemaining: 4, quantityReceived: 10, unitCost: 12, supplierId: 'SUP-001' }],
      stockMovements: [{ id: 1, cogs: 12 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-501', ncpcVariantId: 'VAR-501', publicForNtheemba: true },
    },
    {
      id: '502',
      name: 'Private Water',
      category: 'Drinks',
      barcode: 'WATER-750',
      productType: 'packed',
      sellingPrice: 10,
      cost: 5,
      batches: [{ quantityRemaining: 8, unitCost: 5 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-502', ncpcVariantId: 'VAR-502', publicForNtheemba: false },
    },
  ],
  customerOrders: [],
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
const forbidden = [
  'cost',
  'supplier',
  'privateDescription',
  'batches',
  'stockMovements',
  'unitCost',
  'quantityRemaining',
  'quantityReceived',
  'customer',
  'phone',
  'whatsapp',
  'api_token',
  'secret',
  'AppState',
];
const assertSafeOrder = order => {
  assert.deepEqual(Object.keys(order).sort(), ['created_at', 'items', 'order_id', 'shop_id', 'shop_name', 'status', 'totals', 'updated_at']);
  assert.deepEqual(Object.keys(order.items[0]).sort(), ['availability', 'business_product_id', 'currency', 'identity', 'identity_status', 'line_total', 'name', 'quantity', 'selling_price', 'shop_id', 'shop_name', 'variant']);
  assert.deepEqual(Object.keys(order.items[0].identity).sort(), ['linked', 'ncpc_prd_id', 'ncpc_var_id', 'status']);
  assert.deepEqual(Object.keys(order.items[0].availability).sort(), ['status']);
  const text = JSON.stringify(order);
  for (const key of forbidden) {
    assert.equal(text.includes(key), false, `order response leaked ${key}`);
  }
};

let result = call({
  version: 'v1',
  action: 'order.create',
  request_id: 'order-create-1',
  data: {
    idempotency_key: 'customer-req-0001',
    customer: { name: 'Private Customer', phone: '+260000000001', notes: 'do not expose' },
    items: [{ business_product_id: '501', quantity: 2 }],
  },
});
assert.equal(result.ok, true);
assert.equal(result.request_id, 'order-create-1');
assert.equal(result.data.duplicate, false);
assert.equal(state.customerOrders.length, 1);
assert.equal(state.sales.length, 0, 'order.create must not create a completed POS sale');
assert.equal(state.revenue.length, 0, 'order.create must not create revenue');
assert.equal(state.stockAdjustments.length, 0, 'order.create must not move stock');
assert.equal(saved, 1);
assert.equal(lockCount, 1);
assertSafeOrder(result.data.order);
assert.equal(result.data.order.order_id, 'TF-ORDER-9001');
assert.equal(result.data.order.status, 'requested');
assert.equal(result.data.order.items[0].business_product_id, '501');
assert.deepEqual(result.data.order.items[0].identity, { status: 'linked', linked: true, ncpc_prd_id: 'PRD-501', ncpc_var_id: 'VAR-501' });
assert.equal(result.data.order.items[0].quantity, 2);
assert.equal(result.data.order.items[0].selling_price, 25);
assert.equal(result.data.order.items[0].line_total, 50);
assert.deepEqual(result.data.order.items[0].availability, { status: 'in_stock' });
assert.deepEqual(result.data.order.totals, { currency: 'ZMW', item_count: 1, total: 50 });

state.products[0].sellingPrice = 30;
result = call({
  version: 'v1',
  action: 'order.create',
  request_id: 'order-create-retry',
  data: {
    idempotency_key: 'customer-req-0001',
    customer: { name: 'Private Customer', phone: '+260000000001', notes: 'do not expose' },
    items: [{ business_product_id: '501', quantity: 2 }],
  },
});
assert.equal(result.ok, true);
assert.equal(result.data.duplicate, true);
assert.equal(result.data.order.order_id, 'TF-ORDER-9001');
assert.equal(result.data.order.items[0].quantity, 2, 'same logical retry returns the original order');
assert.equal(result.data.order.items[0].selling_price, 25, 'same logical retry preserves original price snapshot');
assert.equal(state.customerOrders.length, 1);
assert.equal(state.nextId, 9001, 'idempotent retry does not allocate another ID');
assert.equal(saved, 1, 'idempotent retry does not save a second mutation');

result = call({
  version: 'v1',
  action: 'order.create',
  request_id: 'order-create-key-reuse',
  data: { idempotency_key: 'customer-req-0001', items: [{ business_product_id: '501', quantity: 5 }] },
});
assert.equal(result.ok, false, 'reusing an idempotency key for different order content is rejected');
assert.equal(result.error.code, 'IDEMPOTENCY_KEY_REUSED');

result = call({ version: 'v1', action: 'order.status', request_id: 'status-by-id', data: { order_id: 'TF-ORDER-9001' } });
assert.equal(result.ok, true);
assert.equal(result.data.order.order_id, 'TF-ORDER-9001');
assertSafeOrder(result.data.order);

result = call({ version: 'v1', action: 'order.status', request_id: 'status-by-key', data: { idempotency_key: 'customer-req-0001' } });
assert.equal(result.ok, true);
assert.equal(result.data.order.order_id, 'TF-ORDER-9001');

result = call({ version: 'v1', action: 'order.create', request_id: 'private-product', data: { idempotency_key: 'customer-req-0002', items: [{ business_product_id: '502', quantity: 1 }] } });
assert.equal(result.ok, false, 'non-public products cannot be ordered through the public API');
assert.equal(result.error.code, 'PRODUCT_NOT_FOUND');

result = call({ version: 'v1', action: 'order.create', request_id: 'invalid-qty', data: { idempotency_key: 'customer-req-0003', items: [{ business_product_id: '501', quantity: 0 }] } });
assert.equal(result.ok, false, 'invalid quantities fail safely');

result = call({ version: 'v1', action: 'order.status', request_id: 'missing-order', data: { order_id: 'TF-ORDER-404' } });
assert.equal(result.ok, false);
assert.equal(result.error.message, 'Request rejected.');

assert.match(backendSource, /customerOrders/);
assert.match(backendSource, /CustomerOrders/);
assert.match(backendSource, /CustomerOrderItems/);

console.log('TradeFlow order API tests passed: order.create/order.status create customer request records, retry idempotently, snapshot price/identity, avoid POS side effects, and return safe public output.');
