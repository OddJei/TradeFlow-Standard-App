import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'Index copy.html'), 'utf8');

function extract(sourceText, startNeedle, endNeedle) {
  const start = sourceText.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = sourceText.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return sourceText.slice(start, end);
}

const helperSource = [
  'var addProductNcpcCandidates = {};',
  extract(source, 'function getNcpcCandidateDisplayName', 'function formatCurrency(amount)'),
  extract(source, 'function searchAddProductNcpcCandidates', 'function fillEditProductBarcode'),
  extract(source, 'function getProductCategories()', 'function readAddProductForm()'),
  extract(source, 'function readAddProductForm()', 'function openBarcodeExport'),
].join('\n');

const elements = {};
function setInput(id, value) {
  elements[id] = elements[id] || {};
  elements[id].value = value;
  elements[id].innerHTML = elements[id].innerHTML || '';
  elements[id].classList = { toggle() {} };
  return elements[id];
}

let nextId = 1000;
let lastPatch = null;
let lastLinkedRequest = null;
let lastSubmissionRequest = null;
let lastOpenedModal = '';
const toasts = [];
let rpcSuccessHandler = null;
let rpcFailureHandler = null;
const sandbox = {
  AppState: { products: [], notifications: [], user: 'admin' },
  document: { getElementById: id => elements[id] || null },
  addProductNcpcCandidates: {},
  getAddProductCategoryValue: () => String(elements.modalProductCategory?.value || '').trim(),
  getActiveUserContext: () => ({ id: 'admin-1', name: 'Owner Admin', role: 'admin' }),
  generateId: () => ++nextId,
  normalizeBatch: (_product, batch) => batch,
  mutate: fn => { lastPatch = fn(); },
  clone: value => JSON.parse(JSON.stringify(value)),
  closeModal() {},
  openModal: html => { lastOpenedModal = String(html || ''); },
  openProductDrilldown() {},
  showToast: (message, type) => { toasts.push({ message, type }); return { message, type }; },
  applyRemoteState: state => {
    sandbox.AppState = { ...sandbox.AppState, ...state };
  },
  renderView() {},
  scanBarcodeForAdd() {},
  hasBackend: () => true,
  getAuthToken: () => 'admin-token',
  getShopSnapshot: () => ({ shopId: 'shop-main', shopName: 'Main Shop' }),
  todayKey: () => '2026-09-04',
  getUnitOptions: () => ['unit', 'pack', 'bottle'],
  renderHelpButton: () => '',
  BUSINESS_TYPES: { retail_supermarket: { categories: ['Soft Drinks', 'Snacks', 'Bakery'] } },
  esc: value => String(value ?? ''),
  google: { script: { run: {
    withSuccessHandler(handler) { rpcSuccessHandler = handler; return this; },
    withFailureHandler(handler) { rpcFailureHandler = handler; return this; },
    createProductFromNcpcCandidate(request, token) {
      lastLinkedRequest = { request, token };
      if (request.ncpcVariantId === 'VAR-FAIL') {
        if (rpcFailureHandler) rpcFailureHandler(new Error('Mapping failed'));
        return;
      }
      const remoteProduct = {
        id: 2001,
        name: request.product.name,
        brand: request.product.brand,
        variantName: request.product.variantName,
        category: request.product.category,
        unit: request.product.unit,
        productType: request.product.productType,
        sellingPrice: request.product.sellingPrice,
        maxStock: request.product.maxStock,
        barcode: request.product.barcode,
        ncpcMapping: {
          status: 'LINKED',
          ncpcProductId: request.ncpcProductId,
          ncpcVariantId: request.ncpcVariantId,
          publicForNtheemba: false,
        },
        batches: [{
          id: 2002,
          productId: 2001,
          quantityReceived: request.product.initialStock,
          unitCost: request.product.cost,
          sellingPriceSnapshot: request.product.sellingPrice,
        }],
      };
      if (rpcSuccessHandler) rpcSuccessHandler({ ok: true, state: { products: [remoteProduct], notifications: [{ text: 'Product added' }] } });
    },
    createProductFromNcpcSubmission(request, token) {
      lastSubmissionRequest = { request, token };
      const remoteProduct = {
        id: 2101,
        name: request.product.name,
        brand: request.product.brand,
        variantName: request.product.variantName,
        category: request.product.category,
        unit: request.product.unit,
        productType: request.product.productType,
        sellingPrice: request.product.sellingPrice,
        maxStock: request.product.maxStock,
        barcode: request.product.barcode,
        ncpcMapping: {
          status: 'AWAITING_NCPC_REVIEW',
          submissionId: 'LOCAL-NCPC-SUB-REQ1',
          submissionRequestId: request.submissionRequestId,
          submissionStatus: 'PENDING_REVIEW',
          publicForNtheemba: false,
        },
        batches: [{
          id: 2102,
          productId: 2101,
          quantityReceived: request.product.initialStock,
          unitCost: request.product.cost,
          sellingPriceSnapshot: request.product.sellingPrice,
        }],
      };
      if (rpcSuccessHandler) rpcSuccessHandler({ ok: true, state: { products: [remoteProduct], notifications: [{ text: 'Product submitted' }] } });
    },
  } } },
  Date,
  JSON,
  String,
  Number,
  RegExp,
  Object,
  Array,
  Math,
  isFinite,
  parseFloat,
  parseInt,
};

vm.createContext(sandbox);
vm.runInContext(helperSource, sandbox, { filename: 'Index copy.html Add Product helpers' });

function resetForm() {
  Object.keys(elements).forEach(key => delete elements[key]);
  sandbox.AppState.products = [];
  sandbox.AppState.notifications = [];
  lastPatch = null;
  lastLinkedRequest = null;
  lastSubmissionRequest = null;
  lastOpenedModal = '';
  rpcSuccessHandler = null;
  rpcFailureHandler = null;
  toasts.length = 0;
  setInput('modalProductName', '');
  setInput('modalProductBrand', '');
  setInput('modalProductVariantName', '');
  setInput('modalProductCategory', 'Soft Drinks');
  setInput('modalProductUnit', 'unit');
  setInput('modalProductBarcode', '');
  setInput('modalProductCost', '10');
  setInput('modalProductSell', '15');
  setInput('modalProductType', 'packed');
  setInput('modalProductInit', '5');
  setInput('modalProductMax', '50');
  setInput('addNcpcProductId', '');
  setInput('addNcpcVariantId', '');
  setInput('addNcpcSubmissionRequestId', 'TF-NCPC-SUB-REQ1');
  setInput('addNcpcCatalogueVersion', '');
  setInput('addNcpcReleaseVersion', '');
  setInput('addNcpcCanonicalName', '');
  setInput('addNcpcVariantName', '');
  setInput('addNcpcSelectedSummary', '');
}

resetForm();
elements.modalProductName.value = 'Local Cola';
elements.modalProductBarcode.value = 'LOCAL-001';
sandbox.saveProduct();
assert.equal(sandbox.AppState.products.length, 1, 'local-only product is still added');
let product = sandbox.AppState.products[0];
assert.equal(product.id, 1001);
assert.equal(product.ncpcMapping, null);
assert.equal(product.sellingPrice, 15);
assert.equal(product.batches.length, 1);
assert.equal(product.batches[0].productId, product.id, 'initial FIFO batch references the local product ID');
assert.equal(product.batches[0].unitCost, 10);
assert.equal(product.batches[0].sellingPriceSnapshot, 15);
assert.equal(lastPatch.products[0].id, product.id);

resetForm();
elements.modalProductUnit.value = '';
sandbox.addProductNcpcCandidates = {
  'VAR-000001': {
    ncpcProductId: 'PRD-000001',
    ncpcVariantId: 'VAR-000001',
    canonicalName: 'Cola',
    variantName: '500 ml',
    brand: 'Coca-Cola',
    identifiers: 'BAR-500 | ALT-500',
    catalogueVersion: '470',
    releaseVersion: 'NCPC-20260822-120000',
  },
};
sandbox.selectAddProductNcpcCandidate('VAR-000001');
assert.equal(elements.modalProductName.value, 'Cola - 500 ml', 'candidate identity can autofill product name when blank');
assert.equal(elements.modalProductBrand.value, 'Coca-Cola', 'candidate identity can autofill brand when blank');
assert.equal(elements.modalProductVariantName.value, '500 ml', 'candidate identity can autofill variant/size when blank');
assert.equal(elements.modalProductUnit.value, '500 ml', 'candidate variant can autofill unit/size when blank');
assert.equal(elements.modalProductBarcode.value, 'BAR-500', 'candidate barcode can autofill barcode when blank');
assert.equal(elements.modalProductCost.value, '10', 'candidate selection does not overwrite business cost');
assert.equal(elements.modalProductSell.value, '15', 'candidate selection does not overwrite business selling price');
elements.modalProductCost.value = '11';
elements.modalProductSell.value = '19';
elements.modalProductInit.value = '7';
elements.modalProductBrand.value = 'Owner Brand Override';
elements.modalProductVariantName.value = 'Owner Variant Override';
sandbox.saveProduct();
assert.equal(lastPatch, null, 'NCPC-backed product creation does not use the local patch path');
assert.equal(lastLinkedRequest.token, 'admin-token');
assert.equal(lastLinkedRequest.request.ncpcProductId, 'PRD-000001');
assert.equal(lastLinkedRequest.request.ncpcVariantId, 'VAR-000001');
assert.equal(lastLinkedRequest.request.product.cost, 11);
assert.equal(lastLinkedRequest.request.product.sellingPrice, 19);
assert.equal(lastLinkedRequest.request.product.initialStock, 7);
assert.equal(lastLinkedRequest.request.product.brand, 'Owner Brand Override');
assert.equal(lastLinkedRequest.request.product.variantName, 'Owner Variant Override');
assert.equal(sandbox.AppState.products.length, 1, 'NCPC-backed product is added after backend success');
product = sandbox.AppState.products[0];
assert.equal(product.name, 'Cola - 500 ml');
assert.equal(product.brand, 'Owner Brand Override');
assert.equal(product.variantName, 'Owner Variant Override');
assert.equal(product.sellingPrice, 19);
assert.equal(product.batches[0].quantityReceived, 7);
assert.equal(product.batches[0].unitCost, 11);
assert.equal(product.batches[0].sellingPriceSnapshot, 19);
assert.equal(product.ncpcMapping.status, 'LINKED');
assert.equal(product.ncpcMapping.ncpcProductId, 'PRD-000001');
assert.equal(product.ncpcMapping.ncpcVariantId, 'VAR-000001');
assert.equal(product.ncpcMapping.publicForNtheemba, false);
assert.equal(Object.hasOwn(product.ncpcMapping, 'sellingPrice'), false, 'NCPC mapping does not carry TradeFlow price');
assert.equal(Object.hasOwn(product.ncpcMapping, 'stock'), false, 'NCPC mapping does not carry TradeFlow stock');

resetForm();
sandbox.AppState.products = [{ id: 3001, name: 'Existing Cola', ncpcMapping: { status: 'LINKED', ncpcVariantId: 'VAR-000001' } }];
sandbox.addProductNcpcCandidates = {
  'VAR-000001': {
    ncpcProductId: 'PRD-000001',
    ncpcVariantId: 'VAR-000001',
    canonicalName: 'Cola',
    variantName: '500 ml',
    identifiers: 'BAR-500',
  },
};
sandbox.selectAddProductNcpcCandidate('VAR-000001');
assert.equal(elements.addNcpcVariantId.value, '', 'duplicate candidate selection does not prepare a linked save');
assert.match(elements.addNcpcSelectedSummary.innerHTML, /already in your catalogue/);
assert.match(elements.addNcpcSelectedSummary.innerHTML, /View Product/);

resetForm();
sandbox.addProductNcpcCandidates = {
  'VAR-FAIL': {
    ncpcProductId: 'PRD-000001',
    ncpcVariantId: 'VAR-FAIL',
    canonicalName: 'Failed Cola',
    variantName: '500 ml',
    identifiers: 'FAIL-500',
  },
};
elements.addNcpcProductId.value = 'PRD-000001';
elements.addNcpcVariantId.value = 'VAR-FAIL';
elements.modalProductName.value = 'Failed Cola';
elements.modalProductBarcode.value = 'FAIL-500';
sandbox.saveProduct();
assert.equal(sandbox.AppState.products.length, 0, 'linked product is not created locally when the backend mapping path fails');

resetForm();
elements.modalProductName.value = 'New Local Snack';
elements.modalProductBrand.value = '';
elements.modalProductVariantName.value = '';
elements.modalProductBarcode.value = 'SNACK-001';
elements.modalProductCost.value = '4';
elements.modalProductSell.value = '7';
elements.modalProductInit.value = '12';
sandbox.submitNewProductForNcpcReview();
assert.equal(lastPatch, null, 'NCPC submission path does not use the local patch path');
assert.equal(lastSubmissionRequest.token, 'admin-token');
assert.equal(lastSubmissionRequest.request.submissionRequestId, 'TF-NCPC-SUB-REQ1');
assert.equal(lastSubmissionRequest.request.product.name, 'New Local Snack');
assert.equal(lastSubmissionRequest.request.product.brand, '', 'brand is optional for manual Central Catalogue review');
assert.equal(lastSubmissionRequest.request.product.variantName, '', 'variant/size is optional for manual Central Catalogue review');
assert.equal(lastSubmissionRequest.request.product.cost, 4);
assert.equal(lastSubmissionRequest.request.product.sellingPrice, 7);
assert.equal(lastSubmissionRequest.request.product.initialStock, 12);
assert.equal(sandbox.AppState.products.length, 1, 'submitted product is added after backend success');
product = sandbox.AppState.products[0];
assert.equal(product.ncpcMapping.status, 'AWAITING_NCPC_REVIEW');
assert.equal(product.ncpcMapping.submissionId, 'LOCAL-NCPC-SUB-REQ1');
assert.equal(product.ncpcMapping.publicForNtheemba, false);
assert.equal(product.brand, '');
assert.equal(product.variantName, '');
assert.equal(Object.hasOwn(product.ncpcMapping, 'sellingPrice'), false, 'pending NCPC mapping does not carry TradeFlow price');
assert.equal(Object.hasOwn(product.ncpcMapping, 'stock'), false, 'pending NCPC mapping does not carry TradeFlow stock');
assert.equal(product.batches[0].unitCost, 4);
assert.equal(product.batches[0].sellingPriceSnapshot, 7);

resetForm();
sandbox.openAddProductModal();
assert.match(lastOpenedModal, /Step 1 of 4/, 'Add Product opens as a four-step flow');
assert.match(lastOpenedModal, /scanBarcodeForAdd\(\)/, 'barcode scanning is available on Step 1 before catalogue search');
assert.match(lastOpenedModal, /Search Central Catalogue/, 'owner-facing Add Product copy uses Central Catalogue');
assert.match(lastOpenedModal, /Brand[\s\S]*optional/, 'manual brand field is present and optional');
assert.match(lastOpenedModal, /Variant \/ Size[\s\S]*optional/, 'manual variant\/size field is present and optional');
assert.match(lastOpenedModal, /Max Stock Level/, 'business values keep max stock level');
assert.doesNotMatch(lastOpenedModal, /submitted for NCPC review/i, 'owner-facing manual flow avoids NCPC jargon');

resetForm();
sandbox.addProductNcpcCandidates = {
  'VAR-000003': {
    ncpcProductId: 'PRD-000003',
    ncpcVariantId: 'VAR-000003',
    canonicalName: 'Matched Product',
    variantName: '1 kg',
  },
};
sandbox.selectAddProductNcpcCandidate('VAR-000003');
const submitWithSelection = sandbox.submitNewProductForNcpcReview();
assert.equal(submitWithSelection.type, 'warning');
assert.match(submitWithSelection.message, /Clear the selected catalogue match/);
assert.equal(lastSubmissionRequest, null, 'selected candidates must use the linked-product path, not new submission');

resetForm();
elements.modalProductName.value = 'Tampered';
elements.addNcpcProductId.value = 'bad';
elements.addNcpcVariantId.value = 'VAR-000001';
const rejected = sandbox.saveProduct();
assert.equal(rejected.type, 'error');
assert.equal(sandbox.AppState.products.length, 0, 'malformed hidden NCPC identity cannot create a product');

console.log('Add Product NCPC UX tests passed: local-only add still works, selected NCPC identity is persisted, business values stay owner-entered, and initial FIFO batch creation remains unchanged.');
