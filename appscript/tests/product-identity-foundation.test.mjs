import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appscriptDir = path.resolve(__dirname, '..');
const codeSource = fs.readFileSync(path.join(appscriptDir, 'code copy.gs'), 'utf8');
const htmlSource = fs.readFileSync(path.join(appscriptDir, 'Index copy.html'), 'utf8');

function extract(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

const serverIdentitySource = [
  extract(codeSource, 'var TF_NCPC_MAPPING_STATES', 'function saveAppStateInternal_'),
  extract(codeSource, 'function _deriveTradeFlowProductIdentity_', 'function saveAppState(payload'),
].join('\n');

const serverSandbox = {
  _normalizeString: value => String(value ?? '').trim(),
  Error,
  RegExp,
  String,
};
vm.createContext(serverSandbox);
vm.runInContext(serverIdentitySource, serverSandbox, { filename: 'code copy.gs identity helpers' });

const unmappedProduct = {
  id: 1001,
  name: 'Local Sugar',
  sellingPrice: 18,
  maxStock: 50,
  batches: [{ id: 1002, productId: 1001, quantityReceived: 5, unitCost: 10 }],
};
const unmappedBefore = JSON.stringify(unmappedProduct);
assert.equal(JSON.stringify(serverSandbox._deriveTradeFlowProductIdentity_(unmappedProduct)), JSON.stringify({
  businessProductId: '1001',
  ncpcMappingStatus: 'NEEDS_LINK',
  ncpcProductId: '',
  ncpcVariantId: '',
}));
assert.equal(JSON.stringify(unmappedProduct), unmappedBefore, 'identity derivation must not mutate old unmapped products');

const linkedProduct = {
  id: '1003',
  name: 'Mapped Sugar',
  sellingPrice: 19,
  maxStock: 40,
  ncpcMapping: { ncpcProductId: 'PRD-000001', ncpcVariantId: 'VAR-000001', publicForNtheemba: true },
  batches: [{ id: 1004, productId: '1003', quantityReceived: 4, unitCost: 11 }],
};
const linkedBefore = JSON.stringify(linkedProduct);
assert.equal(JSON.stringify(serverSandbox._deriveTradeFlowProductIdentity_(linkedProduct)), JSON.stringify({
  businessProductId: '1003',
  ncpcMappingStatus: 'LINKED',
  ncpcProductId: 'PRD-000001',
  ncpcVariantId: 'VAR-000001',
}));
assert.equal(JSON.stringify(linkedProduct), linkedBefore, 'identity derivation must not change price, stock, batches, or mapping records');

const staleProduct = {
  id: '1005',
  name: 'Stale Link',
  sellingPrice: 20,
  maxStock: 20,
  ncpcMapping: { status: 'LINK_STALE', ncpcProductId: 'PRD-000002', ncpcVariantId: 'VAR-000002' },
};
assert.equal(serverSandbox._deriveTradeFlowProductIdentity_(staleProduct).ncpcMappingStatus, 'LINK_STALE');

const errorProduct = {
  id: '1006',
  name: 'Broken Link',
  sellingPrice: 20,
  maxStock: 20,
  ncpcMapping: { ncpcProductId: 'bad', ncpcVariantId: 'VAR-000002' },
};
assert.equal(serverSandbox._deriveTradeFlowProductIdentity_(errorProduct).ncpcMappingStatus, 'LINK_ERROR');

const clientIdentitySource = extract(htmlSource, 'const NCPC_MAPPING_STATES', 'function formatCurrency(amount)');
const clientSandbox = {
  esc: value => String(value ?? ''),
  Object,
  RegExp,
  String,
};
vm.createContext(clientSandbox);
vm.runInContext(clientIdentitySource, clientSandbox, { filename: 'Index copy.html identity helpers' });

assert.equal(clientSandbox.getProductIdentity(unmappedProduct).businessProductId, '1001');
assert.equal(clientSandbox.getProductIdentity(unmappedProduct).ncpcMappingStatus, 'NEEDS_LINK');
assert.match(clientSandbox.renderNcpcAction(unmappedProduct), /Find Match/);
assert.match(clientSandbox.renderNcpcAction(linkedProduct), /Linked/);
assert.match(clientSandbox.renderNcpcAction(errorProduct), /Link Problem/);

console.log('Product identity foundation tests passed: local product IDs remain canonical, unmapped products derive NEEDS_LINK, legacy links derive LINKED, malformed links derive LINK_ERROR, and derivation is non-mutating.');
