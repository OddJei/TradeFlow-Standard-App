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
  businessOwnerName: 'Private Owner',
  businessOwnerEmail: 'owner@example.test',
  businessWhatsapp: '+260000000000',
  businessAddress: 'Test Road',
  settings: {
    businessName: 'Settings Name',
    businessOwnerEmail: 'settings-owner@example.test',
    openingHours: [
      { day: 'Monday', open: '08:00', close: '17:00', closed: false, privateNote: 'staff only' },
      { day: 'Sunday', open: '', close: '', closed: true },
    ],
  },
  products: [
    {
      id: '101',
      name: 'Public Cola',
      brand: 'Local Brand',
      variantName: '500 ml',
      category: 'Drinks',
      unit: 'bottle',
      barcode: 'COLA-500',
      productType: 'packed',
      sellingPrice: 25,
      supplier: 'Private Supplier',
      privateDescription: 'do not expose',
      batches: [{ quantityRemaining: 3, unitCost: 11 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-001', ncpcVariantId: 'VAR-001', publicForNtheemba: true },
    },
    {
      id: '102',
      name: 'Private Water',
      category: 'Drinks',
      barcode: 'WATER-750',
      productType: 'packed',
      sellingPrice: 10,
      supplier: 'Private Supplier',
      batches: [{ quantityRemaining: 4, unitCost: 5 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-002', ncpcVariantId: 'VAR-002', publicForNtheemba: false },
    },
    {
      id: '103',
      name: 'Public Bread',
      category: 'Bakery',
      barcode: 'BREAD-1',
      productType: 'packed',
      sellingPrice: 8,
      batches: [{ quantityRemaining: 0, unitCost: 3 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-003', ncpcVariantId: 'VAR-003', publicForNtheemba: true },
    },
  ],
};
let ntheembaAuthTouched = false;
let auditTouched = false;
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
      getProperty(key) {
        if (String(key).startsWith('NTHEEMBA_API_')) ntheembaAuthTouched = true;
        return scriptProperties[key] || '';
      },
    }),
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
  getTradeFlowRuntimeConfig_: () => ({ product: 'TradeFlow', edition: 'Standard v1', appVersion: '1.0.0' }),
  getAppStateInternal_: () => state,
  _ensureSheet: () => {
    auditTouched = true;
    return { sheet: {} };
  },
  _appendRow: () => {
    auditTouched = true;
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
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'NtheembaMapping.gs' });

const call = body => {
  const request = { ...body };
  if (request.version === 'v1' && request.action !== 'health' && !request.api_token) {
    request.api_token = 'tf-public-token';
    request.business_id = 'STANDARD_STAGING_BUSINESS_ID';
  }
  const response = sandbox.doPost({ postData: { contents: JSON.stringify(request) } });
  assert.equal(response.mimeType, 'application/json');
  return JSON.parse(response.text);
};

let result = call({ version: 'v1', action: 'health', request_id: 'req-health' });
assert.equal(result.ok, true);
assert.equal(result.version, 'v1');
assert.equal(result.request_id, 'req-health');
assert.equal(result.data.status, 'ok');
assert.equal(result.data.api, 'tradeflow.standard.public');
assert.equal(result.data.version, 'v1');
assert.equal(result.data.product, 'TradeFlow');
assert.equal(result.data.edition, 'Standard v1');
assert.equal(result.data.app_version, '1.0.0');
assert.equal(result.data.capabilities.local_catalogue_search, true);
assert.equal(result.data.security.signed_requests_supported, true);
assert.equal(typeof result.data.limits.max_batch_lookups, 'number');

result = call({ version: 'v1', action: 'business.profile', request_id: 'req-profile' });
assert.equal(result.ok, true);
assert.equal(result.data.business_name, 'Standard Test Shop');
assert.equal(result.data.business_type, 'retail_supermarket');
assert.equal(result.data.public_contact.whatsapp, '+260000000000');
assert.equal(Object.hasOwn(result.data, 'businessOwnerEmail'), false);
assert.equal(Object.hasOwn(result.data, 'businessOwnerName'), false);
assert.equal(Object.hasOwn(result.data, 'clientId'), false);

result = call({ version: 'v1', action: 'business.hours', request_id: 'req-hours' });
assert.equal(result.ok, true);
assert.deepEqual(result.data.hours[0], { day: 'Monday', open: '08:00', close: '17:00', closed: false });
assert.equal(Object.hasOwn(result.data.hours[0], 'privateNote'), false);

result = call({ version: 'v1', action: 'catalogue.search', request_id: 'req-search', data: { query: 'public' } });
assert.equal(result.ok, true);
assert.equal(result.data.items.length, 2);
assert.deepEqual(Object.keys(result.data.items[0]).sort(), ['availability', 'barcode', 'barcodes', 'brand', 'business_product_id', 'catalogue_source', 'category', 'currency', 'identity', 'identity_status', 'name', 'product_type', 'selling_price', 'shop_availability', 'shop_id', 'unit', 'variant']);
assert.deepEqual(Object.keys(result.data.items[0].identity).sort(), ['linked', 'ncpc_prd_id', 'ncpc_var_id', 'status']);
assert.equal(Object.hasOwn(result.data.items[0], 'supplier'), false);
assert.equal(Object.hasOwn(result.data.items[0], 'unitCost'), false);
assert.equal(Object.hasOwn(result.data.items[0], 'batches'), false);
assert.equal(result.data.items[0].business_product_id, '101');
assert.equal(result.data.items[0].selling_price, 25);
assert.equal(result.data.items[0].currency, 'ZMW');
assert.deepEqual(result.data.items[0].availability, { status: 'in_stock' });
assert.equal(result.data.items.some(item => item.business_product_id === '102'), false, 'private catalogue products are not returned');

result = call({ version: 'v1', action: 'catalogue.categories', request_id: 'req-categories' });
assert.deepEqual(result.data.categories, ['Bakery', 'Drinks']);

result = call({ version: 'v1', action: 'catalogue.item', request_id: 'req-item', data: { business_product_id: '101' } });
assert.equal(result.ok, true);
assert.equal(result.data.item.business_product_id, '101');
assert.equal(result.data.item.identity.ncpc_prd_id, 'PRD-001');
assert.equal(result.data.item.identity.ncpc_var_id, 'VAR-001');
assert.equal(result.data.item.selling_price, 25);

result = call({ version: 'v1', action: 'catalogue.by_ncpc_variant', request_id: 'req-variant', data: { ncpc_variant_id: 'VAR-001' } });
assert.equal(result.ok, true);
assert.equal(result.data.items.length, 1);
assert.deepEqual(Object.keys(result.data.items[0]).sort(), ['availability', 'barcode', 'barcodes', 'brand', 'business_product_id', 'catalogue_source', 'category', 'currency', 'identity', 'identity_status', 'name', 'product_type', 'selling_price', 'shop_availability', 'shop_id', 'unit', 'variant']);
assert.equal(Object.hasOwn(result.data.items[0], 'supplier'), false);

result = call({ version: 'v2', action: 'health', request_id: 'req-version' });
assert.equal(result.ok, false);
assert.equal(result.version, 'v2');
assert.equal(result.error.code, 'UNSUPPORTED_VERSION');
assert.equal(result.error.message, 'Unsupported API version.');

result = call({ version: 'v1', action: 'catalogue.item', request_id: 'req-private', data: { business_product_id: '102' } });
assert.equal(result.ok, false);
assert.equal(result.error.code, 'PRODUCT_NOT_FOUND');
assert.equal(result.error.message, 'Request rejected.');

result = call({ version: 'v1', action: 'unknown.operation', request_id: 'req-unknown' });
assert.equal(result.ok, false);
assert.equal(result.error.code, 'UNKNOWN_ACTION');
assert.equal(result.error.message, 'Unsupported action.');

assert.equal(ntheembaAuthTouched, false, 'versioned Standard API requests must not require Ntheemba API token properties');
assert.equal(auditTouched, false, 'versioned Standard API requests must not write Ntheemba API audit rows');

console.log('TradeFlow public API foundation tests passed: v1 envelope, health/profile/hours/catalogue actions, safe errors, and public field allowlists work without Ntheemba.');
