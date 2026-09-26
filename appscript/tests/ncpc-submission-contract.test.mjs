import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');

const state = {
  nextId: 3000,
  products: [
    { id: 2001, name: 'Existing Bread', category: 'Bakery', unit: 'unit', barcode: 'BREAD-001', sellingPrice: 8, maxStock: 40, batches: [] },
  ],
  notifications: [],
};
let saved = 0;
let submitCalls = 0;

const sandbox = {
  requirePortalSession_: (_token, required) => { assert.equal(required, 'admin'); return { role: 'admin', username: 'owner@example.test' }; },
  _normalizeString: value => String(value ?? '').trim(),
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({}) }) },
  _getSheetData: () => [],
  getAppStateInternal_: () => state,
  saveAppStateInternal_: value => { saved++; assert.equal(value, state); return { state: value }; },
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

const client = sandbox._getNcpcClient_();
const originalSubmitProduct = client.submitProduct;
sandbox._getNcpcClient_ = () => ({
  ...client,
  submitProduct(request) {
    submitCalls++;
    return originalSubmitProduct.call(client, request);
  },
});

assert.throws(() => sandbox.createProductFromNcpcSubmission({
  submissionRequestId: 'bad',
  product: { name: 'Bad Request', category: 'Snacks', unit: 'unit', barcode: 'BAD-001', cost: 4, sellingPrice: 7, initialStock: 1, maxStock: 10 },
}, 'admin-token'), /valid submission request ID/);
assert.equal(state.products.length, 1);
assert.equal(state.nextId, 3000);

assert.throws(() => sandbox.createProductFromNcpcSubmission({
  submissionRequestId: 'TF-NCPC-SUB-REQ1',
  product: { name: 'Duplicate Barcode', category: 'Bakery', unit: 'unit', barcode: 'BREAD-001', cost: 4, sellingPrice: 7, initialStock: 1, maxStock: 10 },
}, 'admin-token'), /Barcode already exists/);
assert.equal(state.products.length, 1);
assert.equal(state.nextId, 3000);
assert.equal(submitCalls, 0, 'invalid business data must fail before fake NCPC submission');

const result = sandbox.createProductFromNcpcSubmission({
  submissionRequestId: 'TF-NCPC-SUB-REQ1',
  product: { name: 'New Local Snack', brand: '', variantName: '', category: 'Snacks', unit: 'unit', barcode: 'SNACK-001', cost: 4, sellingPrice: 7, initialStock: 12, maxStock: 50, productType: 'packed' },
}, 'admin-token');
assert.equal(result.ok, true);
assert.equal(saved, 1);
assert.equal(submitCalls, 1);
assert.equal(state.products.length, 2);
assert.equal(state.nextId, 3002);
const product = state.products[1];
assert.equal(product.id, 3001);
assert.equal(product.name, 'New Local Snack');
assert.equal(product.brand, '', 'brand is optional on manual Central Catalogue submissions');
assert.equal(product.variantName, '', 'variant/size is optional on manual Central Catalogue submissions');
assert.equal(product.sellingPrice, 7);
assert.equal(product.maxStock, 50);
assert.equal(product.ncpcMapping.status, 'AWAITING_NCPC_REVIEW');
assert.equal(product.ncpcMapping.submissionId, 'LOCAL-NCPC-SUB-REQ1');
assert.equal(product.ncpcMapping.submissionRequestId, 'TF-NCPC-SUB-REQ1');
assert.equal(product.ncpcMapping.submissionStatus, 'PENDING_REVIEW');
assert.equal(product.ncpcMapping.publicForNtheemba, false);
assert.equal(Object.hasOwn(product.ncpcMapping, 'stock'), false);
assert.equal(Object.hasOwn(product.ncpcMapping, 'sellingPrice'), false);
assert.equal(product.batches.length, 1);
assert.equal(product.batches[0].id, 3002);
assert.equal(product.batches[0].productId, product.id);
assert.equal(product.batches[0].quantityReceived, 12);
assert.equal(product.batches[0].unitCost, 4);
assert.equal(product.batches[0].sellingPriceSnapshot, 7);
assert.equal(product.batches[0].expectedUnitMargin, 3);
assert.equal(product.batches[0].expectedTotalMargin, 36);
assert.equal(state.notifications.length, 1);

const repeated = sandbox.createProductFromNcpcSubmission({
  submissionRequestId: 'TF-NCPC-SUB-REQ1',
  product: { name: 'New Local Snack', category: 'Snacks', unit: 'unit', barcode: 'SNACK-002', cost: 4, sellingPrice: 7, initialStock: 12, maxStock: 50, productType: 'packed' },
}, 'admin-token');
assert.equal(repeated.duplicateSubmission, true);
assert.equal(repeated.product.id, product.id);
assert.equal(state.products.length, 2, 'repeated submission request must not create a second product');
assert.equal(state.nextId, 3002, 'repeated submission request must not advance nextId');
assert.equal(saved, 1, 'repeated submission request must not save another state mutation');
assert.equal(submitCalls, 1, 'repeated submission request must not call fake NCPC submission again');

const status = sandbox.checkNcpcSubmissionStatus(product.id, 'admin-token');
assert.equal(status.ok, true);
assert.equal(status.submissionStatus, 'PENDING_REVIEW');
assert.equal(status.mapping.submissionId, 'LOCAL-NCPC-SUB-REQ1');
assert.equal(state.products[1].ncpcMapping.lastStatusCheckBy, 'owner@example.test');
assert.equal(saved, 2);

assert.throws(() => sandbox.checkNcpcSubmissionStatus(2001, 'admin-token'), /No pending NCPC submission/);

console.log('NCPC submission contract tests passed: fake submission creates a usable pending product, repeated request IDs are idempotent, status checks stay local, and business facts remain TradeFlow-owned.');
