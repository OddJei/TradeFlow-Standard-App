import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

const html = fs.readFileSync(path.join(appRoot, 'Index copy.html'), 'utf8');
const backend = fs.readFileSync(path.join(appRoot, 'code copy.gs'), 'utf8');
const mapping = fs.readFileSync(path.join(appRoot, 'NtheembaMapping.gs'), 'utf8');

const requiredCustomerOrderUi = [
  ['Customer Orders nav tab', /id: 'customerOrders', icon: 'fa-bag-shopping', label: 'Customer Orders'/],
  ['Customer Orders renderer', /function renderCustomerOrders\(container\)/],
  ['Customer order accept action', /function acceptCustomerOrder\(orderId\)/],
  ['Customer order cancel action', /function cancelCustomerOrder\(orderId\)/],
  ['Customer order fulfil modal', /function openFulfillCustomerOrderModal\(orderId\)/],
  ['Customer order fulfil action', /function fulfillCustomerOrder\(orderId\)/],
  ['Customer order state hydration', /AppState\.customerOrders = Array\.isArray\(AppState\.customerOrders\)/],
  ['Customer order view route', /customerOrders: renderCustomerOrders/],
];

for (const [label, pattern] of requiredCustomerOrderUi) {
  assert.match(html, pattern, `${label} is present`);
}

assert.match(html, /requested' \|\| status === 'new'/, 'API-created requested orders are shown as New');
assert.match(html, /const labels = \{ new: 'New', accepted: 'Accepted', fulfilled: 'Fulfilled', cancelled: 'Cancelled' \}/, 'user-facing order statuses match requested flow');
assert.match(html, /order\.status = 'accepted'/, 'acceptance moves orders to accepted');
assert.match(html, /order\.status = 'fulfilled'/, 'fulfilment moves orders to fulfilled');
assert.match(html, /order\.status = 'cancelled'/, 'cancellation is supported');
assert.match(html, /paymentStatus !== 'Paid'/, 'fulfilment requires Paid payment status');
assert.match(html, /requireCustomerOrderOnline\(\)/, 'customer order mutations use online guard');
assert.match(html, /!hasBackend\(\) \|\| !getAuthToken\(\)/, 'online guard requires backend and session token');
assert.match(html, /navigator\.onLine === false/, 'online guard blocks browser offline state');
assert.match(html, /customerOrderStockCheck\(lines\)/, 'fulfilment checks stock before mutation');
assert.match(html, /reduceStock\(line\.productId, line\.qty, 'Customer Order'\)/, 'fulfilment reduces stock through FIFO stock operation');
assert.match(html, /activityKind: kind \|\| 'record'/, 'existing activity stamping remains in use');
assert.match(html, /source: 'customer-order'/, 'fulfilment creates customer-order sourced sale and revenue records');
assert.match(html, /sales: \[clone\(sale\)\], revenue: \[clone\(revenue\)\], customerOrders: \[clone\(order\)\]/, 'fulfilment sync patch includes sale, revenue, and order status');
assert.match(html, /customer\.name.*customer\.phone/s, 'Customer Orders list/modal includes customer name and phone');

assert.match(mapping, /type: 'customer_order_request'/, 'external API creates customer order request records');
assert.match(mapping, /status: 'requested'/, 'order.create keeps requested status for the public API contract');
assert.doesNotMatch(mapping, /AppState\.sales\.push|AppState\.revenue\.push|stockAdjustments\.push/, 'order.create does not complete a sale or move stock');

assert.match(backend, /projected\.customerOrders = canView\('customerOrders'\) \? projected\.customerOrders : \[\]/, 'staff projection hides customer orders without tab access');
assert.match(backend, /customerOrders: \['customerOrders', 'products', 'sales', 'revenue', 'stockAdjustments', 'notifications'\]/, 'staff Customer Orders writes have an explicit server domain');
assert.match(backend, /function _mergeStaffCustomerOrderProducts_\(currentProducts, incomingProducts\)/, 'staff fulfilment product merging is constrained');
assert.match(backend, /merged\.stockMovements = mergeRowsByIdentity_\(existing\.stockMovements \|\| \[\], update\.stockMovements \|\| \[\], 'productStockMovements'\)/, 'staff fulfilment can only merge product stock movements');
assert.match(backend, /merged\.customerOrders = mergeRowsByIdentity_\(current\.customerOrders \|\| \[\], incoming\.customerOrders \|\| \[\], 'customerOrders'\)/, 'staff fulfilment merges customer order status by identity');
assert.match(backend, /merged\.sales = mergeRowsByIdentity_\(current\.sales \|\| \[\], incoming\.sales \|\| \[\], 'sales'\)/, 'staff fulfilment can append sale records');
assert.match(backend, /merged\.revenue = mergeRowsByIdentity_\(current\.revenue \|\| \[\], incoming\.revenue \|\| \[\], 'revenue'\)/, 'staff fulfilment can append revenue records');
assert.match(backend, /merged\.stockAdjustments = mergeRowsByIdentity_\(current\.stockAdjustments \|\| \[\], incoming\.stockAdjustments \|\| \[\], 'stockAdjustments'\)/, 'staff fulfilment can append stock adjustments');

function extract(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

const staffMergeSource = extract(backend, 'var EP_STAFF_WRITE_DOMAINS', 'function importAppState');
const serverSandbox = {
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Error,
};
vm.createContext(serverSandbox);
vm.runInContext(staffMergeSource, serverSandbox, { filename: 'code copy.gs staff customer order merge' });

const currentState = {
  settings: {
    staffTabAccess: {
      customerOrders: { view: true, edit: true },
    },
  },
  customerOrders: [{ id: 'TF-ORDER-1001', status: 'accepted', updatedAt: '2026-08-30T10:00:00.000Z', items: [] }],
  products: [{
    id: 501,
    name: 'Local Cola',
    sellingPrice: 25,
    maxStock: 50,
    batches: [{ id: 1, qty: 10, unitCost: 12 }],
    stockMovements: [{ id: 10, qty: -1, reason: 'Existing' }],
  }],
  sales: [],
  revenue: [],
  stockAdjustments: [],
  notifications: [],
};

const incomingPatch = {
  customerOrders: [{ id: 'TF-ORDER-1001', status: 'fulfilled', updatedAt: '2026-08-30T10:05:00.000Z', saleId: 9001 }],
  products: [{
    id: 501,
    name: 'Tampered Name',
    sellingPrice: 1,
    maxStock: 1,
    batches: [{ id: 1, qty: 999, unitCost: 0 }],
    updatedAt: '2026-08-30T10:05:00.000Z',
    stockMovements: [{ id: 10, qty: -1, reason: 'Existing' }, { id: 11, qty: -2, reason: 'Customer Order' }],
  }],
  sales: [{ id: 9001, source: 'customer-order', sourceOrderId: 'TF-ORDER-1001', updatedAt: '2026-08-30T10:05:00.000Z' }],
  revenue: [{ id: 9002, source: 'customer-order', amount: 50, updatedAt: '2026-08-30T10:05:00.000Z' }],
  stockAdjustments: [{ id: 9003, productId: 501, reason: 'Customer Order', qty: 2, updatedAt: '2026-08-30T10:05:00.000Z' }],
  notifications: [{ id: 9004, text: 'Customer order fulfilled', time: '2026-08-30T10:05:00.000Z' }],
};

const merged = serverSandbox._mergeStaffState_(currentState, incomingPatch, { view: 'customerOrders' });
assert.equal(merged.customerOrders[0].status, 'fulfilled', 'staff Customer Orders patch can update order status');
assert.equal(merged.sales.length, 1, 'staff Customer Orders patch can append sale');
assert.equal(merged.revenue.length, 1, 'staff Customer Orders patch can append revenue');
assert.equal(merged.stockAdjustments.length, 1, 'staff Customer Orders patch can append stock adjustment');
assert.equal(merged.products[0].name, 'Local Cola', 'staff Customer Orders patch cannot rename products');
assert.equal(merged.products[0].sellingPrice, 25, 'staff Customer Orders patch cannot change selling price');
assert.equal(merged.products[0].maxStock, 50, 'staff Customer Orders patch cannot change max stock');
assert.deepEqual(merged.products[0].batches, currentState.products[0].batches, 'staff Customer Orders patch cannot change batches');
assert.equal(merged.products[0].stockMovements.length, 2, 'staff Customer Orders patch can merge stock movements from fulfillment');

const deniedState = { settings: { staffTabAccess: { customerOrders: { view: true, edit: false } } } };
assert.throws(() => serverSandbox._mergeStaffState_(deniedState, incomingPatch, { view: 'customerOrders' }), /server-authorized edit access/, 'server rejects staff Customer Orders writes without edit access');

console.log('Customer Orders fulfilment source checks passed: separate external-order tab, user status labels, online/Paid/stock guards, POS accounting conversion, and staff sync authorization are present.');
