import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..', '..', '..');

const html = fs.readFileSync(path.join(appRoot, 'Index copy.html'), 'utf8');
const backend = fs.readFileSync(path.join(appRoot, 'code copy.gs'), 'utf8');
const mapping = fs.readFileSync(path.join(appRoot, 'NtheembaMapping.gs'), 'utf8');
const schema = fs.readFileSync(path.join(appRoot, 'SHEETS_WORKFLOW_SCHEMA.md'), 'utf8');
const scriptProperties = fs.readFileSync(path.join(appRoot, 'SCRIPT_PROPERTIES.md'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(appRoot, 'config', 'standard-runtime-config.json'), 'utf8'));
const captureRuntime = fs.readFileSync(path.join(repoRoot, 'packages', 'capture-runtime', 'runtime.js'), 'utf8');
const captureIndexedDb = fs.readFileSync(path.join(repoRoot, 'packages', 'capture-runtime', 'indexeddb.js'), 'utf8');

const requiredUiSurfaces = [
  ['Products render', /function renderProducts\(container\)/],
  ['Product row edit', /function saveProductRow\(id\)/],
  ['Add Product wizard', /function openAddProductModal\(\)/],
  ['Price editing', /editSell_/],
  ['POS render', /function renderPOS\(container\)/],
  ['POS checkout', /function checkoutCart\(\)/],
  ['Customer Orders render', /function renderCustomerOrders\(container\)/],
  ['Customer Orders fulfilment', /function fulfillCustomerOrder\(orderId\)/],
  ['Stock reduction', /function reduceStock\(productId, qty, reason\)/],
  ['Quick Restock render', /function renderDirectRestock\(container\)/],
  ['Quick Restock save', /function saveQuickRestock\(\)/],
  ['Inspection render', /function renderInspection\(container\)/],
  ['Budget render', /function renderBudget\(container\)/],
  ['Pending Receipts render', /function renderPending\(container\)/],
  ['Stock Adjustments render', /function renderAdjustments\(container\)/],
  ['Stock Adjustment save', /function saveAdjustment\(\)/],
  ['Revenue render', /function renderRevenue\(container\)/],
  ['Revenue save', /function saveRevenue\(\)/],
  ['Expenses render', /function renderExpenses\(container\)/],
  ['Expense save', /function saveExpense\(expenseId = null\)/],
  ['Offline sync', /function syncLocalState\(onSynced\)/],
  ['Admin login modal', /function openAdminLoginModal\(\)/],
  ['Admin login auth', /function authenticateAdminLogin\(\)/],
  ['Staff login modal', /function openStaffLoginModal\(\)/],
  ['Staff login auth', /function authenticateStaffLogin\(\)/],
  ['Primary login form auth', /function authenticateLoginForm\(\)/],
  ['Help modal', /function openHelpArticle\(helpKey\)/],
];

for (const [label, pattern] of requiredUiSurfaces) {
  assert.match(html, pattern, `${label} surface is still present`);
}

const barcodeModes = [
  ['POS barcode scan', /function scanBarcodeForPOS\(\)\s*{\s*startCameraScan\('pos-cart'\)/],
  ['Add Product barcode scan', /function scanBarcodeForAdd\(\)\s*{\s*startCameraScan\('add'\)/],
  ['Inspection barcode scan', /function scanBarcodeForInspection\(\)\s*{\s*startCameraScan\('inspection'\)/],
  ['Adjustment barcode scan', /function scanBarcodeForAdjustment\(\)\s*{\s*startCameraScan\('adjustment'\)/],
  ['Restock barcode scan', /function scanBarcodeForRestock\(\)\s*{\s*startCameraScan\('restock'\)/],
];

for (const [label, pattern] of barcodeModes) {
  assert.match(html, pattern, `${label} remains wired`);
}

assert.match(html, /CAPTURE_RUNTIME_URL = String\(runtimeConfig\.captureRuntimeUrl \|\| ''\)\.trim\(\)/, 'browser reads capture runtime URL from runtime config');
assert.doesNotMatch(html, /https:\/\/nds-capture-runtime\.onrender\.com/, 'browser source does not hardcode deployed capture URL');
assert.doesNotMatch(backend, /https:\/\/nds-capture-runtime\.onrender\.com/, 'backend source does not hardcode deployed capture URL');
assert.equal(fs.existsSync(path.join(appRoot, 'CaptureRuntime.html')), false, 'Apps Script CaptureRuntime.html is not present');
assert.equal(config.CAPTURE_RUNTIME_URL, 'https://nds-capture-runtime.onrender.com');
assert.equal(config.CAPTURE_RUNTIME_SOURCE, 'packages/capture-runtime/');
assert.equal(config.TRADEFLOW_PUBLIC_API_TOKEN, '<set only in Script Properties for approved Standard API callers>');
assert.match(scriptProperties, /TRADEFLOW_PUBLIC_API_TOKEN/);
assert.match(scriptProperties, /CAPTURE_RUNTIME_URL/);

const captureConfigBlock = html.match(/type: 'NDS_CAPTURE_CONFIG'[\s\S]*?\}\s*, e\.origin \|\| '\*'\);/);
assert.ok(captureConfigBlock, 'capture runtime config handoff is present');
assert.match(captureConfigBlock[0], /productLookup: null/, 'Standard does not send product lookup data to the external capture runtime');

const lookupBuilder = html.match(/function buildCaptureProductLookup\(\) \{[\s\S]*?\n    \}/);
assert.ok(lookupBuilder, 'capture product lookup builder remains available for safe compatibility review');
for (const forbidden of ['stockCost', 'estimatedRevenue', 'totalMargin', 'batches', 'unitCost', 'quantityRemaining', 'supplier', 'privateDescription']) {
  assert.doesNotMatch(lookupBuilder[0], new RegExp(forbidden), `capture lookup builder must not expose ${forbidden}`);
  assert.doesNotMatch(captureRuntime, new RegExp(forbidden), `capture runtime must not echo or calculate ${forbidden}`);
  assert.doesNotMatch(captureIndexedDb, new RegExp(forbidden), `capture runtime cache must not persist ${forbidden}`);
}

const workflowSheets = [
  'BusinessProfile',
  'Products',
  'InventoryBatches',
  'SupplierDeliveries',
  'RestockOrders',
  'RestockOrderItems',
  'StockAdjustments',
  'POSSales',
  'POSSaleItems',
  'CustomerOrders',
  'CustomerOrderItems',
  'HandoverRequests',
  'RevenueEntries',
  'ExpenseEntries',
  'Staff',
  'BusinessSettings',
  'BudgetHeader',
  'BudgetItems',
  'Notifications',
  'CustomUnits',
  'SyncAudit',
  'NcpcProductMappings',
];

for (const sheetName of workflowSheets) {
  assert.match(backend, new RegExp(`${sheetName}\\s*:`), `${sheetName} has a sheet definition`);
  assert.match(schema, new RegExp(`\\\`${sheetName}\\\``), `${sheetName} is documented in workflow schema`);
}

for (const projection of [
  'SupplierDeliveries',
  'StockAdjustments',
  'POSSales',
  'POSSaleItems',
  'CustomerOrders',
  'CustomerOrderItems',
  'HandoverRequests',
  'RevenueEntries',
  'ExpenseEntries',
  'BudgetHeader',
  'BudgetItems',
  'NcpcProductMappings',
]) {
  assert.match(backend, new RegExp(`_replaceWorkflowSheet_\\(ss, '${projection}'`), `${projection} is projected from AppState`);
}

assert.match(backend, /function validateAppState_\(payload\)/, 'AppState validation remains present');
assert.match(backend, /function pushSyncOps\(ops, clientRevision, deviceId, sessionToken\)/, 'sync push endpoint remains present');
assert.match(backend, /function getSyncSnapshot\(clientRevision, sessionToken\)/, 'sync snapshot endpoint remains present');
assert.match(backend, /function requirePortalSession_\(token, requiredRole\)/, 'server-issued session enforcement remains present');
assert.match(backend, /session\.role === 'staff'/, 'staff-specific projection remains present');
assert.match(backend, /function _mergeStaffState_\(current, incoming, action\)/, 'staff write merge guard remains present');
assert.match(html, /id: 'customerOrders', icon: 'fa-bag-shopping', label: 'Customer Orders'/, 'Customer Orders remains a separate external-order tab');
assert.match(html, /paymentStatus !== 'Paid'/, 'Customer Orders fulfilment requires paid status');
assert.match(html, /navigator\.onLine === false/, 'Customer Orders fulfilment blocks offline use');
assert.match(html, /reduceStock\(line\.productId, line\.qty, 'Customer Order'\)/, 'Customer Orders fulfilment uses FIFO stock reduction');
assert.match(backend, /customerOrders: \['customerOrders', 'products', 'sales', 'revenue', 'stockAdjustments', 'notifications'\]/, 'staff Customer Orders write domain remains explicit');

assert.match(mapping, /function getProductIdentityService_\(\)/, 'ProductIdentityService remains present');
assert.match(mapping, /function getCatalogueService_\(\)/, 'CatalogueService remains present');
assert.match(mapping, /function getTradeFlowPublicApiService_\(\)/, 'Standard public API service remains present');
assert.match(mapping, /orderCreate: _tradeFlowPublicApiOrderCreate_/, 'order.create remains routed through service');
assert.match(mapping, /orderStatus: _tradeFlowPublicApiOrderStatus_/, 'order.status remains routed through service');
assert.match(mapping, /handoverCreate: _tradeFlowPublicApiHandoverCreate_/, 'handover.create remains routed through service');
assert.match(mapping, /TRADEFLOW_PUBLIC_API_TOKEN/, 'Standard public API token auth remains present');
assert.match(mapping, /TRADEFLOW_BUSINESS_ID/, 'Standard tenant-scope check remains present');
assert.match(mapping, /AWAITING_NCPC_REVIEW/, 'pending catalogue review state remains present');

const playbookDir = path.join(repoRoot, 'Docs', 'tradeflow', 'user-playbook', 'products');
for (const filename of [
  'add.md',
  'find-ncpc.md',
  'link.md',
  'review-match.md',
  'submit-new.md',
  'submission-status.md',
  'change-link.md',
  'ncpc-status.md',
]) {
  assert.equal(fs.existsSync(path.join(playbookDir, filename)), true, `${filename} playbook article exists`);
}

console.log('TradeFlow Sprint-01 final regression source checks passed: core workflows, barcode modes, workflow projections, sync/session guards, catalogue mapping, public API, config, and help artifacts are present.');
