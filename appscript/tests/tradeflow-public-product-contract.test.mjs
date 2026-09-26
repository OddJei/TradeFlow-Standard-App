import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');

const state = {
  currency: '',
  settings: { currency: 'ZMW' },
  products: [
    {
      id: 501,
      rowNumber: 27,
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
      supplierId: 'SUP-001',
      privateDescription: 'staff note',
      internalNotes: 'owner only',
      batches: [
        { id: 9001, productId: 501, quantityRemaining: 4, quantityReceived: 10, unitCost: 12, supplierId: 'SUP-001' },
      ],
      stockMovements: [{ id: 1, cogs: 12 }],
      ncpcMapping: {
        status: 'LINKED',
        ncpcProductId: 'PRD-501',
        ncpcVariantId: 'VAR-501',
        catalogueVersion: 'private-catalogue-version',
        releaseVersion: 'private-release-version',
        publicForNtheemba: true,
      },
    },
    {
      id: 502,
      name: 'Hidden Cola',
      brand: 'Hidden Brand',
      category: 'Drinks',
      barcode: 'COLA-HIDDEN',
      sellingPrice: 30,
      batches: [{ quantityRemaining: 8, unitCost: 13 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-502', ncpcVariantId: 'VAR-502', publicForNtheemba: false },
    },
    {
      id: 503,
      name: 'Sold Out Bread',
      brand: '',
      variantName: '',
      category: 'Bakery',
      unit: 'loaf',
      barcode: 'BREAD-503',
      productType: 'packed',
      sellingPrice: 8,
      cost: 3,
      batches: [{ quantityRemaining: 0, unitCost: 3 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-503', ncpcVariantId: 'VAR-503', publicForNtheemba: true },
    },
  ],
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
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
  getTradeFlowRuntimeConfig_: () => ({ product: 'TradeFlow', edition: 'Standard v1', appVersion: '1.0.0' }),
  getAppStateInternal_: () => state,
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
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'NtheembaMapping.gs' });

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
  'supplierId',
  'privateDescription',
  'internalNotes',
  'batches',
  'stockMovements',
  'rowNumber',
  'quantityRemaining',
  'quantityReceived',
  'unitCost',
  'catalogueVersion',
  'releaseVersion',
  'publicForNtheemba',
  'AppState',
  'api_token',
  'secret',
];
const assertNoForbiddenKeys = value => {
  const text = JSON.stringify(value);
  for (const key of forbidden) {
    assert.equal(text.includes(key), false, `public product response leaked ${key}`);
  }
};
const assertPublicProductShape = product => {
  assert.deepEqual(Object.keys(product).sort(), ['availability', 'barcode', 'barcodes', 'brand', 'business_product_id', 'catalogue_source', 'category', 'currency', 'identity', 'identity_status', 'name', 'product_type', 'selling_price', 'shop_availability', 'shop_id', 'unit', 'variant']);
  assert.deepEqual(Object.keys(product.identity).sort(), ['linked', 'ncpc_prd_id', 'ncpc_var_id', 'status']);
  assert.deepEqual(Object.keys(product.availability).sort(), ['status']);
  assert.deepEqual(Object.keys(product.shop_availability).sort(), ['shop_id', 'shop_name', 'status']);
  assert.equal(typeof product.business_product_id, 'string');
  assert.equal(typeof product.selling_price, 'number');
  assert.equal(product.currency, 'ZMW');
  assertNoForbiddenKeys(product);
};

let result = call({ version: 'v1', action: 'catalogue.item', request_id: 'by-product-id', data: { business_product_id: '501' } });
assert.equal(result.ok, true);
assertPublicProductShape(result.data.item);
assert.equal(result.data.item.business_product_id, '501');
assert.deepEqual(result.data.item.identity, { status: 'linked', linked: true, ncpc_prd_id: 'PRD-501', ncpc_var_id: 'VAR-501' });
assert.equal(result.data.item.name, 'Local Cola');
assert.equal(result.data.item.variant, '500 ml');
assert.equal(result.data.item.selling_price, 25);
assert.deepEqual(result.data.item.availability, { status: 'in_stock' });

result = call({ version: 'v1', action: 'catalogue.item', request_id: 'by-barcode', data: { barcode: 'COLA-500' } });
assert.equal(result.ok, true);
assert.equal(result.data.item.business_product_id, '501');
assertPublicProductShape(result.data.item);

result = call({ version: 'v1', action: 'catalogue.search', request_id: 'by-text', data: { query: 'cola' } });
assert.equal(result.ok, true);
assert.equal(result.data.items.length, 1, 'text search returns only public matching products');
assert.equal(result.data.items[0].business_product_id, '501');
assertPublicProductShape(result.data.items[0]);

result = call({ version: 'v1', action: 'catalogue.search', request_id: 'by-barcode-search', data: { barcode: 'COLA-500' } });
assert.equal(result.ok, true);
assert.equal(result.data.items.length, 1);
assert.equal(result.data.items[0].business_product_id, '501');
assertPublicProductShape(result.data.items[0]);

result = call({ version: 'v1', action: 'catalogue.by_ncpc_variant', request_id: 'by-variant', data: { ncpc_variant_id: 'VAR-501' } });
assert.equal(result.ok, true);
assert.equal(result.data.items.length, 1);
assert.equal(result.data.items[0].business_product_id, '501');
assertPublicProductShape(result.data.items[0]);

result = call({ version: 'v1', action: 'catalogue.item', request_id: 'hidden', data: { business_product_id: '502' } });
assert.equal(result.ok, false, 'non-public mappings cannot be fetched by public product ID');

result = call({ version: 'v1', action: 'catalogue.item', request_id: 'sold-out', data: { business_product_id: '503' } });
assert.equal(result.ok, true);
assert.deepEqual(result.data.item.availability, { status: 'out_of_stock' });
assertPublicProductShape(result.data.item);

console.log('TradeFlow public product contract tests passed: business_product_id, safe NCPC identity, price, availability, lookup paths, and private-field allowlists are covered.');
