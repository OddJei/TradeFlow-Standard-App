import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '..', 'NtheembaMapping.gs'), 'utf8');
assert.match(source, /installNcpcMappingReviewSweepAt20/, 'the owner-installed daily 20:00 sweep remains available');
assert.match(source, /mapping\.coverageHealth = coverage\.synced \? 'HEALTHY'/, 'the daily sweep records linked coverage health');
assert.match(source, /_linkNcpcCoverageIfConfigured_\(\{[\s\S]*businessProductRef:/, 'the daily sweep rechecks linked coverage with the shop-qualified reference');
assert.match(source, /mapping\.coverageHealth === 'HEALTHY' && mapping\.coverageState === 'LINKED_APPROVED'/, 'healthy linked products are terminal and skipped by later sweeps');
const products = [
  { id: '100', sellingPrice: 20, supplier: 'private', batches: [{ unitCost: 8 }], ncpcMapping: { status: 'AWAITING_NCPC_REVIEW', submissionId: 'SUB-100' } },
  { id: '200', ncpcMapping: { status: 'LINKED', ncpcProductId: 'PRD-200', ncpcVariantId: 'VAR-200' } },
];
const sandbox = {
  _normalizeString: value => String(value ?? '').trim(),
  Date, String, Number, RegExp, Object, Array, Math, Error,
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'NtheembaMapping.gs' });

const before = JSON.stringify({ sellingPrice: products[0].sellingPrice, supplier: products[0].supplier, batches: products[0].batches });
sandbox._applyNcpcReviewDecision_(products[0], products, products[0].ncpcMapping, {
  submissionStatus: 'APPROVED', ncpcProductId: 'PRD-100', ncpcVariantId: 'VAR-100', decidedAt: '2026-09-14T20:00:00Z', releaseVersion: 'REL-1'
}, 'daily_ncpc_sweep');
assert.equal(products[0].ncpcMapping.status, 'LINKED');
assert.equal(products[0].ncpcMapping.ncpcVariantId, 'VAR-100');
assert.equal(JSON.stringify({ sellingPrice: products[0].sellingPrice, supplier: products[0].supplier, batches: products[0].batches }), before, 'approval updates identity only');

assert.throws(() => sandbox._applyNcpcReviewDecision_(products[0], products, products[0].ncpcMapping, {
  submissionStatus: 'APPROVED', ncpcProductId: 'PRD-200', ncpcVariantId: 'VAR-200'
}, 'daily_ncpc_sweep'), /already in your catalogue/);

const rejected = { status: 'AWAITING_NCPC_REVIEW' };
sandbox._applyNcpcReviewDecision_({ id: '300' }, products, rejected, { submissionStatus: 'REJECTED' }, 'daily_ncpc_sweep');
assert.equal(rejected.status, 'REJECTED');

const scoped = { status: 'AWAITING_NCPC_REVIEW', businessProductRef: 'shop-a:100' };
assert.throws(() => sandbox._applyNcpcReviewDecision_({ id: '100' }, products, scoped, {
  submissionStatus: 'APPROVED', businessProductRef: 'shop-b:100', ncpcProductId: 'PRD-100', ncpcVariantId: 'VAR-100'
}, 'daily_ncpc_sweep'), /does not belong to this shop product/);
assert.throws(() => sandbox._applyNcpcReviewDecision_({ id: '100' }, products, scoped, {
  submissionStatus: 'APPROVED', ncpcProductId: 'PRD-100', ncpcVariantId: 'VAR-100'
}, 'daily_ncpc_sweep'), /does not belong to this shop product/);
assert.deepEqual(sandbox._buildNcpcCorrectionChanges_('barcode', '12345')['variant.barcodes'][0].value, '12345');
assert.equal(sandbox._buildNcpcCorrectionChanges_('name', 'Safe name')['product.canonical_name'], 'Safe name');
assert.throws(() => sandbox._buildNcpcCorrectionChanges_('sellingPrice', '20'), /not supported/);
const locationProjection = sandbox._ncpcCoverageLocationProjectionForShop_({ shops: [{ id: 'shop-a', location: { provinceId: '09', provinceName: 'Lusaka', districtId: '0901', districtName: 'Lusaka', townId: '090101', townName: 'Lusaka', area: 'Private area', addressDetails: 'Private street' } }] }, 'shop-a');
assert.equal(locationProjection.province_id, '09');
assert.equal(locationProjection.town_name, 'Lusaka');
assert.equal(Object.hasOwn(locationProjection, 'area'), false, 'NCPC coverage receives a safe location identity projection only');
assert.equal(Object.hasOwn(locationProjection, 'address_details'), false, 'NCPC coverage excludes a shop street address');

const multiCalls = [];
sandbox.isStandardMultiShopReady_ = () => true;
sandbox.listStandardShopSources_ = () => [
  { id: 'shop-a', status: 'active' }, { id: 'shop-b', status: 'active' }, { id: 'shop-old', status: 'inactive' },
];
sandbox.getStandardShopSpreadsheet_ = id => ({ id });
sandbox._runNcpcDailyMappingReviewSweepForShop_ = (sheet, shopId) => {
  multiCalls.push([sheet.id, shopId]);
  return { shopId, checked: 1, linked: shopId === 'shop-a' ? 1 : 0, suggested: shopId === 'shop-b' ? 1 : 0, pending: 0, failures: 0 };
};
const multi = sandbox.runNcpcDailyMappingReviewSweep();
assert.deepEqual(multiCalls, [['shop-a', 'shop-a'], ['shop-b', 'shop-b']], 'the control registry resolves each active isolated shop spreadsheet');
assert.equal(multi.checked, 2);
assert.equal(multi.linked, 1);
assert.equal(multi.suggested, 1);
assert.equal(multi.shops.length, 2);

sandbox._runNcpcDailyMappingReviewSweepForShop_ = (sheet, shopId) => {
  if (shopId === 'shop-a') throw new Error('synthetic shop failure');
  return { shopId, checked: 1, linked: 0, suggested: 1, pending: 0, failures: 0 };
};
const partial = sandbox.runNcpcDailyMappingReviewSweep();
assert.equal(partial.failures, 1, 'one unavailable shop is recorded without exposing its error');
assert.equal(partial.checked, 1, 'remaining active shops still run');
const failedShop = partial.shops.find(item => item.shopId === 'shop-a');
assert.equal(failedShop.failures, 1);
assert.equal(failedShop.error, 'SHOP_SWEEP_FAILED');
console.log('NCPC review-sync tests passed: approved decisions link identity only, duplicate variants are rejected, and rejected reviews remain local products.');
