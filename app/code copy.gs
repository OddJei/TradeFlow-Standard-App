/**
 * code.gs - TradeFlow Pro Backend
 * Complete server-side implementation for Google Apps Script
 */

// ============================================================
// 1. DEPLOYMENT & ASSETS
// ============================================================

const APP_STATE_CHUNK_SIZE = 45000;
const APP_STATE_CHUNK_COUNT_SUFFIX = '__chunk_count';
const APP_STATE_CHUNK_SUFFIX = '__chunk_';

function getScriptProperty_(key, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value === null || value === undefined || value === '' ? (fallback || '') : value;
}

function getTradeFlowRuntimeConfig_() {
  return {
    product: getScriptProperty_('TRADEFLOW_PRODUCT', 'TradeFlow'),
    edition: getScriptProperty_('TRADEFLOW_EDITION', 'Standard v1'),
    clientId: getScriptProperty_('TRADEFLOW_CLIENT_ID'),
    clientName: getScriptProperty_('TRADEFLOW_CLIENT_NAME'),
    branchName: getScriptProperty_('TRADEFLOW_BRANCH_NAME'),
    installationId: getScriptProperty_('TRADEFLOW_INSTALLATION_ID'),
    appVersion: getScriptProperty_('TRADEFLOW_APP_VERSION', '1.0.0'),
    environment: getScriptProperty_('TRADEFLOW_ENVIRONMENT', 'production'),
    folderUrl: getScriptProperty_('TRADEFLOW_FOLDER_URL'),
    scriptUrl: getScriptProperty_('TRADEFLOW_SCRIPT_URL'),
    spreadsheetUrl: getScriptProperty_('TRADEFLOW_SPREADSHEET_URL'),
    deploymentUrl: getScriptProperty_('DEPLOYMENT_URL'),
    captureRuntimeUrl: getScriptProperty_('CAPTURE_RUNTIME_URL')
  };
}

function getSentryDsn_() {
  return getScriptProperty_('SENTRY_DSN');
}

function parseSentryDsn_(dsn) {
  const match = String(dsn || '').match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!match) return null;
  return { publicKey: match[1], host: match[2], projectId: match[3].replace(/\/$/, ''), dsn: dsn };
}

function getTradeFlowInstallationContext() {
  const scriptId = ScriptApp.getScriptId();
  return Object.assign({}, getTradeFlowRuntimeConfig_(), {
    scriptId: scriptId,
    deploymentUrl: getDeploymentUrl(),
    scriptEditorUrl: 'https://script.google.com/home/projects/' + scriptId + '/edit'
  });
}

function getDeploymentUrl() {
  return getTradeFlowRuntimeConfig_().deploymentUrl || ScriptApp.getService().getUrl() || '';
}

function sanitizeSentryValue_(value, depth) {
  const blocked = /password|pin|token|secret|authorization|cookie|appstate|customer|client|rows|payload/i;
  if (depth > 2) return '[Truncated]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 10).map(item => sanitizeSentryValue_(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).slice(0, 20).forEach(key => {
      out[key] = blocked.test(key) ? '[Filtered]' : sanitizeSentryValue_(value[key], depth + 1);
    });
    return out;
  }
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '...' : value;
  return value;
}

function buildSentryEvent_(error, context) {
  const install = getTradeFlowInstallationContext();
  const err = error instanceof Error ? error : new Error(String(error || 'Unknown Apps Script error'));
  const ctx = context || {};
  return {
    event_id: Utilities.getUuid().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    logger: 'google-apps-script',
    environment: install.environment,
    release: 'tradeflow@' + install.appVersion,
    message: err.message,
    exception: { values: [{ type: err.name || 'Error', value: err.message, stacktrace: { frames: String(err.stack || '').split('\n').slice(1, 30).map(line => ({ function: line.trim() })) } }] },
    tags: {
      product: install.product,
      edition: install.edition,
      client_id: install.clientId,
      installation_id: install.installationId,
      environment: install.environment,
      release: 'tradeflow@' + install.appVersion,
      module: ctx.module || 'backend',
      function_name: ctx.functionName || 'unknown'
    },
    extra: sanitizeSentryValue_(Object.assign({}, ctx, { installation: install, action: ctx.action || '' }), 0)
  };
}

function reportTradeFlowError_(error, context) {
  try {
    const dsn = getSentryDsn_();
    const parsed = parseSentryDsn_(dsn);
    if (!parsed) return console.error('Sentry DSN is missing or invalid');
    const event = buildSentryEvent_(error, context);
    const envelope = [JSON.stringify({ dsn: dsn, sent_at: new Date().toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
    UrlFetchApp.fetch('https://' + parsed.host + '/api/' + parsed.projectId + '/envelope/', {
      method: 'post',
      contentType: 'application/x-sentry-envelope',
      payload: envelope,
      muteHttpExceptions: true
    });
  } catch (reportingError) {
    console.error('Sentry reporting failed', reportingError);
  }
}

function withSentryReporting_(functionName, callback, context) {
  try {
    return callback();
  } catch (error) {
    if (!error || !error._tradeFlowSentryReported) {
      reportTradeFlowError_(error, Object.assign({ functionName: functionName }, context || {}));
      try {
        if (error && typeof error === 'object') error._tradeFlowSentryReported = true;
      } catch (markerError) {}
    }
    throw error;
  }
}

function testSentryConnection() {
  try {
    throw new Error('TradeFlow backend Sentry test ' + new Date().toISOString());
  } catch (error) {
    reportTradeFlowError_(error, { functionName: 'testSentryConnection', module: 'sentry', action: 'manual_test' });
    return { ok: true, message: 'Sentry test event submitted. Confirm it in Sentry.' };
  }
}

function doGet(e) {
  const asset = e && e.parameter && e.parameter.asset;
  const view = e && e.parameter && e.parameter.view;
  if (asset === "manifest") return _tradeFlowPwaManifest_();
  if (asset === "sw") return _tradeFlowServiceWorker_();
  if (asset === "icon") return _tradeFlowIconSvg_();
  if (view === "capture") {
    var captureOutput = HtmlService.createHtmlOutputFromFile('CaptureRuntime')
      .setTitle('NDS Capture Runtime')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    captureOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
    return captureOutput;
  }

  var output = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('TradeFlow Pro')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
  return output;
}

function getCaptureRuntimeUrl() {
  return getTradeFlowRuntimeConfig_().captureRuntimeUrl;
}

// Only browser-safe values are returned to the HTML client. Never add
// passwords, API tokens, spreadsheet IDs, or private support URLs here.
function getPublicRuntimeConfig() {
  const config = getTradeFlowRuntimeConfig_();
  return {
    captureRuntimeUrl: config.captureRuntimeUrl,
    sentry: {
      dsn: getSentryDsn_(),
      product: config.product,
      edition: config.edition,
      clientId: config.clientId,
      installationId: config.installationId,
      environment: config.environment,
      release: config.product.toLowerCase().replace(/\s+/g, '-') + '@' + config.appVersion
    }
  };
}

function _tradeFlowPwaManifest_() {
  const manifest = {
    name: "TradeFlow Pro",
    short_name: "TradeFlow",
    description: "Complete inventory management system",
    start_url: "./",
    scope: "./",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui", "browser"],
    background_color: "#071a33",
    theme_color: "#f2d16b",
    orientation: "any",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "?asset=icon", sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
      { src: "?asset=icon", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }
    ]
  };
  return ContentService
    .createTextOutput(JSON.stringify(manifest))
    .setMimeType(ContentService.MimeType.JSON);
}

function _tradeFlowIconSvg_() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#071a33"/><path d="M80 128h352v256H80z" fill="#0b2345"/><path d="M104 154h304v36H104zM104 322h304v36H104z" fill="#f2d16b"/><circle cx="162" cy="256" r="54" fill="#3ec18e"/><path d="M242 205h96c41 0 74 33 74 74s-33 74-74 74h-96V205zm54 50v48h42a24 24 0 0 0 0-48h-42z" fill="#fff"/></svg>';
  return ContentService
    .createTextOutput(svg)
    .setMimeType(ContentService.MimeType.TEXT);
}

function _tradeFlowServiceWorker_() {
  const js = [
    "const TRADEFLOW_CACHE = 'tradeflow-pro-v3-shell-v2';",
    "const SHELL_ASSETS = ['./', '?asset=manifest', '?asset=icon'];",
    "self.addEventListener('install', event => {",
    "  event.waitUntil(caches.open(TRADEFLOW_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));",
    "});",
    "self.addEventListener('activate', event => {",
    "  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== TRADEFLOW_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));",
    "});",
    "self.addEventListener('fetch', event => {",
    "  const req = event.request;",
    "  if (req.method !== 'GET') return;",
    "  const url = new URL(req.url);",
    "  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin) return;",
    "  if (req.mode === 'navigate') {",
    "    event.respondWith(fetch(req).then(res => {",
    "      if (res && res.ok && res.type !== 'opaque') { const copy = res.clone(); caches.open(TRADEFLOW_CACHE).then(cache => cache.put('./', copy)).catch(() => {}); } return res;",
    "    }).catch(() => caches.match('./')));",
    "    return;",
    "  }",
    "  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {",
    "    if (res && res.ok && res.type !== 'opaque') caches.open(TRADEFLOW_CACHE).then(cache => cache.put(req, res.clone())).catch(() => {});",
    "    return res;",
    "  }).catch(() => hit)));",
    "});"
  ].join("\n");
  return ContentService
    .createTextOutput(js)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ============================================================
// 2. UTILITIES
// ============================================================

function _safeLastRow(sheet, headerRow) {
  const lr = sheet.getLastRow();
  return Math.max(lr, headerRow || 1);
}

function _toDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function _formatDate(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function _formatDateTime(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function _serializeDate(value) {
  if (!value) return "";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  } catch (e) {
    return "";
  }
}

function _isTruthy(value) {
  const s = (value || "").toString().trim().toLowerCase();
  return value === true || s === "true" || s === "yes" || s === "y" || s === "1";
}

function _normalizeString(value) {
  return (value || "").toString().trim();
}

function _parseJson(value) {
  if (!value) return null;
  try {
    return typeof value === 'object' ? value : JSON.parse(value);
  } catch (e) {
    return null;
  }
}

function _stringifyJson(obj) {
  try {
    return JSON.stringify(obj || {});
  } catch (e) {
    return "";
  }
}

function _bytesToHex(bytes) {
  return bytes.map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
}

function _generateId(prefix, existingIds) {
  let maxNum = 0;
  const regex = new RegExp('^' + prefix + '(\\d+)$', 'i');
  (existingIds || []).forEach(function(id) {
    const m = String(id || '').match(regex);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return prefix + String(maxNum + 1).padStart(3, '0');
}

// ============================================================
// 3. CACHE MANAGEMENT
// ============================================================

var EP_CACHE_TTL_STOCK_SEC = 90;
var EP_CACHE_TTL_CATEGORIES_SEC = 600;
var EP_CACHE_TTL_STAFF_SEC = 300;
var EP_CACHE_TTL_SETTINGS_SEC = 600;
var EP_CACHE_TTL_DASHBOARD_SEC = 45;
var EP_CACHE_TTL_PRODUCTS_SEC = 120;

function _cacheKey(suffix) {
  return 'ep_' + String(suffix || '');
}

function _cacheGetJson(key) {
  try {
    const raw = CacheService.getScriptCache().get(String(key));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function _cachePutJson(key, obj, ttlSec) {
  try {
    CacheService.getScriptCache().put(String(key), JSON.stringify(obj), Number(ttlSec) || 300);
  } catch (e) {}
}

function _cacheRemove(key) {
  try {
    CacheService.getScriptCache().remove(String(key));
  } catch (e) {}
}

function _cacheBustAll() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(_cacheKey('stock_map'));
    cache.remove(_cacheKey('categories'));
    cache.remove(_cacheKey('staff_list'));
    cache.remove(_cacheKey('app_settings'));
    cache.remove(_cacheKey('products_index'));
    cache.remove(_cacheKey('dash_ver'));
    cache.remove(_cacheKey('metrics_today'));
  } catch (e) {}
}

// ============================================================
// 4. SHEET DEFINITIONS
// ============================================================

var EP_SHEET_DEFS = {
  BusinessProfile: ["Business ID", "Business Name", "Business Type", "Owner Name", "Owner Email", "WhatsApp", "Address", "Updated At"],
  Products: ["Product ID", "Product Name", "Category", "Unit", "Product Type", "Selling Price", "Max Stock", "Barcode", "Updated At", "Record JSON"],
  InventoryBatches: ["Batch ID", "Product ID", "Product Name", "Restock Event ID", "Restock Date", "Received Date", "Quantity Received", "Quantity Remaining", "Unit Cost", "Selling Price", "Status", "Record JSON"],
  SupplierDeliveries: ["Delivery ID", "Date", "Product ID", "Product Name", "Quantity", "Unit Cost", "Source", "Notes", "Recorded By", "Record JSON"],
  RestockOrders: ["Restock Order ID", "Date", "Status", "Total Budget", "Notes", "Created By", "Updated At", "Record JSON"],
  RestockOrderItems: ["Restock Order ID", "Product ID", "Product Name", "Planned Quantity", "Actual Quantity", "Cost Price", "Receipt Status", "Record JSON"],
  StockAdjustments: ["Adjustment ID", "Date", "Product ID", "Quantity", "Reason", "COGS", "Estimated Revenue", "Estimated Margin", "Recorded By", "Record JSON"],
  POSSales: ["Sale ID", "Sale Date", "Status", "Payment Method", "Item Count", "Subtotal", "Total", "Recorded By", "Record JSON"],
  POSSaleItems: ["Sale ID", "Line ID", "Product ID", "Product Name", "Unit", "Quantity", "Unit Price", "Line Total", "COGS", "Estimated Margin", "Batch Allocation JSON", "Record JSON"],
  RevenueEntries: ["Revenue ID", "Date", "Amount", "Category", "Description", "Recorded By", "Record JSON"],
  ExpenseEntries: ["Expense ID", "Date", "Category", "Expense", "Amount", "Notes", "Recorded By", "Record JSON"],
  Staff: ["Staff ID", "Full Name", "Username", "Role", "Status", "Created At", "Record JSON"],
  BusinessSettings: ["Settings ID", "Updated At", "Record JSON"],
  BudgetHeader: ["Budget ID", "Date", "Status", "Total Budget", "Updated At", "Record JSON"],
  BudgetItems: ["Budget ID", "Product ID", "Product Name", "Physical Stock", "Max Stock", "Restock Quantity", "Cost Price", "Total", "Cost Source", "Record JSON"],
  Notifications: ["Notification ID", "Time", "Message", "Read", "User ID", "User Name", "User Role", "Record JSON"],
  CustomUnits: ["Unit ID", "Unit Name", "Record JSON"],
  SyncAudit: ["Operation ID", "Received At", "Device ID", "User ID", "Operation Type", "Entity", "Record ID", "Client Created At"],
  SafeConfig: ["Date Changed", "Portal", "User Name", "Password"],
  AppState: ["Key", "Value", "Updated At"]
};

var EP_PRODUCT_MASTER_WIDTH = 19;
var EP_SALES_LOG_WIDTH = 14;

// ============================================================
// 5. SHEET HELPERS
// ============================================================

function _ensureSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  let created = false;
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    created = true;
  }
  if (headers && headers.length) {
    const existing = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn())).getValues()[0] || [];
    const needsUpdate = headers.some(function(h, i) {
      return (existing[i] || "").toString().trim() !== h;
    });
    if (needsUpdate || sheet.getLastRow() < 1) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      try { sheet.setFrozenRows(1); } catch (e) {}
      try { sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold"); } catch (e) {}
    }
  }
  return { sheet: sheet, created: created };
}

function _ensureAllSheets(ss) {
  const results = {};
  Object.keys(EP_SHEET_DEFS).forEach(function(name) {
    const result = _ensureSheet(ss, name, EP_SHEET_DEFS[name]);
    results[name] = result.created;
  });
  return results;
}

function _getSheetData(sheet, startRow, numRows, numCols) {
  if (!sheet) return [];
  const lr = _safeLastRow(sheet, 1);
  if (lr < (startRow || 2)) return [];
  const rows = numRows || (lr - (startRow || 2) + 1);
  if (rows <= 0) return [];
  const cols = numCols || sheet.getLastColumn();
  return sheet.getRange(startRow || 2, 1, rows, cols).getValues();
}

function _appendRow(sheet, values) {
  if (!sheet) return;
  sheet.appendRow(values);
}

function _updateCell(sheet, row, col, value) {
  if (!sheet || row < 1 || col < 1) return;
  sheet.getRange(row, col).setValue(value);
}

// ============================================================
// 6. PRODUCT MASTER
// ============================================================

function _getProductMasterData(ss) {
  const sheet = ss.getSheetByName('ProductMaster');
  if (!sheet) return [];
  return _getSheetData(sheet, 2, null, EP_PRODUCT_MASTER_WIDTH);
}

function _parseProductRow(row, rowIndex) {
  const productId = _normalizeString(row[0]);
  if (!productId) return null;
  return {
    rowIndex: rowIndex,
    productId: productId,
    productName: _normalizeString(row[1]),
    categoryId: _normalizeString(row[2]),
    staffId: _normalizeString(row[3]),
    supplier: _normalizeString(row[4]),
    barcode: _normalizeString(row[5]),
    unitMeasure: _normalizeString(row[6]),
    unitPrice: row[7] === "" ? null : Number(row[7]),
    unitCost: row[8] === "" ? null : Number(row[8]),
    reorderLevel: row[9] === "" ? null : Number(row[9]),
    batchNumber: _normalizeString(row[10]),
    expiryDate: _toDateOnly(row[11]),
    storageCondition: _normalizeString(row[12]),
    sizeVariant: _normalizeString(row[13]),
    createdAt: row[14],
    batchHandled: _isTruthy(row[15]),
    batchMeasure: _normalizeString(row[16]),
    batchUnits: row[17] === "" ? null : Number(row[17]),
    batchPrice: row[18] === "" ? null : Number(row[18])
  };
}

function _buildProductIndex(ss) {
  const cacheKey = _cacheKey('products_index');
  const cached = _cacheGetJson(cacheKey);
  if (cached) return cached;

  const data = _getProductMasterData(ss);
  const byId = {};
  const byCategory = {};
  const byBarcode = {};

  data.forEach(function(row, i) {
    const parsed = _parseProductRow(row, i + 2);
    if (!parsed) return;
    byId[parsed.productId] = parsed;
    if (parsed.categoryId) {
      if (!byCategory[parsed.categoryId]) byCategory[parsed.categoryId] = [];
      byCategory[parsed.categoryId].push(parsed);
    }
    if (parsed.barcode) {
      byBarcode[parsed.barcode] = parsed;
    }
  });

  const result = { byId: byId, byCategory: byCategory, byBarcode: byBarcode };
  _cachePutJson(cacheKey, result, EP_CACHE_TTL_PRODUCTS_SEC);
  return result;
}

function _buildStockMap(ss) {
  const cacheKey = _cacheKey('stock_map');
  const cached = _cacheGetJson(cacheKey);
  if (cached) return cached;

  const map = {};
  
  // Restock additions
  const restockSheet = ss.getSheetByName('RestockProductLog');
  if (restockSheet) {
    const data = _getSheetData(restockSheet, 2, null, 8);
    data.forEach(function(row) {
      const pid = _normalizeString(row[1]);
      if (!pid) return;
      const qty = Number(row[4]) || 0;
      map[pid] = (map[pid] || 0) + qty;
    });
  }

  // Sales deductions
  const salesSheet = ss.getSheetByName('SalesLog');
  if (salesSheet) {
    const data = _getSheetData(salesSheet, 2, null, EP_SALES_LOG_WIDTH);
    data.forEach(function(row) {
      const status = _normalizeString(row[10]);
      // Only deduct Paid and Pending (cart holds)
      if (status !== 'Paid' && status !== 'Pending') return;
      const pid = _normalizeString(row[2]);
      if (!pid) return;
      const qty = Number(row[6]) || 0;
      map[pid] = (map[pid] || 0) - qty;
    });
  }

  // Stock adjustments (negative)
  const adjSheet = ss.getSheetByName('StockAdjustments');
  if (adjSheet) {
    const data = _getSheetData(adjSheet, 2, null, 8);
    data.forEach(function(row) {
      const pid = _normalizeString(row[1]);
      if (!pid) return;
      const qty = Number(row[3]) || 0;
      map[pid] = (map[pid] || 0) - qty;
    });
  }

  _cachePutJson(cacheKey, map, EP_CACHE_TTL_STOCK_SEC);
  return map;
}

function getProductStock(productId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = _buildStockMap(ss);
  return map[productId] || 0;
}

function getProductById(productId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const index = _buildProductIndex(ss);
  return index.byId[productId] || null;
}

function getProductsByCategory(categoryId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const index = _buildProductIndex(ss);
  return index.byCategory[categoryId] || [];
}

function getProductsList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const index = _buildProductIndex(ss);
  return Object.values(index.byId);
}

function getProductByBarcode(barcode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const index = _buildProductIndex(ss);
  return index.byBarcode[barcode] || null;
}

// ============================================================
// 7. APP STATE PERSISTENCE
// ============================================================

function getAppStateInternal_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('AppState');
  if (!sheet) {
    _ensureSheet(ss, 'AppState', ['Key', 'Value', 'Updated At']);
    return _getDefaultState();
  }
  
  const data = _getSheetData(sheet, 2, null, 2);
  const values = {};
  data.forEach(function(row) {
    const key = _normalizeString(row[0]);
    if (!key) return;
    values[key] = row[1] == null ? '' : String(row[1]);
  });

  Object.keys(values).forEach(function(key) {
    if (!key.endsWith(APP_STATE_CHUNK_COUNT_SUFFIX)) return;
    const baseKey = key.slice(0, -APP_STATE_CHUNK_COUNT_SUFFIX.length);
    const count = Number(values[key] || 0);
    if (!baseKey || count <= 0) return;
    let combined = '';
    for (let i = 0; i < count; i++) {
      combined += values[baseKey + APP_STATE_CHUNK_SUFFIX + i] || '';
    }
    values[baseKey] = combined;
  });

  const state = {};
  Object.keys(values).forEach(function(key) {
    if (key.endsWith(APP_STATE_CHUNK_COUNT_SUFFIX) || key.indexOf(APP_STATE_CHUNK_SUFFIX) !== -1) return;
    const value = values[key];
    try {
      state[key] = JSON.parse(value);
    } catch (e) {
      state[key] = value;
    }
  });
  
  // Merge with defaults
  const defaults = _getDefaultState();
  Object.keys(defaults).forEach(function(key) {
    if (!(key in state)) {
      state[key] = defaults[key];
    }
  });
  
  return state;
}

function getAppState(sessionToken) {
  const session = requirePortalSession_(sessionToken);
  return projectStateForSession_(getAppStateInternal_(), session);
}

function projectStateForSession_(state, session) {
  const projected = JSON.parse(JSON.stringify(state || _getDefaultState()));
  projected.staffMembers = (projected.staffMembers || []).map(function(member) {
    const safe = Object.assign({}, member || {});
    delete safe.password;
    delete safe.pin;
    return safe;
  });
  if (session && session.role === 'staff') {
    const settings = projected.settings || {};
    const tabAccess = settings.staffTabAccess || {};
    const canView = function(tab) { return ((tabAccess || {})[tab] || {}).view === true; };
    projected.settings = {
      allowStaffAddProducts: settings.allowStaffAddProducts === true,
      allowStaffAddStock: settings.allowStaffAddStock === true,
      allowStaffRecordRestocks: settings.allowStaffRecordRestocks === true,
      staffTabAccess: settings.staffTabAccess || {}
    };
    projected.revenue = canView('revenue') || canView('reports') ? projected.revenue : [];
    projected.expenses = canView('expenses') || canView('reports') ? projected.expenses : [];
    projected.sales = canView('reports') ? projected.sales : [];
    projected.stockEntries = canView('restock') || canView('ledger') || canView('reports') ? projected.stockEntries : [];
    projected.stockAdjustments = canView('adjustments') || canView('inspection') || canView('reports') ? projected.stockAdjustments : [];
    if (!canView('budget') && !canView('inspection')) projected.activeBudget = Object.assign({}, projected.activeBudget || {}, { items: [], totalBudget: 0, status: 'restricted' });
    projected.restockOrders = (projected.restockOrders || []).map(function(order) {
      const safeOrder = Object.assign({}, order || {});
      safeOrder.items = (safeOrder.items || []).map(function(item) {
        const safeItem = Object.assign({}, item || {});
        delete safeItem.cost;
        delete safeItem.costPrice;
        delete safeItem.unitCost;
        return safeItem;
      });
      return safeOrder;
    });
    projected.products = (projected.products || []).map(function(product) {
      const safeProduct = Object.assign({}, product || {});
      safeProduct.batches = (safeProduct.batches || []).map(function(batch) {
        const safeBatch = Object.assign({}, batch || {});
        delete safeBatch.unitCost;
        delete safeBatch.expectedUnitMargin;
        delete safeBatch.expectedTotalMargin;
        delete safeBatch.realizedMargin;
        delete safeBatch.remainingMargin;
        return safeBatch;
      });
      return safeProduct;
    });
  }
  return projected;
}

function saveAppStateInternal_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('AppState');
  if (!sheet) {
    sheet = _ensureSheet(ss, 'AppState', ['Key', 'Value', 'Updated At']).sheet;
  }
  
  const now = new Date();
  const nowIso = now.toISOString();
  payload = validateAppState_(payload || {});
  payload._meta = Object.assign({}, payload._meta || {}, {
    serverUpdatedAt: nowIso,
    savedAt: nowIso
  });

  const rows = [];
  Object.keys(payload).forEach(function(key) {
    const value = JSON.stringify(payload[key]);
    if (value.length <= APP_STATE_CHUNK_SIZE) {
      rows.push([key, value, now]);
    } else {
      const chunkCount = Math.ceil(value.length / APP_STATE_CHUNK_SIZE);
      rows.push([key + APP_STATE_CHUNK_COUNT_SUFFIX, String(chunkCount), now]);
      for (let i = 0; i < chunkCount; i++) {
        rows.push([
          key + APP_STATE_CHUNK_SUFFIX + i,
          value.slice(i * APP_STATE_CHUNK_SIZE, (i + 1) * APP_STATE_CHUNK_SIZE),
          now
        ]);
      }
    }
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Updated At']]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  _projectAppStateToDedicatedSheets_(ss, payload, now);
  
  _cacheBustAll();
  return { success: true, savedAt: nowIso, state: payload };
}

function validateAppState_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('State payload must be an object.');
  const state = payload;
  const arrays = ['products', 'sales', 'revenue', 'expenses', 'restockOrders', 'stockEntries', 'stockAdjustments', 'staffMembers', 'notifications', 'customUnits'];
  arrays.forEach(function(key) {
    if (state[key] !== undefined && !Array.isArray(state[key])) throw new Error(key + ' must be an array.');
    if (Array.isArray(state[key]) && state[key].length > 10000) throw new Error(key + ' exceeds the maximum record count.');
  });
  if (state.nextId !== undefined && (!isFinite(Number(state.nextId)) || Number(state.nextId) < 0)) throw new Error('nextId is invalid.');

  const seenBarcodes = {};
  (state.products || []).forEach(function(product, index) {
    if (!product || typeof product !== 'object') throw new Error('Product ' + (index + 1) + ' is invalid.');
    ['id', 'name', 'category', 'unit'].forEach(function(key) {
      if (product[key] === undefined || String(product[key]).trim() === '') throw new Error('Product ' + (index + 1) + ' is missing ' + key + '.');
    });
    if (!isFinite(Number(product.sellingPrice)) || Number(product.sellingPrice) < 0) throw new Error('Product ' + product.name + ' has an invalid selling price.');
    if (!isFinite(Number(product.maxStock)) || Number(product.maxStock) <= 0) throw new Error('Product ' + product.name + ' has an invalid maximum stock.');
    const barcode = String(product.barcode || '').trim().toLowerCase();
    if (barcode && seenBarcodes[barcode]) throw new Error('Barcode ' + product.barcode + ' is assigned to more than one product.');
    if (barcode) seenBarcodes[barcode] = true;
    if (product.batches !== undefined && !Array.isArray(product.batches)) throw new Error('Product ' + product.name + ' has invalid batches.');
    (product.batches || []).forEach(function(batch) {
      if (!isFinite(Number(batch.quantityReceived || batch.qty || 0)) || Number(batch.quantityReceived || batch.qty || 0) < 0) throw new Error('Product ' + product.name + ' has an invalid batch quantity.');
      if (!isFinite(Number(batch.unitCost || 0)) || Number(batch.unitCost || 0) < 0) throw new Error('Product ' + product.name + ' has an invalid batch cost.');
    });
  });

  state.restockOrders = normalizeRestockOrdersForSave_(state.restockOrders || []);
  (state.restockOrders || []).forEach(function(order) {
    if (!order || !Array.isArray(order.items)) throw new Error('Restock order items are invalid.');
    order.items.forEach(function(item) {
      const expected = Number(item.expectedQty || item.restockQty || item.quantity || 0);
      const received = Number(item.receivedQty || item.actualQuantity || 0);
      const damaged = Number(item.damagedQty || 0);
      const cost = Number(item.cost || item.costPrice || item.unitCost || 0);
      if (![expected, received, damaged, cost].every(isFinite) || expected < 0 || received < 0 || damaged < 0 || cost < 0 || received + damaged > expected) {
        throw new Error('Restock order contains invalid receipt quantities or cost.');
      }
    });
  });

  const budget = state.activeBudget || {};
  if (budget.items !== undefined && !Array.isArray(budget.items)) throw new Error('Budget items are invalid.');
  (budget.items || []).forEach(function(item) {
    const qty = Number(item.restockQty || 0);
    const cost = Number(item.costPrice || 0);
    if (!isFinite(qty) || !isFinite(cost) || qty < 0 || cost < 0) throw new Error('Budget contains an invalid quantity or cost.');
  });
  return state;
}

function normalizeRestockOrdersForSave_(orders) {
  return (Array.isArray(orders) ? orders : []).map(function(order) {
    const normalizedOrder = Object.assign({}, order || {});
    normalizedOrder.items = (Array.isArray(normalizedOrder.items) ? normalizedOrder.items : []).map(function(item) {
      const normalizedItem = Object.assign({}, item || {});
      const received = Number(normalizedItem.receivedQty || normalizedItem.actualQuantity || 0);
      const damaged = Number(normalizedItem.damagedQty || 0);
      let expected = Number(normalizedItem.expectedQty || normalizedItem.restockQty || normalizedItem.quantity || 0);
      const cost = Number(normalizedItem.cost || normalizedItem.costPrice || normalizedItem.unitCost || 0);
      if (![expected, received, damaged, cost].every(isFinite) || expected < 0 || received < 0 || damaged < 0 || cost < 0) {
        return normalizedItem;
      }
      if (received + damaged > expected && ['received', 'partially-received'].indexOf(String(normalizedOrder.status || '')) !== -1) {
        expected = received + damaged;
      }
      normalizedItem.expectedQty = expected;
      normalizedItem.receivedQty = received;
      normalizedItem.damagedQty = damaged;
      if (normalizedItem.cost === undefined && normalizedItem.costPrice === undefined && normalizedItem.unitCost === undefined) normalizedItem.cost = cost;
      return normalizedItem;
    });
    return normalizedOrder;
  });
}

function saveAppState(payload, sessionToken) {
  requirePortalSession_(sessionToken, 'admin');
  return saveAppStateInternal_(payload);
}

// AppState is the recovery snapshot. The workflow tables below are rebuilt from
// the same accepted state, so every normal app operation has a readable Sheet
// record as well as a recovery copy.
function _projectAppStateToDedicatedSheets_(ss, state, updatedAt) {
  const products = Array.isArray(state.products) ? state.products : [];
  const activeBudget = state.activeBudget || {};
  const profile = state.settings || {};

  _replaceWorkflowSheet_(ss, 'BusinessProfile', [[
    'business', state.businessName || profile.businessName || '', state.businessType || profile.businessType || '',
    state.businessOwnerName || profile.businessOwnerName || '', state.businessOwnerEmail || profile.businessOwnerEmail || '',
    state.businessWhatsapp || profile.businessWhatsapp || '', state.businessAddress || profile.businessAddress || '', updatedAt
  ]]);
  _replaceWorkflowSheet_(ss, 'Products', products.map(function(product) {
    return [_safeSheetText_(product.id), _safeSheetText_(product.name), _safeSheetText_(product.category), _safeSheetText_(product.unit),
      _safeSheetText_(product.productType || 'packed'), Number(product.sellingPrice || 0), Number(product.maxStock || 0),
      _safeSheetText_(product.barcode), updatedAt, JSON.stringify(product)];
  }));

  const batches = [];
  const deliveries = [];
  products.forEach(function(product) {
    (Array.isArray(product.batches) ? product.batches : []).forEach(function(batch) {
      batches.push([_safeSheetText_(batch.id), _safeSheetText_(product.id), _safeSheetText_(product.name), _safeSheetText_(batch.restockEventId),
        batch.restockDate || '', batch.receivedDate || '', Number(batch.quantityReceived || batch.qty || 0), Number(batch.quantityRemaining || 0),
        Number(batch.unitCost || 0), Number(batch.sellingPriceSnapshot || product.sellingPrice || 0), _safeSheetText_(batch.status || ''), JSON.stringify(batch)]);
      if (String(batch.restockEventId || '') !== 'owner-restock') {
        deliveries.push([_safeSheetText_(batch.id), batch.receivedDate || batch.restockDate || '', _safeSheetText_(product.id), _safeSheetText_(product.name),
          Number(batch.quantityReceived || batch.qty || 0), Number(batch.unitCost || 0), _safeSheetText_(batch.source || batch.restockEventId || 'supplier'),
          _safeSheetText_(batch.notes || ''), _safeSheetText_(batch.receivedBy || ''), JSON.stringify(batch)]);
      }
    });
  });
  _replaceWorkflowSheet_(ss, 'InventoryBatches', batches);
  _replaceWorkflowSheet_(ss, 'SupplierDeliveries', deliveries);

  _replaceWorkflowSheet_(ss, 'RestockOrders', (state.restockOrders || []).map(function(order) {
    return [_safeSheetText_(order.id), order.date || order.createdAt || '', _safeSheetText_(order.status || 'Draft'), Number(order.totalBudget || order.total || 0),
      _safeSheetText_(order.notes || ''), _safeSheetText_(order.userName || order.createdBy || ''), updatedAt, JSON.stringify(order)];
  }));
  _replaceWorkflowSheet_(ss, 'RestockOrderItems', (state.restockOrders || []).reduce(function(rows, order) {
    return rows.concat((order.items || []).map(function(item) {
      return [_safeSheetText_(order.id), _safeSheetText_(item.productId), _safeSheetText_(item.productName), Number(item.expectedQty || item.restockQty || item.quantity || 0),
        Number(item.receivedQty || item.actualQuantity || 0), Number(item.cost || item.costPrice || item.unitCost || 0), _safeSheetText_(item.receiptStatus || order.status || ''), JSON.stringify(item)];
    }));
  }, []));
  _replaceWorkflowSheet_(ss, 'StockAdjustments', (state.stockAdjustments || []).map(function(item) {
    return [_safeSheetText_(item.id), item.date || item.createdAt || '', _safeSheetText_(item.productId), Number(item.qty || 0), _safeSheetText_(item.reason),
      Number(item.cogs || 0), Number(item.estimatedRevenue || 0), Number(item.estimatedMargin || 0), _safeSheetText_(item.userName || ''), JSON.stringify(item)];
  }));
  _replaceWorkflowSheet_(ss, 'POSSales', (state.sales || []).map(function(sale) {
    return [_safeSheetText_(sale.id), sale.date || sale.createdAt || '', _safeSheetText_(sale.status || 'Completed'), _safeSheetText_(sale.paymentMethod || 'Cash'),
      Number(sale.itemCount || (sale.items || []).length || 0), Number(sale.subtotal || sale.total || 0), Number(sale.total || 0), _safeSheetText_(sale.userName || ''), JSON.stringify(sale)];
  }));
  _replaceWorkflowSheet_(ss, 'POSSaleItems', (state.sales || []).reduce(function(rows, sale) {
    return rows.concat((sale.items || []).map(function(item) {
      return [_safeSheetText_(sale.id), _safeSheetText_(item.id), _safeSheetText_(item.productId), _safeSheetText_(item.productName), _safeSheetText_(item.unit || ''),
        Number(item.qty || 0), Number(item.unitPrice || 0), Number(item.lineTotal || 0), Number(item.cogs || 0), Number(item.estimatedMargin || 0), JSON.stringify(item.allocation || []), JSON.stringify(item)];
    }));
  }, []));
  _replaceWorkflowSheet_(ss, 'RevenueEntries', (state.revenue || []).filter(function(item) { return item && item._delete !== true; }).map(function(item) {
    return [_safeSheetText_(item.id), item.date || '', Number(item.amount || 0), _safeSheetText_(item.category || ''), _safeSheetText_(item.description || item.notes || ''), _safeSheetText_(item.userName || ''), JSON.stringify(item)];
  }));
  _replaceWorkflowSheet_(ss, 'ExpenseEntries', (state.expenses || []).filter(function(item) { return item && item._delete !== true; }).map(function(item) {
    return [_safeSheetText_(item.id), item.date || '', _safeSheetText_(item.category), _safeSheetText_(item.expenseName), Number(item.amount || 0), _safeSheetText_(item.notes || ''), _safeSheetText_(item.userName || ''), JSON.stringify(item)];
  }));
  _replaceWorkflowSheet_(ss, 'Staff', (state.staffMembers || []).map(function(item) {
    return [_safeSheetText_(item.id), _safeSheetText_(item.fullName || item.name), _safeSheetText_(item.username || item.email || ''), _safeSheetText_(item.role || 'Staff'),
      _safeSheetText_(item.active === false ? 'Inactive' : 'Active'), item.createdAt || '', JSON.stringify(item)];
  }));
  _replaceWorkflowSheet_(ss, 'BusinessSettings', profile ? [['settings', updatedAt, JSON.stringify(profile)]] : []);
  _replaceWorkflowSheet_(ss, 'BudgetHeader', activeBudget.id ? [[_safeSheetText_(activeBudget.id), activeBudget.date || '', _safeSheetText_(activeBudget.status || 'draft'), Number(activeBudget.totalBudget || 0), updatedAt, JSON.stringify(activeBudget)]] : []);
  _replaceWorkflowSheet_(ss, 'BudgetItems', (activeBudget.items || []).map(function(item) {
    return [_safeSheetText_(activeBudget.id || ''), _safeSheetText_(item.productId), _safeSheetText_(item.productName), Number(item.physicalStock || 0), Number(item.maxStock || 0),
      Number(item.restockQty || 0), Number(item.costPrice || 0), Number(item.total || 0), _safeSheetText_(item.costSource || ''), JSON.stringify(item)];
  }));
  _replaceWorkflowSheet_(ss, 'Notifications', (state.notifications || []).map(function(item, index) {
    return [_safeSheetText_(item.id || index + 1), item.time || item.createdAt || '', _safeSheetText_(item.text || item.message || ''), item.read === true,
      _safeSheetText_(item.userId || ''), _safeSheetText_(item.userName || ''), _safeSheetText_(item.userRole || ''), JSON.stringify(item)];
  }));
  _replaceWorkflowSheet_(ss, 'CustomUnits', (state.customUnits || []).map(function(item, index) {
    const unit = typeof item === 'string' ? { id: item, name: item } : item || {};
    return [_safeSheetText_(unit.id || index + 1), _safeSheetText_(unit.name || unit.label || ''), JSON.stringify(item)];
  }));
}

function _replaceWorkflowSheet_(ss, sheetName, rows) {
  const definition = EP_SHEET_DEFS[sheetName];
  const sheet = _ensureSheet(ss, sheetName, definition).sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, definition.length).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, definition.length).setValues(rows);
}

function _safeSheetText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function getSyncSnapshot(clientRevision, sessionToken) {
  const session = requirePortalSession_(sessionToken);
  const state = getAppStateInternal_();
  state._sync = state._sync || { revision: 0, appliedOps: [] };
  return {
    ok: true,
    state: projectStateForSession_(state, session),
    serverRevision: Number(state._sync.revision || 0),
    serverUpdatedAt: (state._meta && state._meta.serverUpdatedAt) || '',
    clientRevision: Number(clientRevision || 0)
  };
}

function pushSyncOps(ops, clientRevision, deviceId, sessionToken) {
  const session = requirePortalSession_(sessionToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let state = getAppStateInternal_();
    state._sync = state._sync || { revision: 0, appliedOps: [] };
    const applied = {};
    (state._sync.appliedOps || []).forEach(function(opId) { applied[String(opId)] = true; });
    (Array.isArray(ops) ? ops : []).forEach(function(op) {
      const opId = String((op && op.opId) || '');
      if (!opId || applied[opId]) return;
      const action = (op && op.action) || {};
      let incoming = (op && (op.payload || op.state)) || {};
      const opBaseRevision = Number((op && op.baseRevision) || clientRevision || 0);
      const serverRevision = Number(state._sync.revision || 0);
      if (opBaseRevision < serverRevision && !stateHasMergeTimestamps_(incoming)) {
        throw new Error('This browser has older shop data. Refresh before saving to avoid overwriting newer edits.');
      }
      if (session.role === 'staff') incoming = _mergeStaffState_(state, incoming, action);
      incoming = _protectStaffCredentials_(incoming);
      state = mergeStateRecords_(state, incoming);
      _appendSyncOperation_(ss, op, opId, deviceId);
      applied[opId] = true;
      state._sync.revision = Number(state._sync.revision || 0) + 1;
    });
    state._sync.deviceId = String(deviceId || state._sync.deviceId || '');
    state._sync.appliedOps = Object.keys(applied).slice(-500);
    state._sync.lastSyncAt = new Date().toISOString();
    const result = saveAppStateInternal_(state);
    return {
      ok: true,
      state: projectStateForSession_(result.state || state, session),
      serverRevision: Number(state._sync.revision || 0),
      appliedOps: state._sync.appliedOps,
      clientRevision: Number(clientRevision || 0),
      deviceId: String(deviceId || '')
    };
  } finally {
    lock.releaseLock();
  }
}

function stateHasMergeTimestamps_(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.updatedAt || (state._meta && state._meta.clientUpdatedAt)) return true;
  return Object.keys(state).some(function(key) {
    const value = state[key];
    if (Array.isArray(value)) {
      return value.some(function(row) {
        return row && typeof row === 'object' && (row.updatedAt || row.timestamp || row.createdAt);
      });
    }
    return value && typeof value === 'object' && (value.updatedAt || value.timestamp);
  });
}

function _stripStaffProtectedState_(incoming) {
  const safe = JSON.parse(JSON.stringify(incoming || {}));
  // Staff may sync the workflows granted in the UI, but cannot use a crafted
  // whole-state payload to alter portal access, staff accounts, or business
  // ownership/configuration.
  // Projected staff state intentionally redacts batch/order costs. Do not merge
  // those redacted arrays back into the authoritative state.
  ['settings', 'staffMembers', 'businessName', 'businessType', 'businessOwnerName', 'businessOwnerEmail', 'businessWhatsapp', 'businessAddress', 'products', 'restockOrders', 'revenue', 'expenses', 'sales', 'stockEntries', 'stockAdjustments'].forEach(function(key) { delete safe[key]; });
  return safe;
}

var EP_STAFF_WRITE_DOMAINS = {
  products: ['products'],
  budget: ['activeBudget'],
  revenue: ['revenue']
};

function _assertStaffWriteAccess_(state, action) {
  const view = String((action && action.view) || '');
  const access = ((state.settings || {}).staffTabAccess || {})[view] || {};
  if (access.edit !== true || !EP_STAFF_WRITE_DOMAINS[view]) {
    throw new Error('You do not have server-authorized edit access to this feature.');
  }
  return view;
}

function _mergeStaffProducts_(currentProducts, incomingProducts) {
  const incomingById = {};
  (incomingProducts || []).forEach(function(product) { incomingById[String(product && product.id)] = product || {}; });
  return (currentProducts || []).map(function(existing) {
    const update = incomingById[String(existing.id)];
    if (!update) return existing;
    // A staff product edit may update catalogue labels and the replenishment
    // target, but cannot alter price, FIFO batches, or stock history.
    const merged = Object.assign({}, existing);
    ['name', 'category', 'barcode', 'maxStock', 'unit', 'productType'].forEach(function(key) {
      if (update[key] !== undefined) merged[key] = update[key];
    });
    return merged;
  });
}

function _mergeStaffState_(current, incoming, action) {
  const view = _assertStaffWriteAccess_(current, action);
  const merged = JSON.parse(JSON.stringify(current || {}));
  if (view === 'products') merged.products = _mergeStaffProducts_(current.products, incoming.products);
  if (view === 'revenue' && incoming.revenue !== undefined) merged.revenue = mergeRowsByIdentity_(current.revenue || [], incoming.revenue || [], 'revenue');
  if (view === 'budget') {
    if (incoming.activeBudget !== undefined) merged.activeBudget = mergeBudget_(current.activeBudget, incoming.activeBudget);
  }
  return merged;
}

function _protectStaffCredentials_(incoming) {
  const safe = JSON.parse(JSON.stringify(incoming || {}));
  safe.staffMembers = (safe.staffMembers || []).map(function(member) {
    const protectedMember = Object.assign({}, member || {});
    const username = String(protectedMember.username || '').trim();
    const password = String(protectedMember.password || '');
    if (username && password && password.indexOf('sha256:') !== 0) {
      protectedMember.password = _hashPassword('staff', username, password);
    }
    delete protectedMember.pin;
    return protectedMember;
  });
  return safe;
}

function _appendSyncOperation_(ss, op, opId, deviceId) {
  const sheet = _ensureSheet(ss, 'SyncAudit', EP_SHEET_DEFS.SyncAudit).sheet;
  _appendRow(sheet, [
    _safeSheetText_(opId),
    new Date(),
    _safeSheetText_(deviceId || op.deviceId || ''),
    _safeSheetText_(op.userId || ''),
    _safeSheetText_(op.type || 'state-save'),
    _safeSheetText_(op.entity || 'appState'),
    _safeSheetText_(op.recordId || 'state'),
    op.createdAt || ''
  ]);
}

function getSyncStatus(deviceId, sessionToken) {
  requirePortalSession_(sessionToken);
  const state = getAppStateInternal_();
  const sync = state._sync || {};
  return {
    ok: true,
    deviceId: String(deviceId || ''),
    serverRevision: Number(sync.revision || 0),
    serverUpdatedAt: (state._meta && state._meta.serverUpdatedAt) || sync.lastSyncAt || '',
    appliedOps: (sync.appliedOps || []).length
  };
}

function mergeStateRecords_(base, incoming) {
  base = base || {};
  incoming = incoming || {};
  Object.keys(incoming).forEach(function(key) {
    if (key === 'user' || key === 'currentUser' || key === 'currentView') return;
    if (key === 'settings') {
      base.settings = mergeSettingsPatch_(base.settings || {}, incoming.settings || {});
      return;
    }
    if (key === 'products' && Array.isArray(incoming.products)) {
      base.products = mergeProducts_(base.products || [], incoming.products);
      return;
    }
    if (key === 'restockOrders' && Array.isArray(incoming.restockOrders)) {
      base.restockOrders = mergeRestockOrders_(base.restockOrders || [], incoming.restockOrders);
      return;
    }
    if (Array.isArray(incoming[key])) {
      base[key] = mergeRowsByIdentity_(base[key] || [], incoming[key], key);
    } else if (incoming[key] && typeof incoming[key] === 'object') {
      if (key === 'activeBudget') {
        base.activeBudget = mergeBudget_(base.activeBudget, incoming.activeBudget);
        return;
      }
      base[key] = Object.assign({}, base[key] || {}, incoming[key]);
    } else if (incoming[key] !== undefined) {
      base[key] = incoming[key];
    }
  });
  base.nextId = Math.max(Number(base.nextId || 0), Number(incoming.nextId || 0));
  return base;
}

function mergeProducts_(currentProducts, incomingProducts) {
  const map = {};
  (Array.isArray(currentProducts) ? currentProducts : []).forEach(function(product) { map[rowIdentity_(product)] = product; });
  (Array.isArray(incomingProducts) ? incomingProducts : []).forEach(function(product) {
    const key = rowIdentity_(product);
    if (product && product._delete === true) {
      map[key] = product;
      return;
    }
    const current = map[key];
    if (!current || current._delete === true) {
      map[key] = product;
      return;
    }
    const oldTs = Date.parse(current.updatedAt || current.timestamp || current.createdAt || 0) || 0;
    const newTs = Date.parse(product.updatedAt || product.timestamp || product.createdAt || 0) || 0;
    const merged = newTs >= oldTs ? Object.assign({}, current, product) : Object.assign({}, product, current);
    merged.batches = mergeRowsByIdentity_(current.batches || [], product.batches || [], 'productBatches');
    merged.stockMovements = mergeRowsByIdentity_(current.stockMovements || [], product.stockMovements || [], 'productStockMovements');
    map[key] = merged;
  });
  return Object.keys(map).map(function(key) { return map[key]; }).filter(function(row) { return !(row && row._delete === true); });
}

function mergeRestockOrders_(currentOrders, incomingOrders) {
  const map = {};
  (Array.isArray(currentOrders) ? currentOrders : []).forEach(function(order) { map[rowIdentity_(order)] = order; });
  (Array.isArray(incomingOrders) ? incomingOrders : []).forEach(function(order) {
    const key = rowIdentity_(order);
    if (order && order._delete === true) {
      map[key] = order;
      return;
    }
    const current = map[key];
    if (!current || current._delete === true) {
      map[key] = order;
      return;
    }
    const oldTs = Date.parse(current.updatedAt || current.timestamp || current.createdAt || 0) || 0;
    const newTs = Date.parse(order.updatedAt || order.timestamp || order.createdAt || 0) || 0;
    const merged = newTs >= oldTs ? Object.assign({}, current, order) : Object.assign({}, order, current);
    merged.items = mergeRowsByIdentity_(current.items || [], order.items || [], 'restockOrderItems');
    map[key] = merged;
  });
  return Object.keys(map).map(function(key) { return map[key]; });
}

function mergeSettingsPatch_(current, incoming) {
  const merged = Object.assign({}, current || {});
  const patch = incoming && typeof incoming === 'object' ? incoming : {};
  Object.keys(patch).forEach(function(key) {
    if (key === 'staffTabAccess') return;
    merged[key] = patch[key];
  });
  if (patch.staffTabAccess) {
    const access = Object.assign({}, merged.staffTabAccess || {});
    Object.keys(patch.staffTabAccess || {}).forEach(function(tabId) {
      access[tabId] = Object.assign({}, access[tabId] || { view: false, edit: false }, patch.staffTabAccess[tabId] || {});
      if (!access[tabId].view) access[tabId].edit = false;
    });
    merged.staffTabAccess = access;
  }
  return merged;
}

function mergeRowsByIdentity_(currentRows, incomingRows, entity) {
  const appendOnly = { revenue: true, expenses: true, sales: true, payroll: true, stockEntries: true, stockAdjustments: true, auditLog: true, notifications: true };
  const map = {};
  (Array.isArray(currentRows) ? currentRows : []).forEach(function(row) { map[rowIdentity_(row)] = row; });
  (Array.isArray(incomingRows) ? incomingRows : []).forEach(function(row) {
    const key = rowIdentity_(row);
    if (row && row._delete === true) {
      map[key] = row;
      return;
    }
    if (map[key] && map[key]._delete === true) {
      return;
    }
    if (!map[key] || appendOnly[entity]) {
      map[key] = row;
      return;
    }
    const oldTs = Date.parse(map[key].updatedAt || map[key].timestamp || map[key].createdAt || 0) || 0;
    const newTs = Date.parse(row.updatedAt || row.timestamp || row.createdAt || 0) || 0;
    if (newTs >= oldTs) map[key] = Object.assign({}, map[key], row);
  });
  return Object.keys(map).map(function(key) { return map[key]; }).filter(function(row) {
    return appendOnly[entity] || !(row && row._delete === true);
  });
}

function mergeBudget_(current, incoming) {
  const currentBudget = current && typeof current === 'object' ? current : {};
  const incomingBudget = incoming && typeof incoming === 'object' ? incoming : {};
  const oldTs = Date.parse(currentBudget.updatedAt || currentBudget.timestamp || currentBudget.createdAt || 0) || 0;
  const newTs = Date.parse(incomingBudget.updatedAt || incomingBudget.timestamp || incomingBudget.createdAt || 0) || 0;
  if (oldTs > 0 && newTs > 0 && newTs < oldTs) return currentBudget;
  const merged = Object.assign({}, currentBudget, incomingBudget);
  const currentItems = currentBudget.items || [];
  const incomingItems = incomingBudget.items || [];
  merged.items = newTs >= oldTs && incomingItems.length < currentItems.length
    ? incomingItems
    : mergeRowsByIdentity_(currentItems, incomingItems, 'budgetItems');
  merged.totalBudget = merged.items.reduce(function(sum, item) {
    return sum + (Number(item.restockQty || 0) * Number(item.costPrice || 0));
  }, 0);
  return merged;
}

function rowIdentity_(row) {
  row = row || {};
  return String(row.id || row.userId || row.staffId || row.saleId || row.sourceProductId || row.productId || row.name || (row.text && row.time ? row.time + '|' + row.text : '') || JSON.stringify(row));
}

function importAppState(payload, sessionToken) {
  requirePortalSession_(sessionToken, 'admin');
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  return saveAppState(parsed, sessionToken).state;
}

function _getDefaultState() {
  return {
    _meta: {},
    nextId: 1000,
    products: [],
    sales: [],
    revenue: [],
    expenses: [],
    restockOrders: [],
    stockEntries: [],
    stockAdjustments: [],
    staffMembers: [],
    settings: {
      allowStaffAddProducts: false,
      allowStaffAddStock: false,
      allowStaffRecordRestocks: false,
      businessType: 'retail_supermarket',
      businessName: 'TradeFlow Pro',
      businessOwnerName: '',
      businessOwnerEmail: '',
      businessWhatsapp: '',
      businessAddress: '',
      requireAdminPortalLogin: false,
      requireStaffPortalLogin: false,
      adminPortalUsername: 'admin',
      setupCompleted: false,
      recurringExpenses: [],
      staffTabAccess: _getDefaultStaffTabAccess()
    },
    notifications: [],
    customUnits: [],
    activeBudget: {
      id: 1001,
      date: _formatDate(new Date()),
      items: [],
      status: 'draft',
      totalBudget: 0
    },
    businessType: 'retail_supermarket',
    businessName: 'TradeFlow Pro',
    businessOwnerName: '',
    businessOwnerEmail: '',
    businessWhatsapp: '',
    businessAddress: ''
  };
}

function _getDefaultStaffTabAccess() {
  const tabIds = [
    'dashboard', 'pos', 'products', 'restock', 'inspection', 'budget', 'ledger',
    'pending', 'stockEntries', 'orders', 'adjustments', 'reports', 'revenue',
    'expenses', 'settings'
  ];
  return tabIds.reduce(function(map, id) {
    map[id] = {
      view: id !== 'settings',
      edit: id !== 'settings'
    };
    return map;
  }, {});
}

function prepareAppReset(sessionToken) {
  const session = requirePortalSession_(sessionToken, 'admin');
  const state = getAppStateInternal_();
  const phrase = 'RESET ' + String(state.businessName || (state.settings || {}).businessName || 'TradeFlow Pro').trim();
  const nonce = Utilities.getUuid().replace(/-/g, '');
  const key = EP_RESET_CHALLENGE_PREFIX + _sessionPropertyKey_(sessionToken);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({ nonce: nonce, phrase: phrase, username: session.username, expiresAt: Date.now() + EP_RESET_CHALLENGE_TTL_MS }));
  return { phrase: phrase, resetToken: nonce, expiresAt: Date.now() + EP_RESET_CHALLENGE_TTL_MS };
}

function resetAppState(sessionToken, confirmation, resetToken) {
  requirePortalSession_(sessionToken, 'admin');
  const key = EP_RESET_CHALLENGE_PREFIX + _sessionPropertyKey_(sessionToken);
  const challenge = _parseJson(PropertiesService.getScriptProperties().getProperty(key));
  // Consume the challenge before changing state so it cannot be replayed.
  PropertiesService.getScriptProperties().deleteProperty(key);
  if (!challenge || Number(challenge.expiresAt || 0) <= Date.now() || String(challenge.nonce || '') !== String(resetToken || '') || String(challenge.phrase || '') !== String(confirmation || '').trim()) {
    throw new Error('Reset confirmation is invalid or has expired. Start again.');
  }
  const defaults = _getDefaultState();
  saveAppStateInternal_(defaults);
  _cacheBustAll();
  return defaults;
}

// ============================================================
// 8. BUSINESS TYPES
// ============================================================

var BUSINESS_TYPES = {
  'retail_supermarket': {
    label: 'Retail Supermarket',
    categories: [
      'Fresh Produce & Vegetables', 'Dairy & Eggs', 'Meat & Poultry',
      'Bakery & Bread', 'Beverages', 'Snacks & Confectionery',
      'Rice, Pasta & Grains', 'Canned & Packaged Foods',
      'Cooking Oil & Spices', 'Frozen Foods', 'Household & Cleaning',
      'Personal Care & Toiletries', 'Baby & Infant Products',
      'Pet Food & Supplies', 'Breakfast Cereals', 'Health & Wellness',
      'Stationery & Office Supplies', 'Cigarettes & Tobacco', 'General Merchandise'
    ]
  },
  'hardware': {
    label: 'Hardware & Building',
    categories: [
      'Cement & Concrete', 'Bricks & Blocks', 'Roofing & Ceiling',
      'Timber & Wood', 'Plumbing & Fittings', 'Electrical & Cables',
      'Paint & Coatings', 'Nails & Fasteners', 'Tiles & Flooring',
      'Glass & Glazing', 'Steel & Metal', 'Garden & Landscaping',
      'Hand Tools & Power Tools', 'Safety Equipment & PPE',
      'Kitchen & Bathroom Fittings', 'Electrical Appliances',
      'Insulation Materials', 'PVC & Plastic Piping'
    ]
  },
  'pharmacy': {
    label: 'Pharmacy & Health',
    categories: [
      'Prescription Medications', 'Over-the-Counter Medicines',
      'Vitamins & Supplements', 'First Aid & Wound Care',
      'Baby & Child Healthcare', 'Personal Hygiene',
      'Beauty & Skincare', 'Oral Care', 'Eye Care',
      'Medical Equipment', 'Health Drinks & Nutrition',
      'Herbal & Traditional Medicines', 'Diabetes & Chronic Care',
      'Pain Relief & Analgesics', 'Allergy & Respiratory',
      'Digestive Health', 'Sexual & Reproductive Health',
      'Pet Medications'
    ]
  },
  'clothing': {
    label: 'Clothing & Fashion',
    categories: [
      "Men's Clothing", "Women's Clothing", "Children's Wear",
      'Footwear', 'Accessories', 'Jewelry & Watches',
      'Traditional Clothing', 'Sportswear', 'Lingerie & Sleepwear',
      'Formal Wear', 'Denim & Jeans', 'Outerwear',
      'Swimwear', 'School Uniforms', 'Workwear & Corporate',
      'Hosiery & Socks', 'Belts & Leather Goods', 'Hats & Caps'
    ]
  },
  'electronics': {
    label: 'Electronics & Appliances',
    categories: [
      'Smartphones & Tablets', 'Laptops & Computers',
      'Televisions & Home Entertainment', 'Audio & Sound Systems',
      'Kitchen Appliances', 'Refrigerators & Freezers',
      'Washing Machines & Dryers', 'Mobile Accessories',
      'Camera & Photography', 'Gaming & Video Games',
      'Computer Accessories', 'Air Conditioners & Fans',
      'Smart Home Devices', 'Vacuum Cleaners', 'Electric Tools',
      'Fitness & Health Tech', 'Batteries & Power Banks',
      'Cables & Connectivity'
    ]
  },
  'furniture': {
    label: 'Furniture Store',
    categories: [
      'Living Room Furniture', 'Bedroom Furniture',
      'Dining Room Furniture', 'Office Furniture',
      'Outdoor Furniture', 'Kitchen Cabinets',
      'Mattresses & Bedding', 'Curtains & Blinds',
      'Rugs & Carpets', 'Lighting Fixtures',
      'Shelving & Storage', 'TV Stands & Entertainment Units',
      "Children's Furniture", 'Bathroom Furniture',
      'Doors & Door Fittings', 'Decorative Items & Mirrors',
      'Window Frames & Glass', 'Custom Furniture Orders'
    ]
  },
  'automotive': {
    label: 'Automotive Parts',
    categories: [
      'Engine Parts', 'Brake Systems', 'Transmission & Gearbox',
      'Suspension & Steering', 'Electrical & Ignition',
      'Tires & Wheels', 'Batteries & Charging',
      'Filters', 'Exhaust Systems', 'Air Conditioning Parts',
      'Body Parts & Panels', 'Lighting & Bulbs',
      'Wipers & Windows', 'Cooling System',
      'Lubricants & Oils', 'Car Accessories',
      'Tools & Garage Equipment', 'Performance Upgrades'
    ]
  },
  'restaurant': {
    label: 'Restaurant & Food',
    categories: [
      'Beverages', 'Main Dishes', 'Sides & Accompaniments',
      'Desserts & Pastries', 'Breakfast Items', 'Lunch Specials',
      'Dinner Specials', 'Salads & Healthy Options',
      'Sandwiches & Wraps', 'Pasta & Noodle Dishes',
      'Pizza & Italian', 'Traditional Zambian Dishes',
      'International Cuisine', 'Catering & Events',
      "Kid's Meals", 'Seafood & Fish',
      'Vegetarian & Vegan', 'Alcoholic & Non-alcoholic'
    ]
  },
  'cosmetics': {
    label: 'Cosmetics & Beauty',
    categories: [
      'Haircare', 'Skincare', 'Makeup',
      'Nail Care', 'Fragrances & Perfumes',
      'Salon Equipment & Tools', 'Hair Extensions & Wigs',
      "Men's Grooming", 'Sun Protection',
      'Bath & Body', 'Organic & Natural Products',
      'Anti-aging & Skincare', 'Professional Makeup',
      'Beauty Accessories', 'Eyelashes & Brows',
      'Tattoo & Permanent Makeup', 'Spa & Wellness Products',
      'Hair Dyes & Color'
    ]
  },
  'agriculture': {
    label: 'Agricultural Supplies',
    categories: [
      'Fertilizers', 'Seeds', 'Pesticides & Herbicides',
      'Farming Tools & Equipment', 'Animal Feed & Supplements',
      'Veterinary Supplies', 'Irrigation Equipment',
      'Greenhouses & Shade Nets', 'Harvesting Tools',
      'Livestock Equipment', 'Packaging & Storage',
      'Soil Testing & Analysis', 'Drainage & Water Management',
      'Organic Farming Supplies', 'Horticulture & Flowers',
      'Poultry Equipment', 'Beekeeping Equipment',
      'Fish Farming Supplies'
    ]
  },
  'stationery': {
    label: 'Stationery & Office',
    categories: [
      'Paper & Printing', 'Writing Instruments',
      'Office Furniture', 'Filing & Organization',
      'Computer Supplies', 'School Supplies',
      'Art & Craft Materials', 'Office Machines',
      'Envelopes & Mailing', 'Business Forms',
      'Whiteboards & Presentation', 'Packaging',
      'Cleaning Supplies', 'Safety & First Aid',
      'Technology Accessories', 'Breakroom Supplies',
      'Desk Accessories', 'Office Decor & Plants'
    ]
  },
  'cellular': {
    label: 'Cellular & Airtime',
    categories: [
      'Mobile Airtime', 'Mobile Money Transactions',
      'Data Bundles', 'Smartphones & Tablets',
      'SIM Cards', 'Mobile Accessories',
      'Bill Payments', 'Prepaid Electricity',
      'Digital Money Transfers', 'International Calling',
      'Television Subscriptions', 'Internet Services',
      'Digital Gift Cards', 'Mobile Banking Services',
      'Insurance Products', 'Travel & Ticket Services',
      'Education & School Fees', 'Donations & Zakat'
    ]
  },
  'construction': {
    label: 'Construction & Building',
    categories: [
      'Materials', 'Lumber', 'Concrete & Cement',
      'Steel & Metal', 'Roofing & Ceiling',
      'Plumbing & Pipes', 'Electrical & Wiring',
      'Painting & Finishing', 'Flooring & Tiling',
      'Windows & Glass', 'Construction Tools',
      'Safety Gear & PPE', 'Landscaping & Exterior',
      'HVAC', 'Insulation & Soundproofing',
      'Scaffolding & Ladders', 'Formwork & Shuttering',
      'Waterproofing & Treatments'
    ]
  },
  'pet_supplies': {
    label: 'Pet Supplies',
    categories: [
      'Pet Food', 'Pet Accessories',
      'Bedding & Kennels', 'Grooming Products',
      'Pet Medications', 'Toys & Entertainment',
      'Pet Travel & Carriers', 'Fish Tanks & Aquarium',
      'Bird Cages & Supplies', 'Reptile & Terrarium',
      'Training Aids', 'Hygiene & Waste Management',
      'Feeding Bowls & Waterers', 'Veterinary Equipment',
      'Pet Insurance', 'Dog Clothing & Accessories',
      'Cat Furniture', 'Pet ID & Tracking'
    ]
  },
  'bookstore': {
    label: 'Bookstore & Learning',
    categories: [
      'School Textbooks', 'University & College Texts',
      "Children's Books & Readers", 'Fiction & Novels',
      'Non-Fiction', 'Educational Software',
      'Art & Craft Supplies', 'Musical Instruments',
      'Stationery', 'Educational Toys & Games',
      'Curriculum Materials', 'E-books & Digital Libraries',
      'Language Learning', 'Reference Materials',
      'Scientific Equipment', 'Study Guides & Exam Prep',
      'Religious & Spiritual Books', 'Career & Vocational Guides'
    ]
  }
};

function getBusinessTypes() {
  return BUSINESS_TYPES;
}

function getBusinessTypeCategories(businessType) {
  return BUSINESS_TYPES[businessType]?.categories || [];
}

// ============================================================
// 9. CATEGORIES
// ============================================================

function _ensureCategory(ss, categoryName) {
  const sheet = ss.getSheetByName('ProductCategoryConfig');
  if (!sheet) return null;
  
  const data = _getSheetData(sheet, 2, null, 2);
  const nameLower = categoryName.toLowerCase();
  
  for (let i = 0; i < data.length; i++) {
    const id = _normalizeString(data[i][0]);
    const name = _normalizeString(data[i][1]);
    if (name.toLowerCase() === nameLower) {
      return { categoryId: id, categoryName: name };
    }
  }
  
  // Create new category
  const existingIds = data.map(function(row) { return _normalizeString(row[0]); });
  const newId = _generateId('CAT', existingIds);
  sheet.appendRow([newId, categoryName]);
  _cacheRemove(_cacheKey('categories'));
  return { categoryId: newId, categoryName: categoryName, created: true };
}

function getCategories() {
  const cacheKey = _cacheKey('categories');
  const cached = _cacheGetJson(cacheKey);
  if (cached) return cached;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ProductCategoryConfig');
  if (!sheet) return [];
  
  const data = _getSheetData(sheet, 2, null, 2);
  const result = data.map(function(row) {
    return {
      id: _normalizeString(row[0]),
      name: _normalizeString(row[1])
    };
  }).filter(function(c) { return c.id; });
  
  _cachePutJson(cacheKey, result, EP_CACHE_TTL_CATEGORIES_SEC);
  return result;
}

function seedCategories(businessType) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const categories = BUSINESS_TYPES[businessType]?.categories || [];
  if (!categories.length) return { added: 0 };
  
  const sheet = ss.getSheetByName('ProductCategoryConfig');
  if (!sheet) return { error: 'Category sheet not found' };
  
  const existing = {};
  const data = _getSheetData(sheet, 2, null, 2);
  data.forEach(function(row) {
    const name = _normalizeString(row[1]);
    if (name) existing[name.toLowerCase()] = true;
  });
  
  let added = 0;
  const existingIds = data.map(function(row) { return _normalizeString(row[0]); });
  let nextId = _generateId('CAT', existingIds);
  
  categories.forEach(function(catName) {
    if (existing[catName.toLowerCase()]) return;
    sheet.appendRow([nextId, catName]);
    nextId = 'CAT' + String(parseInt(nextId.replace('CAT', ''), 10) + 1).padStart(3, '0');
    added++;
  });
  
  _cacheRemove(_cacheKey('categories'));
  return { added: added };
}

// ============================================================
// 10. STAFF
// ============================================================

function getStaffList() {
  const cacheKey = _cacheKey('staff_list');
  const cached = _cacheGetJson(cacheKey);
  if (cached) return cached;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('StaffMaster');
  if (!sheet) return [];
  
  const data = _getSheetData(sheet, 2, null, 6);
  const result = data.map(function(row) {
    return {
      staffId: _normalizeString(row[0]),
      fullName: _normalizeString(row[1]),
      role: _normalizeString(row[2]),
      phone: _normalizeString(row[3]),
      email: _normalizeString(row[4]),
      status: _normalizeString(row[5]) || 'Active'
    };
  }).filter(function(s) { return s.staffId; });
  
  _cachePutJson(cacheKey, result, EP_CACHE_TTL_STAFF_SEC);
  return result;
}

function addStaffMember(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('StaffMaster');
  if (!sheet) return { error: 'StaffMaster sheet not found' };
  
  const name = _normalizeString(data.fullName);
  const email = _normalizeString(data.email);
  const role = _normalizeString(data.role) || 'Staff';
  const phone = _normalizeString(data.phoneNumber);
  
  if (!name) return { error: 'Full name is required' };
  if (!email) return { error: 'Email is required' };
  
  // Check for duplicate email
  const existing = getStaffList();
  if (existing.some(function(s) { return s.email.toLowerCase() === email.toLowerCase(); })) {
    return { error: 'Email already registered' };
  }
  
  const existingIds = existing.map(function(s) { return s.staffId; });
  const staffId = _generateId('ST', existingIds);
  
  sheet.appendRow([staffId, name, role, phone, email, 'Active']);
  _cacheRemove(_cacheKey('staff_list'));
  
  return { success: true, staffId: staffId, fullName: name };
}

function updateStaffStatus(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('StaffMaster');
  if (!sheet) return { error: 'StaffMaster sheet not found' };
  
  const staffId = _normalizeString(data.staffId);
  const status = _normalizeString(data.status);
  if (!staffId) return { error: 'Staff ID required' };
  if (!status) return { error: 'Status required' };
  
  const rows = _getSheetData(sheet, 2, null, 6);
  for (let i = 0; i < rows.length; i++) {
    if (_normalizeString(rows[i][0]) === staffId) {
      const rowNum = i + 2;
      sheet.getRange(rowNum, 6).setValue(status);
      _cacheRemove(_cacheKey('staff_list'));
      return { success: true, staffId: staffId, status: status };
    }
  }
  
  return { error: 'Staff member not found' };
}

// ============================================================
// 11. SETTINGS
// ============================================================

function getAppSettings() {
  const cacheKey = _cacheKey('app_settings');
  const cached = _cacheGetJson(cacheKey);
  if (cached) return cached;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Settings');
  if (!sheet) {
    _ensureSheet(ss, 'Settings', ['Key', 'Value', 'Updated At']);
    return { businessName: 'TradeFlow Pro', businessType: 'retail_supermarket', businessOwnerName: '', businessOwnerEmail: '', businessWhatsapp: '', businessAddress: '', setupCompleted: false };
  }
  
  const data = _getSheetData(sheet, 2, null, 2);
  const settings = { businessName: 'TradeFlow Pro', businessType: 'retail_supermarket', businessOwnerName: '', businessOwnerEmail: '', businessWhatsapp: '', businessAddress: '', setupCompleted: false };
  
  data.forEach(function(row) {
    const key = _normalizeString(row[0]);
    const value = row[1];
    if (key === 'BUSINESS_NAME') settings.businessName = value || 'TradeFlow Pro';
    if (key === 'BUSINESS_TYPE') settings.businessType = value || 'retail_supermarket';
    if (key === 'BUSINESS_OWNER_NAME') settings.businessOwnerName = value || '';
    if (key === 'BUSINESS_OWNER_EMAIL') settings.businessOwnerEmail = value || '';
    if (key === 'BUSINESS_WHATSAPP') settings.businessWhatsapp = value || '';
    if (key === 'BUSINESS_ADDRESS') settings.businessAddress = value || '';
    if (key === 'SETUP_COMPLETED') settings.setupCompleted = value === 'true' || value === true;
    if (key === 'SETUP_COMPLETED_AT') settings.setupCompletedAt = value;
  });
  
  _cachePutJson(cacheKey, settings, EP_CACHE_TTL_SETTINGS_SEC);
  return settings;
}

function saveAppSettings(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Settings');
  if (!sheet) {
    sheet = _ensureSheet(ss, 'Settings', ['Key', 'Value', 'Updated At']).sheet;
  }
  
  const now = new Date();
  const keys = {
    'BUSINESS_NAME': data.businessName,
    'BUSINESS_TYPE': data.businessType,
    'BUSINESS_OWNER_NAME': data.businessOwnerName || '',
    'BUSINESS_OWNER_EMAIL': data.businessOwnerEmail || '',
    'BUSINESS_WHATSAPP': data.businessWhatsapp || '',
    'BUSINESS_ADDRESS': data.businessAddress || '',
    'SETUP_COMPLETED': data.setupCompleted ? 'true' : 'false',
    'SETUP_COMPLETED_AT': data.setupCompleted ? now.toISOString() : ''
  };
  
  const existing = {};
  const existingData = _getSheetData(sheet, 2, null, 2);
  existingData.forEach(function(row) {
    const key = _normalizeString(row[0]);
    if (key) existing[key] = true;
  });
  
  Object.keys(keys).forEach(function(key) {
    if (existing[key]) {
      const data = _getSheetData(sheet, 2, null, 2);
      for (let i = 0; i < data.length; i++) {
        if (_normalizeString(data[i][0]) === key) {
          const row = i + 2;
          sheet.getRange(row, 2).setValue(keys[key]);
          sheet.getRange(row, 3).setValue(now);
          return;
        }
      }
    } else {
      sheet.appendRow([key, keys[key], now]);
    }
  });
  
  _cacheRemove(_cacheKey('app_settings'));
  return { success: true };
}

// ============================================================
// 12. SETUP & REPAIR SHEETS
// ============================================================

function setupOrRepairSheets(data, sessionToken) {
  try {
    requirePortalSession_(sessionToken, 'admin');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const businessType = data?.businessType || 'retail_supermarket';
    const businessName = data?.businessName || 'TradeFlow Pro';
    const businessOwnerName = data?.businessOwnerName || '';
    const businessOwnerEmail = data?.businessOwnerEmail || '';
    const businessWhatsapp = data?.businessWhatsapp || '';
    const businessAddress = data?.businessAddress || '';
    const startedFresh = !ss.getSheetByName('AppState');
    
    // Create only the current workflow schema. Removed legacy tables are not
    // recreated on a clean installation.
    const results = _ensureAllSheets(ss);
    
    // Ensure SafeConfig exists
    _ensureSafeConfigSheet(ss);

    // Backfill the workflow tables immediately when an owner presses
    // Repair/Create Sheets. This makes the button safe for both a new file and
    // an existing AppState-based installation.
    const currentState = getAppStateInternal_();
    currentState.settings = Object.assign({}, currentState.settings || {}, {
      businessName: businessName,
      businessType: businessType,
      businessOwnerName: businessOwnerName,
      businessOwnerEmail: businessOwnerEmail,
      businessWhatsapp: businessWhatsapp,
      businessAddress: businessAddress,
      setupCompleted: true
    });
    currentState.businessName = businessName;
    currentState.businessType = businessType;
    currentState.businessOwnerName = businessOwnerName;
    currentState.businessOwnerEmail = businessOwnerEmail;
    currentState.businessWhatsapp = businessWhatsapp;
    currentState.businessAddress = businessAddress;
    saveAppStateInternal_(currentState);
    
    _cacheBustAll();
    
    return {
      success: true,
      message: 'Sheets ready: ' + Object.keys(results).filter(function(k) { return results[k]; }).join(', '),
      sheetsCreated: Object.keys(results).filter(function(k) { return results[k]; }),
      startedFresh: startedFresh,
      state: currentState,
      workflowTablesReady: ['BusinessProfile', 'Products', 'InventoryBatches', 'SupplierDeliveries', 'RestockOrders', 'RestockOrderItems', 'StockAdjustments', 'POSSales', 'POSSaleItems', 'RevenueEntries', 'ExpenseEntries', 'Staff', 'BusinessSettings', 'BudgetHeader', 'BudgetItems', 'Notifications', 'CustomUnits', 'SyncAudit']
    };
  } catch (e) {
    return { error: true, message: e.message || 'Setup failed' };
  }
}

function _ensureSafeConfigSheet(ss) {
  const result = _ensureSheet(ss, 'SafeConfig', ['Date Changed', 'Portal', 'User Name', 'Password']);
  const sheet = result.sheet;
  
  // Seed default portals
  const portals = ['staff', 'admin'];
  const existing = {};
  const data = _getSheetData(sheet, 2, null, 2);
  data.forEach(function(row) {
    const portal = _normalizeString(row[1]);
    if (portal) existing[portal] = true;
  });
  
  portals.forEach(function(portal) {
    if (!existing[portal]) {
      sheet.appendRow([new Date(), portal, '', 'NOT_SET']);
    }
  });
  
  // Hide password column
  try { sheet.hideColumns(4); } catch (e) {}
  
  return sheet;
}

function getFirstTimeSetupStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const appState = ss.getSheetByName('AppState');
  const required = !appState || appState.getLastRow() < 2;
  return { required: required };
}

function completeFirstTimeSetup(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const existingAppState = ss.getSheetByName('AppState');
    if (existingAppState && existingAppState.getLastRow() >= 2) throw new Error('This business has already been set up. Sign in as the existing administrator.');
    const businessName = _normalizeString(data && data.businessName);
    const businessType = _normalizeString(data && data.businessType) || 'retail_supermarket';
    const ownerName = _normalizeString(data && data.ownerName);
    const ownerEmail = _normalizeString(data && data.ownerEmail);
    const whatsapp = _normalizeString(data && data.whatsapp);
    const address = _normalizeString(data && data.address);
    const adminUsername = _normalizeString(data && data.adminUsername).toLowerCase();
    const adminPassword = String((data && data.adminPassword) || '');
    if (!businessName || !ownerName || !adminUsername || adminPassword.length < 8) throw new Error('Business name, owner name, admin username, and an 8-character password are required.');
    if (!/^[a-z0-9._-]{3,64}$/i.test(adminUsername)) throw new Error('Admin username may use letters, numbers, dots, underscores, and hyphens only.');

    _ensureAllSheets(ss);
    const safeConfig = _ensureSafeConfigSheet(ss);
    const rows = _getSheetData(safeConfig, 2, null, 4);
    let adminRow = -1;
    rows.forEach(function(row, index) { if (_normalizeString(row[1]) === 'admin') adminRow = index + 2; });
    if (adminRow < 0) {
      safeConfig.appendRow([new Date(), 'admin', adminUsername, _hashPassword('admin', adminUsername, adminPassword)]);
    } else {
      safeConfig.getRange(adminRow, 1, 1, 4).setValues([[new Date(), 'admin', adminUsername, _hashPassword('admin', adminUsername, adminPassword)]]);
    }

    const state = _getDefaultState();
    state.businessName = businessName;
    state.businessType = businessType;
    state.businessOwnerName = ownerName;
    state.businessOwnerEmail = ownerEmail;
    state.businessWhatsapp = whatsapp;
    state.businessAddress = address;
    state.settings = Object.assign({}, state.settings, {
      businessName: businessName,
      businessType: businessType,
      businessOwnerName: ownerName,
      businessOwnerEmail: ownerEmail,
      businessWhatsapp: whatsapp,
      businessAddress: address,
      adminPortalUsername: adminUsername,
      requireAdminPortalLogin: true,
      requireStaffPortalLogin: false,
      setupCompleted: true
    });
    saveAppStateInternal_(state);
    const session = _createPortalSession_('admin', adminUsername, 'admin');
    return { ok: true, state: projectStateForSession_(state, { role: 'admin' }), sessionToken: session.token, expiresAt: session.expiresAt };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// 13. AUTHENTICATION
// ============================================================

var EP_PORTAL_PASSWORD_NOT_SET = "NOT_SET";
var EP_SESSION_PREFIX = 'tradeflow_session_';
var EP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
var EP_RESET_CHALLENGE_PREFIX = 'tradeflow_reset_challenge_';
var EP_RESET_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function _hashPassword(portal, username, password) {
  const material = portal + ":" + username.toLowerCase() + ":" + password;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8);
  return "sha256:" + _bytesToHex(digest);
}

function _sessionPropertyKey_(token) {
  return EP_SESSION_PREFIX + _bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token || ''), Utilities.Charset.UTF_8));
}

function _createPortalSession_(portal, username, role) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = { portal: portal, username: username || '', role: role || 'admin', expiresAt: Date.now() + EP_SESSION_TTL_MS };
  PropertiesService.getScriptProperties().setProperty(_sessionPropertyKey_(token), JSON.stringify(session));
  return { token: token, expiresAt: session.expiresAt };
}

function requirePortalSession_(token, requiredRole) {
  const key = _sessionPropertyKey_(token);
  const session = _parseJson(PropertiesService.getScriptProperties().getProperty(key));
  if (!session || !session.expiresAt || Number(session.expiresAt) <= Date.now()) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (requiredRole && session.role !== requiredRole) throw new Error('You are not authorized for this action.');
  return session;
}

function endPortalSession(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty(_sessionPropertyKey_(token));
  return { ok: true };
}

function getPortalAuthStatus(data) {
  const portal = _normalizeString(data?.portal || '');
  if (!portal) return { error: true, message: 'Portal is required' };
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SafeConfig');
  if (!sheet) return { error: true, message: 'SafeConfig sheet not found' };
  
  const rows = _getSheetData(sheet, 2, null, 4);
  for (let i = 0; i < rows.length; i++) {
    if (_normalizeString(rows[i][1]) === portal) {
      const password = _normalizeString(rows[i][3]);
      return {
        portal: portal,
        passwordRequired: password !== EP_PORTAL_PASSWORD_NOT_SET && password !== '',
        username: _normalizeString(rows[i][2])
      };
    }
  }
  
  return { portal: portal, passwordRequired: false, username: '' };
}

function verifyPortalLogin(data) {
  const portal = _normalizeString(data?.portal || '');
  const username = _normalizeString(data?.username || '');
  const password = data?.password || '';
  
  if (!portal) return { error: true, message: 'Portal is required' };

  // Staff credentials are matched against the staff record, not the generic
  // portal row. This prevents an unset generic staff password from granting a
  // session to every caller.
  if (portal === 'staff') {
    const state = getAppStateInternal_();
    const staff = (state.staffMembers || []).find(function(member) {
      if (!member || member.active === false || String(member.username || '').toLowerCase() !== username.toLowerCase()) return false;
      const stored = String(member.password || member.pin || '');
      const hash = _hashPassword('staff', username, password);
      return stored === hash || stored === String(password);
    });
    if (!staff) return { error: true, message: 'Invalid username or password' };
    const staffPassword = String(staff.password || staff.pin || '');
    if (staffPassword.indexOf('sha256:') !== 0) {
      staff.password = _hashPassword('staff', username, password);
      delete staff.pin;
      saveAppStateInternal_(state);
    }
    const session = _createPortalSession_('staff', username, 'staff');
    return { success: true, portal: 'staff', username: username, staffId: staff.id, sessionToken: session.token, expiresAt: session.expiresAt };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SafeConfig');
  if (!sheet) return { error: true, message: 'SafeConfig sheet not found' };
  
  const rows = _getSheetData(sheet, 2, null, 4);
  for (let i = 0; i < rows.length; i++) {
    if (_normalizeString(rows[i][1]) === portal) {
      const storedPassword = _normalizeString(rows[i][3]);
      const storedUsername = _normalizeString(rows[i][2]);
      
      if (storedPassword === EP_PORTAL_PASSWORD_NOT_SET || storedPassword === '') {
        const session = _createPortalSession_(portal, storedUsername || username || portal, portal === 'staff' ? 'staff' : 'admin');
        return { success: true, portal: portal, username: storedUsername || username || '', sessionToken: session.token, expiresAt: session.expiresAt };
      }
      
      if (username && password) {
        const hash = _hashPassword(portal, username, password);
        if (hash === storedPassword) {
          const session = _createPortalSession_(portal, username, portal === 'staff' ? 'staff' : 'admin');
          return { success: true, portal: portal, username: username, sessionToken: session.token, expiresAt: session.expiresAt };
        }
        // Check plaintext fallback (legacy)
        if (password === storedPassword) {
          sheet.getRange(i + 2, 4).setValue(hash);
          const session = _createPortalSession_(portal, username, portal === 'staff' ? 'staff' : 'admin');
          return { success: true, portal: portal, username: username, sessionToken: session.token, expiresAt: session.expiresAt };
        }
      }
      
      return { error: true, message: 'Invalid username or password' };
    }
  }
  
  return { error: true, message: 'Portal not configured' };
}

function updatePortalCredential(data, sessionToken) {
  requirePortalSession_(sessionToken, 'admin');
  const portal = _normalizeString(data?.portal || '');
  const username = _normalizeString(data?.username || '');
  const password = data?.password || '';
  const requirePassword = data?.requirePassword === true;
  
  if (!portal) return { error: true, message: 'Portal is required' };
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SafeConfig');
  if (!sheet) return { error: true, message: 'SafeConfig sheet not found' };
  
  const rows = _getSheetData(sheet, 2, null, 4);
  for (let i = 0; i < rows.length; i++) {
    if (_normalizeString(rows[i][1]) === portal) {
      const rowNum = i + 2;
      const newPassword = requirePassword ? _hashPassword(portal, username, password) : EP_PORTAL_PASSWORD_NOT_SET;
      // SafeConfig columns are Updated At, Portal, Username, Password Hash.
      // Writing to columns 2 and 3 corrupts the portal identifier and leaves
      // the old password active.
      sheet.getRange(rowNum, 3).setValue(username);
      sheet.getRange(rowNum, 4).setValue(newPassword);
      sheet.getRange(rowNum, 1).setValue(new Date());
      return { success: true, portal: portal, username: username, passwordRequired: requirePassword };
    }
  }
  
  // Create new portal entry
  const newPassword = requirePassword ? _hashPassword(portal, username, password) : EP_PORTAL_PASSWORD_NOT_SET;
  sheet.appendRow([new Date(), portal, username, newPassword]);
  try { sheet.hideColumns(4); } catch (e) {}
  
  return { success: true, portal: portal, username: username, passwordRequired: requirePassword };
}

function changeOwnAdminPassword(currentPassword, newPassword, sessionToken) {
  const session = requirePortalSession_(sessionToken, 'admin');
  const nextPassword = String(newPassword || '');
  if (nextPassword.length < 8) throw new Error('Password must contain at least 8 characters.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SafeConfig');
  if (!sheet) throw new Error('SafeConfig sheet not found');
  const rows = _getSheetData(sheet, 2, null, 4);
  for (let i = 0; i < rows.length; i++) {
    if (_normalizeString(rows[i][1]) !== 'admin') continue;
    const username = _normalizeString(rows[i][2]);
    const stored = _normalizeString(rows[i][3]);
    const current = String(currentPassword || '');
    const matches = stored === EP_PORTAL_PASSWORD_NOT_SET || stored === '' || stored === _hashPassword('admin', username, current) || stored === current;
    if (!matches) throw new Error('Your current password is not correct.');
    sheet.getRange(i + 2, 4).setValue(_hashPassword('admin', username, nextPassword));
    sheet.getRange(i + 2, 1).setValue(new Date());
    const props = PropertiesService.getScriptProperties();
    Object.keys(props.getProperties()).filter(function(key) { return key.indexOf(EP_SESSION_PREFIX) === 0; }).forEach(function(key) { props.deleteProperty(key); });
    return { ok: true, signInRequired: true, username: session.username || username };
  }
  throw new Error('Admin credential record not found.');
}

// ============================================================
// 14. API ENDPOINTS
// ============================================================

// Get all products with stock
function getInventoryData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const products = getProductsList();
  const stockMap = _buildStockMap(ss);
  
  return products.map(function(p) {
    return {
      productId: p.productId,
      productName: p.productName,
      categoryId: p.categoryId,
      unitMeasure: p.unitMeasure,
      unitPrice: p.unitPrice,
      unitCost: p.unitCost,
      stock: stockMap[p.productId] || 0,
      reorderLevel: p.reorderLevel || 0,
      barcode: p.barcode || '',
      expiryDate: p.expiryDate ? _formatDate(p.expiryDate) : '',
      maxStock: 50 // Default, can be enhanced
    };
  });
}

// Record a sale
function recordSale(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SalesLog');
  if (!sheet) return { error: 'SalesLog sheet not found' };
  
  const productId = _normalizeString(data.productId);
  const qty = Number(data.qty || 0);
  const unitPrice = Number(data.unitPrice || 0);
  const staffId = _normalizeString(data.staffId) || 'SYSTEM';
  const saleId = 'SL' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  
  if (!productId) return { error: 'Product ID required' };
  if (qty <= 0) return { error: 'Quantity must be positive' };
  
  const product = getProductById(productId);
  if (!product) return { error: 'Product not found' };
  
  const stock = getProductStock(productId);
  if (stock < qty) return { error: 'Insufficient stock: ' + stock + ' available' };
  
  const gross = qty * (unitPrice || product.unitPrice || 0);
  const now = new Date();
  
  sheet.appendRow([
    saleId, now, productId, product.productName, product.categoryId,
    product.unitMeasure || 'unit', qty, unitPrice || product.unitPrice || 0,
    gross, staffId, 'Paid', '', '', ''
  ]);
  
  _cacheRemove(_cacheKey('stock_map'));
  _cacheRemove(_cacheKey('metrics_today'));
  _cacheRemove(_cacheKey('dash_ver'));
  
  return {
    success: true,
    saleId: saleId,
    productId: productId,
    productName: product.productName,
    qty: qty,
    gross: gross
  };
}

// Record a restock
function recordRestock(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('RestockProductLog');
  if (!sheet) return { error: 'RestockProductLog sheet not found' };
  
  const productId = _normalizeString(data.productId);
  const qty = Number(data.qtyAdded || 0);
  const unitCost = Number(data.unitCost || 0);
  const staffId = _normalizeString(data.staffId) || 'SYSTEM';
  const batchNumber = _normalizeString(data.batchNumber) || ('B' + new Date().toISOString().replace(/\D/g, '').slice(0, 10));
  
  if (!productId) return { error: 'Product ID required' };
  if (qty <= 0) return { error: 'Quantity must be positive' };
  
  const product = getProductById(productId);
  if (!product) return { error: 'Product not found' };
  
  const now = new Date();
  sheet.appendRow([
    now, productId, product.productName, product.categoryId,
    qty, batchNumber, data.expiryDate || '', staffId
  ]);
  
  _cacheRemove(_cacheKey('stock_map'));
  _cacheRemove(_cacheKey('dash_ver'));
  
  return {
    success: true,
    productId: productId,
    productName: product.productName,
    qtyAdded: qty,
    batchNumber: batchNumber
  };
}

// ============================================================
// 15. EXPORT FUNCTIONS
// ============================================================

function exportReportTablesToSheets(bundle, sessionToken) {
  try {
    const session = requirePortalSession_(sessionToken);
    if (session.role === 'staff') {
      const state = getAppStateInternal_();
      const access = (((state || {}).settings || {}).staffTabAccess || {}).reports || {};
      if (access.view !== true) throw new Error('You do not have access to reports.');
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Create report sheet
    let newSheet = ss.getSheetByName('ReportExport');
    if (!newSheet) newSheet = ss.insertSheet('ReportExport');
    else if (newSheet.getLastRow() > 0 && String(newSheet.getRange(1, 1).getValue() || '') !== 'TradeFlow Report Export') {
      throw new Error('ReportExport exists but is not a TradeFlow-managed report. It was left unchanged.');
    } else {
      newSheet.clearContents();
      newSheet.clearFormats();
    }
    
    // Write KPI summary
    const kpis = bundle.kpis || {};
    newSheet.getRange(1, 1).setValue('TradeFlow Report Export');
    newSheet.getRange(2, 1).setValue('Total Revenue');
    newSheet.getRange(2, 2).setValue(kpis.revenue || 0);
    newSheet.getRange(3, 1).setValue('Gross Margin %');
    newSheet.getRange(3, 2).setValue(kpis.grossMarginPct || 0);
    newSheet.getRange(4, 1).setValue('Net Profit');
    newSheet.getRange(4, 2).setValue(kpis.netProfit || 0);
    newSheet.getRange(5, 1).setValue('Operating Expenses');
    newSheet.getRange(5, 2).setValue(kpis.operatingExpenses || 0);
    newSheet.getRange(6, 1).setValue('Cash Flow');
    newSheet.getRange(6, 2).setValue(kpis.cashFlow || 0);
    newSheet.getRange(7, 1).setValue('Inventory Value');
    newSheet.getRange(7, 2).setValue(kpis.inventoryValue || 0);
    newSheet.getRange(8, 1).setValue('Expected Profit Remaining');
    newSheet.getRange(8, 2).setValue(kpis.expectedProfitRemaining || 0);
    newSheet.getRange(9, 1).setValue('Realized Profit');
    newSheet.getRange(9, 2).setValue(kpis.realizedProfit || 0);
    newSheet.getRange(10, 1).setValue('Open Batch Value');
    newSheet.getRange(10, 2).setValue(kpis.openBatchValue || 0);
    newSheet.getRange(11, 1).setValue('Completed Batch Profit');
    newSheet.getRange(11, 2).setValue(kpis.completedBatchProfit || 0);
    newSheet.getRange(12, 1).setValue('Average Margin %');
    newSheet.getRange(12, 2).setValue(kpis.averageMarginPct || 0);
    
    // Restock summary / inventory ledger export
    let row = 15;
    const batchRows = bundle.batchRows || [];
    if (batchRows.length) {
      newSheet.getRange(row, 1).setValue('Restock Summary');
      row++;
      const headers = [
        'Date', 'Product', 'Batch ID', 'Restock Event', 'Qty Received',
        'Qty Remaining', 'Unit Cost', 'Selling Snapshot', 'Total Cost',
        'Expected Revenue', 'Expected Margin', 'Realized Margin',
        'Remaining Margin', 'Status'
      ];
      newSheet.getRange(row, 1, 1, headers.length).setValues([headers]);
      row++;
      batchRows.forEach(function(item) {
        newSheet.getRange(row, 1, 1, headers.length).setValues([[
          item.date || item.restockDate || '',
          item.product || '',
          item.batchId || '',
          item.restockEventId || '',
          Number(item.quantityReceived || 0),
          Number(item.quantityRemaining || 0),
          Number(item.unitCost || 0),
          Number(item.sellingPriceSnapshot || 0),
          Number(item.totalCost || 0),
          Number(item.expectedRevenue || 0),
          Number(item.expectedMargin || 0),
          Number(item.realizedMargin || 0),
          Number(item.remainingMargin || 0),
          item.status || ''
        ]]);
        row++;
      });
    }

    row += 2;
    const productProfitRows = bundle.productProfitRows || [];
    if (productProfitRows.length) {
      newSheet.getRange(row, 1).setValue('Profit by Product');
      row++;
      newSheet.getRange(row, 1, 1, 5).setValues([['Product', 'Stock', 'Inventory Value', 'Realized Margin', 'Remaining Margin']]);
      row++;
      productProfitRows.forEach(function(item) {
        newSheet.getRange(row, 1, 1, 5).setValues([[
          item.product || '',
          Number(item.stock || 0),
          Number(item.inventoryValue || 0),
          Number(item.realizedMargin || 0),
          Number(item.remainingMargin || 0)
        ]]);
        row++;
      });
    }

    // Revenue table
    row += 2;
    const revenueRows = bundle.revenueRows || [];
    if (revenueRows.length) {
      newSheet.getRange(row, 1).setValue('Revenue');
      row++;
      newSheet.getRange(row, 1).setValue('Date');
      newSheet.getRange(row, 2).setValue('Amount');
      newSheet.getRange(row, 3).setValue('Notes');
      row++;
      revenueRows.forEach(function(item) {
        newSheet.getRange(row, 1).setValue(item.date || '');
        newSheet.getRange(row, 2).setValue(item.amount || 0);
        newSheet.getRange(row, 3).setValue(item.notes || '');
        row++;
      });
    }
    
    // Expenses table
    row += 2;
    const expenseRows = bundle.expenseRows || [];
    if (expenseRows.length) {
      newSheet.getRange(row, 1).setValue('Expenses');
      row++;
      newSheet.getRange(row, 1).setValue('Date');
      newSheet.getRange(row, 2).setValue('Category');
      newSheet.getRange(row, 3).setValue('Expense');
      newSheet.getRange(row, 4).setValue('Amount');
      newSheet.getRange(row, 5).setValue('Notes');
      row++;
      expenseRows.forEach(function(item) {
        newSheet.getRange(row, 1).setValue(item.date || '');
        newSheet.getRange(row, 2).setValue(item.category || '');
        newSheet.getRange(row, 3).setValue(item.expenseName || item.name || '');
        newSheet.getRange(row, 4).setValue(item.amount || 0);
        newSheet.getRange(row, 5).setValue(item.notes || '');
        row++;
      });
    }

    row += 2;
    const cogsRows = bundle.cogsRows || [];
    if (cogsRows.length) {
      newSheet.getRange(row, 1).setValue('Stock Adjustments / COGS');
      row++;
      newSheet.getRange(row, 1, 1, 7).setValues([['Date', 'Product', 'Qty', 'COGS', 'Estimated Revenue', 'Estimated Margin', 'Reason']]);
      row++;
      cogsRows.forEach(function(item) {
        newSheet.getRange(row, 1, 1, 7).setValues([[
          item.date || '',
          item.product || '',
          Number(item.qty || 0),
          Number(item.cogs || 0),
          Number(item.estimatedRevenue || 0),
          Number(item.estimatedMargin || 0),
          item.reason || ''
        ]]);
        row++;
      });
    }
    
    // Formatting
    try {
      newSheet.autoResizeColumns(1, 14);
      newSheet.getRange(1, 1, 1, 14).setFontWeight('bold');
    } catch (e) {}
    
    return {
      success: true,
      spreadsheetUrl: ss.getUrl(),
      file: exportSheetAsXlsx_(ss, newSheet, 'tradeflow_report_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.xlsx')
    };
  } catch (e) {
    return { error: true, message: e.message || 'Export failed' };
  }
}

function exportSheetAsXlsx_(spreadsheet, sheet, filename) {
  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?format=xlsx&gid=' + sheet.getSheetId();
  const response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (response.getResponseCode() >= 400) throw new Error('Could not download the report spreadsheet.');
  const blob = response.getBlob().setName(filename || 'report.xlsx');
  return { filename: blob.getName(), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: Utilities.base64Encode(blob.getBytes()) };
}

function exportReportPdfFile(html, filename, sessionToken) {
  const session = requirePortalSession_(sessionToken);
  if (session.role === 'staff') {
    const state = getAppStateInternal_();
    const access = (((state || {}).settings || {}).staffTabAccess || {}).reports || {};
    if (access.view !== true) throw new Error('You do not have access to reports.');
  }
  const safeName = String(filename || 'tradeflow_report.pdf').replace(/[^\w.\-]+/g, '_');
  const source = Utilities.newBlob(String(html || ''), 'text/html', safeName.replace(/\.pdf$/i, '.html'));
  const pdf = source.getAs(MimeType.PDF).setName(safeName);
  return {
    ok: true,
    filename: safeName,
    mimeType: MimeType.PDF,
    base64: Utilities.base64Encode(pdf.getBytes())
  };
}

// ============================================================
// 16. DASHBOARD METRICS
// ============================================================

function getDashboardMetrics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const products = getProductsList();
  const stockMap = _buildStockMap(ss);
  
  const totalProducts = products.length;
  const totalStockValue = products.reduce(function(sum, p) {
    const stock = stockMap[p.productId] || 0;
    const cost = p.unitCost || 0;
    return sum + (stock * cost);
  }, 0);
  
  const lowStockItems = products.filter(function(p) {
    const stock = stockMap[p.productId] || 0;
    const reorder = p.reorderLevel || 0;
    return stock <= reorder;
  });
  
  return {
    totalProducts: totalProducts,
    totalStockValue: totalStockValue,
    lowStockCount: lowStockItems.length,
    lowStockItems: lowStockItems.map(function(p) {
      return {
        productId: p.productId,
        productName: p.productName,
        stock: stockMap[p.productId] || 0,
        reorderLevel: p.reorderLevel || 0
      };
    })
  };
}

// ============================================================
// 17. NOTE ON EXPORTS
// ============================================================
// In Google Apps Script, every top-level function is automatically
// callable via google.script.run — no re-exporting needed.
// The _exports wrapper pattern was removed because it caused
// infinite recursion: the wrapper called _exports.fn which
// (due to hoisting) pointed back to the wrapper itself.

var _tfSentry_getProductStock = getProductStock;
getProductStock = function() {
  var args = arguments;
  return withSentryReporting_('getProductStock', function() {
    return _tfSentry_getProductStock.apply(null, args);
  }, { module: 'inventory', action: 'get_product_stock' });
};

var _tfSentry_getProductById = getProductById;
getProductById = function() {
  var args = arguments;
  return withSentryReporting_('getProductById', function() {
    return _tfSentry_getProductById.apply(null, args);
  }, { module: 'inventory', action: 'get_product' });
};

var _tfSentry_getProductsList = getProductsList;
getProductsList = function() {
  var args = arguments;
  return withSentryReporting_('getProductsList', function() {
    return _tfSentry_getProductsList.apply(null, args);
  }, { module: 'inventory', action: 'list_products' });
};

var _tfSentry_getProductByBarcode = getProductByBarcode;
getProductByBarcode = function() {
  var args = arguments;
  return withSentryReporting_('getProductByBarcode', function() {
    return _tfSentry_getProductByBarcode.apply(null, args);
  }, { module: 'scanner', action: 'lookup_barcode' });
};

var _tfSentry_getAppState = getAppState;
getAppState = function() {
  var args = arguments;
  return withSentryReporting_('getAppState', function() {
    return _tfSentry_getAppState.apply(null, args);
  }, { module: 'state', action: 'load' });
};

var _tfSentry_saveAppState = saveAppState;
saveAppState = function() {
  var args = arguments;
  return withSentryReporting_('saveAppState', function() {
    return _tfSentry_saveAppState.apply(null, args);
  }, { module: 'state', action: 'save' });
};

var _tfSentry_getSyncSnapshot = getSyncSnapshot;
getSyncSnapshot = function() {
  var args = arguments;
  return withSentryReporting_('getSyncSnapshot', function() {
    return _tfSentry_getSyncSnapshot.apply(null, args);
  }, { module: 'sync', action: 'snapshot' });
};

var _tfSentry_pushSyncOps = pushSyncOps;
pushSyncOps = function() {
  var args = arguments;
  return withSentryReporting_('pushSyncOps', function() {
    return _tfSentry_pushSyncOps.apply(null, args);
  }, { module: 'sync', action: 'push_ops' });
};

var _tfSentry_importAppState = importAppState;
importAppState = function() {
  var args = arguments;
  return withSentryReporting_('importAppState', function() {
    return _tfSentry_importAppState.apply(null, args);
  }, { module: 'state', action: 'import' });
};

var _tfSentry_resetAppState = resetAppState;
resetAppState = function() {
  var args = arguments;
  return withSentryReporting_('resetAppState', function() {
    return _tfSentry_resetAppState.apply(null, args);
  }, { module: 'state', action: 'reset' });
};

var _tfSentry_getStaffList = getStaffList;
getStaffList = function() {
  var args = arguments;
  return withSentryReporting_('getStaffList', function() {
    return _tfSentry_getStaffList.apply(null, args);
  }, { module: 'staff', action: 'list_staff' });
};

var _tfSentry_addStaffMember = addStaffMember;
addStaffMember = function() {
  var args = arguments;
  return withSentryReporting_('addStaffMember', function() {
    return _tfSentry_addStaffMember.apply(null, args);
  }, { module: 'staff', action: 'add_staff' });
};

var _tfSentry_updateStaffStatus = updateStaffStatus;
updateStaffStatus = function() {
  var args = arguments;
  return withSentryReporting_('updateStaffStatus', function() {
    return _tfSentry_updateStaffStatus.apply(null, args);
  }, { module: 'staff', action: 'update_status' });
};

var _tfSentry_getAppSettings = getAppSettings;
getAppSettings = function() {
  var args = arguments;
  return withSentryReporting_('getAppSettings', function() {
    return _tfSentry_getAppSettings.apply(null, args);
  }, { module: 'settings', action: 'load' });
};

var _tfSentry_saveAppSettings = saveAppSettings;
saveAppSettings = function() {
  var args = arguments;
  return withSentryReporting_('saveAppSettings', function() {
    return _tfSentry_saveAppSettings.apply(null, args);
  }, { module: 'settings', action: 'save' });
};

var _tfSentry_setupOrRepairSheets = setupOrRepairSheets;
setupOrRepairSheets = function() {
  var args = arguments;
  return withSentryReporting_('setupOrRepairSheets', function() {
    return _tfSentry_setupOrRepairSheets.apply(null, args);
  }, { module: 'sheets', action: 'setup_or_repair' });
};

var _tfSentry_getInventoryData = getInventoryData;
getInventoryData = function() {
  var args = arguments;
  return withSentryReporting_('getInventoryData', function() {
    return _tfSentry_getInventoryData.apply(null, args);
  }, { module: 'inventory', action: 'load_inventory' });
};

var _tfSentry_recordSale = recordSale;
recordSale = function() {
  var args = arguments;
  return withSentryReporting_('recordSale', function() {
    return _tfSentry_recordSale.apply(null, args);
  }, { module: 'inventory', action: 'record_sale' });
};

var _tfSentry_recordRestock = recordRestock;
recordRestock = function() {
  var args = arguments;
  return withSentryReporting_('recordRestock', function() {
    return _tfSentry_recordRestock.apply(null, args);
  }, { module: 'inventory', action: 'record_restock' });
};

var _tfSentry_exportReportTablesToSheets = exportReportTablesToSheets;
exportReportTablesToSheets = function() {
  var args = arguments;
  return withSentryReporting_('exportReportTablesToSheets', function() {
    return _tfSentry_exportReportTablesToSheets.apply(null, args);
  }, { module: 'reports', action: 'export_tables' });
};
