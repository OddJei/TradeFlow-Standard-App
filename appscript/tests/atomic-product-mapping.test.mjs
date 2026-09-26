import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');

const releaseRows = [
  ['PRD-000001', 'VAR-000001', 'Cola', '500 ml', '123', '470', 'NCPC-20260822-120000', 'now'],
  ['PRD-000001', 'VAR-000002', 'Cola', '1 L', '456', '470', 'NCPC-20260822-120000', 'now'],
];
const state = {
  nextId: 1000,
  products: [
    { id: 501, name: 'Existing Cola', sellingPrice: 25, batches: [], ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000002' } },
  ],
  notifications: [],
};
let saved = 0;
const sandbox = {
  requirePortalSession_: (_token, required) => { assert.equal(required, 'admin'); return { role: 'admin', username: 'owner@example.test' }; },
  _normalizeString: value => String(value ?? '').trim(),
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({}) }) },
  _getSheetData: () => releaseRows,
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

const beforeDuplicate = JSON.stringify(state);
assert.throws(() => sandbox.createProductFromNcpcCandidate({
  ncpcProductId: 'PRD-000001',
  ncpcVariantId: 'VAR-000002',
  product: { name: 'Duplicate Cola', category: 'Drinks', unit: '500 ml', barcode: 'DUP-1', cost: 10, sellingPrice: 15, initialStock: 5, maxStock: 50, productType: 'packed' },
}, 'admin-token'), /already in your catalogue/);
assert.equal(JSON.stringify(state), beforeDuplicate, 'duplicate VAR rejection must not create product, batch, notification, or advance nextId');

const beforeBadMapping = JSON.stringify(state);
assert.throws(() => sandbox.createProductFromNcpcCandidate({
  ncpcProductId: 'PRD-000001',
  ncpcVariantId: 'VAR-404',
  product: { name: 'Bad Cola', category: 'Drinks', unit: '500 ml', barcode: 'BAD-1', cost: 10, sellingPrice: 15, initialStock: 5, maxStock: 50, productType: 'packed' },
}, 'admin-token'), /not present/);
assert.equal(JSON.stringify(state), beforeBadMapping, 'mapping verification failure must not corrupt product stock/accounting');

const result = sandbox.createProductFromNcpcCandidate({
  ncpcProductId: 'PRD-000001',
  ncpcVariantId: 'VAR-000001',
  product: { name: 'Local Cola 500', category: 'Drinks', unit: '500 ml', barcode: 'COLA-500', cost: 10, sellingPrice: 18, initialStock: 7, maxStock: 70, productType: 'packed' },
}, 'admin-token');
assert.equal(result.ok, true);
assert.equal(saved, 1);
assert.equal(state.products.length, 2);
assert.equal(state.nextId, 1002);
const product = state.products[1];
assert.equal(product.id, 1001);
assert.equal(product.name, 'Local Cola 500');
assert.equal(product.sellingPrice, 18);
assert.equal(product.maxStock, 70);
assert.equal(product.ncpcMapping.status, 'LINKED');
assert.equal(product.ncpcMapping.ncpcProductId, 'PRD-000001');
assert.equal(product.ncpcMapping.ncpcVariantId, 'VAR-000001');
assert.equal(product.ncpcMapping.publicForNtheemba, false);
assert.equal(Object.hasOwn(product.ncpcMapping, 'stock'), false);
assert.equal(Object.hasOwn(product.ncpcMapping, 'sellingPrice'), false);
assert.equal(product.batches.length, 1);
assert.equal(product.batches[0].id, 1002);
assert.equal(product.batches[0].productId, product.id);
assert.equal(product.batches[0].quantityReceived, 7);
assert.equal(product.batches[0].unitCost, 10);
assert.equal(product.batches[0].sellingPriceSnapshot, 18);
assert.equal(product.batches[0].expectedUnitMargin, 8);
assert.equal(product.batches[0].expectedTotalMargin, 56);
assert.equal(state.notifications.length, 1);

const existingIds = state.products.map(item => item.id);
assert.deepEqual(existingIds, [501, 1001], 'existing product IDs remain stable');

console.log('Atomic product + mapping tests passed: duplicate VAR and bad mapping fail before mutation, linked product and initial batch are created coherently, and existing IDs stay stable.');
