import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(appRoot, 'code copy.gs'), 'utf8');
const html = fs.readFileSync(path.join(appRoot, 'Index copy.html'), 'utf8');
const mapping = fs.readFileSync(path.join(appRoot, 'NtheembaMapping.gs'), 'utf8');
const locationFallback = fs.readFileSync(path.join(appRoot, 'LocationCatalogueFallback.gs'), 'utf8');

const state = {
  nextId: 9000,
  activeShopId: 'shop-main',
  settings: { currency: 'ZMW', activeShopId: 'shop-main' },
  shops: [
    { id: 'shop-main', name: 'Main Shop', status: 'active', isPrimary: true, location: { countryId: 'ZM', provinceId: 'zm-copperbelt', provinceName: 'Copperbelt', districtId: 'zm-copperbelt-mufulira', districtName: 'Mufulira', townId: 'zm-copperbelt-mufulira-mufulira', townName: 'Mufulira', area: 'Kantanshi', catalogueVersion: '5.0' } },
    { id: 'shop-2', name: 'Second Shop', status: 'active', isPrimary: false, location: { countryId: 'ZM', provinceId: 'zm-lusaka', provinceName: 'Lusaka', districtId: 'zm-lusaka-lusaka', districtName: 'Lusaka', townOther: 'Garden', area: 'Northmead', catalogueVersion: '5.0' } },
  ],
  products: [
    {
      id: 701,
      name: 'Linked Mojo 500 ml',
      brand: 'Mojo',
      variantName: '500 ml',
      category: 'Drinks',
      unit: 'bottle',
      barcode: '0001234567890',
      barcodes: [
        { value: '0001234567890', label: 'cola', kind: 'manufacturer', isPrimary: true, source: 'scan' },
        { value: '6900001112223', label: 'orange', kind: 'manufacturer', isPrimary: false, source: 'manual' },
      ],
      productType: 'packed',
      sellingPrice: 12,
      batches: [
        { id: 801, shopId: 'shop-main', shopName: 'Main Shop', quantityRemaining: 4, unitCost: 7, supplier: 'private' },
        { id: 802, shopId: 'shop-2', shopName: 'Second Shop', quantityRemaining: 0, unitCost: 7, supplier: 'private' },
      ],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-701', ncpcVariantId: 'VAR-701', publicForNtheemba: true },
    },
    {
      id: 702,
      name: 'Local Public Noodles',
      category: 'Foods',
      unit: 'pack',
      barcode: 'NOODLE-LOCAL',
      publicForNtheemba: false,
      productType: 'packed',
      sellingPrice: 8,
      batches: [{ quantityRemaining: 2, unitCost: 3 }],
      ncpcMapping: { status: 'AWAITING_NCPC_REVIEW', submissionId: 'LOCAL-NCPC-SUB-702', submissionStatus: 'PENDING_REVIEW', publicForNtheemba: false },
    },
    {
      id: 703,
      name: 'Private Sugar',
      category: 'Groceries',
      unit: 'kg',
      barcode: 'PRIVATE-SUGAR',
      publicForNtheemba: false,
      sellingPrice: 30,
      batches: [{ quantityRemaining: 10, unitCost: 20 }],
    },
  ],
  ncpcCorrectionRequests: [],
};

let saved = 0;
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
  }[key] || ''), getProperties: () => ({}), setProperty() {}, deleteProperty() {} }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
  getTradeFlowRuntimeConfig_: () => ({ product: 'TradeFlow', edition: 'Standard v1', appVersion: 'review-refinement' }),
  getAppStateInternal_: () => state,
  saveAppStateInternal_: value => { saved += 1; assert.equal(value, state); return { state: value }; },
  requirePortalSession_: () => ({ role: 'admin', username: 'owner@example.test' }),
  _ensureSheet: () => ({ sheet: {} }),
  _appendRow: () => {},
  _getSheetData: () => [],
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
vm.runInContext(mapping, sandbox, { filename: 'NtheembaMapping.gs' });

const call = body => {
  const request = { ...body };
  if (request.version === 'v1' && request.action !== 'health' && !request.api_token) {
    request.api_token = 'tf-public-token';
    request.business_id = 'STANDARD_STAGING_BUSINESS_ID';
  }
  return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(request) } }).text);
};

let result = call({ version: 'v1', action: 'catalogue.item', request_id: 'alt-barcode', data: { barcode: '6900001112223', shop_id: 'shop-main' } });
assert.equal(result.ok, true);
assert.equal(result.data.item.business_product_id, '701');
assert.equal(result.data.item.barcode, '0001234567890', 'primary barcode mirror is preserved');
assert.equal(result.data.item.shop_availability.shop_id, 'shop-main');
assert.equal(result.data.item.availability.status, 'in_stock');

result = call({ version: 'v1', action: 'catalogue.item', request_id: 'shop-2-barcode', data: { barcode: '6900001112223', shop_id: 'shop-2' } });
assert.equal(result.ok, true);
assert.equal(result.data.item.shop_availability.shop_id, 'shop-2');
assert.equal(result.data.item.availability.status, 'out_of_stock', 'availability is scoped to the requested shop');

result = call({ version: 'v1', action: 'catalogue.search', request_id: 'local-public', data: { query: 'noodles' } });
assert.equal(result.ok, true);
assert.equal(result.data.items.length, 0, 'review-pending product remains internal until linked and explicitly published');

result = call({ version: 'v1', action: 'catalogue.search', request_id: 'private-hidden', data: { query: 'Private Sugar' } });
assert.equal(result.ok, true);
assert.equal(result.data.items.length, 0, 'private local products stay hidden');

result = call({ version: 'v1', action: 'order.create', request_id: 'multi-shop-requires-shop', data: { idempotency_key: 'order-no-shop-701', items: [{ business_product_id: '701', quantity: 1 }] } });
assert.equal(result.ok, false, 'multi-shop public order creation requires explicit shop identity');

result = call({ version: 'v1', action: 'order.create', request_id: 'multi-shop-with-shop', data: { idempotency_key: 'order-shop-701', shop_id: 'shop-main', items: [{ business_product_id: '701', quantity: 1 }] } });
assert.equal(result.ok, true);
assert.equal(result.data.order.shop_id, 'shop-main');
assert.equal(state.customerOrders.at(-1).shopId, 'shop-main', 'stored customer order keeps assigned shop');

const savedBeforeCorrection = saved;
const correction = sandbox.submitNcpcProductCorrection({
  productId: '701',
  correctionRequestId: 'TF-NCPC-CORR-ALT701',
  field: 'barcode',
  previousValue: '0001234567890',
  proposedValue: '6900001112223',
  source: 'scan',
}, 'admin-token');
assert.equal(correction.ok, true);
assert.equal(correction.correction.correctionStatus, 'PENDING_REVIEW');
assert.equal(correction.correction.ncpcVariantId, 'VAR-701');
assert.equal(saved, savedBeforeCorrection + 1);

const repeat = sandbox.submitNcpcProductCorrection({
  productId: '701',
  correctionRequestId: 'TF-NCPC-CORR-ALT701',
  field: 'barcode',
  previousValue: 'ignored',
  proposedValue: 'ignored',
}, 'admin-token');
assert.equal(repeat.duplicateCorrection, true, 'correction request is idempotent');
assert.equal(saved, savedBeforeCorrection + 1);

assert.throws(() => sandbox.submitNcpcProductCorrection({
  productId: '701',
  correctionRequestId: 'TF-NCPC-CORR-PRICE701',
  field: 'sellingPrice',
  previousValue: '10',
  proposedValue: '12',
}, 'admin-token'), /TradeFlow-owned business values cannot be submitted/);

assert.match(backend, /ProductBarcodes: \["Product ID", "Product Name", "Barcode"/, 'ProductBarcodes projection exists');
assert.match(backend, /NcpcCorrectionRequests: \["Correction Request ID"/, 'NCPC correction projection exists');
assert.match(backend, /var TF_STANDARD_MAX_SHOPS = 3;/, 'backend enforces the Standard three-shop Sprint-01 cap');
assert.match(backend, /TF_STANDARD_CONTROL_SHEET_ID_KEY = 'TRADEFLOW_STANDARD_CONTROL_SHEET_ID_V1'/, 'backend has Harvest-style Standard control spreadsheet configuration');
assert.match(backend, /TF_STANDARD_SHOP_SHEETS_FOLDER_URL_KEY = 'TRADEFLOW_STANDARD_SHOP_SHEETS_FOLDER_URL'/, 'backend has optional shop-sheet folder configuration');
assert.match(backend, /function setupStandardMultiShopSourceModel_/, 'backend can create a control sheet plus separate shop spreadsheets');
assert.match(backend, /function getStandardShopSpreadsheet_/, 'backend resolves per-shop spreadsheets');
assert.match(backend, /function getAppStateForShop/, 'backend exposes per-shop state reads');
assert.match(backend, /function saveAppStateForShop/, 'backend exposes per-shop state writes');
assert.match(backend, /function getSyncSnapshotForShop/, 'backend exposes per-shop sync reads');
assert.match(backend, /function pushSyncOpsForShop/, 'backend exposes per-shop sync writes');
assert.match(backend, /StaffAssignments: \["Assignment ID", "Staff ID", "Username", "Shop ID"/, 'control model records exactly one shop assignment per staff account');
assert.doesNotMatch(backend, /NTHEEMBA_LOCATION_API_URL/, 'shop setup keeps the approved embedded-only Zambia location catalogue with no runtime location-service dependency');
assert.match(backend, /getEmbeddedStandardLocationCatalogue_\(\)/, 'location catalogue has an embedded fallback path');
assert.match(backend, /applySyncShopContext_\(state, incoming, action\)/, 'backend preserves immutable queued sync shop context');
assert.match(backend, /Shops: \["Shop ID", "Shop Name", "Spreadsheet ID"/, 'Shops workflow projection includes per-shop spreadsheet identity');
assert.match(mapping, /barcode: barcode,\s+barcodes: barcode \?/, 'server product creation preserves blank barcode and only mirrors explicit barcode');
assert.doesNotMatch(mapping, /barcode: barcode \|\| \('TF'/, 'server does not silently generate TF barcodes for blank input');
assert.match(mapping, /requireExplicitForMultiShop: true/, 'public order creation requires shop_id for multi-shop businesses');

assert.match(html, /function normalizeProductBarcodes\(product\)/, 'client hydrates legacy and alternate barcodes');
assert.match(html, /function addAlternateBarcodeToProduct\(id\)/, 'client exposes a simple alternate barcode manager');
assert.match(html, /function findLocalAddProductMatches\(name\)/, 'Add Product checks local products before Central Catalogue search');
assert.match(html, /const MAX_STANDARD_SHOPS = 3;/, 'UI rejects a fourth Standard shop');
assert.match(html, /function renderFirstTimeSetupWizard\(\)/, 'first-time setup wizard remains the required workspace setup path');
assert.match(html, /function setFirstSetupShopCount\(count\)/, 'first-time setup can collect one to three initial shops');
assert.match(html, /getStandardLocationCatalogue\(\)/, 'first-time setup pulls the canonical location catalogue through the backend');
assert.match(html, /renderCanonicalLocationPicker/, 'setup UI uses canonical province, district, and town dropdowns');
assert.match(html, /pushSyncOpsForShop/, 'client sync writes target the active shop sheet');
assert.match(html, /getSyncSnapshotForShop/, 'client sync reads target the active shop sheet');
assert.match(html, /spreadsheetId: String\(shop\.spreadsheetId/, 'settings preserves per-shop spreadsheet IDs created during setup');
assert.match(html, /function switchActiveShop\(shopId\)/, 'UI persists explicit active shop switching');
assert.match(html, /action: \{ view: AppState\.currentView \|\| '', shopId, shopName: shop\.shopName \}/, 'queued sync operation keeps original shop context');
assert.match(html, /renderLocalAddProductMatches\(name\);\s+searchAddProductNcpcCandidates\(\);/, 'local duplicate warning runs before Central Catalogue search');
assert.doesNotMatch(html, /modalProductBarcode'\)\.value\.trim\(\) \|\| \('TF'/, 'client Add Product does not silently generate TF barcodes');
assert.match(html, /Replace the scanned barcode with a generated TradeFlow barcode/, 'edit-mode generated barcode cannot silently replace a scanned barcode');
assert.match(locationFallback, /function getEmbeddedStandardLocationCatalogue_/, 'embedded Zambia location fallback is included in Standard source');
assert.match(locationFallback, /\"areas\"/, 'embedded V5 catalogue carries town-specific area suggestions');
assert.match(locationFallback, /\"locality_hints\"/, 'embedded V5 catalogue carries district locality fallback suggestions');
assert.match(locationFallback, /\"allow_unlisted_area\": true/, 'area entry still allows manual values when suggestions are incomplete');

console.log('TradeFlow review-refinement tests passed: exact/multiple barcodes, local duplicate warnings, NCPC corrections, review-pending provisional fallback, shop-scoped public API, and projection hooks are covered.');
