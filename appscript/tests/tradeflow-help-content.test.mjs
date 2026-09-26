import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appscriptDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appscriptDir, '..', '..', '..', '..');
const serverSource = fs.readFileSync(path.join(appscriptDir, 'TradeFlowHelpContent.gs'), 'utf8');
const htmlSource = fs.readFileSync(path.join(appscriptDir, 'Index.html'), 'utf8');

function extract(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

const requiredKeys = [
  'products.add',
  'products.find-ncpc',
  'products.link',
  'products.review-match',
  'products.submit-new',
  'products.submission-status',
  'products.change-link',
  'products.ncpc-status',
];

const serverSandbox = { JSON, String, Object };
vm.createContext(serverSandbox);
vm.runInContext(serverSource, serverSandbox, { filename: 'TradeFlowHelpContent.gs' });

assert.deepEqual(serverSandbox.listTradeFlowHelpKeys(), [...requiredKeys].sort());

for (const key of requiredKeys) {
  const result = serverSandbox.getHelpArticle(key);
  assert.equal(result.ok, true, `${key} is returned by getHelpArticle`);
  assert.equal(result.article.key, key);
  assert.match(result.article.readMorePath, /^Docs\/tradeflow\/user-playbook\/products\/.+\.md$/);
  assert.ok(result.article.summary.length > 20, `${key} has contextual summary`);
  assert.ok(result.article.expectedResult.length > 20, `${key} has expected result`);
  assert.ok(result.article.mistakes.length >= 3, `${key} has likely mistakes`);
  assert.ok(result.article.recovery.length >= 3, `${key} has recovery steps`);
  assert.equal(fs.existsSync(path.join(repoRoot, result.article.readMorePath)), true, `${key} read-more file exists`);
}

assert.equal(serverSandbox.getHelpArticle('missing.key').ok, false);

const clientSource = extract(htmlSource, 'const TRADEFLOW_HELP_ARTICLES', 'const NCPC_MAPPING_STATES');
const openedModals = [];
const rpcCalls = [];
let successHandler = null;
let failureHandler = null;
const toasts = [];
const clientSandbox = {
  JSON,
  String,
  Object,
  Array,
  window: {},
  esc: value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),
  openModal(html) { openedModals.push(html); },
  closeModal() {},
  showToast(message, type) { toasts.push({ message, type }); },
  hasBackend() { return false; },
  google: { script: { run: {
    withSuccessHandler(handler) { successHandler = handler; return this; },
    withFailureHandler(handler) { failureHandler = handler; return this; },
    getHelpArticle(key) { rpcCalls.push({ method: 'getHelpArticle', key }); },
  } } },
};

vm.createContext(clientSandbox);
vm.runInContext(clientSource, clientSandbox, { filename: 'Index.html help helpers' });

for (const key of requiredKeys) {
  const article = clientSandbox.getLocalHelpArticle(key);
  assert.equal(article.key, key, `${key} exists in browser-local help bundle`);
  assert.match(clientSandbox.renderHelpArticleHtml(article), /Read more/, `${key} renders read-more action`);
}

clientSandbox.openHelpArticle('products.find-ncpc');
assert.equal(rpcCalls.length, 0, 'offline/local help opens without backend RPC');
assert.match(openedModals.at(-1), /Find In Catalogue/);
assert.match(openedModals.at(-1), /Expected result/);
assert.match(openedModals.at(-1), /Likely mistakes/);
assert.match(openedModals.at(-1), /Recovery steps/);

clientSandbox.hasBackend = () => true;
clientSandbox.window.google = clientSandbox.google;
clientSandbox.openHelpArticle('products.link');
assert.deepEqual(rpcCalls, [{ method: 'getHelpArticle', key: 'products.link' }], 'backend help RPC is supported when available');
assert.equal(typeof successHandler, 'function');
assert.equal(typeof failureHandler, 'function');

const forbidden = /(https?:\/\/|AKfy|DEPLOYMENT_URL|SPREADSHEET_ID|SCRIPT_ID|WEBHOOK_SECRET|API_KEY|[A-Za-z0-9_-]{35,})/i;
const helpTexts = [
  { label: 'TradeFlowHelpContent.gs', text: serverSource },
  { label: 'Index copy.html help bundle', text: clientSource },
  ...requiredKeys.map(key => {
    const file = path.join(repoRoot, serverSandbox.getHelpArticle(key).article.readMorePath);
    return { label: path.relative(repoRoot, file), text: fs.readFileSync(file, 'utf8') };
  }),
];

for (const item of helpTexts) {
  assert.doesNotMatch(item.text, forbidden, `${item.label} must not expose concrete secret/deployment details`);
}

console.log('TradeFlow help content tests passed: required Product/NCPC help keys, read-more playbook files, offline modal fallback, backend getHelpArticle support, and sensitive-token exclusions are covered.');
