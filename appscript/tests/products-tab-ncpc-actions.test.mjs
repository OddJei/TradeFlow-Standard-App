import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appscriptDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(appscriptDir, 'Index.html'), 'utf8');

function extract(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

const clientSource = [
  extract('function renderHelpButton', 'const NCPC_MAPPING_STATES'),
  extract('const NCPC_MAPPING_STATES', 'function getNcpcCandidateDisplayName'),
  extract('function formatCurrency', 'function formatDate(value)'),
  extract('let editingProductId = null;', 'function handleProductSearch'),
  extract('function fillEditProductBarcode', 'function scanBarcodeForEdit'),
  extract('function openNcpcMappingModal', 'function searchAddProductNcpcCandidates'),
].join('\n');

const elements = {};
function element(id, overrides = {}) {
  elements[id] = {
    value: '',
    innerHTML: '',
    checked: false,
    dataset: {},
    focus() {},
    classList: { toggle() {} },
    ...overrides,
  };
  return elements[id];
}

const rpcCalls = [];
let successHandler = null;
let failureHandler = null;
const toasts = [];
const openedModals = [];
const sandbox = {
  AppState: {
    user: 'admin',
    products: [
      { id: 101, name: 'Unmapped Cola', category: 'Drinks', barcode: 'BAR-101', sellingPrice: 15, maxStock: 40 },
      { id: 102, name: 'Suggested Sugar', category: 'Groceries', barcode: 'BAR-102', sellingPrice: 20, maxStock: 60, ncpcMapping: { status: 'MATCH_SUGGESTED', ncpcProductId: 'PRD-000002', ncpcVariantId: 'VAR-000002' } },
      { id: 103, name: 'Linked Water', category: 'Drinks', barcode: 'BAR-103', sellingPrice: 10, maxStock: 80, ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-000003', ncpcVariantId: 'VAR-000003' } },
      { id: 104, name: 'Submitted Flour', category: 'Groceries', barcode: 'BAR-104', sellingPrice: 22, maxStock: 50, ncpcMapping: { status: 'AWAITING_NCPC_REVIEW', ncpcProductId: 'PRD-000004', ncpcVariantId: 'VAR-000004' } },
      { id: 105, name: 'Stale Rice', category: 'Groceries', barcode: 'BAR-105', sellingPrice: 30, maxStock: 70, ncpcMapping: { status: 'LINK_STALE', ncpcProductId: 'PRD-000005', ncpcVariantId: 'VAR-000005' } },
      { id: 106, name: 'Broken Beans', category: 'Groceries', barcode: 'BAR-106', sellingPrice: 18, maxStock: 45, ncpcMapping: { status: 'LINK_ERROR', ncpcProductId: 'bad', ncpcVariantId: 'VAR-000006' } },
      { id: 107, name: 'Local Bread', category: 'Bakery', barcode: 'BAR-107', sellingPrice: 8, maxStock: 30, ncpcMapping: { status: 'LOCAL_ONLY' } },
    ],
  },
  document: { getElementById: id => elements[id] || null },
  window: { globalSearchTerm: '' },
  Intl,
  Number,
  String,
  RegExp,
  Object,
  Array,
  JSON,
  Math,
  Date,
  isFinite,
  parseFloat,
  parseInt,
  esc: value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),
  getFilteredProducts() { return sandbox.AppState.products; },
  getProductStock() { return 5; },
  getProductBatchTotals() { return { stockCost: 50, estimatedRevenue: 75, totalMargin: 25 }; },
  getProductValue() { return 50; },
  getLowStockCount() { return 1; },
  getProductById(id) { return sandbox.AppState.products.find(product => String(product.id) === String(id)) || null; },
  getProductBarcodeValues(product) { return [product?.barcode, ...(product?.barcodes || []).map(entry => entry?.value || entry)].filter(Boolean); },
  hasBackend() { return true; },
  getAuthToken() { return 'admin-token'; },
  getShopSnapshot() { return { shopId: 'shop-main', shopName: 'Main Shop' }; },
  showToast(message, type) { toasts.push({ message, type }); return { message, type }; },
  openModal(html) { openedModals.push(html); },
  closeModal() {},
  renderView() {},
  confirm() { return true; },
  google: { script: { run: {
    withSuccessHandler(handler) { successHandler = handler; return this; },
    withFailureHandler(handler) { failureHandler = handler; return this; },
    getNcpcProductMapping(productId, token) {
      rpcCalls.push({ method: 'getNcpcProductMapping', productId, token });
      if (successHandler) successHandler({ ok: true, mapping: null });
    },
    getNcpcPublishedCandidates(query, token) {
      rpcCalls.push({ method: 'getNcpcPublishedCandidates', query, token });
      if (successHandler) successHandler({ ok: true, candidates: [] });
    },
    saveNcpcProductMapping(payload, token) {
      rpcCalls.push({ method: 'saveNcpcProductMapping', payload, token });
      if (successHandler) successHandler({ ok: true, mapping: payload });
    },
    unpublishNcpcProductMapping(productId, token) {
      rpcCalls.push({ method: 'unpublishNcpcProductMapping', productId, token });
      if (successHandler) successHandler({ ok: true, mapping: { status: 'LINKED', publicForNtheemba: false } });
    },
    removeNcpcProductMapping(productId, token) {
      rpcCalls.push({ method: 'removeNcpcProductMapping', productId, token });
      if (successHandler) successHandler({ ok: true });
    },
  } } },
};

vm.createContext(sandbox);
vm.runInContext(clientSource, sandbox, { filename: 'Index copy.html Products NCPC helpers' });

const coverage = sandbox.getCatalogueCoverage([
  ...sandbox.AppState.products,
  { id: 108, name: 'Inactive Linked', active: false, ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-000008', ncpcVariantId: 'VAR-000008' } },
  { id: 109, name: 'Deleted Linked', deleted: true, ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-000009', ncpcVariantId: 'VAR-000009' } },
]);
assert.equal(coverage.totalActive, 7, 'coverage ignores inactive/deleted products');
assert.equal(coverage.linked, 1);
assert.equal(coverage.needsLink, 2, 'unmapped and suggested products both need linking');
assert.equal(coverage.submitted, 1);
assert.equal(coverage.needsAttention, 2, 'stale and error links need attention');
assert.equal(coverage.localOnly, 1);
assert.equal(coverage.catalogueTotal, 6, 'local-only products are visible but excluded from NCPC coverage denominator');
assert.equal(coverage.coveragePercent.toFixed(1), '16.7');
assert.equal(rpcCalls.length, 0, 'coverage calculation must use local state only');

const rowsHtml = sandbox.renderProductRowsHtml();
assert.match(rowsHtml, /Find Match/, 'unmapped products render a Find Match action');
assert.match(rowsHtml, /Review Match/, 'suggested matches render a Review Match action');
assert.match(rowsHtml, /Linked/, 'linked products render a Linked action');
assert.match(rowsHtml, /Awaiting Review/, 'submitted products render an Awaiting Review action');
assert.match(rowsHtml, /Needs Attention/, 'stale links render a Needs Attention action');
assert.match(rowsHtml, /Link Problem/, 'broken links render a Link Problem action');
assert.match(rowsHtml, /Local Only/, 'local-only products render a Local Only action');
assert.equal(rpcCalls.length, 0, 'row HTML rendering must use local state only');

const container = element('productsContainer');
sandbox.renderProducts(container);
assert.match(container.innerHTML, /Products/);
assert.match(container.innerHTML, /Central Catalogue/, 'Products page renders a local catalogue coverage summary');
assert.match(container.innerHTML, /16\.7%/, 'coverage percentage is rendered from local mapping state');
assert.match(container.innerHTML, /ui-grid-246 grid gap-2 text-sm/, 'coverage summary uses the 2-4-6 responsive grid utility');
assert.match(container.innerHTML, /1<\/div><div class="text-xs text-slate-500">linked/, 'linked count is rendered');
assert.match(container.innerHTML, /2<\/div><div class="text-xs text-slate-500">need linking/, 'needs-link count is rendered');
assert.match(container.innerHTML, /7<\/div><div class="text-xs text-slate-500">active total/, 'coverage summary renders a sixth stable cell for 2-4-6 layout');
assert.match(container.innerHTML, /Review Products/, 'coverage summary exposes a local review affordance');
assert.equal(rpcCalls.length, 0, 'Products page render must not call NCPC mapping or candidate RPCs');

assert.match(source, /\.ui-grid-246,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/, '2-column mobile utility is defined');
assert.match(source, /@media \(min-width: 768px\) and \(max-width: 1199px\)[\s\S]*\.ui-grid-246,[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/, '4-column tablet utility is defined');
assert.match(source, /@media \(min-width: 1200px\)[\s\S]*\.ui-grid-246,[\s\S]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\) !important;/, '6-column desktop utility is defined');
assert.match(source, /\.content \.ui-grid-246,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/, 'mobile one-column guard preserves explicit 2-4-6 grids');

element('ncpcCandidateResults');
element('ncpcCandidateSearch', { value: 'cola' });
sandbox.searchNcpcCandidates();
assert.deepEqual(rpcCalls.map(call => call.method), ['getNcpcPublishedCandidates'], 'candidate search is an explicit action only');
assert.equal(rpcCalls[0].query, 'cola');

rpcCalls.length = 0;
sandbox.openNcpcMappingModal(101);
assert.deepEqual(rpcCalls.map(call => call.method), ['getNcpcPublishedCandidates'], 'opening a product NCPC action auto-searches NCPC once using row identity');
assert.match(rpcCalls[0].query, /Unmapped Cola/);
assert.match(rpcCalls[0].query, /Drinks/);
assert.match(rpcCalls[0].query, /BAR-101/);
assert.match(openedModals.at(-1), /Search Central Catalogue/, 'mapping management still exposes explicit search UI with owner-friendly copy');

rpcCalls.length = 0;
sandbox.AppState.user = 'staff';
const staffRowsHtml = sandbox.renderProductRowsHtml();
assert.doesNotMatch(staffRowsHtml, /openNcpcMappingModal/, 'staff product rows do not expose NCPC mapping actions');
sandbox.openNcpcMappingModal(101);
assert.equal(rpcCalls.length, 0, 'staff cannot trigger mapping-management RPCs from the browser');
assert.match(toasts.at(-1).message, /Only an administrator/);

assert.equal(typeof failureHandler, 'function', 'mapping RPC paths retain failure handlers');

const editBarcode = element('editBarcode_101', { value: 'SCANNED-101', dataset: { source: 'scan' } });
let confirmCalls = 0;
sandbox.confirm = message => {
  confirmCalls += 1;
  assert.match(message, /Replace the scanned barcode/, 'generated barcode requires explicit replacement confirmation after scan');
  return false;
};
sandbox.fillEditProductBarcode(101);
assert.equal(editBarcode.value, 'SCANNED-101', 'declining replacement preserves the scanned edit barcode');
assert.equal(editBarcode.dataset.source, 'scan');
sandbox.confirm = () => true;
sandbox.fillEditProductBarcode(101);
assert.match(editBarcode.value, /^TF\d+$/, 'confirmed replacement generates a TradeFlow barcode');
assert.equal(editBarcode.dataset.source, 'generated');
assert.equal(confirmCalls, 1);

console.log('Products tab NCPC action tests passed: rows render deterministic local-state actions, Products render does not search NCPC, explicit search and admin mapping management remain separate.');
