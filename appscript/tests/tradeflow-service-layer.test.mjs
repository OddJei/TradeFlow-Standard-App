import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');

const releaseRows = [
  ['PRD-000001', 'VAR-000001', 'Cola', '500 ml', '123', '470', 'NCPC-20260822-120000', 'now'],
  ['PRD-000002', 'VAR-000002', 'Water', '750 ml', '456', '470', 'NCPC-20260822-120000', 'now'],
  ['PRD-000003', 'VAR-000003', 'Biscuits', '100 g', '789', '470', 'NCPC-20260822-120000', 'now'],
  ['PRD-000004', 'VAR-000004', 'Juice', '250 ml', '987', '470', 'NCPC-20260822-120000', 'now'],
];
const state = {
  nextId: 7000,
  products: [
    {
      id: 'public-1',
      name: 'Public Cola',
      barcode: 'PUB-COLA',
      sellingPrice: 25,
      supplier: 'private supplier',
      batches: [{ quantityRemaining: 3, unitCost: 11 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000001', publicForNtheemba: true },
    },
    {
      id: 'private-1',
      name: 'Private Water',
      sellingPrice: 10,
      privateDescription: 'do not expose',
      batches: [{ quantityRemaining: 4 }],
      ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-000002', ncpcVariantId: 'VAR-000002', publicForNtheemba: false },
    },
  ],
  notifications: [],
};
let saved = 0;
let authCalls = 0;

const sandbox = {
  requirePortalSession_: (_token, required) => {
    authCalls++;
    assert.equal(required, 'admin');
    return { role: 'admin', username: 'owner@example.test' };
  },
  _normalizeString: value => String(value ?? '').trim(),
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({}) }) },
  _getSheetData: () => releaseRows,
  getAppStateInternal_: () => state,
  saveAppStateInternal_: value => {
    saved++;
    assert.equal(value, state);
    return { state: value };
  },
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

const productIdentity = sandbox.getProductIdentityService_();
assert.equal(typeof productIdentity.saveMapping, 'function');
assert.equal(typeof productIdentity.createFromCandidate, 'function');
assert.equal(typeof productIdentity.createFromSubmission, 'function');
assert.equal(typeof productIdentity.checkSubmissionStatus, 'function');

const directCandidate = productIdentity.createFromCandidate({
  ncpcProductId: 'PRD-000003',
  ncpcVariantId: 'VAR-000003',
  product: {
    name: 'Local Water',
    brand: 'Editable Brand',
    variantName: 'Owner Override 750 ml',
    category: 'Drinks',
    unit: '750 ml',
    barcode: 'WATER-750',
    cost: 5,
    sellingPrice: 9,
    initialStock: 6,
    maxStock: 60,
    productType: 'packed',
  },
}, { role: 'admin', username: 'service@example.test' });
assert.equal(directCandidate.ok, true);
assert.equal(directCandidate.product.ncpcMapping.status, 'LINKED');
assert.equal(directCandidate.product.brand, 'Editable Brand');
assert.equal(directCandidate.product.variantName, 'Owner Override 750 ml');
assert.equal(directCandidate.product.batches[0].expectedTotalMargin, 24);

const directSubmission = productIdentity.createFromSubmission({
  submissionRequestId: 'TF-NCPC-SUB-SERVICE1',
  product: {
    name: 'Service Manual Product',
    brand: '',
    variantName: '',
    category: 'Snacks',
    unit: 'unit',
    barcode: 'SERVICE-MANUAL',
    cost: 4,
    sellingPrice: 7,
    initialStock: 2,
    maxStock: 20,
    productType: 'packed',
  },
}, { role: 'admin', username: 'service@example.test' });
assert.equal(directSubmission.ok, true);
assert.equal(directSubmission.product.ncpcMapping.status, 'AWAITING_NCPC_REVIEW');
assert.equal(directSubmission.product.ncpcMapping.submissionRequestId, 'TF-NCPC-SUB-SERVICE1');

const wrapperResult = sandbox.saveNcpcProductMapping({
  productId: directSubmission.product.id,
  ncpcProductId: 'PRD-000004',
  ncpcVariantId: 'VAR-000004',
  publicForNtheemba: true,
}, 'admin-token');
assert.equal(wrapperResult.ok, true);
assert.equal(authCalls, 1, 'RPC wrapper authenticates before invoking the service boundary');

const catalogue = sandbox.getCatalogueService_();
assert.equal(typeof catalogue.searchPublicCatalogue, 'function');
assert.equal(typeof catalogue.getPublicItem, 'function');
assert.equal(typeof catalogue.findByNcpcVariants, 'function');

const search = catalogue.searchPublicCatalogue({ query: 'cola' });
assert.equal(search.length, 1);
assert.deepEqual(Object.keys(search[0]).sort(), ['available', 'item_id', 'item_type', 'name', 'ncpc_variant_id', 'price']);
assert.equal(Object.hasOwn(search[0], 'supplier'), false);
assert.equal(Object.hasOwn(search[0], 'unitCost'), false);

const publicItem = catalogue.getPublicItem('public-1');
assert.equal(publicItem.name, 'Public Cola');
assert.throws(() => catalogue.getPublicItem('private-1'), /Product not found/);

const batchItems = catalogue.findByNcpcVariants(['VAR-000001', 'VAR-000004']);
assert.equal(batchItems.length, 2);
assert.deepEqual(Object.keys(batchItems[0]).sort(), ['availability', 'business_item_id', 'contract_version', 'display_name', 'ncpc_product_id', 'ncpc_variant_id', 'public_price', 'stock_status']);
assert.equal(Object.hasOwn(batchItems[0], 'supplier'), false);
assert.equal(saved, 3);

console.log('TradeFlow service layer tests passed: ProductIdentityService and CatalogueService are callable directly, RPC auth remains outside the business service, and public catalogue output stays allowlisted.');
