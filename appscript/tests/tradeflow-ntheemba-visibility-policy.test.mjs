import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '..', 'NtheembaMapping.gs'), 'utf8');

const sandbox = {
  _normalizeString: value => String(value ?? '').trim(),
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

const linkedPublished = {
  id: 'linked-public',
  name: 'Linked Published',
  ncpcMapping: {
    status: 'LINKED',
    ncpcProductId: 'PRD-1',
    ncpcVariantId: 'VAR-1',
    publicForNtheemba: true,
  },
};
const linkedUnpublished = {
  id: 'linked-private',
  name: 'Linked Unpublished',
  ncpcMapping: {
    status: 'LINKED',
    ncpcProductId: 'PRD-2',
    ncpcVariantId: 'VAR-2',
    publicForNtheemba: false,
  },
};
const pending = {
  id: 'pending',
  name: 'Pending Review',
  publicForNtheemba: false,
  ncpcMapping: {
    status: 'AWAITING_NCPC_REVIEW',
    submissionId: 'SUB-1',
    submissionStatus: 'PENDING_REVIEW',
    publicForNtheemba: false,
  },
};
const localOnlyLegacyPublic = {
  id: 'local-only',
  name: 'Local Only',
  publicForNtheemba: true,
  ncpcMapping: { status: 'LOCAL_ONLY', publicForNtheemba: true },
};
const rejectedLegacyPublic = {
  id: 'rejected',
  name: 'Rejected',
  publicForNtheemba: true,
  ncpcMapping: { status: 'REJECTED', submissionStatus: 'REJECTED', publicForNtheemba: true },
};
const unsubmittedLegacyPublic = {
  id: 'unsubmitted',
  name: 'Unsubmitted',
  publicForNtheemba: true,
};
const inactivePending = {
  id: 'inactive-pending',
  name: 'Inactive Pending',
  active: false,
  ncpcMapping: { status: 'AWAITING_NCPC_REVIEW', submissionStatus: 'PENDING_REVIEW' },
};

assert.equal(sandbox._tradeFlowProductIdentityStatus_(linkedPublished), 'linked');
assert.equal(sandbox._tradeFlowProductIdentityStatus_(pending), 'awaiting_ncpc_review');
assert.equal(sandbox._tradeFlowProductIdentityStatus_(localOnlyLegacyPublic), 'local_only');
assert.equal(sandbox._tradeFlowProductIdentityStatus_(rejectedLegacyPublic), 'rejected');
assert.equal(sandbox._tradeFlowProductIdentityStatus_(unsubmittedLegacyPublic), 'unlinked');

assert.equal(sandbox._productIsVisibleToNtheembaApi_(linkedPublished), true, 'approved linked product requires explicit publication and is visible when published');
assert.equal(sandbox._productIsVisibleToNtheembaApi_(linkedUnpublished), false, 'approved linked product can be unpublished by the business');
assert.equal(sandbox._productIsVisibleToNtheembaApi_(pending), false, 'pending NCPC review remains internal until an explicit linked publication exists');
assert.equal(sandbox._productIsVisibleToNtheembaApi_(localOnlyLegacyPublic), false, 'local-only product remains hidden even if an old public flag is true');
assert.equal(sandbox._productIsVisibleToNtheembaApi_(rejectedLegacyPublic), false, 'rejected product remains hidden even if an old public flag is true');
assert.equal(sandbox._productIsVisibleToNtheembaApi_(unsubmittedLegacyPublic), false, 'unsubmitted product remains hidden even if an old public flag is true');
assert.equal(sandbox._productIsVisibleToNtheembaApi_(inactivePending), false, 'inactive products are never externally visible');

const publicProducts = sandbox._catalogueServicePublicProductsFromState_({
  products: [
    linkedPublished,
    linkedUnpublished,
    pending,
    localOnlyLegacyPublic,
    rejectedLegacyPublic,
    unsubmittedLegacyPublic,
    inactivePending,
  ],
});
assert.deepEqual(
  publicProducts.map(product => product.id),
  ['linked-public'],
  'public catalogue exposes only explicitly public linked products',
);

console.log('TradeFlow Ntheemba visibility policy tests passed: only linked-public products surface; pending-review, unsubmitted, local-only, rejected, and private products remain TradeFlow-only.');
