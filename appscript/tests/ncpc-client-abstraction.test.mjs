import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');

const releaseRows = [
  ['PRD-000001', 'VAR-000001', 'Cola', '500 ml', '123 | brown drink', '470', 'NCPC-20260822-120000', 'now'],
  ['PRD-000001', 'VAR-000002', 'Cola', '1 L', '456', '470', 'NCPC-20260822-120000', 'now'],
  ['PRD-000002', 'VAR-000003', 'Water', '750 ml', '789', '470', 'NCPC-20260822-120000', 'now'],
  ['bad-product', 'VAR-000004', 'Invalid', 'Ignored', '', '470', 'NCPC-20260822-120000', 'now'],
];
const state = {
  products: [
    { id: '101', name: 'Local Cola', sellingPrice: 25, supplier: 'private', batches: [{ unitCost: 10, quantityRemaining: 4 }], ncpcMapping: null },
  ],
};
let sheetLoaded = true;
let saved = 0;

const sandbox = {
  requirePortalSession_: (_token, required) => {
    assert.equal(required, 'admin');
    return { role: 'admin', username: 'owner@example.test' };
  },
  _normalizeString: value => String(value ?? '').trim(),
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => (sheetLoaded ? {} : null) }) },
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
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'NtheembaMapping.gs' });

const client = sandbox._getNcpcClient_();
assert.equal(client.kind, 'local_approved_release');
assert.equal(typeof client.searchCandidates, 'function');
assert.equal(typeof client.getVariant, 'function');
assert.equal(typeof client.submitProduct, 'function');
assert.equal(typeof client.getSubmissionStatus, 'function');
assert.match(source, /linkCoverage: function\(request\)/, 'HTTP NCPC client exposes the coverage-link operation');
assert.match(source, /\/v1\/businesses\/.*\/coverage/, 'coverage-link operation targets the canonical NCPC route');
assert.match(source, /_linkNcpcCoverageIfConfigured_/, 'approved-candidate flows share the coverage-link guard');

let result = sandbox.getNcpcPublishedCandidates('cola', 'admin-token');
assert.equal(result.clientKind, 'local_approved_release');
assert.equal(result.candidates.length, 2, 'candidate search uses the local approved-release client');
assert.deepEqual(result.candidates.map(item => item.ncpcVariantId), ['VAR-000001', 'VAR-000002']);
assert.equal(Object.hasOwn(result.candidates[0], 'sellingPrice'), false, 'NCPC candidates cannot include TradeFlow price');
assert.equal(Object.hasOwn(result.candidates[0], 'stock'), false, 'NCPC candidates cannot include TradeFlow stock');

result = client.searchCandidates({ query: 'cola', limit: 1 });
assert.equal(result.candidates.length, 1, 'client search respects the bounded result limit');

const variant = client.verifyVariant({ ncpcProductId: 'PRD-000002', ncpcVariantId: 'VAR-000003' });
assert.equal(variant.canonicalName, 'Water');
assert.throws(() => client.verifyVariant({ ncpcProductId: 'PRD-000002', ncpcVariantId: 'VAR-404' }), /not present/);
assert.throws(() => client.verifyVariant({ ncpcProductId: 'bad', ncpcVariantId: 'VAR-000003' }), /Valid NCPC product/);
const submission = client.submitProduct({ submissionRequestId: 'TF-NCPC-SUB-REQ1', name: 'New Product', category: 'Snacks', unit: 'unit' });
assert.equal(submission.clientKind, 'local_approved_release');
assert.equal(submission.submissionId, 'LOCAL-NCPC-SUB-REQ1');
assert.equal(submission.submissionStatus, 'PENDING_REVIEW');
assert.equal(client.getSubmissionStatus({ submissionId: submission.submissionId }).submissionStatus, 'PENDING_REVIEW');
assert.throws(() => client.submitProduct({}), /valid submission request ID/);
assert.throws(() => client.getSubmissionStatus({ submissionId: 'LIVE-123' }), /Unknown NCPC submission ID/);

const privateBefore = JSON.stringify({ sellingPrice: state.products[0].sellingPrice, supplier: state.products[0].supplier, batches: state.products[0].batches });
result = sandbox.saveNcpcProductMapping({ productId: '101', ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000001', publicForNtheemba: true }, 'admin-token');
assert.equal(result.mapping.status, 'LINKED');
assert.equal(result.mapping.ncpcVariantId, 'VAR-000001');
assert.equal(JSON.stringify({ sellingPrice: state.products[0].sellingPrice, supplier: state.products[0].supplier, batches: state.products[0].batches }), privateBefore, 'client-backed mapping must not change TradeFlow business facts');
assert.equal(saved, 1);

sheetLoaded = false;
result = sandbox.getNcpcPublishedCandidates('cola', 'admin-token');
assert.equal(result.ok, true);
assert.equal(result.candidates.length, 0);
assert.match(result.message, /Load an approved NCPC release/);
assert.throws(() => client.verifyVariant({ ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000001' }), /No approved NCPC release/);

console.log('NCPC client abstraction tests passed: approved-release search, verify, fake submission, and fake status checks run through the local client without live NCPC, and TradeFlow business facts remain unchanged.');
