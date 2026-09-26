import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appscriptDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appscriptDir, '..', '..', '..', '..');
const codeSource = fs.readFileSync(path.join(appscriptDir, 'code copy.gs'), 'utf8');
const htmlSource = fs.readFileSync(path.join(appscriptDir, 'Index copy.html'), 'utf8');
const runtimeReadme = fs.readFileSync(path.join(repoRoot, 'packages/capture-runtime/README.md'), 'utf8');
const runtimeConfig = JSON.parse(fs.readFileSync(path.join(appscriptDir, 'config/standard-runtime-config.json'), 'utf8'));

const deployedUrl = 'https://nds-capture-runtime.onrender.com';

function extract(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

assert.equal(fs.existsSync(path.join(appscriptDir, 'CaptureRuntime.html')), false, 'CaptureRuntime.html must not be active Apps Script source');
assert.doesNotMatch(codeSource, /createHtmlOutputFromFile\(['"]CaptureRuntime['"]\)/, 'backend must not serve deleted CaptureRuntime.html');
assert.doesNotMatch(codeSource, new RegExp(deployedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'backend source must not hardcode the deployed capture runtime URL');
assert.doesNotMatch(htmlSource, new RegExp(deployedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'browser source must not hardcode the deployed capture runtime URL');
assert.equal(runtimeConfig.CAPTURE_RUNTIME_URL, deployedUrl, 'JSON runtime config carries the deployed capture runtime URL');
assert.equal(runtimeConfig.CAPTURE_RUNTIME_SOURCE, 'packages/capture-runtime/');
assert.match(runtimeConfig.DEPLOYMENT_URL, /^<set per Apps Script deployment>$/);
assert.match(runtimeConfig.SENTRY_DSN, /^<optional;/);
assert.match(runtimeReadme, /Reusable browser capture runtime/, 'packages/capture-runtime remains the capture runtime source package');

const serverSource = [
  extract(codeSource, 'const APP_STATE_CHUNK_SIZE', 'function getSentryDsn_'),
  extract(codeSource, 'function doGet', 'function getPublicRuntimeConfig'),
].join('\n');
let htmlBody = '';
let scriptProperties = {};
const serverSandbox = {
  JSON,
  String,
  Object,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return scriptProperties[key] || ''; },
      };
    },
  },
  ScriptApp: {
    getScriptId() { return 'SCRIPT_ID_TEST'; },
    getService() { return { getUrl() { return 'https://script.google.com/macros/s/test/exec'; } }; },
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createHtmlOutput(body) {
      htmlBody = String(body || '');
      return {
        setTitle() { return this; },
        setXFrameOptionsMode() { return this; },
      };
    },
  },
};
vm.createContext(serverSandbox);
vm.runInContext(serverSource, serverSandbox, { filename: 'code copy.gs capture runtime helpers' });

assert.equal(serverSandbox.getTradeFlowRuntimeConfig_().captureRuntimeUrl, '', 'capture runtime URL is not defaulted in source');
assert.equal(serverSandbox.getCaptureRuntimeUrl(), '');
assert.throws(() => serverSandbox.doGet({ parameter: { view: 'capture' } }), /CAPTURE_RUNTIME_URL Script Property is required/);
scriptProperties = { CAPTURE_RUNTIME_URL: deployedUrl };
assert.equal(serverSandbox.getTradeFlowRuntimeConfig_().captureRuntimeUrl, deployedUrl);
assert.equal(serverSandbox.getCaptureRuntimeUrl(), deployedUrl);
serverSandbox.doGet({ parameter: { view: 'capture' } });
assert.match(htmlBody, new RegExp(deployedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'legacy capture view redirects to deployed runtime');

const clientSource = [
  extract(htmlSource, 'let CAPTURE_RUNTIME_URL', 'function buildCaptureProductLookup'),
  extract(htmlSource, 'function buildCaptureRuntimeUrl', 'function _ensureScanListener'),
].join('\n');
const clientSandbox = {
  URL,
  String,
  Date,
  Math,
  Array,
  Uint32Array,
  crypto: { getRandomValues(arr) { arr.fill(1); return arr; } },
  window: { location: { origin: 'https://script.google.com' } },
  getDeviceId() { return 'device-1'; },
};
vm.createContext(clientSandbox);
vm.runInContext(clientSource, clientSandbox, { filename: 'Index copy.html capture runtime helpers' });

const session = { sessionId: 'session-1', token: 'token-1', deviceId: 'device-1' };
assert.throws(() => clientSandbox.buildCaptureRuntimeUrl('pos', session), /Invalid URL/, 'browser launch fails closed until runtime config is loaded');
vm.runInContext(`CAPTURE_RUNTIME_URL = ${JSON.stringify(runtimeConfig.CAPTURE_RUNTIME_URL)};`, clientSandbox);
const captureUrl = new URL(clientSandbox.buildCaptureRuntimeUrl('pos', session));
assert.equal(captureUrl.origin, deployedUrl);
assert.equal(captureUrl.searchParams.get('mode'), 'barcode');
assert.equal(captureUrl.searchParams.get('return'), 'pos');
assert.equal(captureUrl.searchParams.get('session'), 'session-1');
assert.equal(captureUrl.searchParams.get('protocol'), 'NDS_CAPTURE_V1');

console.log('Capture runtime URL tests passed: Apps Script no longer serves CaptureRuntime.html, JSON config carries the deployed Render URL, and scanner launch uses configured CAPTURE_RUNTIME_URL.');
