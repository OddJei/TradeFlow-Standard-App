import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');
const state = { products: [
  { id: 'a-1', name: 'Tenant A Cola', sellingPrice: 25, supplier: 'private', batches: [{ quantityRemaining: 3 }], ncpcMapping: { ncpcProductId: 'PRD-001', ncpcVariantId: 'VAR-001', publicForNtheemba: true } },
  { id: 'a-2', name: 'Tenant A Water', sellingPrice: 10, privateDescription: 'private', batches: [{ quantityRemaining: 0 }], ncpcMapping: { ncpcProductId: 'PRD-002', ncpcVariantId: 'VAR-002', publicForNtheemba: true } },
  { id: 'a-3', name: 'Private mapping', sellingPrice: 9, batches: [{ quantityRemaining: 8 }], ncpcMapping: { ncpcProductId: 'PRD-003', ncpcVariantId: 'VAR-003', publicForNtheemba: false } },
] };
const auditRows = [];
const properties = { NTHEEMBA_API_TOKEN: 'tenant-a-token', NTHEEMBA_BUSINESS_ID: 'tenant-a', NTHEEMBA_API_SIGNING_SECRET: 'tenant-a-signing-secret' };
const sandbox = {
  Utilities: { getUuid: () => '12345678-1234-1234-1234-123456789abc', DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, computeDigest: (_alg, value) => Array.from(String(value)).map(char => char.charCodeAt(0)), computeHmacSha256Signature: (_material, secret) => Array.from(`hmac:${secret}`).map(char => char.charCodeAt(0)), base64Encode: bytes => Buffer.from(bytes).toString('base64') },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || '', getProperties: () => ({ ...properties }), setProperty: (key, value) => { properties[key] = value; }, deleteProperty: key => { delete properties[key]; } }) },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({}) },
  _ensureSheet: () => ({ sheet: {} }),
  _appendRow: (_sheet, row) => auditRows.push(row),
  _normalizeString: value => String(value ?? '').trim(),
  _bytesToHex: bytes => bytes.map(value => (`0${value.toString(16)}`).slice(-2)).join(''),
  getAppStateInternal_: () => state,
  Date, JSON, Array, String, Number, Object, RegExp, Math, Buffer,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'NtheembaMapping.gs' });

const call = body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text);
let nonceCounter = 0;
const request = variantIds => {
  const body = { action: 'find_items_by_ncpc_variants', contract_version: sandbox.NTHEEMBA_FIND_ITEMS_CONTRACT_VERSION, api_token: 'tenant-a-token', business_id: 'tenant-a', request_timestamp: Date.now(), request_nonce: `nonce-${String(++nonceCounter).padStart(12, '0')}`, data: { ncpc_variant_ids: variantIds } };
  body.request_signature = sandbox._ntheembaBatchSignature_(body, variantIds);
  return body;
};

let result = call(request(['VAR-001', 'VAR-002', 'VAR-003', 'VAR-404']));
assert.equal(result.ok, true);
assert.equal(result.contract_version, 'tradeflow.ntheemba.find_items_by_ncpc_variants.v1');
assert.equal(result.data.length, 2, 'batch returns only multiple mapped, public items');
assert.deepEqual(Object.keys(result.data[0]).sort(), ['availability', 'business_item_id', 'contract_version', 'display_name', 'ncpc_product_id', 'ncpc_variant_id', 'public_price', 'stock_status']);
assert.equal(result.data[0].business_item_id, 'a-1');
assert.equal(result.data[1].stock_status, 'out_of_stock');
assert.equal(Object.hasOwn(result.data[0], 'supplier'), false);

result = call({ ...request(['VAR-001']), business_id: 'tenant-b' });
assert.equal(result.ok, false, 'a different business identity cannot read this deployment');
result = call({ ...request(['VAR-001']), api_token: 'wrong' });
assert.equal(result.ok, false, 'invalid authentication fails safely');
result = call({ ...request(['VAR-001']), request_signature: 'invalid-signature-value-that-is-long-enough' });
assert.equal(result.ok, false, 'invalid signature fails safely');
result = call(request([]));
assert.equal(result.ok, false, 'empty query cannot enumerate public items');
result = call(request(['VAR-001', 'VAR-001']));
assert.equal(result.ok, false, 'duplicate IDs fail safely');
result = call(request(Array.from({ length: 51 }, (_, i) => `VAR-${i + 100}`)));
assert.equal(result.ok, false, 'oversized batch fails safely');
result = JSON.parse(sandbox.doPost({ postData: { contents: '{bad' } }).text);
assert.equal(result.ok, false, 'malformed JSON fails safely');
const replay = request(['VAR-001']);
assert.equal(call(replay).ok, true);
assert.equal(call(replay).ok, false, 'a captured request nonce cannot be replayed');
assert.equal(call({ ...request(['VAR-001']), request_timestamp: Date.now() - 600001 }).ok, false, 'stale request fails safely');
assert.match(result.request_id, /^ntf_/);
assert.ok(auditRows.some(row => row[3] === 'success'));
assert.ok(auditRows.some(row => row[3] === 'rejected'));
console.log('Ntheemba batch lookup contract tests passed: public mapping allowlist, tenant isolation, bounded validation, safe failures, and redacted output.');
