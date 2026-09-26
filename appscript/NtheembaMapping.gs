/**
 * Owner-controlled NCPC mapping and public Ntheemba read boundary.
 * NCPC release data is a local, explicit cache of an exported, published
 * release. It is used only to search and validate opaque IDs; it never becomes
 * TradeFlow stock, pricing, cost, supplier, batch, or description data.
 */
var NCPC_RELEASE_SHEET = 'NcpcPublishedCatalogue';
var NCPC_RELEASE_HEADERS = ['NCPC Product ID', 'NCPC Variant ID', 'Canonical Name', 'Variant Name', 'Identifiers', 'Catalogue Version', 'Release Version', 'Loaded At'];
var NTHEEMBA_FIND_ITEMS_CONTRACT_VERSION = 'tradeflow.ntheemba.find_items_by_ncpc_variants.v1';
var NTHEEMBA_FIND_ITEMS_MAX_VARIANT_IDS = 50;
var NTHEEMBA_FIND_ITEMS_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
var NTHEEMBA_FIND_ITEMS_NONCE_PREFIX = 'tradeflow_ntheemba_nonce_';
var NTHEEMBA_API_AUDIT_SHEET = 'NtheembaApiAudit';
var NTHEEMBA_API_AUDIT_HEADERS = ['Request ID', 'Received At', 'Action', 'Outcome', 'Candidate Count', 'Result Count'];
var NCPC_CLIENT_KIND_LOCAL_APPROVED_RELEASE = 'local_approved_release';
var NCPC_FAKE_SUBMISSION_PREFIX = 'LOCAL-NCPC-SUB-';
var NCPC_FAKE_CORRECTION_PREFIX = 'LOCAL-NCPC-CORR-';
var TRADEFLOW_PUBLIC_API_VERSION = 'v1';
var TRADEFLOW_PUBLIC_API_NAME = 'tradeflow.standard.public';
var TRADEFLOW_PUBLIC_API_MAX_BODY_BYTES = 100000;
var TRADEFLOW_PUBLIC_API_MAX_BATCH_LOOKUPS = 50;
var TRADEFLOW_PUBLIC_API_MAX_BATCH_ORDERS = 20;
var TRADEFLOW_PUBLIC_API_MAX_ORDER_ITEMS = 25;
var TRADEFLOW_PUBLIC_API_OPEN_ACTIONS = { health: true };
var TRADEFLOW_PUBLIC_API_WRITE_ACTIONS = { 'order.create': true, 'order.batch_create': true, 'handover.create': true };
var TRADEFLOW_PUBLIC_API_RATE_WINDOW_SECONDS = 60;
var TRADEFLOW_PUBLIC_API_DEFAULT_READS_PER_MINUTE = 120;
var TRADEFLOW_PUBLIC_API_DEFAULT_WRITES_PER_MINUTE = 30;
var TRADEFLOW_PUBLIC_API_DEFAULT_BATCHES_PER_MINUTE = 12;
var TRADEFLOW_PUBLIC_API_DEFAULT_HEALTH_PER_MINUTE = 60;
var TRADEFLOW_PUBLIC_API_DEFAULT_CLOCK_SKEW_SECONDS = 300;
var TRADEFLOW_PUBLIC_API_RATE_CACHE_PREFIX = 'tfapi_rate_v1_';
var TRADEFLOW_PUBLIC_API_NONCE_CACHE_PREFIX = 'tfapi_nonce_v1_';
var TF_STANDARD_MAX_SHOPS = 3;
var TF_STANDARD_DEFAULT_SHOP_ID = 'shop-main';
var TF_STANDARD_LOCATION_CATALOGUE_VERSION = '5.0';

function replaceNcpcPublishedRelease(data, sessionToken) {
  requirePortalSession_(sessionToken, 'admin');
  data = data || {};
  var release = data.release || data;
  var rows = _buildNcpcReleaseRows_(release, _normalizeString(data.releaseVersion));
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, NCPC_RELEASE_SHEET, NCPC_RELEASE_HEADERS).sheet;
    sheet.clearContents();
    sheet.getRange(1, 1, 1, NCPC_RELEASE_HEADERS.length).setValues([NCPC_RELEASE_HEADERS]);
    if (rows.length) sheet.getRange(2, 1, rows.length, NCPC_RELEASE_HEADERS.length).setValues(rows);
    return { ok: true, candidatesLoaded: rows.length, catalogueVersion: String(release.catalogueVersion), releaseVersion: rows[0][6] };
  } finally { lock.releaseLock(); }
}

function _buildNcpcReleaseRows_(release, requestedReleaseVersion) {
  if (!release || release.schemaVersion !== 'ncpc-2.0' || release.publishedOnly !== true) throw new Error('Load an NCPC v2 published release export only.');
  var catalogueVersion = _normalizeString(release.catalogueVersion);
  if (!catalogueVersion) throw new Error('The published NCPC export has no catalogue version.');
  var releases = Array.isArray(release.releases) ? release.releases : [];
  var publishedReleases = releases.filter(function(item) { return item && item.status === 'published' && _normalizeString(item.releaseVersion); });
  var releaseVersion = requestedReleaseVersion || (publishedReleases.length === 1 ? _normalizeString(publishedReleases[0].releaseVersion) : '');
  if (!releaseVersion || !publishedReleases.some(function(item) { return _normalizeString(item.releaseVersion) === releaseVersion; })) throw new Error('Select the published NCPC release version represented by this export.');
  var products = {};
  (Array.isArray(release.products) ? release.products : []).forEach(function(product) {
    if (product && product.publicationStatus === 'published' && product.status === 'active' && /^PRD-[A-Z0-9-]+$/.test(_normalizeString(product.id))) products[_normalizeString(product.id)] = product;
  });
  var identifiers = {};
  (Array.isArray(release.identifiers) ? release.identifiers : []).forEach(function(identifier) {
    if (!identifier || identifier.status !== 'active' || !identifier.variantId) return;
    var variantId = _normalizeString(identifier.variantId);
    if (!identifiers[variantId]) identifiers[variantId] = [];
    identifiers[variantId].push(_normalizeString(identifier.identifierValue));
  });
  var loadedAt = new Date().toISOString();
  var rows = (Array.isArray(release.productVariants) ? release.productVariants : []).filter(function(variant) {
    return variant && variant.publicationStatus === 'published' && variant.status === 'active' && products[_normalizeString(variant.productId)] && /^VAR-[A-Z0-9-]+$/.test(_normalizeString(variant.id));
  }).map(function(variant) {
    var product = products[_normalizeString(variant.productId)];
    return [_normalizeString(product.id), _normalizeString(variant.id), _normalizeString(product.canonicalName), _normalizeString(variant.variantName), (identifiers[_normalizeString(variant.id)] || []).filter(Boolean).join(' | '), catalogueVersion, releaseVersion, loadedAt];
  });
  if (!rows.length) throw new Error('The selected published NCPC release contains no active published variants.');
  return rows;
}

function getNcpcPublishedCandidates(query, sessionToken) {
  requirePortalSession_(sessionToken, 'admin');
  return _getNcpcClient_().searchCandidates({ query: query, limit: 30 });
}

function _getNcpcClient_() {
  if (typeof getNcpcConnectionConfig_ === 'function') {
    var config = getNcpcConnectionConfig_();
    if (config && config.baseUrl && config.token) return _createHttpNcpcClient_(config);
  }
  return _createLocalApprovedReleaseNcpcClient_();
}

/* The browser never receives this client or its token.  Reads and submissions
 * are made only from Apps Script, and local-release mode remains available for
 * source/local tests and deliberately offline TradeFlow use. */
function _createHttpNcpcClient_(config) {
  function call(method, path, payload) {
    var requestId = 'tf-ncpc-' + Utilities.getUuid();
    var options = {
      method: method,
      headers: Object.assign({}, config.headers || {}, { Authorization: 'Bearer ' + config.token, 'X-Request-ID': requestId }),
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true
    };
    if (payload !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
    var response = UrlFetchApp.fetch(config.baseUrl + path, options);
    var text = response.getContentText() || '';
    var body = text ? JSON.parse(text) : null;
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !body || body.success !== true) throw new Error('Central Catalogue request could not be completed. Request ID: ' + requestId);
    return body.data || {};
  }
  function candidate(item) {
    return { ncpcProductId: item.ncpc_product_id, ncpcVariantId: item.ncpc_variant_id, canonicalName: item.canonical_name, variantName: item.variant_name, identifiers: (item.identifiers || []).join(' | '), catalogueVersion: item.catalogue_version, releaseVersion: item.release_version };
  }
  return {
    kind: 'http_ncpc_v1',
    searchCandidates: function(request) {
      request = request || {};
      var query = encodeURIComponent(_normalizeString(request.query));
      var data = call('get', '/v1/catalogue/candidates?query=' + query + '&limit=' + Math.max(1, Math.min(30, Number(request.limit || 30))));
      return { ok: true, clientKind: 'http_ncpc_v1', candidates: (data.candidates || []).map(candidate), message: '' };
    },
    getVariant: function(request) {
      var data = call('post', '/v1/catalogue/variants/verify', { ncpc_product_id: _normalizeString(request.ncpcProductId), ncpc_variant_id: _normalizeString(request.ncpcVariantId) });
      return candidate(data);
    },
    verifyVariant: function(request) { return this.getVariant(request); },
    linkCoverage: function(request) {
      request = request || {};
      var data = call('post', '/v1/businesses/' + encodeURIComponent(_normalizeString(config.businessId)) + '/coverage', {
        business_product_ref: _normalizeString(request.businessProductRef),
        shop_id: _normalizeString(request.shopId),
        idempotency_key: _normalizeString(request.idempotencyKey),
        ncpc_product_id: _normalizeString(request.ncpcProductId),
        ncpc_variant_id: _normalizeString(request.ncpcVariantId),
        source: 'tradeflow',
        location_projection: request.locationProjection || {},
        exposure_preference: _normalizeString(request.exposurePreference) || 'WITHIN_BUSINESS'
      });
      return { ok: true, clientKind: 'http_ncpc_v1', state: data.state, businessId: data.business_id || config.businessId, businessProductRef: data.business_product_ref || request.businessProductRef, shopId: data.shop_id || request.shopId, ncpcProductId: data.ncpc_product_id, ncpcVariantId: data.ncpc_variant_id, locationProjection: data.location_projection || {} };
    },
    submitProduct: function(request) {
      var data = call('post', '/v1/submissions/products', { business_id: config.businessId, business_product_ref: _normalizeString(request.businessProductRef || request.localProductId), shop_id: _normalizeString(request.shopId) || undefined, location_projection: request.locationProjection || {}, idempotency_key: _normalizeString(request.submissionRequestId), canonical_name: _normalizeString(request.name), variant_name: _normalizeString(request.variantName) || undefined, brand: _normalizeString(request.brand) || undefined, category: _normalizeString(request.category) || undefined, barcodes: (request.identifiers || []).map(function(value) { return { value: value, source: 'tradeflow' }; }), source: 'tradeflow' });
      return { ok: true, clientKind: 'http_ncpc_v1', submissionId: data.submission_id, submissionStatus: data.state, submittedAt: data.submitted_at };
    },
    getSubmissionStatus: function(request) {
      var data = call('get', '/v1/submissions/' + encodeURIComponent(_normalizeString(request.submissionId)));
      return { ok: true, clientKind: 'http_ncpc_v1', submissionId: data.submission_id, submissionStatus: data.state, businessId: data.business_id || '', businessProductRef: data.business_product_ref || '', ncpcProductId: data.ncpc_product_id, ncpcVariantId: data.ncpc_variant_id, catalogueVersion: data.catalogue_version || '', releaseVersion: data.release_version || '', decidedAt: data.decided_at || '' };
    },
    submitCorrection: function(request) {
      var data = call('post', '/v1/submissions/corrections', { business_id: config.businessId, business_product_ref: _normalizeString(request.businessProductRef), idempotency_key: _normalizeString(request.correctionRequestId), ncpc_product_id: _normalizeString(request.ncpcProductId) || undefined, ncpc_variant_id: _normalizeString(request.ncpcVariantId), changes: request.changes || {}, source: 'tradeflow' });
      return { ok: true, clientKind: 'http_ncpc_v1', correctionId: data.submission_id, correctionStatus: data.state, submittedAt: data.submitted_at };
    }
  };
}

function _createLocalApprovedReleaseNcpcClient_() {
  return {
    kind: NCPC_CLIENT_KIND_LOCAL_APPROVED_RELEASE,
    searchCandidates: function(request) {
      request = request || {};
      var needle = _normalizeString(request.query).toLowerCase();
      var limit = Math.max(1, Math.min(30, Number(request.limit || 30)));
      var release = _readNcpcApprovedReleaseCandidates_();
      var candidates = release.candidates.filter(function(candidate) {
        return !needle || [candidate.ncpcProductId, candidate.ncpcVariantId, candidate.canonicalName, candidate.variantName, candidate.identifiers].join(' ').toLowerCase().indexOf(needle) >= 0;
      }).slice(0, limit);
      return { ok: true, clientKind: NCPC_CLIENT_KIND_LOCAL_APPROVED_RELEASE, candidates: candidates, message: release.loaded ? '' : 'Load an approved NCPC release export before searching.' };
    },
    getVariant: function(request) {
      request = request || {};
      var productId = _normalizeString(request.ncpcProductId);
      var variantId = _normalizeString(request.ncpcVariantId);
      if (!/^PRD-[A-Z0-9-]+$/.test(productId) || !/^VAR-[A-Z0-9-]+$/.test(variantId)) throw new Error('Valid NCPC product and variant IDs are required.');
      var release = _readNcpcApprovedReleaseCandidates_();
      if (!release.loaded) throw new Error('No approved NCPC release is loaded for this business.');
      var candidate = release.candidates.find(function(item) {
        return item.ncpcProductId === productId && item.ncpcVariantId === variantId;
      });
      if (!candidate) throw new Error('NCPC product and variant IDs are not present in the approved release.');
      return candidate;
    },
    verifyVariant: function(request) {
      return this.getVariant(request);
    },
    submitProduct: function(request) {
      request = request || {};
      var requestId = _normalizeString(request.submissionRequestId);
      if (!/^TF-NCPC-SUB-[A-Z0-9-]+$/.test(requestId)) throw new Error('A valid submission request ID is required.');
      var name = _normalizeString(request.name);
      if (!name) throw new Error('Product name is required for NCPC submission.');
      return {
        ok: true,
        clientKind: NCPC_CLIENT_KIND_LOCAL_APPROVED_RELEASE,
        submissionId: NCPC_FAKE_SUBMISSION_PREFIX + requestId.replace(/^TF-NCPC-SUB-/, ''),
        submissionStatus: 'PENDING_REVIEW',
        submittedAt: new Date().toISOString()
      };
    },
    getSubmissionStatus: function(request) {
      request = request || {};
      var submissionId = _normalizeString(request.submissionId);
      if (submissionId.indexOf(NCPC_FAKE_SUBMISSION_PREFIX) !== 0) throw new Error('Unknown NCPC submission ID.');
      return {
        ok: true,
        clientKind: NCPC_CLIENT_KIND_LOCAL_APPROVED_RELEASE,
        submissionId: submissionId,
        submissionStatus: 'PENDING_REVIEW',
        businessProductRef: _normalizeString(request.businessProductRef)
      };
    },
    submitCorrection: function(request) {
      request = request || {};
      var requestId = _normalizeString(request.correctionRequestId);
      if (!/^TF-NCPC-CORR-[A-Z0-9-]+$/.test(requestId)) throw new Error('A valid correction request ID is required.');
      return {
        ok: true,
        clientKind: NCPC_CLIENT_KIND_LOCAL_APPROVED_RELEASE,
        correctionId: NCPC_FAKE_CORRECTION_PREFIX + requestId.replace(/^TF-NCPC-CORR-/, ''),
        correctionStatus: 'PENDING_REVIEW',
        submittedAt: new Date().toISOString()
      };
    },
    getCorrectionStatus: function(request) {
      request = request || {};
      var correctionId = _normalizeString(request.correctionId);
      if (correctionId.indexOf(NCPC_FAKE_CORRECTION_PREFIX) !== 0) throw new Error('Unknown NCPC correction ID.');
      return {
        ok: true,
        clientKind: NCPC_CLIENT_KIND_LOCAL_APPROVED_RELEASE,
        correctionId: correctionId,
        correctionStatus: 'PENDING_REVIEW'
      };
    }
  };
}

function _readNcpcApprovedReleaseCandidates_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NCPC_RELEASE_SHEET);
  if (!sheet) return { loaded: false, candidates: [] };
  return { loaded: true, candidates: _getSheetData(sheet, 2, null, NCPC_RELEASE_HEADERS.length).map(_ncpcCandidateFromRow_).filter(Boolean) };
}

function _ncpcCandidateFromRow_(row) {
  var productId = _normalizeString(row[0]);
  var variantId = _normalizeString(row[1]);
  if (!/^PRD-[A-Z0-9-]+$/.test(productId) || !/^VAR-[A-Z0-9-]+$/.test(variantId)) return null;
  return { ncpcProductId: productId, ncpcVariantId: variantId, canonicalName: _normalizeString(row[2]), variantName: _normalizeString(row[3]), identifiers: _normalizeString(row[4]), catalogueVersion: _normalizeString(row[5]), releaseVersion: _normalizeString(row[6]) };
}

function _findNcpcCandidate_(productId, variantId) {
  return _getNcpcClient_().verifyVariant({ ncpcProductId: productId, ncpcVariantId: variantId });
}

function _findActiveProductByNcpcVariant_(products, variantId, excludeProductId) {
  var wanted = _normalizeString(variantId);
  var excluded = _normalizeString(excludeProductId);
  if (!wanted) return null;
  return (Array.isArray(products) ? products : []).find(function(product) {
    if (!product || product.active === false || product._delete === true) return false;
    if (excluded && String(product.id) === excluded) return false;
    var mapping = product.ncpcMapping || {};
    if (_normalizeString(mapping.status) === 'LOCAL_ONLY') return false;
    return _normalizeString(mapping.ncpcVariantId) === wanted;
  }) || null;
}

function _assertNcpcVariantNotAlreadyLinked_(products, variantId, excludeProductId) {
  var existing = _findActiveProductByNcpcVariant_(products, variantId, excludeProductId);
  if (existing) {
    throw new Error('This product is already in your catalogue.');
  }
}

function _normalizeBarcodeValue_(value) {
  return String(value == null ? '' : value).trim();
}

function _normalizeProductBarcodes_(product) {
  if (!product || typeof product !== 'object') return [];
  var source = Array.isArray(product.barcodes) ? product.barcodes : [];
  var rows = [];
  var seen = {};
  source.forEach(function(entry) {
    var value = _normalizeBarcodeValue_(entry && typeof entry === 'object' ? entry.value : entry);
    if (!value || seen[value.toLowerCase()]) return;
    seen[value.toLowerCase()] = true;
    rows.push({
      value: value,
      label: _normalizeString(entry && typeof entry === 'object' ? entry.label : ''),
      kind: _normalizeString(entry && typeof entry === 'object' ? entry.kind : '') || (value.indexOf('TF') === 0 ? 'tradeflow' : 'manufacturer'),
      isPrimary: entry && typeof entry === 'object' && entry.isPrimary === true,
      source: _normalizeString(entry && typeof entry === 'object' ? entry.source : '')
    });
  });
  var primary = _normalizeBarcodeValue_(product.barcode);
  if (primary && !seen[primary.toLowerCase()]) {
    rows.unshift({ value: primary, label: '', kind: primary.indexOf('TF') === 0 ? 'tradeflow' : 'manufacturer', isPrimary: true, source: 'legacy' });
    seen[primary.toLowerCase()] = true;
  }
  if (rows.length && !rows.some(function(entry) { return entry.isPrimary === true; })) rows[0].isPrimary = true;
  product.barcodes = rows;
  product.barcode = (rows.find(function(entry) { return entry.isPrimary === true; }) || rows[0] || { value: '' }).value || '';
  return rows;
}

function _productBarcodeValues_(product) {
  return _normalizeProductBarcodes_(product).map(function(entry) { return entry.value; }).filter(Boolean);
}

function _productHasBarcode_(product, barcode) {
  var wanted = _normalizeBarcodeValue_(barcode).toLowerCase();
  if (!wanted) return false;
  return _productBarcodeValues_(product).some(function(value) { return value.toLowerCase() === wanted; });
}

function _findActiveProductByBarcode_(products, barcode, excludeProductId) {
  var excluded = _normalizeString(excludeProductId);
  return (Array.isArray(products) ? products : []).find(function(product) {
    if (!product || product.active === false || product._delete === true) return false;
    if (excluded && String(product.id) === excluded) return false;
    return _productHasBarcode_(product, barcode);
  }) || null;
}

function _productIsPublicForNtheemba_(product) {
  if (!product || product.active === false || product._delete === true) return false;
  return product.publicForNtheemba === true || !!(product.ncpcMapping && product.ncpcMapping.publicForNtheemba === true);
}

// Ntheemba visibility is intentionally narrower than TradeFlow operational visibility.
// A product can remain fully usable inside TradeFlow without being exposed through the
// customer-facing integration API. Pending NCPC submissions remain internal until
// approved/linked products receive the business's explicit Ntheemba publication flag.
// Other identity states stay TradeFlow-local.
function _productIsVisibleToNtheembaApi_(product) {
  if (!product || product.active === false || product._delete === true) return false;
  var identityStatus = _tradeFlowProductIdentityStatus_(product);
  if (identityStatus === 'linked') return _productIsPublicForNtheemba_(product);
  return false;
}

function _normalizeShopId_(value) {
  return _normalizeString(value).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);
}

function _normalizeShopLocation_(location) {
  location = location && typeof location === 'object' ? location : {};
  var townId = _normalizeString(location.townId || location.town_id);
  var townOther = _normalizeString(location.townOther || location.town_other);
  return {
    country_id: 'ZM',
    country_name: 'Zambia',
    province_id: _normalizeString(location.provinceId || location.province_id),
    province_name: _normalizeString(location.provinceName || location.province_name_snapshot || location.province),
    district_id: _normalizeString(location.districtId || location.district_id),
    district_name: _normalizeString(location.districtName || location.district_name_snapshot || location.district),
    town_id: townId,
    town_name: _normalizeString(location.townName || location.town_name_snapshot || location.town),
    town_other: townId ? '' : townOther,
    area: _normalizeString(location.area || location.areaName),
    landmark: _normalizeString(location.landmark),
    address_details: _normalizeString(location.addressDetails || location.address_details || location.address),
    catalogue_version: _normalizeString(location.catalogueVersion || location.location_catalogue_version) || TF_STANDARD_LOCATION_CATALOGUE_VERSION
  };
}

function _normalizeTradeFlowShops_(state) {
  state = state || {};
  var settings = state.settings || {};
  var raw = Array.isArray(state.shops) ? state.shops : [];
  var shops = raw.map(function(shop) {
    shop = shop && typeof shop === 'object' ? shop : {};
    var id = _normalizeShopId_(shop.id || shop.shopId || shop.branchId) || TF_STANDARD_DEFAULT_SHOP_ID;
    return {
      id: id,
      name: _normalizeString(shop.name || shop.shopName || shop.branchName) || _normalizeString(settings.businessName || state.businessName) || 'Main Shop',
      status: _normalizeString(shop.status) || 'active',
      is_primary: shop.isPrimary === true || shop.primary === true || id === TF_STANDARD_DEFAULT_SHOP_ID,
      location: _normalizeShopLocation_(shop.location || shop.shopLocation || {})
    };
  }).filter(function(shop) { return shop.status !== 'deleted'; });
  if (!shops.length) shops = [{
    id: TF_STANDARD_DEFAULT_SHOP_ID,
    name: _normalizeString(settings.shopName || settings.businessName || state.businessName) || 'Main Shop',
    status: 'active',
    is_primary: true,
    location: _normalizeShopLocation_({ addressDetails: settings.businessAddress || state.businessAddress || '' })
  }];
  if (shops.length > TF_STANDARD_MAX_SHOPS) throw new Error('Standard TradeFlow supports a maximum of three shops in Sprint-01.');
  if (!shops.some(function(shop) { return shop.is_primary; })) shops[0].is_primary = true;
  return shops;
}

function _resolveTradeFlowShop_(state, requestedShopId, options) {
  options = options || {};
  var shops = _normalizeTradeFlowShops_(state).filter(function(shop) { return shop.status !== 'inactive'; });
  var wanted = _normalizeShopId_(requestedShopId);
  if (wanted) {
    var found = shops.find(function(shop) { return shop.id === wanted; });
    if (!found) throw new Error('Unknown shop ID.');
    return found;
  }
  if (shops.length === 1) return shops[0];
  if (options.requireExplicitForMultiShop) throw new Error('Shop ID is required when more than one shop is configured.');
  return shops.find(function(shop) { return shop.is_primary; }) || shops[0];
}

function _tradeFlowPublicShopSources_() {
  if (typeof isStandardMultiShopReady_ === 'function' && isStandardMultiShopReady_() && typeof listStandardShopSources_ === 'function') {
    return listStandardShopSources_().filter(function(shop) { return shop.status !== 'inactive' && shop.status !== 'deleted'; }).map(function(shop) {
      return { id: _normalizeShopId_(shop.id || shop.shopId), name: _normalizeString(shop.name), status: shop.status || 'active', is_primary: shop.isPrimary === true, location: _normalizeShopLocation_(shop.location || {}), config: shop.config && typeof shop.config === 'object' && !Array.isArray(shop.config) ? shop.config : {} };
    });
  }
  return _normalizeTradeFlowShops_(getAppStateInternal_()).filter(function(shop) { return shop.status !== 'inactive'; });
}

function _resolveTradeFlowPublicShopSource_(requestedShopId, options) {
  options = options || {};
  var shops = _tradeFlowPublicShopSources_();
  var wanted = _normalizeShopId_(requestedShopId);
  if (wanted) {
    var found = shops.find(function(shop) { return shop.id === wanted; });
    if (!found) throw new Error('Unknown shop ID.');
    return found;
  }
  if (shops.length === 1) return shops[0];
  if (options.requireExplicitForMultiShop) throw new Error('Shop ID is required when more than one shop is configured.');
  return shops.find(function(shop) { return shop.is_primary; }) || shops[0];
}

function _tradeFlowStateContextForShop_(requestedShopId, options) {
  var shop = _resolveTradeFlowPublicShopSource_(requestedShopId, options || {});
  if (typeof isStandardMultiShopReady_ === 'function' && isStandardMultiShopReady_()) {
    var ss = getStandardShopSpreadsheet_(shop.id);
    var state = getAppStateInternal_(ss) || {};
    state.activeShopId = shop.id;
    state.settings = Object.assign({}, state.settings || {}, { activeShopId: shop.id });
    return { shop: shop, state: state, spreadsheet: ss };
  }
  return { shop: shop, state: getAppStateInternal_() || {}, spreadsheet: SpreadsheetApp.getActiveSpreadsheet() };
}

function _tradeFlowIdentitySpreadsheetForShop_(session, requestedShopId) {
  if (typeof isStandardMultiShopReady_ === 'function' && isStandardMultiShopReady_()) {
    var resolved = resolveStandardSessionShopId_(session, requestedShopId);
    return { shopId: resolved, spreadsheet: getStandardShopSpreadsheet_(resolved) };
  }
  return { shopId: TF_STANDARD_DEFAULT_SHOP_ID, spreadsheet: SpreadsheetApp.getActiveSpreadsheet() };
}

function _catalogueServiceOperationalProductsFromState_(state) {
  return ((state || {}).products || []).filter(function(product) {
    return !!product && product.active !== false && product._delete !== true;
  });
}

// Public integration catalogue: keep TradeFlow operational state private unless the
// product is approved/published for Ntheemba or is awaiting NCPC review provisionally.
function _catalogueServicePublicProductsFromState_(state) {
  return _catalogueServiceOperationalProductsFromState_(state).filter(_productIsVisibleToNtheembaApi_);
}

function _tradeFlowProductAliasValues_(product) {
  var source = product && product.aliases;
  if (!Array.isArray(source)) return [];
  return source.map(function(entry) {
    return _normalizeString(entry && typeof entry === 'object' ? (entry.name || entry.value || entry.alias) : entry);
  }).filter(Boolean);
}

function _tradeFlowProductIdentityStatus_(product) {
  var mapping = (product && product.ncpcMapping) || {};
  var raw = _normalizeString(mapping.status).toUpperCase();
  if (raw === 'LINK_STALE') return 'link_stale';
  if (raw === 'LINK_ERROR') return 'link_error';
  if (raw === 'MATCH_SUGGESTED') return 'match_suggested';
  if (raw === 'NEEDS_LINK') return 'needs_link';
  if (raw === 'LOCAL_ONLY') return 'local_only';
  if (raw === 'REJECTED' || raw === 'REVIEW_REJECTED' || _normalizeString(mapping.submissionStatus).toUpperCase() === 'REJECTED') return 'rejected';
  if (raw === 'AWAITING_NCPC_REVIEW' || raw === 'PENDING_REVIEW' || raw === 'SUBMITTED' || _normalizeString(mapping.submissionId) || _normalizeString(mapping.submissionStatus).toUpperCase() === 'PENDING_REVIEW') return 'awaiting_ncpc_review';
  if (raw === 'LINKED' || _normalizeString(mapping.ncpcVariantId) || _normalizeString(mapping.ncpcProductId)) return 'linked';
  return 'unlinked';
}

function _tradeFlowCatalogueSearchText_(product) {
  return [
    product && product.name,
    product && product.variantName,
    product && product.brand,
    product && product.category,
    product && product.sku,
    _tradeFlowProductAliasValues_(product).join(' '),
    _productBarcodeValues_(product).join(' ')
  ].map(_normalizeString).join(' ').toLowerCase();
}

function _tradeFlowCatalogueSearchScore_(product, query, barcode, businessProductId, shopId) {
  var score = 0;
  var wantedId = _normalizeString(businessProductId);
  var wantedBarcode = _normalizeBarcodeValue_(barcode).toLowerCase();
  var needle = _normalizeString(query).toLowerCase();
  var name = _normalizeString(product && product.name).toLowerCase();
  var aliases = _tradeFlowProductAliasValues_(product).map(function(value) { return value.toLowerCase(); });
  var barcodes = _productBarcodeValues_(product).map(function(value) { return value.toLowerCase(); });
  if (wantedId && String(product && product.id) === wantedId) score += 2000;
  if (wantedBarcode && barcodes.indexOf(wantedBarcode) >= 0) score += 2000;
  if (needle) {
    if (name === needle) score += 1200;
    else if (name.indexOf(needle) === 0) score += 800;
    else if (name.indexOf(needle) >= 0) score += 500;
    if (aliases.indexOf(needle) >= 0) score += 900;
    if (barcodes.indexOf(needle) >= 0) score += 1100;
    if (_tradeFlowCatalogueSearchText_(product).indexOf(needle) >= 0) score += 100;
  }
  if (_tradeFlowProductStockForShop_(product, shopId) > 0) score += 40;
  if (_tradeFlowProductIdentityStatus_(product) === 'linked') score += 5;
  return score;
}


function _tradeFlowProductStockForShop_(product, shopId) {
  var wanted = _normalizeShopId_(shopId);
  return (product.batches || []).filter(function(batch) {
    return !wanted || _normalizeShopId_(batch.shopId || TF_STANDARD_DEFAULT_SHOP_ID) === wanted;
  }).reduce(function(total, batch) {
    return total + Number(batch.quantityRemaining || batch.quantityReceived || batch.qty || 0);
  }, 0);
}

function getProductIdentityService_() {
  return {
    saveMapping: _productIdentityServiceSaveMapping_,
    createFromCandidate: _productIdentityServiceCreateFromCandidate_,
    createFromSubmission: _productIdentityServiceCreateFromSubmission_,
    checkSubmissionStatus: _productIdentityServiceCheckSubmissionStatus_,
    submitCorrection: _productIdentityServiceSubmitCorrection_,
    unpublishMapping: _productIdentityServiceUnpublishMapping_,
    removeMapping: _productIdentityServiceRemoveMapping_,
    getMapping: _productIdentityServiceGetMapping_
  };
}

function saveNcpcProductMapping(data, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  var operationId = 'tf-map-' + (typeof Utilities !== 'undefined' && Utilities.getUuid
    ? Utilities.getUuid()
    : String(new Date().getTime()) + '-' + Math.random().toString(36).slice(2));
  data = Object.assign({}, data || {}, { shopId: shopId || (data && data.shopId) || '', operationId: operationId });
  _logNcpcMappingEvent_('START', {
    operationId: operationId,
    productId: data.productId,
    shopId: data.shopId,
    ncpcProductId: data.ncpcProductId,
    ncpcVariantId: data.ncpcVariantId
  });
  try {
    var result = getProductIdentityService_().saveMapping(data, session);
    _logNcpcMappingEvent_('SUCCESS', {
      operationId: operationId,
      productId: result && result.productId,
      shopId: result && result.shopId,
      ncpcProductId: result && result.mapping && result.mapping.ncpcProductId,
      ncpcVariantId: result && result.mapping && result.mapping.ncpcVariantId,
      status: result && result.mapping && result.mapping.status
    });
    return result;
  } catch (error) {
    _logNcpcMappingEvent_('FAILURE', {
      operationId: operationId,
      productId: data.productId,
      shopId: data.shopId,
      error: String(error && error.message || error).slice(0, 240)
    });
    throw error;
  }
}

function _logNcpcMappingEvent_(eventName, data) {
  var safe = {};
  Object.keys(data || {}).forEach(function(key) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') safe[key] = String(data[key]).slice(0, 160);
  });
  var line = '[TradeFlow NCPC mapping] ' + eventName + ' ' + JSON.stringify(safe);
  if (typeof console !== 'undefined' && console.log) console.log(line);
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(line);
}

function _newNcpcLinkOperationId_() {
  return 'TF-NCPC-LINK-' + (typeof Utilities !== 'undefined' && Utilities.getUuid
    ? Utilities.getUuid()
    : String(new Date().getTime()) + '-' + Math.random().toString(36).slice(2));
}

function _linkNcpcCoverageIfConfigured_(request) {
  var client = _getNcpcClient_();
  if (!client || client.kind !== 'http_ncpc_v1' || typeof client.linkCoverage !== 'function') {
    return { synced: false, state: 'NOT_SENT_OFFLINE', clientKind: client && client.kind || 'unknown' };
  }
  request = request || {};
  var operationId = _normalizeString(request.operationId) || _newNcpcLinkOperationId_();
  _logNcpcMappingEvent_('COVERAGE_LINK_START', {
    operationId: operationId,
    productId: request.productId,
    shopId: request.shopId,
    businessProductRef: request.businessProductRef,
    ncpcProductId: request.ncpcProductId,
    ncpcVariantId: request.ncpcVariantId
  });
  try {
    var result = client.linkCoverage({
      businessProductRef: request.businessProductRef,
      shopId: request.shopId,
      idempotencyKey: operationId,
      ncpcProductId: request.ncpcProductId,
      ncpcVariantId: request.ncpcVariantId,
      locationProjection: request.locationProjection || {},
      exposurePreference: request.exposurePreference || 'WITHIN_BUSINESS'
    });
    _logNcpcMappingEvent_('COVERAGE_LINK_SUCCESS', {
      operationId: operationId,
      productId: request.productId,
      shopId: result && result.shopId,
      businessProductRef: result && result.businessProductRef,
      ncpcProductId: result && result.ncpcProductId,
      ncpcVariantId: result && result.ncpcVariantId,
      state: result && result.state
    });
    return { synced: true, state: result && result.state || 'LINKED_APPROVED', clientKind: client.kind, response: result };
  } catch (error) {
    _logNcpcMappingEvent_('COVERAGE_LINK_FAILURE', {
      operationId: operationId,
      productId: request.productId,
      shopId: request.shopId,
      error: String(error && error.message || error).slice(0, 240)
    });
    throw error;
  }
}

function _productIdentityServiceSaveMapping_(data, session) {
  data = data || {};
  var productId = _normalizeString(data.productId);
  var variantId = _normalizeString(data.ncpcVariantId);
  var familyId = _normalizeString(data.ncpcProductId);
  if (!productId || !/^PRD-[A-Z0-9-]+$/.test(familyId) || !/^VAR-[A-Z0-9-]+$/.test(variantId)) throw new Error('A local product and valid NCPC product/variant IDs are required.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var candidate = _findNcpcCandidate_(familyId, variantId);
    var target = _tradeFlowIdentitySpreadsheetForShop_(session, data.shopId);
    var state = getAppStateInternal_(target.spreadsheet);
    var product = (state.products || []).find(function(row) { return String(row.id) === productId; });
    if (!product) throw new Error('Local product not found.');
    _assertNcpcVariantNotAlreadyLinked_(state.products || [], candidate.ncpcVariantId, productId);
    var businessProductRef = target.shopId + ':' + productId;
    var coverage = _linkNcpcCoverageIfConfigured_({
      operationId: data.operationId,
      productId: productId,
      shopId: target.shopId,
      businessProductRef: businessProductRef,
      ncpcProductId: candidate.ncpcProductId,
      ncpcVariantId: candidate.ncpcVariantId,
      locationProjection: _ncpcCoverageLocationProjectionForShop_(state, target.shopId),
      exposurePreference: data.publicForNtheemba === true ? 'WIDER' : 'WITHIN_BUSINESS'
    });
    product.ncpcMapping = { status: 'LINKED', ncpcProductId: candidate.ncpcProductId, ncpcVariantId: candidate.ncpcVariantId, catalogueVersion: candidate.catalogueVersion, releaseVersion: candidate.releaseVersion, linkedAt: new Date().toISOString(), linkedBy: session.username || 'admin', publicForNtheemba: data.publicForNtheemba === true, businessProductRef: businessProductRef, shopId: target.shopId, shopLocationProjection: _ncpcCoverageLocationProjectionForShop_(state, target.shopId), coverageState: coverage.state };
    saveAppStateInternal_(state, target.spreadsheet);
    return { ok: true, productId: productId, shopId: target.shopId, mapping: product.ncpcMapping };
  } finally { lock.releaseLock(); }
}

function createProductFromNcpcCandidate(data, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  data = Object.assign({}, data || {}, { shopId: shopId || (data && data.shopId) || '' });
  return getProductIdentityService_().createFromCandidate(data, session);
}

function _productIdentityServiceCreateFromCandidate_(data, session) {
  data = data || {};
  var productData = data.product || {};
  var ncpcProductId = _normalizeString(data.ncpcProductId);
  var ncpcVariantId = _normalizeString(data.ncpcVariantId);
  if (!/^PRD-[A-Z0-9-]+$/.test(ncpcProductId) || !/^VAR-[A-Z0-9-]+$/.test(ncpcVariantId)) throw new Error('Search and select an approved catalogue product again.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var candidate = _findNcpcCandidate_(ncpcProductId, ncpcVariantId);
    var target = _tradeFlowIdentitySpreadsheetForShop_(session, data.shopId);
    var state = getAppStateInternal_(target.spreadsheet);
    state.products = Array.isArray(state.products) ? state.products : [];
    state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
    _assertNcpcVariantNotAlreadyLinked_(state.products, candidate.ncpcVariantId, '');
    var product = _buildTradeFlowProductFromNcpcCandidate_(state, productData, candidate, session);
    var businessProductRef = target.shopId + ':' + product.id;
    var coverage = _linkNcpcCoverageIfConfigured_({
      productId: product.id,
      shopId: target.shopId,
      businessProductRef: businessProductRef,
      ncpcProductId: candidate.ncpcProductId,
      ncpcVariantId: candidate.ncpcVariantId,
      locationProjection: _ncpcCoverageLocationProjectionForShop_(state, target.shopId),
      exposurePreference: 'WITHIN_BUSINESS'
    });
    product.ncpcMapping.businessProductRef = businessProductRef;
    product.ncpcMapping.shopId = target.shopId;
    product.ncpcMapping.shopLocationProjection = _ncpcCoverageLocationProjectionForShop_(state, target.shopId);
    product.ncpcMapping.coverageState = coverage.state;
    state.products.push(product);
    var notification = {
      text: 'Product added: ' + product.name + ' (' + (product.barcode || '') + ')',
      time: new Date().toLocaleString(),
      read: false,
      userId: session.username || 'admin',
      userName: session.username || 'admin',
      userRole: session.role || 'admin'
    };
    state.notifications.push(notification);
    saveAppStateInternal_(state, target.spreadsheet);
    return { ok: true, product: product, notification: notification, state: state, shopId: target.shopId };
  } finally { lock.releaseLock(); }
}

function createProductFromNcpcSubmission(data, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  data = Object.assign({}, data || {}, { shopId: shopId || (data && data.shopId) || '' });
  return getProductIdentityService_().createFromSubmission(data, session);
}

function _productIdentityServiceCreateFromSubmission_(data, session) {
  data = data || {};
  var productData = data.product || {};
  var submissionRequestId = _normalizeString(data.submissionRequestId);
  if (!/^TF-NCPC-SUB-[A-Z0-9-]+$/.test(submissionRequestId)) throw new Error('A valid submission request ID is required.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var target = _tradeFlowIdentitySpreadsheetForShop_(session, data.shopId);
    var state = getAppStateInternal_(target.spreadsheet);
    state.products = Array.isArray(state.products) ? state.products : [];
    state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
    var existing = _findProductByNcpcSubmissionRequest_(state.products, submissionRequestId);
    if (existing) return { ok: true, product: existing, notification: null, state: state, shopId: target.shopId, duplicateSubmission: true };
    var product = _buildTradeFlowProductFromNcpcSubmission_(state, productData, submissionRequestId, session, target.shopId);
    state.products.push(product);
    var notification = {
      text: 'Product awaiting Central Catalogue review: ' + product.name + ' (' + (product.barcode || '') + ')',
      time: new Date().toLocaleString(),
      read: false,
      userId: session.username || 'admin',
      userName: session.username || 'admin',
      userRole: session.role || 'admin'
    };
    state.notifications.push(notification);
    saveAppStateInternal_(state, target.spreadsheet);
    return { ok: true, product: product, notification: notification, state: state, shopId: target.shopId };
  } finally { lock.releaseLock(); }
}

function checkNcpcSubmissionStatus(productId, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  return getProductIdentityService_().checkSubmissionStatus(productId, session, shopId);
}

function _productIdentityServiceCheckSubmissionStatus_(productId, session, shopId) {
  var localId = _normalizeString(productId);
  if (!localId) throw new Error('Local product ID is required.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var target = _tradeFlowIdentitySpreadsheetForShop_(session, shopId);
    var state = getAppStateInternal_(target.spreadsheet);
    var product = (state.products || []).find(function(row) { return String(row.id) === localId; });
    if (!product || !product.ncpcMapping || _normalizeString(product.ncpcMapping.status) !== 'AWAITING_NCPC_REVIEW') throw new Error('No pending NCPC submission is recorded for this product.');
    var mapping = product.ncpcMapping;
    var result = _getNcpcClient_().getSubmissionStatus({ submissionId: mapping.submissionId, businessProductRef: mapping.businessProductRef });
    mapping.lastStatusCheckAt = new Date().toISOString();
    mapping.lastStatusCheckBy = session.username || 'admin';
    mapping.submissionStatus = result.submissionStatus || mapping.submissionStatus || 'PENDING_REVIEW';
    _applyNcpcReviewDecision_(product, state.products || [], mapping, result, session.username || 'admin');
    product.updatedAt = mapping.lastStatusCheckAt;
    saveAppStateInternal_(state, target.spreadsheet);
    return { ok: true, productId: localId, mapping: mapping, submissionStatus: mapping.submissionStatus, state: state };
  } finally { lock.releaseLock(); }
}

function _applyNcpcReviewDecision_(product, products, mapping, result, actor) {
  if (_normalizeString(mapping.businessProductRef) && _normalizeString(result && result.businessProductRef) !== _normalizeString(mapping.businessProductRef)) throw new Error('NCPC review result does not belong to this shop product.');
  var state = _normalizeString(result && result.submissionStatus).toUpperCase();
  if (state === 'APPROVED' && /^PRD-[A-Z0-9-]+$/.test(_normalizeString(result.ncpcProductId)) && /^VAR-[A-Z0-9-]+$/.test(_normalizeString(result.ncpcVariantId))) {
    _assertNcpcVariantNotAlreadyLinked_(products, result.ncpcVariantId, product.id);
    mapping.status = 'LINKED';
    mapping.ncpcProductId = result.ncpcProductId;
    mapping.ncpcVariantId = result.ncpcVariantId;
    mapping.catalogueVersion = result.catalogueVersion || mapping.catalogueVersion || '';
    mapping.releaseVersion = result.releaseVersion || mapping.releaseVersion || '';
    mapping.linkedAt = result.decidedAt || new Date().toISOString();
    mapping.linkedBy = 'ncpc_review:' + actor;
    mapping.reviewResolvedAt = mapping.linkedAt;
    return;
  }
  if (state === 'REJECTED' || state === 'WITHDRAWN') {
    mapping.status = 'REJECTED';
    mapping.reviewResolvedAt = result.decidedAt || new Date().toISOString();
  }
}

/* Install this manually once per approved shop-bound Script project. Apps
 * Script time triggers run approximately, rather than at an exact minute. */
function installNcpcMappingReviewSweepAt20() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runNcpcDailyMappingReviewSweep') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runNcpcDailyMappingReviewSweep').timeBased().everyDays(1).atHour(20).create();
  return { ok: true, handler: 'runNcpcDailyMappingReviewSweep', schedule: 'daily around 20:00 script time zone' };
}

function runNcpcDailyMappingReviewSweep() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (typeof isStandardMultiShopReady_ === 'function' && isStandardMultiShopReady_()) {
      var total = { checked: 0, linked: 0, healthy: 0, suggested: 0, pending: 0, failures: 0, shops: [] };
      listStandardShopSources_().filter(function(shop) { return shop.status !== 'inactive' && shop.status !== 'deleted'; }).forEach(function(shop) {
        try {
          var result = _runNcpcDailyMappingReviewSweepForShop_(getStandardShopSpreadsheet_(shop.id), shop.id);
          total.shops.push(result);
          ['checked', 'linked', 'healthy', 'suggested', 'pending', 'failures'].forEach(function(key) { total[key] += Number(result[key] || 0); });
        } catch (error) { total.failures += 1; total.shops.push({ shopId: shop.id, failures: 1, error: 'SHOP_SWEEP_FAILED' }); }
      });
      return total;
    }
    return _runNcpcDailyMappingReviewSweepForShop_(SpreadsheetApp.getActiveSpreadsheet(), TF_STANDARD_DEFAULT_SHOP_ID);
  } finally { lock.releaseLock(); }
}

function _runNcpcDailyMappingReviewSweepForShop_(spreadsheet, shopId) {
  var state = getAppStateInternal_(spreadsheet);
  var client = _getNcpcClient_();
  var summary = { shopId: _normalizeShopId_(shopId), checked: 0, linked: 0, healthy: 0, suggested: 0, pending: 0, failures: 0 };
  (state.products || []).forEach(function(product) {
    if (!product || product.active === false || product._delete === true) return;
    var mapping = product.ncpcMapping || {};
    try {
      if (_normalizeString(mapping.status) === 'LINKED' && mapping.ncpcProductId && mapping.ncpcVariantId) {
        if (mapping.coverageHealth === 'HEALTHY' && mapping.coverageState === 'LINKED_APPROVED') {
          summary.checked += 1;
          summary.healthy += 1;
          return;
        }
        var coverage = _linkNcpcCoverageIfConfigured_({
          operationId: _newNcpcLinkOperationId_(),
          productId: String(product.id),
          shopId: _normalizeShopId_(shopId),
          businessProductRef: _normalizeString(mapping.businessProductRef) || (_normalizeShopId_(shopId) + ':' + String(product.id)),
          ncpcProductId: mapping.ncpcProductId,
          ncpcVariantId: mapping.ncpcVariantId,
          locationProjection: _ncpcCoverageLocationProjectionForShop_(state, shopId),
          exposurePreference: mapping.publicForNtheemba === true ? 'WIDER' : 'WITHIN_BUSINESS'
        });
        mapping.lastCoverageCheckAt = new Date().toISOString();
        mapping.lastCoverageCheckBy = 'daily_ncpc_sweep';
        mapping.coverageState = coverage.state;
        mapping.coverageHealth = coverage.synced ? 'HEALTHY' : 'NOT_SENT_OFFLINE';
        product.ncpcMapping = mapping;
        summary.checked += 1;
        if (coverage.synced) summary.healthy += 1; else summary.pending += 1;
      } else if (_normalizeString(mapping.status) === 'AWAITING_NCPC_REVIEW' && mapping.submissionId) {
        var decision = client.getSubmissionStatus({ submissionId: mapping.submissionId, businessProductRef: mapping.businessProductRef });
        mapping.lastStatusCheckAt = new Date().toISOString();
        mapping.lastStatusCheckBy = 'daily_ncpc_sweep';
        mapping.submissionStatus = decision.submissionStatus || mapping.submissionStatus;
        _applyNcpcReviewDecision_(product, state.products || [], mapping, decision, 'daily_ncpc_sweep');
        product.ncpcMapping = mapping; summary.checked += 1;
        if (mapping.status === 'LINKED') summary.linked += 1; else summary.pending += 1;
      } else if (!product.ncpcMapping || _normalizeString(mapping.status) === 'NEEDS_LINK') {
        var query = _normalizeString(product.barcode) || _normalizeString(product.name);
        if (!query) return;
        var matches = client.searchCandidates({ query: query, limit: 2 }).candidates || [];
        if (matches.length === 1) {
          product.ncpcMapping = { status: 'MATCH_SUGGESTED', suggestedNcpcProductId: matches[0].ncpcProductId, suggestedNcpcVariantId: matches[0].ncpcVariantId, suggestedAt: new Date().toISOString(), suggestedBy: 'daily_ncpc_sweep', catalogueVersion: matches[0].catalogueVersion || '', releaseVersion: matches[0].releaseVersion || '' };
          summary.suggested += 1;
        }
      }
    } catch (error) { summary.failures += 1; }
  });
  saveAppStateInternal_(state, spreadsheet);
  return summary;
}

function submitNcpcProductCorrection(data, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  data = Object.assign({}, data || {}, { shopId: shopId || (data && data.shopId) || '' });
  return getProductIdentityService_().submitCorrection(data, session);
}

function _productIdentityServiceSubmitCorrection_(data, session) {
  data = data || {};
  var localId = _normalizeString(data.productId);
  var field = _normalizeString(data.field);
  var requestId = _normalizeString(data.correctionRequestId);
  if (!localId) throw new Error('Local product ID is required.');
  if (!/^[A-Za-z0-9_.:-]{2,80}$/.test(field)) throw new Error('Correction field is invalid.');
  if (!/^TF-NCPC-CORR-[A-Z0-9-]+$/.test(requestId)) throw new Error('A valid correction request ID is required.');
  var forbidden = {
    sellingPrice: true, cost: true, stock: true, maxStock: true, supplier: true,
    batches: true, margin: true, revenue: true, expenses: true, businessPolicy: true
  };
  if (forbidden[field]) throw new Error('TradeFlow-owned business values cannot be submitted to NCPC.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var target = _tradeFlowIdentitySpreadsheetForShop_(session, data.shopId);
    var state = getAppStateInternal_(target.spreadsheet);
    state.ncpcCorrectionRequests = Array.isArray(state.ncpcCorrectionRequests) ? state.ncpcCorrectionRequests : [];
    var existing = state.ncpcCorrectionRequests.find(function(row) { return _normalizeString(row.correctionRequestId) === requestId; });
    if (existing) return { ok: true, correction: existing, duplicateCorrection: true, state: state };
    var product = (state.products || []).find(function(row) { return String(row.id) === localId; });
    if (!product) throw new Error('Local product not found.');
    var mapping = product.ncpcMapping || {};
    var submission = _getNcpcClient_().submitCorrection({
      correctionRequestId: requestId,
      localProductId: localId,
      businessProductRef: _normalizeString(mapping.businessProductRef) || (target.shopId + ':' + localId),
      shopId: target.shopId,
      ncpcProductId: _normalizeString(mapping.ncpcProductId),
      ncpcVariantId: _normalizeString(mapping.ncpcVariantId),
      changes: _buildNcpcCorrectionChanges_(field, data.proposedValue)
    });
    var now = submission.submittedAt || new Date().toISOString();
    var correction = {
      correctionRequestId: requestId,
      correctionId: submission.correctionId,
      correctionStatus: submission.correctionStatus || 'PENDING_REVIEW',
      localProductId: localId,
      businessProductRef: _normalizeString(mapping.businessProductRef) || (target.shopId + ':' + localId),
      shopId: target.shopId,
      ncpcProductId: _normalizeString(mapping.ncpcProductId),
      ncpcVariantId: _normalizeString(mapping.ncpcVariantId),
      field: field,
      previousValue: data.previousValue == null ? '' : String(data.previousValue),
      proposedValue: data.proposedValue == null ? '' : String(data.proposedValue),
      source: _normalizeString(data.source),
      submittedAt: now,
      submittedBy: session.username || 'admin'
    };
    state.ncpcCorrectionRequests.push(correction);
    product.ncpcCorrections = Array.isArray(product.ncpcCorrections) ? product.ncpcCorrections : [];
    product.ncpcCorrections.push({ correctionRequestId: requestId, correctionId: correction.correctionId, field: field, status: correction.correctionStatus, submittedAt: now });
    product.updatedAt = now;
    saveAppStateInternal_(state, target.spreadsheet);
    return { ok: true, correction: correction, state: state };
  } finally { lock.releaseLock(); }
}

function _buildNcpcCorrectionChanges_(field, proposedValue) {
  var value = proposedValue == null ? '' : String(proposedValue);
  var paths = { name: 'product.canonical_name', canonicalName: 'product.canonical_name', variantName: 'variant.canonical_name', brand: 'product.brand', category: 'product.category' };
  if (field === 'barcode') return { 'variant.barcodes': [{ value: value, source: 'tradeflow' }] };
  if (!paths[field] || !value) throw new Error('This identity correction is not supported by Central Catalogue review.');
  var changes = {}; changes[paths[field]] = value;
  return changes;
}

function _buildTradeFlowProductFromNcpcCandidate_(state, productData, candidate, session) {
  var name = _normalizeString(productData.name);
  var brand = _normalizeString(productData.brand);
  var variantName = _normalizeString(productData.variantName);
  var category = _normalizeString(productData.category);
  var unit = _normalizeString(productData.unit);
  var barcode = _normalizeBarcodeValue_(productData.barcode);
  var productType = _normalizeString(productData.productType) || 'packed';
  var cost = Number(productData.cost);
  var sell = Number(productData.sellingPrice);
  var initStock = Number(productData.initialStock || 0);
  var maxStock = Number(productData.maxStock || 0);
  if (!name || !category || !unit || !isFinite(cost) || cost <= 0) throw new Error('Fill in all required fields.');
  if (!isFinite(sell) || sell < 0) throw new Error('Enter a valid selling price.');
  if (!isFinite(initStock) || initStock < 0) throw new Error('Initial stock is invalid.');
  if (!isFinite(maxStock) || maxStock <= 0) throw new Error('Max stock must be greater than 0.');
  if (barcode && _findActiveProductByBarcode_(state.products, barcode)) throw new Error('Barcode already exists.');
  var now = new Date().toISOString();
  var productId = _nextTradeFlowStateId_(state);
  var product = {
    id: productId,
    name: name,
    brand: brand,
    variantName: variantName,
    category: category,
    unit: unit,
    productType: productType,
    sellingPrice: sell,
    maxStock: maxStock,
    barcode: barcode,
    barcodes: barcode ? [{ value: barcode, label: '', kind: barcode.indexOf('TF') === 0 ? 'tradeflow' : 'manufacturer', isPrimary: true, source: 'manual' }] : [],
    ncpcMapping: {
      status: 'LINKED',
      ncpcProductId: candidate.ncpcProductId,
      ncpcVariantId: candidate.ncpcVariantId,
      catalogueVersion: candidate.catalogueVersion || '',
      releaseVersion: candidate.releaseVersion || '',
      canonicalName: candidate.canonicalName || '',
      variantName: candidate.variantName || '',
      linkedAt: now,
      linkedBy: session.username || 'admin',
      publicForNtheemba: false
    },
    batches: [],
    stockMovements: [],
    updatedAt: now
  };
  if (initStock > 0) {
    product.batches.push({
      shopId: _resolveTradeFlowShop_(state, state.activeShopId, { requireExplicitForMultiShop: false }).id,
      shopName: _resolveTradeFlowShop_(state, state.activeShopId, { requireExplicitForMultiShop: false }).name,
      id: _nextTradeFlowStateId_(state),
      productId: product.id,
      restockEventId: 'initial-stock',
      restockDate: now.slice(0, 10),
      quantityReceived: initStock,
      qty: initStock,
      unitCost: cost,
      sellingPriceSnapshot: sell,
      expectedUnitMargin: sell - cost,
      expectedTotalMargin: (sell - cost) * initStock,
      receivedDate: now.slice(0, 10),
      supplierId: '',
      invoiceId: ''
    });
  }
  return product;
}

function _buildTradeFlowProductFromNcpcSubmission_(state, productData, submissionRequestId, session, shopId) {
  var name = _normalizeString(productData.name);
  var brand = _normalizeString(productData.brand);
  var variantName = _normalizeString(productData.variantName);
  var category = _normalizeString(productData.category);
  var unit = _normalizeString(productData.unit);
  var barcode = _normalizeBarcodeValue_(productData.barcode);
  var productType = _normalizeString(productData.productType) || 'packed';
  var cost = Number(productData.cost);
  var sell = Number(productData.sellingPrice);
  var initStock = Number(productData.initialStock || 0);
  var maxStock = Number(productData.maxStock || 0);
  if (!name || !category || !unit || !isFinite(cost) || cost <= 0) throw new Error('Fill in all required fields.');
  if (!isFinite(sell) || sell < 0) throw new Error('Enter a valid selling price.');
  if (!isFinite(initStock) || initStock < 0) throw new Error('Initial stock is invalid.');
  if (!isFinite(maxStock) || maxStock <= 0) throw new Error('Max stock must be greater than 0.');
  if (barcode && _findActiveProductByBarcode_(state.products, barcode)) throw new Error('Barcode already exists.');
  var productId = _nextTradeFlowStateId_(state);
  var mappingShopId = _normalizeShopId_(shopId) || TF_STANDARD_DEFAULT_SHOP_ID;
  var locationProjection = _ncpcCoverageLocationProjectionForShop_(state, mappingShopId);
  var submission = _getNcpcClient_().submitProduct({
    submissionRequestId: submissionRequestId,
    localProductId: String(productId),
    businessProductRef: mappingShopId + ':' + String(productId),
    shopId: mappingShopId,
    locationProjection: locationProjection,
    name: name,
    brand: brand,
    variantName: variantName,
    category: category,
    unit: unit,
    productType: productType,
    identifiers: barcode ? [barcode] : []
  });
  var now = submission.submittedAt || new Date().toISOString();
  var product = {
    id: productId,
    name: name,
    brand: brand,
    variantName: variantName,
    category: category,
    unit: unit,
    productType: productType,
    sellingPrice: sell,
    maxStock: maxStock,
    barcode: barcode,
    barcodes: barcode ? [{ value: barcode, label: '', kind: barcode.indexOf('TF') === 0 ? 'tradeflow' : 'manufacturer', isPrimary: true, source: 'manual' }] : [],
    ncpcMapping: {
      status: 'AWAITING_NCPC_REVIEW',
      submissionId: submission.submissionId,
      submissionRequestId: submissionRequestId,
      businessProductRef: mappingShopId + ':' + String(productId),
      shopId: mappingShopId,
      shopLocationProjection: locationProjection,
      submissionStatus: submission.submissionStatus || 'PENDING_REVIEW',
      submittedAt: now,
      submittedBy: session.username || 'admin',
      publicForNtheemba: false
    },
    batches: [],
    stockMovements: [],
    updatedAt: now
  };
  if (initStock > 0) {
    product.batches.push({
      shopId: _resolveTradeFlowShop_(state, state.activeShopId, { requireExplicitForMultiShop: false }).id,
      shopName: _resolveTradeFlowShop_(state, state.activeShopId, { requireExplicitForMultiShop: false }).name,
      id: _nextTradeFlowStateId_(state),
      productId: product.id,
      restockEventId: 'initial-stock',
      restockDate: now.slice(0, 10),
      quantityReceived: initStock,
      qty: initStock,
      unitCost: cost,
      sellingPriceSnapshot: sell,
      expectedUnitMargin: sell - cost,
      expectedTotalMargin: (sell - cost) * initStock,
      receivedDate: now.slice(0, 10),
      supplierId: '',
      invoiceId: ''
    });
  }
  return product;
}

function _ncpcCoverageLocationProjectionForShop_(state, shopId) {
  var location = {};
  if (typeof isStandardMultiShopReady_ === 'function' && isStandardMultiShopReady_() && typeof getStandardShopById_ === 'function') {
    location = (getStandardShopById_(shopId) || {}).location || {};
  } else {
    var shops = Array.isArray((state || {}).shops) ? state.shops : [];
    var shop = shops.find(function(item) { return _normalizeShopId_(item && (item.id || item.shopId)) === _normalizeShopId_(shopId); }) || {};
    location = shop.location || ((state || {}).settings || {}).shopLocation || {};
  }
  var normalized = _normalizeShopLocation_(location);
  return {
    country_id: normalized.country_id, country_name: normalized.country_name,
    province_id: normalized.province_id, province_name: normalized.province_name,
    district_id: normalized.district_id, district_name: normalized.district_name,
    town_id: normalized.town_id, town_name: normalized.town_name,
    catalogue_version: normalized.catalogue_version
  };
}

function _findProductByNcpcSubmissionRequest_(products, submissionRequestId) {
  var wanted = _normalizeString(submissionRequestId);
  if (!wanted) return null;
  return (Array.isArray(products) ? products : []).find(function(product) {
    if (!product || product.active === false || product._delete === true) return false;
    var mapping = product.ncpcMapping || {};
    return _normalizeString(mapping.status) === 'AWAITING_NCPC_REVIEW' && _normalizeString(mapping.submissionRequestId) === wanted;
  }) || null;
}

function _nextTradeFlowStateId_(state) {
  state.nextId = Number(state.nextId || 0) + 1;
  return state.nextId;
}

function getNcpcProductMapping(productId, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  return getProductIdentityService_().getMapping(productId, session, shopId);
}

function _productIdentityServiceGetMapping_(productId, session, shopId) {
  var target = _tradeFlowIdentitySpreadsheetForShop_(session, shopId);
  var product = (getAppStateInternal_(target.spreadsheet).products || []).find(function(row) { return String(row.id) === String(productId); });
  if (!product) throw new Error('Local product not found.');
  return { ok: true, productId: String(product.id), mapping: product.ncpcMapping || null };
}

function unpublishNcpcProductMapping(productId, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  return getProductIdentityService_().unpublishMapping(productId, session, shopId);
}

function _productIdentityServiceUnpublishMapping_(productId, session, shopId) {
  return _changeNcpcMapping_(productId, session, shopId, function(mapping) { mapping.publicForNtheemba = false; return mapping; });
}

function removeNcpcProductMapping(productId, sessionToken, shopId) {
  var session = requirePortalSession_(sessionToken, 'admin');
  return getProductIdentityService_().removeMapping(productId, session, shopId);
}

function _productIdentityServiceRemoveMapping_(productId, session, shopId) {
  return _changeNcpcMapping_(productId, session, shopId, function() { return null; });
}

function _changeNcpcMapping_(productId, session, shopId, transform) {
  var localId = _normalizeString(productId);
  if (!localId) throw new Error('Local product ID is required.');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var target = _tradeFlowIdentitySpreadsheetForShop_(session, shopId);
    var state = getAppStateInternal_(target.spreadsheet);
    var product = (state.products || []).find(function(row) { return String(row.id) === localId; });
    if (!product || !product.ncpcMapping) throw new Error('NCPC mapping not found.');
    var next = transform(Object.assign({}, product.ncpcMapping));
    if (next) { next.updatedAt = new Date().toISOString(); next.updatedBy = session.username || 'admin'; product.ncpcMapping = next; }
    else delete product.ncpcMapping;
    saveAppStateInternal_(state, target.spreadsheet);
    return { ok: true, productId: localId, mapping: next || null };
  } finally { lock.releaseLock(); }
}

function doPost(e) {
  var requestId = _ntheembaRequestId_();
  var action = 'unknown';
  var candidateCount = 0;
  var contents = '';
  try {
    contents = (e && e.postData && e.postData.contents);
    if (typeof contents !== 'string' || !contents) throw new Error('Malformed request');
    var request = JSON.parse(contents);
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Malformed request');
    action = _normalizeString(request.action);
    if (_isTradeFlowPublicApiRequest_(request)) {
      return _tradeFlowPublicApiJsonResponse_(_handleTradeFlowPublicApiRequest_(request, requestId, contents.length));
    }
    _authenticateNtheembaRequest_(request);
    if (action === 'find_items_by_ncpc_variants') {
      var variantIds = _validateNcpcVariantBatchRequest_(request);
      candidateCount = variantIds.length;
      _verifyNtheembaBatchSignature_(request, variantIds);
      _consumeNtheembaRequestNonce_(request);
      var items = getCatalogueService_().findByNcpcVariants(variantIds);
      _appendNtheembaApiAudit_(requestId, action, 'success', candidateCount, items.length);
      return _ntheembaJsonResponse_({ ok: true, request_id: requestId, contract_version: NTHEEMBA_FIND_ITEMS_CONTRACT_VERSION, data: items });
    }
    if (request.action !== 'search_catalogue' && request.action !== 'get_item') throw new Error('Unsupported action');
    var data = request.data || {};
    if (request.action === 'get_item') {
      return _ntheembaJsonResponse_({ ok: true, request_id: requestId, data: getCatalogueService_().getPublicItem(data.item_id) });
    }
    return _ntheembaJsonResponse_({ ok: true, request_id: requestId, data: getCatalogueService_().searchPublicCatalogue(data) });
  } catch (error) {
    if (_looksLikeTradeFlowPublicApiPayload_(contents)) {
      return _tradeFlowPublicApiJsonResponse_(_tradeFlowPublicApiError_(TRADEFLOW_PUBLIC_API_VERSION, requestId, 'MALFORMED_REQUEST', 'Malformed request.'));
    }
    _appendNtheembaApiAuditSafely_(requestId, action, 'rejected', candidateCount, 0);
    return _ntheembaJsonResponse_({ ok: false, request_id: requestId, error: { code: 'REQUEST_REJECTED', message: 'Request rejected.' } });
  }
}

function _isTradeFlowPublicApiRequest_(request) {
  return _normalizeString(request && request.version) || _normalizeString(request && request.action).indexOf('.') >= 0 || _normalizeString(request && request.action) === 'health';
}

function _looksLikeTradeFlowPublicApiPayload_(contents) {
  return typeof contents === 'string' && /"version"\s*:\s*"v1"/.test(contents);
}

function _handleTradeFlowPublicApiRequest_(request, requestId, bodyBytes) {
  var version = _normalizeString(request.version) || TRADEFLOW_PUBLIC_API_VERSION;
  var action = _normalizeString(request.action);
  var data = request.data || {};
  var safeRequestId = _tradeFlowPublicApiSafeId_(request.request_id) || requestId || _tradeFlowPublicApiRequestId_();
  var correlationId = _tradeFlowPublicApiSafeId_(request.correlation_id);
  try {
    if (version !== TRADEFLOW_PUBLIC_API_VERSION) return _tradeFlowPublicApiError_(version, safeRequestId, 'UNSUPPORTED_VERSION', 'Unsupported API version.');
    if (!action) return _tradeFlowPublicApiError_(version, safeRequestId, 'MISSING_ACTION', 'Action is required.');
    _validateTradeFlowPublicApiRequest_(request, bodyBytes);
    var authContext = _authenticateTradeFlowPublicApiRequest_(request, action);
    _enforceTradeFlowPublicApiRateLimit_(request, action, authContext);
    _verifyTradeFlowPublicApiRequestSignature_(request, action, authContext);
    var service = getTradeFlowPublicApiService_();
    if (action === 'health') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.health(), correlationId);
    if (action === 'business.profile') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.businessProfile(), correlationId);
    if (action === 'business.hours') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.businessHours(data), correlationId);
    if (action === 'shops.list') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.shopsList(), correlationId);
    if (action === 'shop.get') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.shopGet(data), correlationId);
    if (action === 'catalogue.search') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.catalogueSearch(data), correlationId);
    if (action === 'catalogue.barcode') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.catalogueBarcode(data), correlationId);
    if (action === 'catalogue.batch_lookup') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.catalogueBatchLookup(data), correlationId);
    if (action === 'catalogue.categories') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.catalogueCategories(data), correlationId);
    if (action === 'catalogue.item') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.catalogueItem(data), correlationId);
    if (action === 'catalogue.by_ncpc_variant') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.catalogueByNcpcVariant(data), correlationId);
    if (action === 'order.create') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.orderCreate(data, request), correlationId);
    if (action === 'order.batch_create') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.orderBatchCreate(data, request), correlationId);
    if (action === 'order.status') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.orderStatus(data), correlationId);
    if (action === 'handover.create') return _tradeFlowPublicApiSuccess_(version, safeRequestId, service.handoverCreate(data, request), correlationId);
    return _tradeFlowPublicApiError_(version, safeRequestId, 'UNKNOWN_ACTION', 'Unsupported action.', correlationId);
  } catch (error) {
    var code = error && error.publicCode ? error.publicCode : 'REQUEST_REJECTED';
    _tradeFlowPublicApiSecurityLog_(safeRequestId, action, code);
    var rejected = _tradeFlowPublicApiError_(version, safeRequestId, code, 'Request rejected.', correlationId);
    if (error && Number(error.retryAfterSeconds) > 0) rejected.error.retry_after_seconds = Math.ceil(Number(error.retryAfterSeconds));
    return rejected;
  }
}

function _validateTradeFlowPublicApiRequest_(request, bodyBytes) {
  if (Number(bodyBytes || 0) > TRADEFLOW_PUBLIC_API_MAX_BODY_BYTES) _throwTradeFlowPublicApiError_('PAYLOAD_TOO_LARGE');
  var action = _normalizeString(request.action);
  if (action && !/^[a-z][a-z0-9_.-]{0,63}$/.test(action)) _throwTradeFlowPublicApiError_('INVALID_ACTION');
  var requestId = _normalizeString(request.request_id);
  if (requestId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) _throwTradeFlowPublicApiError_('INVALID_REQUEST_ID');
  var correlationId = _normalizeString(request.correlation_id);
  if (correlationId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(correlationId)) _throwTradeFlowPublicApiError_('INVALID_CORRELATION_ID');
  var businessId = _normalizeString(request.business_id);
  if (businessId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(businessId)) _throwTradeFlowPublicApiError_('INVALID_BUSINESS_ID');
  var token = _normalizeString(request.api_token || (request.auth && request.auth.api_token));
  if (token.length > 512) _throwTradeFlowPublicApiError_('INVALID_AUTH');
  if (request.data !== undefined && (!request.data || typeof request.data !== 'object' || Array.isArray(request.data))) _throwTradeFlowPublicApiError_('INVALID_DATA');
}

function _authenticateTradeFlowPublicApiRequest_(request, action) {
  if (TRADEFLOW_PUBLIC_API_OPEN_ACTIONS[action]) return { anonymous: true, callerId: 'anonymous', businessId: '' };
  var props = PropertiesService.getScriptProperties();
  var configuredToken = _normalizeString(props.getProperty('TRADEFLOW_PUBLIC_API_TOKEN'));
  var previousToken = _normalizeString(props.getProperty('TRADEFLOW_PUBLIC_API_TOKEN_PREVIOUS'));
  var requestToken = _normalizeString(request.api_token || (request.auth && request.auth.api_token));
  var tokenSlot = '';
  if (configuredToken && requestToken && _tradeFlowSecureEquals_(requestToken, configuredToken)) tokenSlot = 'current';
  else if (previousToken && requestToken && _tradeFlowSecureEquals_(requestToken, previousToken)) tokenSlot = 'previous';
  if (!tokenSlot) _throwTradeFlowPublicApiError_('UNAUTHORIZED');
  var configuredBusinessId = _normalizeString(props.getProperty('TRADEFLOW_BUSINESS_ID')) || _normalizeString(props.getProperty('NTHEEMBA_BUSINESS_ID'));
  var requestBusinessId = _normalizeString(request.business_id);
  if (requestBusinessId && !configuredBusinessId) _throwTradeFlowPublicApiError_('TENANT_SCOPE_UNCONFIGURED');
  if (requestBusinessId && requestBusinessId !== configuredBusinessId) _throwTradeFlowPublicApiError_('TENANT_MISMATCH');
  return {
    businessId: configuredBusinessId,
    tokenSlot: tokenSlot,
    callerId: _tradeFlowHashHex_(requestToken).slice(0, 24)
  };
}

function _tradeFlowPublicApiNumberProperty_(name, fallback, minValue, maxValue) {
  var raw = _normalizeString(PropertiesService.getScriptProperties().getProperty(name));
  var value = Number(raw);
  if (!Number.isFinite(value)) value = Number(fallback);
  value = Math.floor(value);
  if (Number.isFinite(minValue)) value = Math.max(Number(minValue), value);
  if (Number.isFinite(maxValue)) value = Math.min(Number(maxValue), value);
  return value;
}

function _tradeFlowPublicApiRateLimitForAction_(action) {
  if (action === 'health') {
    return _tradeFlowPublicApiNumberProperty_('TRADEFLOW_PUBLIC_API_RATE_LIMIT_HEALTH_PER_MINUTE', TRADEFLOW_PUBLIC_API_DEFAULT_HEALTH_PER_MINUTE, 5, 1000);
  }
  if (action === 'order.batch_create') {
    return _tradeFlowPublicApiNumberProperty_('TRADEFLOW_PUBLIC_API_RATE_LIMIT_BATCH_PER_MINUTE', TRADEFLOW_PUBLIC_API_DEFAULT_BATCHES_PER_MINUTE, 1, 300);
  }
  if (action === 'catalogue.batch_lookup') {
    return _tradeFlowPublicApiNumberProperty_('TRADEFLOW_PUBLIC_API_RATE_LIMIT_BATCH_LOOKUP_PER_MINUTE', 30, 1, 600);
  }
  if (TRADEFLOW_PUBLIC_API_WRITE_ACTIONS[action]) {
    return _tradeFlowPublicApiNumberProperty_('TRADEFLOW_PUBLIC_API_RATE_LIMIT_WRITE_PER_MINUTE', TRADEFLOW_PUBLIC_API_DEFAULT_WRITES_PER_MINUTE, 1, 600);
  }
  return _tradeFlowPublicApiNumberProperty_('TRADEFLOW_PUBLIC_API_RATE_LIMIT_READ_PER_MINUTE', TRADEFLOW_PUBLIC_API_DEFAULT_READS_PER_MINUTE, 5, 2000);
}

function _enforceTradeFlowPublicApiRateLimit_(request, action, authContext) {
  if (typeof CacheService === 'undefined' || typeof LockService === 'undefined') return;
  var limit = _tradeFlowPublicApiRateLimitForAction_(action);
  var now = Date.now();
  var windowMs = TRADEFLOW_PUBLIC_API_RATE_WINDOW_SECONDS * 1000;
  var windowId = Math.floor(now / windowMs);
  var callerId = (authContext && authContext.callerId) || 'anonymous';
  var group = action === 'health' ? 'health' : (action === 'order.batch_create' ? 'batch-write' : (action === 'catalogue.batch_lookup' ? 'batch-read' : (TRADEFLOW_PUBLIC_API_WRITE_ACTIONS[action] ? 'write' : 'read')));
  var keyMaterial = [TRADEFLOW_PUBLIC_API_RATE_CACHE_PREFIX, callerId, group, String(windowId)].join('|');
  var key = TRADEFLOW_PUBLIC_API_RATE_CACHE_PREFIX + _tradeFlowHashHex_(keyMaterial).slice(0, 48);
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var cache = CacheService.getScriptCache();
    var count = Number(cache.get(key) || 0);
    if (count >= limit) {
      var retryAfter = Math.max(1, Math.ceil(((windowId + 1) * windowMs - now) / 1000));
      var error = new Error('Public API rate limit exceeded.');
      error.publicCode = 'RATE_LIMITED';
      error.retryAfterSeconds = retryAfter;
      throw error;
    }
    cache.put(key, String(count + 1), TRADEFLOW_PUBLIC_API_RATE_WINDOW_SECONDS * 2);
  } finally {
    lock.releaseLock();
  }
}

function _tradeFlowPublicApiSignatureRequired_() {
  return _normalizeString(PropertiesService.getScriptProperties().getProperty('TRADEFLOW_PUBLIC_API_REQUIRE_SIGNATURE')).toLowerCase() === 'true';
}

function _verifyTradeFlowPublicApiRequestSignature_(request, action, authContext) {
  if (TRADEFLOW_PUBLIC_API_OPEN_ACTIONS[action]) return;
  var signature = _normalizeString(request.request_signature);
  var required = _tradeFlowPublicApiSignatureRequired_();
  if (!required && !signature) return;
  var props = PropertiesService.getScriptProperties();
  var secret = _normalizeString(props.getProperty('TRADEFLOW_PUBLIC_API_SIGNING_SECRET'));
  if (!secret || secret.length < 24) _throwTradeFlowPublicApiError_('SIGNING_NOT_CONFIGURED');
  var requestBusinessId = _normalizeString(request.business_id);
  if (!requestBusinessId || requestBusinessId !== _normalizeString(authContext && authContext.businessId)) _throwTradeFlowPublicApiError_('TENANT_MISMATCH');
  var timestamp = Number(request.request_timestamp);
  var nonce = _normalizeString(request.request_nonce);
  var maxSkewSeconds = _tradeFlowPublicApiNumberProperty_('TRADEFLOW_PUBLIC_API_MAX_CLOCK_SKEW_SECONDS', TRADEFLOW_PUBLIC_API_DEFAULT_CLOCK_SKEW_SECONDS, 30, 1800);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > maxSkewSeconds * 1000) _throwTradeFlowPublicApiError_('STALE_REQUEST');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) _throwTradeFlowPublicApiError_('INVALID_NONCE');
  if (!/^[A-Za-z0-9+/=]{20,256}$/.test(signature)) _throwTradeFlowPublicApiError_('INVALID_SIGNATURE');
  var expected = _tradeFlowPublicApiSignature_(request, secret);
  if (!_tradeFlowSecureEquals_(signature, expected)) _throwTradeFlowPublicApiError_('INVALID_SIGNATURE');
  _consumeTradeFlowPublicApiNonce_(nonce, maxSkewSeconds);
}

function _tradeFlowPublicApiSignature_(request, signingSecret) {
  var material = [
    TRADEFLOW_PUBLIC_API_VERSION,
    _normalizeString(request.business_id),
    _normalizeString(request.request_id),
    _normalizeString(request.correlation_id),
    _normalizeString(request.action),
    String(Number(request.request_timestamp)),
    _normalizeString(request.request_nonce),
    _tradeFlowHashHex_(_tradeFlowCanonicalJson_(request.data || {}))
  ].join('\n');
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature(material, signingSecret, Utilities.Charset.UTF_8));
}

function _consumeTradeFlowPublicApiNonce_(nonce, maxSkewSeconds) {
  if (typeof CacheService === 'undefined' || typeof LockService === 'undefined') return;
  var key = TRADEFLOW_PUBLIC_API_NONCE_CACHE_PREFIX + _tradeFlowHashHex_(nonce).slice(0, 48);
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) _throwTradeFlowPublicApiError_('REPLAY_DETECTED');
    cache.put(key, '1', Math.min(21600, Math.max(60, maxSkewSeconds * 2)));
  } finally {
    lock.releaseLock();
  }
}

function _tradeFlowCanonicalJson_(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(_tradeFlowCanonicalJson_).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + _tradeFlowCanonicalJson_(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function _tradeFlowHashHex_(value) {
  return _bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8));
}

function _tradeFlowSecureEquals_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i++) mismatch |= (left.charCodeAt(i % Math.max(1, left.length)) || 0) ^ (right.charCodeAt(i % Math.max(1, right.length)) || 0);
  return mismatch === 0;
}

function _tradeFlowPublicApiSecurityLog_(requestId, action, code) {
  try {
    console.warn(JSON.stringify({ event: 'tradeflow_public_api_rejected', request_id: requestId || '', action: action || '', code: code || 'REQUEST_REJECTED' }));
  } catch (ignored) {}
}

function _throwTradeFlowPublicApiError_(code) {
  var error = new Error('Public API request rejected.');
  error.publicCode = code;
  throw error;
}

function getTradeFlowPublicApiService_() {
  return {
    health: _tradeFlowPublicApiHealth_,
    businessProfile: _tradeFlowPublicApiBusinessProfile_,
    businessHours: _tradeFlowPublicApiBusinessHours_,
    shopsList: _tradeFlowPublicApiShopsList_,
    shopGet: _tradeFlowPublicApiShopGet_,
    catalogueSearch: _tradeFlowPublicApiCatalogueSearch_,
    catalogueBarcode: _tradeFlowPublicApiCatalogueBarcode_,
    catalogueBatchLookup: _tradeFlowPublicApiCatalogueBatchLookup_,
    catalogueCategories: _tradeFlowPublicApiCatalogueCategories_,
    catalogueItem: _tradeFlowPublicApiCatalogueItem_,
    catalogueByNcpcVariant: _tradeFlowPublicApiCatalogueByNcpcVariant_,
    orderCreate: _tradeFlowPublicApiOrderCreate_,
    orderBatchCreate: _tradeFlowPublicApiOrderBatchCreate_,
    orderStatus: _tradeFlowPublicApiOrderStatus_,
    handoverCreate: _tradeFlowPublicApiHandoverCreate_
  };
}

function _tradeFlowPublicApiHealth_() {
  var runtime = (typeof getTradeFlowRuntimeConfig_ === 'function') ? getTradeFlowRuntimeConfig_() : {};
  return {
    status: 'ok',
    api: TRADEFLOW_PUBLIC_API_NAME,
    version: TRADEFLOW_PUBLIC_API_VERSION,
    product: _normalizeString(runtime.product) || 'TradeFlow',
    edition: _normalizeString(runtime.edition) || 'Standard v1',
    app_version: _normalizeString(runtime.appVersion) || '',
    capabilities: {
      local_catalogue_search: true,
      barcode_lookup: true,
      batch_catalogue_lookup: true,
      customer_order_create: true,
      batch_customer_order_create: true,
      order_status: true
    },
    limits: {
      max_body_bytes: TRADEFLOW_PUBLIC_API_MAX_BODY_BYTES,
      max_batch_lookups: TRADEFLOW_PUBLIC_API_MAX_BATCH_LOOKUPS,
      max_batch_orders: TRADEFLOW_PUBLIC_API_MAX_BATCH_ORDERS,
      max_order_items: TRADEFLOW_PUBLIC_API_MAX_ORDER_ITEMS
    },
    security: {
      token_auth: true,
      tenant_scope: true,
      rate_limiting: true,
      idempotency_payload_binding: true,
      signed_requests_supported: true,
      signed_requests_required: _tradeFlowPublicApiSignatureRequired_()
    }
  };
}

function _tradeFlowPublicApiBusinessProfile_() {
  var state = getAppStateInternal_() || {};
  var settings = state.settings || {};
  var shops = _tradeFlowPublicShopSources_();
  return {
    business_name: _normalizeString(state.businessName) || _normalizeString(settings.businessName) || 'TradeFlow Pro',
    business_type: _normalizeString(state.businessType) || _normalizeString(settings.businessType) || 'retail_supermarket',
    public_contact: { whatsapp: _normalizeString(state.businessWhatsapp) || _normalizeString(settings.businessWhatsapp) || '', address: _normalizeString(state.businessAddress) || _normalizeString(settings.businessAddress) || '' },
    shops: shops.map(function(shop) { return { shop_id: shop.id, name: shop.name, primary: shop.is_primary === true, location: shop.location }; })
  };
}

function _tradeFlowPublicApiShopsList_() {
  return { shops: _tradeFlowPublicShopSources_().map(function(shop) { return { shop_id: shop.id, name: shop.name, primary: shop.is_primary === true, location: shop.location }; }) };
}

function _tradeFlowPublicApiShopGet_(data) {
  data = data || {};
  var shop = _resolveTradeFlowPublicShopSource_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: true });
  return { shop: { shop_id: shop.id, name: shop.name, primary: shop.is_primary === true, location: shop.location } };
}

function _tradeFlowPublicApiBusinessHours_(data) {
  data = data || {};
  var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: false });
  var config = (context.shop && context.shop.config) || {};
  var settings = context.state.settings || {};
  var hours = Array.isArray(config.businessHours) ? config.businessHours : (Array.isArray(config.openingHours) ? config.openingHours : (Array.isArray(settings.openingHours) ? settings.openingHours : (Array.isArray(settings.businessHours) ? settings.businessHours : [])));
  return { shop_id: context.shop.id, hours: hours.map(_tradeFlowPublicApiSafeHour_) };
}

function _tradeFlowPublicApiSafeHour_(row) {
  row = row || {};
  return {
    day: _normalizeString(row.day),
    open: _normalizeString(row.open),
    close: _normalizeString(row.close),
    closed: row.closed === true
  };
}

function _tradeFlowPublicApiCatalogueSearch_(data) {
  data = data || {};
  var query = _normalizeString(data.query);
  if (query.length > 100) throw new Error('Search query is too long.');
  var requestedShopId = data.shop_id || data.branch_id;
  var context = _tradeFlowStateContextForShop_(requestedShopId, { requireExplicitForMultiShop: false });
  var businessProductId = _normalizeString(data.business_product_id || data.item_id);
  var barcode = _normalizeString(data.barcode);
  var ncpcVariantId = _normalizeString(data.ncpc_variant_id);
  var items = _catalogueServicePublicProductsFromState_(context.state).filter(function(product) {
    var map = product.ncpcMapping || {};
    if (businessProductId && String(product.id) !== businessProductId) return false;
    if (barcode && !_productHasBarcode_(product, barcode)) return false;
    if (ncpcVariantId && _normalizeString(map.ncpcVariantId) !== ncpcVariantId) return false;
    if (!query) return true;
    return _tradeFlowCatalogueSearchText_(product).indexOf(query.toLowerCase()) >= 0;
  }).sort(function(a,b) {
    var scoreDiff = _tradeFlowCatalogueSearchScore_(b, query, barcode, businessProductId, context.shop.id) - _tradeFlowCatalogueSearchScore_(a, query, barcode, businessProductId, context.shop.id);
    return scoreDiff || _publicProductRankSortForShop_(a,b,context.shop.id);
  }).slice(0, 12).map(function(product) { return _tradeFlowPublicApiProduct_(product, context.shop, true); });
  return { shop_id: context.shop.id, items: items };
}

function _tradeFlowPublicApiCatalogueBarcode_(data) {
  data = data || {};
  var barcode = _normalizeBarcodeValue_(data.barcode);
  if (!barcode || barcode.length > 128) _throwTradeFlowPublicApiError_('INVALID_BARCODE');
  var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: false });
  var item = _catalogueServicePublicProductsFromState_(context.state).find(function(product) {
    return _productHasBarcode_(product, barcode);
  });
  if (!item) _throwTradeFlowPublicApiError_('PRODUCT_NOT_FOUND');
  return { shop_id: context.shop.id, barcode: barcode, item: _tradeFlowPublicApiProduct_(item, context.shop, true) };
}

function _tradeFlowPublicApiCatalogueBatchLookup_(data) {
  data = data || {};
  var lookups = Array.isArray(data.lookups) ? data.lookups : [];
  if (lookups.length < 1 || lookups.length > TRADEFLOW_PUBLIC_API_MAX_BATCH_LOOKUPS) _throwTradeFlowPublicApiError_('INVALID_BATCH_SIZE');
  var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: false });
  var products = _catalogueServicePublicProductsFromState_(context.state);
  var seenLookupIds = {};
  var summary = { requested: lookups.length, found: 0, multiple_matches: 0, not_found: 0, invalid: 0 };
  var results = lookups.map(function(rawLookup, index) {
    var lookup = rawLookup && typeof rawLookup === 'object' && !Array.isArray(rawLookup) ? rawLookup : {};
    var fallbackId = 'lookup-' + (index + 1);
    var lookupId = _normalizeString(lookup.lookup_id || lookup.id || fallbackId);
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(lookupId) || seenLookupIds[lookupId]) {
      summary.invalid += 1;
      return { lookup_id: /^[A-Za-z0-9_.:-]{1,80}$/.test(lookupId) ? lookupId : fallbackId, status: 'invalid_lookup', items: [], error: { code: seenLookupIds[lookupId] ? 'DUPLICATE_LOOKUP_ID' : 'INVALID_LOOKUP_ID', message: 'Lookup identifier is invalid or duplicated.' } };
    }
    seenLookupIds[lookupId] = true;
    var businessProductId = _normalizeString(lookup.business_product_id || lookup.item_id);
    var barcode = _normalizeBarcodeValue_(lookup.barcode);
    var query = _normalizeString(lookup.query);
    if (query.length > 100) {
      summary.invalid += 1;
      return { lookup_id: lookupId, status: 'invalid_lookup', items: [], error: { code: 'QUERY_TOO_LONG', message: 'Search query is too long.' } };
    }
    if (!businessProductId && !barcode && !query) {
      summary.invalid += 1;
      return { lookup_id: lookupId, status: 'invalid_lookup', items: [], error: { code: 'MISSING_LOOKUP_CRITERIA', message: 'Provide business_product_id, barcode, or query.' } };
    }
    var matches = products.filter(function(product) {
      if (businessProductId && String(product.id) !== businessProductId) return false;
      if (barcode && !_productHasBarcode_(product, barcode)) return false;
      if (query && _tradeFlowCatalogueSearchText_(product).indexOf(query.toLowerCase()) < 0) return false;
      return true;
    }).sort(function(a, b) {
      var scoreDiff = _tradeFlowCatalogueSearchScore_(b, query, barcode, businessProductId, context.shop.id) - _tradeFlowCatalogueSearchScore_(a, query, barcode, businessProductId, context.shop.id);
      return scoreDiff || _publicProductRankSortForShop_(a, b, context.shop.id);
    }).slice(0, businessProductId || barcode ? 5 : 8);
    var status = matches.length === 0 ? 'not_found' : (matches.length === 1 ? 'found' : 'multiple_matches');
    if (status === 'found') summary.found += 1;
    else if (status === 'multiple_matches') summary.multiple_matches += 1;
    else summary.not_found += 1;
    return { lookup_id: lookupId, status: status, items: matches.map(function(product) { return _tradeFlowPublicApiProduct_(product, context.shop, true); }) };
  });
  return { shop_id: context.shop.id, results: results, summary: summary, limits: { max_lookups: TRADEFLOW_PUBLIC_API_MAX_BATCH_LOOKUPS } };
}

function _tradeFlowPublicApiCatalogueCategories_(data) {
  data = data || {};
  var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: false });
  var seen = {};
  var categories = _catalogueServicePublicProductsFromState_(context.state).map(function(product) { return _normalizeString(product.category); }).filter(function(category) {
    if (!category || seen[category.toLowerCase()]) return false; seen[category.toLowerCase()] = true; return true;
  }).sort();
  return { shop_id: context.shop.id, categories: categories };
}

function _tradeFlowPublicApiCatalogueItem_(data) {
  data = data || {};
  var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: false });
  var itemId = _normalizeString(data.business_product_id || data.item_id);
  var barcode = _normalizeString(data.barcode);
  if (!itemId && !barcode) _throwTradeFlowPublicApiError_('MISSING_PRODUCT_REFERENCE');
  var item = _catalogueServicePublicProductsFromState_(context.state).find(function(product) { return (itemId && String(product.id) === itemId) || (barcode && _productHasBarcode_(product, barcode)); });
  if (!item) _throwTradeFlowPublicApiError_('PRODUCT_NOT_FOUND');
  return { shop_id: context.shop.id, item: _tradeFlowPublicApiProduct_(item, context.shop, true) };
}

function _tradeFlowPublicApiCatalogueByNcpcVariant_(data) {
  data = data || {};
  var variantId = _normalizeString(data.ncpc_variant_id);
  if (!/^VAR-[A-Z0-9-]+$/.test(variantId)) throw new Error('Valid NCPC variant ID is required.');
  var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: false });
  return { shop_id: context.shop.id, items: _catalogueServicePublicProductsFromState_(context.state).filter(function(product) {
    return _normalizeString((product.ncpcMapping || {}).ncpcVariantId) === variantId;
  }).map(function(product) { return _tradeFlowPublicApiProduct_(product, context.shop, true); }) };
}

function _publicProductRankSortForShop_(a, b, shopId) {
  var aLinked = !!(a && a.ncpcMapping && _normalizeString(a.ncpcMapping.ncpcVariantId));
  var bLinked = !!(b && b.ncpcMapping && _normalizeString(b.ncpcMapping.ncpcVariantId));
  if (aLinked !== bLinked) return aLinked ? -1 : 1;
  var aInStock = _tradeFlowProductStockForShop_(a, shopId) > 0;
  var bInStock = _tradeFlowProductStockForShop_(b, shopId) > 0;
  if (aInStock !== bInStock) return aInStock ? -1 : 1;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function _publicProductRankSort_(a, b) {
  var aLinked = !!(a && a.ncpcMapping && _normalizeString(a.ncpcMapping.ncpcVariantId));
  var bLinked = !!(b && b.ncpcMapping && _normalizeString(b.ncpcMapping.ncpcVariantId));
  if (aLinked !== bLinked) return aLinked ? -1 : 1;
  var aInStock = _tradeFlowProductStockForShop_(a) > 0;
  var bInStock = _tradeFlowProductStockForShop_(b) > 0;
  if (aInStock !== bInStock) return aInStock ? -1 : 1;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function _tradeFlowPublicApiProduct_(product, shop, includeShopAvailability) {
  var mapping = product.ncpcMapping || {};
  var stock = _tradeFlowProductStockForShop_(product, shop && shop.id);
  var inStock = stock > 0;
  var response = {
    business_product_id: String(product.id),
    shop_id: shop ? shop.id : '',
    identity: {
      status: _tradeFlowProductIdentityStatus_(product),
      linked: _tradeFlowProductIdentityStatus_(product) === 'linked',
      ncpc_prd_id: _normalizeString(mapping.ncpcProductId),
      ncpc_var_id: _normalizeString(mapping.ncpcVariantId)
    },
    identity_status: _tradeFlowProductIdentityStatus_(product),
    catalogue_source: 'tradeflow_local_catalogue',
    name: _normalizeString(product.name),
    variant: _normalizeString(product.variantName || mapping.variantName),
    brand: _normalizeString(product.brand),
    category: _normalizeString(product.category),
    unit: _normalizeString(product.unit),
    barcode: _normalizeString(product.barcode),
    barcodes: _productBarcodeValues_(product),
    product_type: _normalizeString(product.productType) || 'product',
    selling_price: Number(product.sellingPrice || 0),
    currency: _tradeFlowPublicApiCurrency_(),
    availability: {
      status: inStock ? 'in_stock' : 'out_of_stock'
    }
  };
  if (includeShopAvailability && shop) {
    response.shop_availability = {
      shop_id: shop.id,
      shop_name: shop.name,
      status: inStock ? 'in_stock' : 'out_of_stock'
    };
  }
  return response;
}

function _tradeFlowPublicApiCurrency_() {
  var state = getAppStateInternal_() || {};
  var settings = state.settings || {};
  return _normalizeString(state.currency) || _normalizeString(settings.currency) || 'ZMW';
}

function _tradeFlowValidateOrderIdempotencyKey_(value) {
  var key = _normalizeString(value);
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) _throwTradeFlowPublicApiError_('INVALID_IDEMPOTENCY_KEY');
  return key;
}

function _tradeFlowOrderIdempotencyFingerprint_(data, shopId) {
  data = data || {};
  return _tradeFlowHashHex_(_tradeFlowCanonicalJson_({
    kind: 'order.create',
    shop_id: _normalizeShopId_(shopId),
    customer: _tradeFlowPublicApiSafeCustomer_(data.customer || {}),
    items: (Array.isArray(data.items) ? data.items : []).map(function(item) {
      item = item || {};
      return {
        business_product_id: _normalizeString(item.business_product_id || item.product_id || item.item_id),
        quantity: Number(item.quantity)
      };
    })
  }));
}

function _tradeFlowStoredOrderIdempotencyFingerprint_(order, fallbackShopId) {
  order = order || {};
  return _tradeFlowHashHex_(_tradeFlowCanonicalJson_({
    kind: 'order.create',
    shop_id: _normalizeShopId_(order.shopId || order.shop_id || fallbackShopId),
    customer: _tradeFlowPublicApiSafeCustomer_(order.customer || {}),
    items: (Array.isArray(order.items) ? order.items : []).map(function(item) {
      item = item || {};
      return {
        business_product_id: _normalizeString(item.business_product_id || item.productId || item.product_id || item.item_id),
        quantity: Number(item.quantity || item.qty || 0)
      };
    })
  }));
}

function _tradeFlowCreateCustomerOrderInContext_(data, request, context, state) {
  data = data || {};
  var idempotencyKey = _tradeFlowValidateOrderIdempotencyKey_(data.idempotency_key || (request && request.idempotency_key));
  var items = Array.isArray(data.items) ? data.items : [];
  if (items.length < 1 || items.length > TRADEFLOW_PUBLIC_API_MAX_ORDER_ITEMS) _throwTradeFlowPublicApiError_('INVALID_ORDER_ITEMS');
  state.customerOrders = Array.isArray(state.customerOrders) ? state.customerOrders : [];
  var shop = context.shop;
  var idempotencyFingerprint = _tradeFlowOrderIdempotencyFingerprint_(data, shop.id);
  var existing = _tradeFlowFindCustomerOrderByIdempotencyKey_(state.customerOrders, idempotencyKey);
  if (existing) {
    var existingFingerprint = _normalizeString(existing.idempotencyFingerprint) || _tradeFlowStoredOrderIdempotencyFingerprint_(existing, shop.id);
    if (!_tradeFlowSecureEquals_(existingFingerprint, idempotencyFingerprint)) _throwTradeFlowPublicApiError_('IDEMPOTENCY_KEY_REUSED');
    return { order: existing, duplicate: true, created: false };
  }
  var orderItems = items.map(function(item) { return _tradeFlowPublicApiOrderItem_(item, shop, state); });
  var currency = _tradeFlowPublicApiCurrency_();
  var now = new Date().toISOString();
  var order = {
    id: 'TF-ORDER-' + _nextTradeFlowStateId_(state),
    type: 'customer_order_request',
    status: 'requested',
    idempotencyKey: idempotencyKey,
    idempotencyFingerprint: idempotencyFingerprint,
    createdAt: now,
    updatedAt: now,
    shopId: shop.id,
    shopName: shop.name,
    publicShopContext: true,
    items: orderItems,
    totals: {
      currency: currency,
      itemCount: orderItems.length,
      total: orderItems.reduce(function(sum, item) { return sum + Number(item.line_total || 0); }, 0)
    },
    customer: _tradeFlowPublicApiSafeCustomer_(data.customer || {})
  };
  state.customerOrders.push(order);
  return { order: order, duplicate: false, created: true };
}

function _tradeFlowPublicApiOrderCreate_(data, request) {
  data = data || {};
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: true });
    var result = _tradeFlowCreateCustomerOrderInContext_(data, request, context, context.state);
    if (result.created) saveAppStateInternal_(context.state, context.spreadsheet);
    return { order: _tradeFlowPublicApiOrder_(result.order), duplicate: result.duplicate === true };
  } finally { lock.releaseLock(); }
}

function _tradeFlowPublicApiOrderBatchCreate_(data, request) {
  data = data || {};
  var orders = Array.isArray(data.orders) ? data.orders : [];
  if (orders.length < 1 || orders.length > TRADEFLOW_PUBLIC_API_MAX_BATCH_ORDERS) _throwTradeFlowPublicApiError_('INVALID_BATCH_SIZE');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: true });
    var state = context.state;
    var createdCount = 0;
    var duplicateCount = 0;
    var rejectedCount = 0;
    var seenKeys = {};
    var results = orders.map(function(rawOrder, index) {
      var child = rawOrder && typeof rawOrder === 'object' && !Array.isArray(rawOrder) ? rawOrder : {};
      var suppliedShopId = _normalizeShopId_(child.shop_id || child.branch_id);
      if (suppliedShopId && suppliedShopId !== context.shop.id) {
        rejectedCount += 1;
        return { index: index, status: 'rejected', error: { code: 'SHOP_SCOPE_MISMATCH', message: 'All orders in one batch must belong to the batch shop.' } };
      }
      var rawKey = _normalizeString(child.idempotency_key);
      if (rawKey && seenKeys[rawKey]) {
        rejectedCount += 1;
        return { index: index, idempotency_key: rawKey, status: 'rejected', error: { code: 'DUPLICATE_BATCH_IDEMPOTENCY_KEY', message: 'The same idempotency key appears more than once in this batch.' } };
      }
      if (rawKey) seenKeys[rawKey] = true;
      try {
        var result = _tradeFlowCreateCustomerOrderInContext_(child, {}, context, state);
        if (result.created) createdCount += 1;
        else duplicateCount += 1;
        return { index: index, idempotency_key: _normalizeString(child.idempotency_key), status: result.duplicate ? 'duplicate' : 'created', order: _tradeFlowPublicApiOrder_(result.order) };
      } catch (error) {
        rejectedCount += 1;
        return { index: index, idempotency_key: rawKey, status: 'rejected', error: { code: error && error.publicCode ? error.publicCode : 'REQUEST_REJECTED', message: 'Order request rejected.' } };
      }
    });
    if (createdCount > 0) saveAppStateInternal_(state, context.spreadsheet);
    return {
      shop_id: context.shop.id,
      results: results,
      summary: { requested: orders.length, created: createdCount, duplicate: duplicateCount, rejected: rejectedCount },
      limits: { max_orders: TRADEFLOW_PUBLIC_API_MAX_BATCH_ORDERS, max_items_per_order: TRADEFLOW_PUBLIC_API_MAX_ORDER_ITEMS }
    };
  } finally { lock.releaseLock(); }
}

function _tradeFlowPublicApiOrderStatus_(data) {
  data = data || {};
  var orderId = _normalizeString(data.order_id);
  var idempotencyKey = _normalizeString(data.idempotency_key);
  if (!orderId && !idempotencyKey) _throwTradeFlowPublicApiError_('MISSING_ORDER_REFERENCE');
  var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: true });
  var order = (context.state.customerOrders || []).find(function(item) {
    return (orderId && _normalizeString(item.id) === orderId) || (idempotencyKey && _normalizeString(item.idempotencyKey) === idempotencyKey);
  });
  if (!order) _throwTradeFlowPublicApiError_('ORDER_NOT_FOUND');
  return { shop_id: context.shop.id, order: _tradeFlowPublicApiOrder_(order) };
}

function _tradeFlowFindCustomerOrderByIdempotencyKey_(orders, idempotencyKey) {
  return (Array.isArray(orders) ? orders : []).find(function(order) {
    return _normalizeString(order && order.idempotencyKey) === idempotencyKey;
  }) || null;
}

function _tradeFlowPublicApiHandoverCreate_(data, request) {
  data = data || {};
  var idempotencyKey = _tradeFlowValidateOrderIdempotencyKey_(data.idempotency_key || (request && request.idempotency_key));
  var channel = _normalizeString(data.channel || (request && request.source_channel) || 'api').slice(0, 40);
  var reason = _normalizeString(data.reason || data.message || data.notes).slice(0, 500);
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var context = _tradeFlowStateContextForShop_(data.shop_id || data.branch_id, { requireExplicitForMultiShop: true });
    var state = context.state;
    state.handoverRequests = Array.isArray(state.handoverRequests) ? state.handoverRequests : [];
    var safeCustomer = _tradeFlowPublicApiSafeCustomer_(data.customer || {});
    var idempotencyFingerprint = _tradeFlowHashHex_(_tradeFlowCanonicalJson_({ kind: 'handover.create', shop_id: context.shop.id, channel: channel || 'api', reason: reason, customer: safeCustomer }));
    var existing = _tradeFlowFindHandoverByIdempotencyKey_(state.handoverRequests, idempotencyKey);
    if (existing) {
      var existingFingerprint = _normalizeString(existing.idempotencyFingerprint) || _tradeFlowHashHex_(_tradeFlowCanonicalJson_({ kind: 'handover.create', shop_id: _normalizeShopId_(existing.shopId || existing.shop_id || context.shop.id), channel: _normalizeString(existing.channel) || 'api', reason: _normalizeString(existing.reason).slice(0, 500), customer: _tradeFlowPublicApiSafeCustomer_(existing.customer || {}) }));
      if (!_tradeFlowSecureEquals_(existingFingerprint, idempotencyFingerprint)) _throwTradeFlowPublicApiError_('IDEMPOTENCY_KEY_REUSED');
      return { handover: _tradeFlowPublicApiHandover_(existing), duplicate: true };
    }
    var now = new Date().toISOString();
    var handover = { id: 'TF-HANDOVER-' + _nextTradeFlowStateId_(state), type: 'handover_request', status: 'requested', idempotencyKey: idempotencyKey, idempotencyFingerprint: idempotencyFingerprint, createdAt: now, updatedAt: now, shopId: context.shop.id, shopName: context.shop.name, channel: channel || 'api', reason: reason, customer: safeCustomer };
    state.handoverRequests.push(handover);
    saveAppStateInternal_(state, context.spreadsheet);
    return { shop_id: context.shop.id, handover: _tradeFlowPublicApiHandover_(handover), duplicate: false };
  } finally { lock.releaseLock(); }
}

function _tradeFlowFindHandoverByIdempotencyKey_(handoverRequests, idempotencyKey) {
  return (Array.isArray(handoverRequests) ? handoverRequests : []).find(function(item) {
    return _normalizeString(item && item.idempotencyKey) === idempotencyKey;
  }) || null;
}

function _tradeFlowPublicApiOrderItem_(item, shop, state) {
  item = item || {};
  var productId = _normalizeString(item.business_product_id || item.product_id || item.item_id);
  var qty = Number(item.quantity);
  if (!productId || !isFinite(qty) || qty <= 0 || qty > 999) _throwTradeFlowPublicApiError_('INVALID_ORDER_ITEM');
  var product = _catalogueServicePublicProductsFromState_(state || {}).find(function(candidate) {
    return String(candidate.id) === productId;
  });
  if (!product) _throwTradeFlowPublicApiError_('PRODUCT_NOT_FOUND');
  var publicProduct = _tradeFlowPublicApiProduct_(product, shop);
  return {
    shop_id: shop ? shop.id : '',
    shop_name: shop ? shop.name : '',
    business_product_id: publicProduct.business_product_id,
    identity: publicProduct.identity,
    name: publicProduct.name,
    variant: publicProduct.variant,
    quantity: qty,
    selling_price: publicProduct.selling_price,
    currency: publicProduct.currency,
    line_total: qty * publicProduct.selling_price,
    availability: publicProduct.availability
  };
}

function _tradeFlowPublicApiSafeCustomer_(customer) {
  customer = customer || {};
  return {
    display_name: _normalizeString(customer.display_name || customer.name).slice(0, 120),
    phone: _normalizeString(customer.phone || customer.whatsapp).slice(0, 40)
  };
}

function _tradeFlowPublicApiOrder_(order) {
  var includeShop = order && order.publicShopContext === true;
  var response = {
    order_id: _normalizeString(order.id),
    status: _normalizeString(order.status) || 'requested',
    created_at: _normalizeString(order.createdAt),
    updated_at: _normalizeString(order.updatedAt),
    items: (Array.isArray(order.items) ? order.items : []).map(function(item) { return _tradeFlowPublicApiOrderPublicItem_(item, includeShop); }),
    totals: {
      currency: _normalizeString((order.totals || {}).currency) || _tradeFlowPublicApiCurrency_(),
      item_count: Number((order.totals || {}).itemCount || (order.items || []).length || 0),
      total: Number((order.totals || {}).total || 0)
    }
  };
  if (includeShop) {
    response.shop_id = _normalizeString(order.shopId || order.shop_id);
    response.shop_name = _normalizeString(order.shopName || order.shop_name);
  }
  return response;
}

function _tradeFlowPublicApiHandover_(handover) {
  return {
    handover_id: _normalizeString(handover.id),
    status: _normalizeString(handover.status) || 'requested',
    channel: _normalizeString(handover.channel) || 'api',
    created_at: _normalizeString(handover.createdAt),
    updated_at: _normalizeString(handover.updatedAt),
    shop_id: _normalizeString(handover.shopId || handover.shop_id),
    shop_name: _normalizeString(handover.shopName || handover.shop_name)
  };
}

function _tradeFlowPublicApiOrderPublicItem_(item, includeShop) {
  item = item || {};
  var response = {
    business_product_id: _normalizeString(item.business_product_id),
    identity: {
      status: _normalizeString((item.identity || {}).status || item.identity_status),
      linked: (item.identity || {}).linked === true,
      ncpc_prd_id: _normalizeString((item.identity || {}).ncpc_prd_id),
      ncpc_var_id: _normalizeString((item.identity || {}).ncpc_var_id)
    },
    identity_status: _normalizeString(item.identity_status || (item.identity || {}).status),
    name: _normalizeString(item.name),
    variant: _normalizeString(item.variant),
    quantity: Number(item.quantity || 0),
    selling_price: Number(item.selling_price || 0),
    currency: _normalizeString(item.currency) || _tradeFlowPublicApiCurrency_(),
    line_total: Number(item.line_total || 0),
    availability: {
      status: _normalizeString((item.availability || {}).status) || 'unknown'
    }
  };
  if (includeShop) {
    response.shop_id = _normalizeString(item.shop_id || item.shopId);
    response.shop_name = _normalizeString(item.shop_name || item.shopName);
  }
  return response;
}

function _tradeFlowPublicApiSuccess_(version, requestId, data, correlationId) {
  var response = { ok: true, version: version, request_id: requestId, data: data };
  if (correlationId) response.correlation_id = correlationId;
  return response;
}

function _tradeFlowPublicApiError_(version, requestId, code, message, correlationId) {
  var response = { ok: false, version: version || TRADEFLOW_PUBLIC_API_VERSION, request_id: requestId, error: { code: code, message: message } };
  if (correlationId) response.correlation_id = correlationId;
  return response;
}

function _tradeFlowPublicApiRequestId_() {
  return 'tfapi_' + Utilities.getUuid().replace(/-/g, '');
}

function _tradeFlowPublicApiSafeId_(value) {
  var id = _normalizeString(value);
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(id) ? id : '';
}

function _tradeFlowPublicApiJsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function _authenticateNtheembaRequest_(request) {
  var props = PropertiesService.getScriptProperties();
  var configuredToken = _normalizeString(props.getProperty('NTHEEMBA_API_TOKEN'));
  var configuredBusinessId = _normalizeString(props.getProperty('NTHEEMBA_BUSINESS_ID'));
  var requestToken = _normalizeString(request.api_token);
  var requestBusinessId = _normalizeString(request.business_id);
  if (!configuredToken || !configuredBusinessId || !requestToken || !requestBusinessId || requestToken !== configuredToken || requestBusinessId !== configuredBusinessId) throw new Error('Unauthorized');
  return { businessId: configuredBusinessId };
}

function _validateNcpcVariantBatchRequest_(request) {
  if (_normalizeString(request.contract_version) !== NTHEEMBA_FIND_ITEMS_CONTRACT_VERSION || !request.data || typeof request.data !== 'object' || Array.isArray(request.data)) throw new Error('Malformed request');
  var ids = request.data.ncpc_variant_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > NTHEEMBA_FIND_ITEMS_MAX_VARIANT_IDS) throw new Error('Invalid batch size');
  var seen = {};
  return ids.map(function(value) {
    var id = _normalizeString(value);
    if (!/^VAR-[A-Z0-9-]+$/.test(id) || seen[id]) throw new Error('Invalid variant IDs');
    seen[id] = true;
    return id;
  });
}

function _consumeNtheembaRequestNonce_(request) {
  var timestamp = Number(request.request_timestamp);
  var nonce = _normalizeString(request.request_nonce);
  if (!Number.isFinite(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || Math.abs(Date.now() - timestamp) > NTHEEMBA_FIND_ITEMS_MAX_CLOCK_SKEW_MS) throw new Error('Invalid request freshness');
  var props = PropertiesService.getScriptProperties();
  var key = NTHEEMBA_FIND_ITEMS_NONCE_PREFIX + _bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, nonce, Utilities.Charset.UTF_8));
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    Object.keys(props.getProperties()).filter(function(propertyKey) { return propertyKey.indexOf(NTHEEMBA_FIND_ITEMS_NONCE_PREFIX) === 0; }).forEach(function(propertyKey) {
      if (Number(props.getProperty(propertyKey) || 0) < Date.now() - NTHEEMBA_FIND_ITEMS_MAX_CLOCK_SKEW_MS) props.deleteProperty(propertyKey);
    });
    if (props.getProperty(key)) throw new Error('Replayed request');
    props.setProperty(key, String(timestamp));
  } finally { lock.releaseLock(); }
}

function _verifyNtheembaBatchSignature_(request, variantIds) {
  var secret = _normalizeString(PropertiesService.getScriptProperties().getProperty('NTHEEMBA_API_SIGNING_SECRET'));
  var signature = _normalizeString(request.request_signature);
  if (!secret || !/^[A-Za-z0-9+/=]{20,256}$/.test(signature) || signature !== _ntheembaBatchSignature_(request, variantIds, secret)) throw new Error('Invalid request signature');
}

function _ntheembaBatchSignature_(request, variantIds, signingSecret) {
  var secret = signingSecret || _normalizeString(PropertiesService.getScriptProperties().getProperty('NTHEEMBA_API_SIGNING_SECRET'));
  var material = [NTHEEMBA_FIND_ITEMS_CONTRACT_VERSION, _normalizeString(request.business_id), String(request.request_timestamp), _normalizeString(request.request_nonce), variantIds.join(',')].join('\n');
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature(material, secret, Utilities.Charset.UTF_8));
}

function getCatalogueService_() {
  return {
    searchPublicCatalogue: _catalogueServiceSearchPublicCatalogue_,
    getPublicItem: _catalogueServiceGetPublicItem_,
    findByNcpcVariants: _findPublicItemsByNcpcVariants_
  };
}

function _catalogueServicePublicProducts_() {
  var context = _tradeFlowStateContextForShop_('', { requireExplicitForMultiShop: false });
  return _catalogueServicePublicProductsFromState_(context.state);
}

function _catalogueServiceGetPublicItem_(itemId) {
  var item = _catalogueServicePublicProducts_().find(function(product) {
    return String(product.id) === String(itemId);
  });
  if (!item) throw new Error('Product not found.');
  return ntheembaPublicProduct_(item);
}

function _catalogueServiceSearchPublicCatalogue_(data) {
  data = data || {};
  var query = String(data.query || '').toLowerCase();
  return _catalogueServicePublicProducts_().filter(function(product) {
    var map = product.ncpcMapping || {};
    return (data.ncpc_variant_id && map.ncpcVariantId === data.ncpc_variant_id) || [product.name, _productBarcodeValues_(product).join(' '), map.ncpcVariantId].join(' ').toLowerCase().indexOf(query) >= 0;
  }).slice(0, 6).map(ntheembaPublicProduct_);
}

function _findPublicItemsByNcpcVariants_(variantIds) {
  var wanted = {};
  variantIds.forEach(function(id) { wanted[id] = true; });
  return _catalogueServicePublicProducts_().filter(function(product) {
    var mapping = product && product.ncpcMapping;
    return _productIsPublicForNtheemba_(product) && mapping && wanted[_normalizeString(mapping.ncpcVariantId)] === true;
  }).map(_ntheembaNcpcBatchPublicItem_);
}

function _ntheembaNcpcBatchPublicItem_(product) {
  var mapping = product.ncpcMapping || {};
  var stock = (product.batches || []).reduce(function(total, batch) { return total + Number(batch.quantityRemaining || batch.quantityReceived || batch.qty || 0); }, 0);
  var inStock = stock > 0;
  return {
    business_item_id: String(product.id),
    ncpc_product_id: _normalizeString(mapping.ncpcProductId),
    ncpc_variant_id: _normalizeString(mapping.ncpcVariantId),
    display_name: String(product.name || ''),
    public_price: Number(product.sellingPrice || 0),
    availability: inStock ? 'available' : 'unavailable',
    stock_status: inStock ? 'in_stock' : 'out_of_stock',
    contract_version: NTHEEMBA_FIND_ITEMS_CONTRACT_VERSION
  };
}

function _ntheembaRequestId_() { return 'ntf_' + Utilities.getUuid().replace(/-/g, ''); }

function _ntheembaJsonResponse_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }

function _appendNtheembaApiAudit_(requestId, action, outcome, candidateCount, resultCount) {
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var sheet = _ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), NTHEEMBA_API_AUDIT_SHEET, NTHEEMBA_API_AUDIT_HEADERS).sheet;
    _appendRow(sheet, [requestId, new Date(), action, outcome, Number(candidateCount || 0), Number(resultCount || 0)]);
  } finally { lock.releaseLock(); }
}

function _appendNtheembaApiAuditSafely_(requestId, action, outcome, candidateCount, resultCount) {
  try { _appendNtheembaApiAudit_(requestId, action, outcome, candidateCount, resultCount); } catch (ignored) {}
}

function ntheembaPublicProduct_(product) {
  var stock = (product.batches || []).reduce(function(total, batch) { return total + Number(batch.quantityRemaining || batch.quantityReceived || batch.qty || 0); }, 0);
  var mapping = product.ncpcMapping || {};
  return { item_id: String(product.id), name: String(product.name), item_type: String(product.productType || 'product'), price: Number(product.sellingPrice || 0), available: stock > 0, ncpc_variant_id: _normalizeString(mapping.ncpcVariantId) };
}
