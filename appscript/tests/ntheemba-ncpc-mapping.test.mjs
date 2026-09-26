import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');
const state = { products: [{ id: '101', name: 'Local Cola', sellingPrice: 25, privateDescription: 'Shop only', supplier: 'Local Supplier', batches: [{ unitCost: 10, quantityRemaining: 4 }], ncpcMapping: null }] };
const releaseRows = [
  ['PRD-000001', 'VAR-000001', 'Cola', '500 ml', '123', '470', 'NCPC-20260822-120000', 'now'],
  ['PRD-000001', 'VAR-000002', 'Cola', '1 L', '456', '470', 'NCPC-20260822-120000', 'now'],
];
let role = 'admin';
let saved = 0;
const sandbox = {
  requirePortalSession_: (_token, required) => { if (required && role !== required) throw new Error('You are not authorized for this action.'); return { role, username: 'owner@example.test' }; },
  _normalizeString: value => String(value ?? '').trim(),
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  getAppStateInternal_: () => state,
  saveAppStateInternal_: value => { saved++; assert.equal(value, state); return { state: value }; },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({}) }) },
  _getSheetData: () => releaseRows,
  Date,
  JSON,
  Array,
  String,
  RegExp,
  Object,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'NtheembaMapping.gs' });

const privateBefore = JSON.stringify({ sellingPrice: state.products[0].sellingPrice, privateDescription: state.products[0].privateDescription, supplier: state.products[0].supplier, batches: state.products[0].batches });
let result = sandbox.saveNcpcProductMapping({ productId: '101', ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000001', publicForNtheemba: true }, 'admin-token');
assert.equal(result.mapping.status, 'LINKED');
assert.equal(result.mapping.ncpcVariantId, 'VAR-000001');
assert.equal(result.mapping.catalogueVersion, '470');
assert.equal(result.mapping.releaseVersion, 'NCPC-20260822-120000');
assert.equal(JSON.stringify({ sellingPrice: state.products[0].sellingPrice, privateDescription: state.products[0].privateDescription, supplier: state.products[0].supplier, batches: state.products[0].batches }), privateBefore, 'mapping must not change private local fields');

result = sandbox.saveNcpcProductMapping({ productId: '101', ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000002' }, 'admin-token');
assert.equal(result.mapping.ncpcVariantId, 'VAR-000002', 'admin can replace an existing mapping');

state.products.push({ id: '202', name: 'Duplicate Cola', sellingPrice: 20, batches: [], ncpcMapping: null });
assert.throws(() => sandbox.saveNcpcProductMapping({ productId: '202', ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000002' }, 'admin-token'), /already in your catalogue/);

result = sandbox.unpublishNcpcProductMapping('101', 'admin-token');
assert.equal(result.mapping.publicForNtheemba, false);
result = sandbox.removeNcpcProductMapping('101', 'admin-token');
assert.equal(result.mapping, null);
assert.equal(state.products[0].ncpcMapping, undefined);

assert.throws(() => sandbox.saveNcpcProductMapping({ productId: '101', ncpcProductId: 'PRD-BAD', ncpcVariantId: 'VAR-999999' }, 'admin-token'), /not present/);
role = 'staff';
assert.throws(() => sandbox.saveNcpcProductMapping({ productId: '101', ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000001' }, 'staff-token'), /not authorized/);
assert.ok(saved >= 4, 'create, update, unpublish, and remove must persist through AppState');
console.log('NCPC mapping tests passed: admin create/update/remove, non-admin rejection, invalid-ID rejection, and private-field preservation.');
