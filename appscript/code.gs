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
const TRADEFLOW_SETUP_SUPPORT_CODE = 'SETUP_CONFIG_NOT_READY';
const TRADEFLOW_SETUP_REQUIRED_SCRIPT_PROPERTIES = [
  { key: 'TRADEFLOW_APP_VERSION', group: 'installation', label: 'TradeFlow app version' },
  { key: 'TRADEFLOW_EDITION', group: 'installation', label: 'TradeFlow edition' },
  { key: 'TRADEFLOW_CLIENT_ID', group: 'installation', label: 'TradeFlow client identity' },
  { key: 'TRADEFLOW_CLIENT_NAME', group: 'installation', label: 'TradeFlow client name' },
  { key: 'TRADEFLOW_INSTALLATION_ID', group: 'installation', label: 'TradeFlow installation identity' },
  { key: 'TRADEFLOW_ENVIRONMENT', group: 'installation', label: 'TradeFlow environment' },
  { key: 'CAPTURE_RUNTIME_URL', group: 'scanner', label: 'Barcode scanner runtime', type: 'httpsUrl' },
  { key: 'NCPC_ENABLED', group: 'centralCatalogue', label: 'Central Catalogue enabled flag', expect: 'true' },
  { key: 'NCPC_BASE_URL', group: 'centralCatalogue', label: 'Central Catalogue API URL', type: 'httpsUrl' },
  { key: 'NCPC_API_TOKEN', group: 'centralCatalogue', label: 'Central Catalogue API token', minLength: 24, secret: true },
  { key: 'NCPC_API_VERSION', group: 'centralCatalogue', label: 'Central Catalogue API version', expect: 'v1' },
  { key: 'NCPC_TIMEOUT_MS', group: 'centralCatalogue', label: 'Central Catalogue timeout', type: 'number', min: 1000, max: 30000 }
];

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

function normalizeSetupPropertyValue_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function normalizeNcpcClientId_(value, fallback) {
  const raw = normalizeSetupPropertyValue_(value || fallback);
  const safe = raw
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe.slice(0, 96) || 'tradeflow-standard';
}

function isValidSetupHttpsUrl_(value) {
  return /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#].*)?$/.test(normalizeSetupPropertyValue_(value));
}

function getSetupPropertyGroupLabel_(group) {
  return ({
    installation: 'TradeFlow installation',
    scanner: 'Barcode scanner runtime',
    centralCatalogue: 'Central Catalogue connection',
    gatewayHeaders: 'Central Catalogue gateway headers'
  })[group] || 'Technical configuration';
}

function buildSetupPreflightPublicStatus_(details) {
  const groups = ['installation', 'scanner', 'centralCatalogue', 'gatewayHeaders'];
  const ownerChecks = groups.map(function(group) {
    const problems = details.problems.filter(function(problem) { return problem.group === group; });
    return {
      id: group,
      label: getSetupPropertyGroupLabel_(group),
      ready: problems.length === 0
    };
  });
  return {
    ready: details.ready,
    supportCode: TRADEFLOW_SETUP_SUPPORT_CODE,
    status: details.ready ? 'ready' : 'not_ready',
    title: details.ready ? 'TradeFlow is ready for business setup' : 'TradeFlow needs technical activation',
    message: details.ready
      ? 'The protected TradeFlow and Central Catalogue connection settings are configured.'
      : 'This copy is not ready for business setup. Please call NDS technical support for assistance.',
    ownerChecks: ownerChecks
  };
}

function getTradeFlowSetupPreflight_() {
  const props = PropertiesService.getScriptProperties();
  const problems = [];
  const values = {};

  TRADEFLOW_SETUP_REQUIRED_SCRIPT_PROPERTIES.forEach(function(rule) {
    const value = normalizeSetupPropertyValue_(props.getProperty(rule.key));
    values[rule.key] = value;
    if (!value) {
      problems.push({ key: rule.key, group: rule.group, label: rule.label, type: 'missing' });
      return;
    }
    if (rule.expect && value.toLowerCase() !== String(rule.expect).toLowerCase()) {
      problems.push({ key: rule.key, group: rule.group, label: rule.label, type: 'invalid' });
      return;
    }
    if (rule.type === 'httpsUrl' && !isValidSetupHttpsUrl_(value)) {
      problems.push({ key: rule.key, group: rule.group, label: rule.label, type: 'invalid' });
      return;
    }
    if (rule.type === 'number') {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue < rule.min || numberValue > rule.max) {
        problems.push({ key: rule.key, group: rule.group, label: rule.label, type: 'invalid' });
        return;
      }
    }
    if (rule.minLength && value.length < rule.minLength) {
      problems.push({ key: rule.key, group: rule.group, label: rule.label, type: 'invalid' });
    }
  });

  const extraHeaders = normalizeSetupPropertyValue_(props.getProperty('NCPC_EXTRA_HEADERS_JSON'));
  let extraHeadersConfigured = false;
  if (extraHeaders) {
    try {
      const parsed = JSON.parse(extraHeaders);
      const validObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      const validValues = validObject && Object.keys(parsed).every(function(key) {
        return normalizeSetupPropertyValue_(key) && typeof parsed[key] === 'string';
      });
      if (!validObject || !validValues) {
        problems.push({ key: 'NCPC_EXTRA_HEADERS_JSON', group: 'gatewayHeaders', label: 'Central Catalogue gateway headers', type: 'invalid' });
      } else {
        extraHeadersConfigured = Object.keys(parsed).length > 0;
      }
    } catch (e) {
      problems.push({ key: 'NCPC_EXTRA_HEADERS_JSON', group: 'gatewayHeaders', label: 'Central Catalogue gateway headers', type: 'invalid' });
    }
  }

  const ready = problems.length === 0;
  const details = {
    ready: ready,
    supportCode: TRADEFLOW_SETUP_SUPPORT_CODE,
    missing: problems.filter(function(problem) { return problem.type === 'missing'; }).map(function(problem) { return problem.label; }),
    invalid: problems.filter(function(problem) { return problem.type === 'invalid'; }).map(function(problem) { return problem.label; }),
    problems: problems,
    ncpc: {
      enabled: values.NCPC_ENABLED === 'true',
      ready: problems.filter(function(problem) { return problem.group === 'centralCatalogue' || problem.group === 'gatewayHeaders'; }).length === 0,
      apiVersion: values.NCPC_API_VERSION || '',
      baseUrlConfigured: !!values.NCPC_BASE_URL,
      tokenConfigured: !!values.NCPC_API_TOKEN,
      timeoutMs: Number(values.NCPC_TIMEOUT_MS) || 0,
      extraHeadersConfigured: extraHeadersConfigured
    }
  };
  details.public = buildSetupPreflightPublicStatus_(details);
  return details;
}

function getTradeFlowSetupPreflight() {
  return getTradeFlowSetupPreflight_().public;
}

/**
 * Customer-safe, business-admin view of the optional Ntheemba connection.
 * Configuration values and credentials intentionally never leave the server.
 */
function getTradeFlowNtheembaConnectionStatus(sessionToken) {
  var session = requirePortalSession_(sessionToken, 'admin');
  var props = PropertiesService.getScriptProperties();
  var enabled = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_ENABLED')).toLowerCase() === 'true';
  var registrationStatus = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_REGISTRATION_STATUS'));
  var registered = registrationStatus === 'registered_pending_verification';
  var termsVersion = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_TERMS_VERSION'));
  var privacyVersion = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_PRIVACY_VERSION'));
  var policyAccepted = !!termsVersion && !!privacyVersion &&
    normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_TERMS_ACCEPTED_VERSION')) === termsVersion &&
    normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_PRIVACY_ACCEPTED_VERSION')) === privacyVersion;
  var capabilities = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_CAPABILITIES'))
    .split(',').map(function(item) { return normalizeSetupPropertyValue_(item); }).filter(Boolean);
  var catalogueReady = enabled && policyAccepted && capabilities.indexOf('catalogue.read') >= 0 && !registered;
  var onboardingConfigured = !!normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_BASE_URL')) &&
    /^https:\/\//i.test(normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_BASE_URL')));

  return {
    enabled: enabled,
    canManage: session.role === 'super_admin',
    policy: {
      status: policyAccepted ? 'accepted' : 'action_required',
      termsVersion: termsVersion || '',
      privacyVersion: privacyVersion || ''
    },
    capabilities: capabilities,
    registration: {
      status: registered ? registrationStatus : 'not_registered',
      label: registered ? 'Registered with Ntheemba. Verification is still required; customer workflows remain disabled.' : 'Not registered yet.'
    },
    onboarding: {
      status: onboardingConfigured ? 'ready' : 'not_configured',
      label: onboardingConfigured ? 'Ready to send the NTheemba connection contract.' : 'NTheemba connection credentials still need protected configuration.'
    },
    chat: {
      status: registered ? 'pending_verification' : (catalogueReady ? 'ready' : 'not_ready'),
      label: registered ? 'Registered and awaiting Ntheemba verification. Customer chat remains disabled.' : (catalogueReady ? 'Ready for the Ntheemba chat service' : 'Complete activation before chat can use TradeFlow data')
    },
    marketplace: {
      status: 'not_available',
      label: 'Marketplace is unavailable until its separate approval and connection are implemented.'
    },
    gateway: {
      status: 'not_configured',
      label: 'WhatsApp connection and QR pairing are managed by the separate gateway service.'
    }
  };
}

/** Record the Super Admin's first-time consent before NTheemba registration. */
function acceptTradeFlowNtheembaPolicies(consent, sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  if (!consent || consent.terms !== true || consent.privacy !== true) {
    throw new Error('Accept both the NTheemba connection terms and privacy notice to continue.');
  }
  var props = PropertiesService.getScriptProperties();
  var termsVersion = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_TERMS_VERSION')) || 'ntheemba-local-terms-v1';
  var privacyVersion = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_PRIVACY_VERSION')) || 'ntheemba-local-privacy-v1';
  props.setProperties({
    TRADEFLOW_TERMS_VERSION: termsVersion,
    TRADEFLOW_PRIVACY_VERSION: privacyVersion,
    TRADEFLOW_NTHEEMBA_TERMS_ACCEPTED_VERSION: termsVersion,
    TRADEFLOW_NTHEEMBA_PRIVACY_ACCEPTED_VERSION: privacyVersion
  }, false);
  if (isStandardMultiShopReady_()) {
    _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'ntheemba.policy.accepted', '', {
      actor: session.username || 'super_admin', termsVersion: termsVersion, privacyVersion: privacyVersion
    });
  }
  return getTradeFlowNtheembaConnectionStatus(sessionToken);
}

/** Store the narrow capability declaration selected by the Super Admin. */
function setTradeFlowNtheembaCapabilities(capabilities, sessionToken) {
  requirePortalSession_(sessionToken, 'super_admin');
  var allowed = ['catalogue.read', 'order.create', 'business.information', 'business.hours', 'handover.create'];
  var chosen = (Array.isArray(capabilities) ? capabilities : []).map(normalizeSetupPropertyValue_)
    .filter(function(item, index, all) { return allowed.indexOf(item) >= 0 && all.indexOf(item) === index; });
  if (!chosen.length) throw new Error('Choose at least one NTheemba capability to continue.');
  PropertiesService.getScriptProperties().setProperty('TRADEFLOW_NTHEEMBA_CAPABILITIES', chosen.join(','));
  return getTradeFlowNtheembaConnectionStatus(sessionToken);
}

/** Return the safe, token-free connection details for Super Admin confirmation. */
function getTradeFlowNtheembaConnectionPreview(sessionToken) {
  requirePortalSession_(sessionToken, 'super_admin');
  var props = PropertiesService.getScriptProperties();
  var state = getAppStateInternal_();
  var shops = isStandardMultiShopReady_() ? listStandardShopSources_() : normalizeShops_(state);
  return {
    businessId: normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_BUSINESS_ID')),
    displayName: _normalizeString(state.businessName || (state.settings || {}).businessName || props.getProperty('TRADEFLOW_CLIENT_NAME')),
    businessType: _normalizeString((state.settings || {}).businessType),
    capabilities: normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_CAPABILITIES')).split(',').map(normalizeSetupPropertyValue_).filter(Boolean),
    policyAccepted: getTradeFlowNtheembaConnectionStatus(sessionToken).policy.status === 'accepted',
    shops: shops.filter(function(shop) { return shop && shop.status !== 'deleted'; }).map(function(shop) {
      var item = _tradeFlowNtheembaShopContract_(shop);
      return { shopId: item.shopId, displayName: item.displayName, status: item.status, isPrimary: item.isPrimary, location: item.location, hoursStatus: item.hoursStatus };
    }),
    customerWorkflows: 'disabled'
  };
}

/** Super-Admin-only, public-data-only NTheemba onboarding request. */
function initiateTradeFlowNtheembaConnection(sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  var props = PropertiesService.getScriptProperties();
  var baseUrl = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_NTHEEMBA_BASE_URL')).replace(/\/+$/, '');
  var businessId = normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_BUSINESS_ID'));
  if (!baseUrl || !businessId) throw new Error('NTheemba connection needs its approved address and this TradeFlow business ID.');
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('NTheemba connection needs an approved HTTPS address.');
  var connection = getTradeFlowNtheembaConnectionStatus(sessionToken);
  if (connection.policy.status !== 'accepted') throw new Error('Accept the approved NTheemba policy versions before starting the connection.');
  var callbackUrl = normalizeSetupPropertyValue_(props.getProperty('DEPLOYMENT_URL')) ||
    normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_PUBLIC_API_BASE_URL')) ||
    ScriptApp.getService().getUrl();
  if (!/^https:\/\//i.test(callbackUrl || '')) throw new Error('TradeFlow needs its approved HTTPS public API address before starting the connection.');
  var capabilities = _tradeFlowNtheembaCapabilities_(connection.capabilities);
  if (!capabilities.length) throw new Error('Choose at least one supported NTheemba capability first.');
  var state = getAppStateInternal_();
  var shops = isStandardMultiShopReady_() ? listStandardShopSources_() : normalizeShops_(state);
  shops = shops.filter(function(shop) { return shop && shop.status !== 'deleted'; });
  if (!shops.length) throw new Error('Configure at least one TradeFlow shop before starting NTheemba.');
  var contract = {
    contractVersion: 'tradeflow.ntheemba.onboarding.v1', businessId: businessId,
    displayName: _normalizeString(state.businessName || (state.settings || {}).businessName || props.getProperty('TRADEFLOW_CLIENT_NAME') || businessId),
    businessType: _normalizeString((state.settings || {}).businessType), declaredCapabilities: capabilities,
    integrationId: 'tradeflow-' + businessId.toLowerCase().replace(/[^a-z0-9]+/g, '-'), baseUrl: callbackUrl,
    shops: shops.map(_tradeFlowNtheembaShopContract_)
  };
  var response = UrlFetchApp.fetch(baseUrl + '/api/v1/onboarding/tradeflow/register', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Request-ID': 'tf-onboard-' + Utilities.getUuid() }, payload: JSON.stringify(contract)
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('NTheemba could not register this connection (HTTP ' + code + ').');
  var result = JSON.parse(response.getContentText() || '{}');
  if (!result.issuedTradeFlowApiToken) throw new Error('NTheemba did not issue the private TradeFlow connection token.');
  props.setProperty('TRADEFLOW_PUBLIC_API_TOKEN', result.issuedTradeFlowApiToken);
  props.setProperties({
    TRADEFLOW_NTHEEMBA_ENABLED: 'true',
    TRADEFLOW_NTHEEMBA_REGISTRATION_STATUS: result.status || 'registered_pending_verification'
  }, false);
  return { status: result.status || 'registered_pending_verification', customerWorkflows: result.customerWorkflows || 'disabled', shopCount: Number(result.shopCount) || shops.length, initiatedBy: session.username || 'super_admin' };
}

function _tradeFlowNtheembaCapabilities_(requested) {
  var mapping = { 'catalogue.read': 'product.catalogue', 'order.create': 'product.order', 'business.information': 'business.information', 'business.hours': 'business.hours', 'handover.create': 'handover.create' };
  var result = [];
  (requested || []).forEach(function(item) { var mapped = mapping[_normalizeString(item)]; if (mapped && result.indexOf(mapped) < 0) result.push(mapped); });
  return result;
}

function _tradeFlowNtheembaShopContract_(shop) {
  var location = normalizeShopLocation_(shop.location || {}), safe = {};
  ['province_id','province_name','district_id','district_name','town_id','town_name','area','landmark','address'].forEach(function(key) {
    var value = _normalizeString(location[key] || location[key.replace(/_([a-z])/g, function(_, letter) { return letter.toUpperCase(); })]);
    if (value) safe[key] = value;
  });
  return { shopId: normalizeShopId_(shop.id || shop.shopId), displayName: _normalizeString(shop.name || shop.displayName), status: shop.status === 'inactive' ? 'inactive' : 'active', isPrimary: shop.isPrimary === true, location: safe, hoursStatus: 'unverified', sourceRevision: _normalizeString(shop.updatedAt || shop.createdAt || '') };
}

function getNcpcExtraHeaders_() {
  const raw = normalizeSetupPropertyValue_(PropertiesService.getScriptProperties().getProperty('NCPC_EXTRA_HEADERS_JSON'));
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  const headers = {};
  Object.keys(parsed || {}).forEach(function(key) {
    const cleanKey = normalizeSetupPropertyValue_(key);
    const cleanValue = parsed[key];
    if (cleanKey && typeof cleanValue === 'string') headers[cleanKey] = cleanValue;
  });
  return headers;
}

function getNcpcConnectionConfig_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = normalizeSetupPropertyValue_(props.getProperty('NCPC_BASE_URL')).replace(/\/+$/, '');
  const token = normalizeSetupPropertyValue_(props.getProperty('NCPC_API_TOKEN'));
  const timeoutMs = Math.max(1000, Math.min(30000, Number(normalizeSetupPropertyValue_(props.getProperty('NCPC_TIMEOUT_MS')) || 7000)));
  return {
    baseUrl: baseUrl,
    token: token,
    apiVersion: normalizeSetupPropertyValue_(props.getProperty('NCPC_API_VERSION')) || 'v1',
    timeoutMs: timeoutMs,
    headers: getNcpcExtraHeaders_(),
    businessId: normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_BUSINESS_ID')) || normalizeSetupPropertyValue_(props.getProperty('NTHEEMBA_BUSINESS_ID')) || normalizeSetupPropertyValue_(props.getProperty('TRADEFLOW_CLIENT_ID'))
  };
}

function setupNcpcTokenBeforeFirstTimeSetup(options) {
  options = options || {};
  const props = PropertiesService.getScriptProperties();
  const baseUrl = normalizeSetupPropertyValue_(options.ncpcBaseUrl || props.getProperty('NCPC_BASE_URL')).replace(/\/+$/, '');
  const provisioningToken = normalizeSetupPropertyValue_(options.provisioningToken || props.getProperty('NCPC_PROVISIONING_TOKEN'));
  const businessId = normalizeSetupPropertyValue_(options.businessId || props.getProperty('TRADEFLOW_BUSINESS_ID') || props.getProperty('NTHEEMBA_BUSINESS_ID') || props.getProperty('TRADEFLOW_CLIENT_ID'));
  const rawClientId = normalizeSetupPropertyValue_(options.clientId || props.getProperty('NCPC_CLIENT_ID'));
  const clientId = normalizeNcpcClientId_(rawClientId, 'tradeflow:' + businessId);
  const apiVersion = normalizeSetupPropertyValue_(options.apiVersion || props.getProperty('NCPC_API_VERSION')) || 'v1';
  const timeoutMs = Math.max(1000, Math.min(30000, Number(normalizeSetupPropertyValue_(options.timeoutMs || props.getProperty('NCPC_TIMEOUT_MS')) || 7000)));
  const rotate = options.rotate === true || normalizeSetupPropertyValue_(props.getProperty('NCPC_PROVISIONING_ROTATE')).toLowerCase() === 'true';
  const removeProvisioningToken = options.removeProvisioningToken !== false;

  logNcpcSetupProbe_('TOKEN_SETUP_START', {
    baseUrlConfigured: !!baseUrl,
    provisioningTokenConfigured: !!provisioningToken,
    businessIdConfigured: !!businessId,
    clientId: clientId,
    apiVersion: apiVersion,
    timeoutMs: timeoutMs,
    rotate: rotate
  });

  if (!isValidSetupHttpsUrl_(baseUrl)) throw new Error('NCPC_BASE_URL must be an HTTPS URL before token setup.');
  if (!provisioningToken) throw new Error('NCPC_PROVISIONING_TOKEN is required temporarily before token setup.');
  if (!businessId) throw new Error('TRADEFLOW_BUSINESS_ID or TRADEFLOW_CLIENT_ID is required before token setup.');

  const headers = Object.assign({}, getNcpcExtraHeaders_(), {
    Authorization: 'Bearer ' + provisioningToken,
    'X-Request-ID': 'tf-ncpc-token-setup-' + Utilities.getUuid()
  });
  const payload = {
    business_id: businessId,
    client_id: clientId,
    rotate: rotate
  };
  const startedAt = Date.now();
  const response = UrlFetchApp.fetch(baseUrl + '/v1/admin/clients/tradeflow', {
    method: 'post',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  });
  const statusCode = response.getResponseCode();
  const bodyText = response.getContentText() || '';
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch (parseError) {}
  const data = body && body.data ? body.data : {};
  if (statusCode !== 201 || !body || body.success !== true || !data.token) {
    logNcpcSetupProbe_('TOKEN_SETUP_FAILED', {
      statusCode: statusCode,
      durationMs: Date.now() - startedAt,
      requestId: headers['X-Request-ID'],
      response: body ? { version: body.version, success: body.success, error: body.error || null, dataSummary: summarizeNcpcProbeData_(body.data) } : { raw: bodyText.slice(0, 300) }
    });
    throw new Error('NCPC token setup failed. Check provisioning token/admin scope. Request ID: ' + headers['X-Request-ID']);
  }

  props.setProperties({
    TRADEFLOW_BUSINESS_ID: data.business_id || businessId,
    NCPC_ENABLED: 'true',
    NCPC_API_VERSION: apiVersion,
    NCPC_TIMEOUT_MS: String(timeoutMs),
    NCPC_BASE_URL: baseUrl,
    NCPC_CLIENT_ID: data.client_id || clientId,
    NCPC_API_TOKEN: data.token
  }, false);
  if (!props.getProperty('NCPC_EXTRA_HEADERS_JSON')) props.setProperty('NCPC_EXTRA_HEADERS_JSON', '{}');
  if (removeProvisioningToken) {
    props.deleteProperty('NCPC_PROVISIONING_TOKEN');
    props.deleteProperty('NCPC_PROVISIONING_ROTATE');
  }

  const result = {
    ok: true,
    statusCode: statusCode,
    durationMs: Date.now() - startedAt,
    requestId: headers['X-Request-ID'],
    businessId: data.business_id || businessId,
    clientId: data.client_id || clientId,
    scopes: data.scopes || [],
    tokenSaved: true,
    provisioningTokenRemoved: removeProvisioningToken,
    nextFunction: 'testNcpcConnectionBeforeFirstTimeSetupPretty'
  };
  logNcpcSetupProbe_('TOKEN_SETUP_SAVED', result);
  return result;
}

function setupNcpcTokenBeforeFirstTimeSetupPretty(options) {
  return JSON.stringify(setupNcpcTokenBeforeFirstTimeSetup(options || {}), null, 2);
}

function setupAndTestNcpcBeforeFirstTimeSetup(options) {
  const setup = setupNcpcTokenBeforeFirstTimeSetup(options || {});
  const test = testNcpcConnectionBeforeFirstTimeSetup(options && options.testOptions ? options.testOptions : {});
  return { ok: setup.ok === true && test.ok === true, setup: setup, test: test };
}

function setupAndTestNcpcBeforeFirstTimeSetupPretty(options) {
  return JSON.stringify(setupAndTestNcpcBeforeFirstTimeSetup(options || {}), null, 2);
}

function ncpcProbeRequest_(config, step) {
  const headers = Object.assign({}, config.headers || {}, step.auth === false ? {} : { Authorization: 'Bearer ' + config.token });
  headers['X-Request-ID'] = step.requestId || ('tf-ncpc-probe-' + Utilities.getUuid());
  const options = {
    method: step.method || 'get',
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  };
  if (step.payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(step.payload);
  }
  const startedAt = Date.now();
  try {
    const response = UrlFetchApp.fetch(config.baseUrl + step.path, options);
    const bodyText = response.getContentText() || '';
    let body = null;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch (parseError) {}
    const statusCode = response.getResponseCode();
    const ok = (step.expectedStatus || [200]).indexOf(statusCode) >= 0 && (!step.expectSuccess || (body && body.success === true));
    return {
      name: step.name,
      group: step.group,
      method: String(options.method || 'get').toUpperCase(),
      path: step.path,
      expected: step.expected,
      statusCode: statusCode,
      ok: ok,
      durationMs: Date.now() - startedAt,
      requestId: headers['X-Request-ID'],
      response: body ? {
        version: body.version,
        success: body.success,
        error: body.error || null,
        dataSummary: summarizeNcpcProbeData_(body.data)
      } : { raw: bodyText.slice(0, 300) }
    };
  } catch (error) {
    return {
      name: step.name,
      group: step.group,
      method: String(options.method || 'get').toUpperCase(),
      path: step.path,
      expected: step.expected,
      statusCode: 0,
      ok: false,
      durationMs: Date.now() - startedAt,
      requestId: headers['X-Request-ID'],
      response: { error: { code: 'FETCH_FAILED', message: String(error && error.message || error) } }
    };
  }
}

function logNcpcSetupProbe_(message, data) {
  try {
    const line = '[TradeFlow NCPC setup test] ' + message + (data === undefined ? '' : ' ' + JSON.stringify(data, null, 2));
    console.log(line);
    Logger.log(line);
  } catch (e) {}
}

function logNcpcSetupProbeStep_(step, index) {
  logNcpcSetupProbe_('STEP ' + (index + 1) + ' - ' + (step.name || 'NCPC probe'), {
    ok: step.ok === true,
    skipped: step.skipped === true,
    group: step.group || '',
    method: step.method || '',
    path: step.path || '',
    statusCode: step.statusCode === undefined ? null : step.statusCode,
    durationMs: step.durationMs === undefined ? null : step.durationMs,
    requestId: step.requestId || '',
    expected: step.expected || '',
    response: step.response || null
  });
}

function summarizeNcpcProbeData_(data) {
  if (!data || typeof data !== 'object') return data === undefined ? null : data;
  if (Array.isArray(data)) return { itemCount: data.length };
  if (Array.isArray(data.candidates)) {
    return {
      candidateCount: data.candidates.length,
      firstCandidate: data.candidates[0] ? {
        ncpcProductId: data.candidates[0].ncpc_product_id,
        ncpcVariantId: data.candidates[0].ncpc_variant_id,
        canonicalName: data.candidates[0].canonical_name,
        matchType: data.candidates[0].match_type
      } : null
    };
  }
  const allowed = {};
  ['service', 'status', 'api_version', 'ncpc_product_id', 'ncpc_variant_id', 'canonical_name', 'variant_name', 'submission_id', 'state', 'business_id', 'business_product_ref', 'review_id'].forEach(function(key) {
    if (data[key] !== undefined) allowed[key] = data[key];
  });
  return Object.keys(allowed).length ? allowed : { keys: Object.keys(data).slice(0, 12) };
}

function firstNcpcProbeCandidate_(result) {
  try {
    const summary = result && result.response && result.response.dataSummary;
    return summary && summary.firstCandidate && summary.firstCandidate.ncpcVariantId ? summary.firstCandidate : null;
  } catch (e) {
    return null;
  }
}

function testNcpcConnectionBeforeFirstTimeSetup(options) {
  options = options || {};
  const allowMutation = options.allowMutation === true;
  const preflight = getTradeFlowSetupPreflight_();
  logNcpcSetupProbe_('START', {
    mode: allowMutation ? 'synthetic_mutating_import_probe' : 'safe_non_mutating_contract_probe',
    setupPreflightReady: preflight.ready === true,
    supportCode: preflight.supportCode
  });
  const result = {
    ok: false,
    mode: allowMutation ? 'synthetic_mutating_import_probe' : 'safe_non_mutating_contract_probe',
    supportCode: preflight.supportCode,
    setupPreflight: preflight.public,
    note: allowMutation
      ? 'This run may create a synthetic pending NCPC submission for import testing.'
      : 'This run does not create NCPC submissions; import APIs are tested with validation/read probes only.',
    steps: []
  };
  if (!preflight.ready) {
    result.summary = { passed: 0, failed: 1, skipped: 0, message: 'Script Properties are not ready; NCPC HTTP tests were not attempted.' };
    logNcpcSetupProbe_('BLOCKED_BY_PREFLIGHT', {
      supportCode: preflight.supportCode,
      setupPreflight: preflight.public,
      summary: result.summary
    });
    logNcpcSetupProbe_('FINAL_REPORT', result);
    return result;
  }

  const config = getNcpcConnectionConfig_();
  const query = normalizeSetupPropertyValue_(options.query) || normalizeSetupPropertyValue_(PropertiesService.getScriptProperties().getProperty('NCPC_TEST_QUERY')) || 'Fanta';
  const businessId = normalizeSetupPropertyValue_(options.businessId) || config.businessId || 'TRADEFLOW-CONNECTION-PROBE';
  result.config = {
    baseUrlConfigured: !!config.baseUrl,
    tokenConfigured: !!config.token,
    apiVersion: config.apiVersion,
    timeoutMs: config.timeoutMs,
    businessIdConfigured: !!config.businessId,
    extraHeadersConfigured: Object.keys(config.headers || {}).length > 0
  };

  result.steps.push(ncpcProbeRequest_(config, {
    name: 'NCPC service health',
    group: 'connection',
    auth: false,
    method: 'get',
    path: '/health',
    expectedStatus: [200],
    expectSuccess: true,
    expected: 'HTTP 200 envelope with service=ncpc and status=ok'
  }));
  const candidates = ncpcProbeRequest_(config, {
    name: 'Catalogue candidate search',
    group: 'catalogue_read',
    method: 'get',
    path: '/v1/catalogue/candidates?query=' + encodeURIComponent(query) + '&limit=3',
    expectedStatus: [200],
    expectSuccess: true,
    expected: 'Authenticated catalogue:read returns candidate envelope'
  });
  result.steps.push(candidates);
  const candidate = firstNcpcProbeCandidate_(candidates);
  if (candidate) {
    result.steps.push(ncpcProbeRequest_(config, {
      name: 'Variant lookup',
      group: 'catalogue_read',
      method: 'get',
      path: '/v1/catalogue/variants/' + encodeURIComponent(candidate.ncpcVariantId),
      expectedStatus: [200],
      expectSuccess: true,
      expected: 'Authenticated variant read returns public identity only'
    }));
    result.steps.push(ncpcProbeRequest_(config, {
      name: 'Variant verify',
      group: 'catalogue_read',
      method: 'post',
      path: '/v1/catalogue/variants/verify',
      payload: { ncpc_product_id: candidate.ncpcProductId, ncpc_variant_id: candidate.ncpcVariantId },
      expectedStatus: [200],
      expectSuccess: true,
      expected: 'Authenticated variant/product pair verification succeeds'
    }));
  } else {
    result.steps.push({ name: 'Variant lookup', group: 'catalogue_read', ok: true, skipped: true, expected: 'Skipped because candidate search returned no variant candidate' });
    result.steps.push({ name: 'Variant verify', group: 'catalogue_read', ok: true, skipped: true, expected: 'Skipped because candidate search returned no variant candidate' });
  }

  result.steps.push(ncpcProbeRequest_(config, {
    name: 'Product import API validation probe',
    group: 'import_contract',
    method: 'post',
    path: '/v1/submissions/products',
    payload: { business_id: businessId, business_product_ref: 'TF-PROBE-PRODUCT', idempotency_key: 'tf-probe-product-' + Utilities.getUuid() },
    expectedStatus: [422],
    expected: 'Route returns INVALID_REQUEST for intentionally incomplete product import payload; no submission is created'
  }));
  result.steps.push(ncpcProbeRequest_(config, {
    name: 'Correction import API permission/readiness probe',
    group: 'import_contract',
    method: 'post',
    path: '/v1/submissions/corrections',
    payload: { business_id: businessId, business_product_ref: 'TF-PROBE-PRODUCT', idempotency_key: 'tf-probe-correction-' + Utilities.getUuid(), ncpc_variant_id: 'VAR-CONNECTION-PROBE', changes: { 'variant.canonical_name': 'Connection Probe' }, evidence: { source: 'tradeflow_setup_probe' } },
    expectedStatus: [404],
    expected: 'With a write-capable token, route reaches service and returns NOT_FOUND for deliberate fake variant; 403 means token lacks submissions:write'
  }));
  result.steps.push(ncpcProbeRequest_(config, {
    name: 'Submission status API probe',
    group: 'import_contract',
    method: 'get',
    path: '/v1/submissions/SUB-CONNECTION-PROBE',
    expectedStatus: [404],
    expected: 'With a read-capable submission token, route returns NOT_FOUND for deliberate fake submission; 403 means token lacks submissions:read'
  }));

  if (allowMutation) {
    result.steps.push(ncpcProbeRequest_(config, {
      name: 'Synthetic product import write probe',
      group: 'import_mutation',
      method: 'post',
      path: '/v1/submissions/products',
      payload: {
        business_id: businessId,
        business_product_ref: 'TF-PROBE-' + Utilities.getUuid().slice(0, 8),
        shop_id: 'setup-probe',
        idempotency_key: 'tf-probe-write-' + Utilities.getUuid(),
        canonical_name: 'TradeFlow NCPC Setup Probe - Do Not Publish',
        variant_name: 'Synthetic connection test',
        brand: 'NDS',
        category: 'Connection Probe',
        source: 'tradeflow_setup_probe',
        exposure_preference: 'private'
      },
      expectedStatus: [201],
      expectSuccess: true,
      expected: 'Creates a synthetic pending NCPC submission; use only in approved staging'
    }));
  }

  const passed = result.steps.filter(function(step) { return step.ok === true && step.skipped !== true; }).length;
  const skipped = result.steps.filter(function(step) { return step.skipped === true; }).length;
  const failed = result.steps.length - passed - skipped;
  result.summary = { passed: passed, failed: failed, skipped: skipped };
  result.ok = failed === 0;
  result.steps.forEach(function(step, index) {
    logNcpcSetupProbeStep_(step, index);
  });
  logNcpcSetupProbe_('SUMMARY', result.summary);
  logNcpcSetupProbe_('FINAL_REPORT', result);
  return result;
}

function testNcpcConnectionBeforeFirstTimeSetupPretty(options) {
  return JSON.stringify(testNcpcConnectionBeforeFirstTimeSetup(options || {}), null, 2);
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
    var captureUrl = getCaptureRuntimeUrl();
    if (!captureUrl) throw new Error('CAPTURE_RUNTIME_URL Script Property is required for barcode scanning.');
    var captureOutput = HtmlService.createHtmlOutput(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>NDS Capture Runtime</title><script>location.replace(' + JSON.stringify(captureUrl) + ');</script>' +
        '<p><a href="' + captureUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">Open NDS Capture Runtime</a></p>')
      .setTitle('NDS Capture Runtime Redirect')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
  const setupPreflight = getTradeFlowSetupPreflight_();
  return {
    captureRuntimeUrl: config.captureRuntimeUrl,
    setup: setupPreflight.public,
    centralCatalogue: {
      enabled: setupPreflight.ncpc.enabled,
      ready: setupPreflight.ncpc.ready,
      apiVersion: setupPreflight.ncpc.apiVersion,
      baseUrlConfigured: setupPreflight.ncpc.baseUrlConfigured,
      extraHeadersConfigured: setupPreflight.ncpc.extraHeadersConfigured
    },
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

function normalizeStandardLocationCatalogue_(catalogue, source) {
  catalogue = catalogue && typeof catalogue === 'object' ? catalogue : {};

  function normalizeSuggestionList_(rows) {
    const seen = {};
    return (Array.isArray(rows) ? rows : []).map(function(row) {
      return _normalizeString(row && typeof row === 'object' ? row.name : row);
    }).filter(function(name) {
      const key = name.toLowerCase();
      if (!name || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  return {
    country: _normalizeString(catalogue.country) || 'Zambia',
    country_code: _normalizeString(catalogue.country_code || catalogue.countryCode) || 'ZM',
    version: _normalizeString(catalogue.version) || TF_STANDARD_LOCATION_CATALOGUE_VERSION,
    release: _normalizeString(catalogue.release),
    national_district_coverage: catalogue.national_district_coverage === true,
    source: source || _normalizeString(catalogue.source) || 'unknown',
    ui: {
      province: 'dropdown',
      district: 'dependent_dropdown',
      town: 'dependent_dropdown_with_other',
      town_other_enabled: true,
      area: 'free_text_with_suggestions',
      allow_unlisted_area: true,
      area_suggestion_priority: ['town.areas', 'district.locality_hints', 'manual']
    },
    provinces: (Array.isArray(catalogue.provinces) ? catalogue.provinces : []).map(function(province) {
      return {
        id: _normalizeString(province.id),
        name: _normalizeString(province.name),
        districts: (Array.isArray(province.districts) ? province.districts : []).map(function(district) {
          return {
            id: _normalizeString(district.id),
            name: _normalizeString(district.name),
            coverage: _normalizeString(district.coverage),
            locality_hints: normalizeSuggestionList_(district.locality_hints || district.localitySuggestions),
            towns: (Array.isArray(district.towns) ? district.towns : []).map(function(town) {
              return {
                id: _normalizeString(town.id),
                name: _normalizeString(town.name),
                aliases: normalizeSuggestionList_(town.aliases),
                areas: normalizeSuggestionList_(town.areas || town.area_suggestions || town.areaSuggestions)
              };
            }).filter(function(town) { return town.id && town.name; })
          };
        }).filter(function(district) { return district.id && district.name; })
      };
    }).filter(function(province) { return province.id && province.name; })
  };
}

function getStandardLocationCatalogue() {
  return {
    ok: true,
    catalogue: normalizeStandardLocationCatalogue_(getEmbeddedStandardLocationCatalogue_(), 'embedded-canonical'),
    embedded: true
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
  Shops: ["Shop ID", "Shop Name", "Spreadsheet ID", "Status", "Primary", "Province ID", "Province", "District ID", "District", "Town ID", "Town", "Other Town", "Area", "Landmark", "Catalogue Version", "Updated At", "Config JSON", "Record JSON"],
  Products: ["Product ID", "Product Name", "Category", "Unit", "Product Type", "Selling Price", "Max Stock", "Barcode", "Updated At", "Record JSON"],
  ProductBarcodes: ["Product ID", "Product Name", "Barcode", "Label", "Kind", "Primary", "Source", "Updated At", "Record JSON"],
  InventoryBatches: ["Batch ID", "Shop ID", "Shop Name", "Product ID", "Product Name", "Restock Event ID", "Restock Date", "Received Date", "Quantity Received", "Quantity Remaining", "Unit Cost", "Selling Price", "Status", "Record JSON"],
  SupplierDeliveries: ["Delivery ID", "Shop ID", "Shop Name", "Date", "Product ID", "Product Name", "Quantity", "Unit Cost", "Source", "Notes", "Recorded By", "Record JSON"],
  RestockOrders: ["Restock Order ID", "Shop ID", "Shop Name", "Date", "Status", "Total Budget", "Notes", "Created By", "Updated At", "Record JSON"],
  RestockOrderItems: ["Restock Order ID", "Shop ID", "Shop Name", "Product ID", "Product Name", "Planned Quantity", "Actual Quantity", "Cost Price", "Receipt Status", "Record JSON"],
  StockAdjustments: ["Adjustment ID", "Shop ID", "Shop Name", "Date", "Product ID", "Quantity", "Reason", "COGS", "Estimated Revenue", "Estimated Margin", "Recorded By", "Record JSON"],
  POSSales: ["Sale ID", "Shop ID", "Shop Name", "Sale Date", "Status", "Payment Method", "Item Count", "Subtotal", "Total", "Recorded By", "Record JSON"],
  POSSaleItems: ["Sale ID", "Line ID", "Shop ID", "Shop Name", "Product ID", "Product Name", "Unit", "Quantity", "Unit Price", "Line Total", "COGS", "Estimated Margin", "Batch Allocation JSON", "Record JSON"],
  CustomerOrders: ["Order ID", "Shop ID", "Shop Name", "Created At", "Status", "Idempotency Key", "Item Count", "Total", "Currency", "Record JSON"],
  CustomerOrderItems: ["Order ID", "Shop ID", "Shop Name", "Product ID", "NCPC Product ID", "NCPC Variant ID", "Product Name", "Quantity", "Selling Price", "Line Total", "Record JSON"],
  HandoverRequests: ["Handover ID", "Shop ID", "Shop Name", "Created At", "Status", "Channel", "Idempotency Key", "Customer Name", "Customer Phone", "Reason", "Record JSON"],
  RevenueEntries: ["Revenue ID", "Date", "Amount", "Category", "Description", "Recorded By", "Record JSON"],
  ExpenseEntries: ["Expense ID", "Date", "Category", "Expense", "Amount", "Notes", "Recorded By", "Record JSON"],
  Staff: ["Staff ID", "Full Name", "Username", "Role", "Status", "Created At", "Record JSON"],
  BusinessSettings: ["Settings ID", "Updated At", "Record JSON"],
  BudgetHeader: ["Budget ID", "Date", "Status", "Total Budget", "Updated At", "Record JSON"],
  BudgetItems: ["Budget ID", "Product ID", "Product Name", "Physical Stock", "Max Stock", "Restock Quantity", "Cost Price", "Total", "Cost Source", "Record JSON"],
  Notifications: ["Notification ID", "Time", "Message", "Read", "User ID", "User Name", "User Role", "Record JSON"],
  CustomUnits: ["Unit ID", "Unit Name", "Record JSON"],
  NcpcProductMappings: ["Local Product ID", "Status", "NCPC Product ID", "NCPC Variant ID", "Suggested NCPC Product ID", "Suggested NCPC Variant ID", "Submission ID", "Submission Status", "Last Status Check At", "Catalogue Version", "Release Version", "Linked/Submitted At", "Linked/Submitted By", "Public For Ntheemba", "Record JSON"],
  NcpcCorrectionRequests: ["Correction Request ID", "Correction ID", "Status", "Local Product ID", "NCPC Product ID", "NCPC Variant ID", "Field", "Previous Value", "Proposed Value", "Source", "Submitted At", "Submitted By", "Record JSON"],
  SyncAudit: ["Operation ID", "Received At", "Device ID", "User ID", "Operation Type", "Entity", "Record ID", "Client Created At"],
  SafeConfig: ["Date Changed", "Portal", "User Name", "Password"],
  AppState: ["Key", "Value", "Updated At"]
};

var EP_PRODUCT_MASTER_WIDTH = 19;
var EP_SALES_LOG_WIDTH = 14;

var TF_NCPC_MAPPING_STATES = {
  NEEDS_LINK: 'NEEDS_LINK',
  MATCH_SUGGESTED: 'MATCH_SUGGESTED',
  LINKED: 'LINKED',
  AWAITING_NCPC_REVIEW: 'AWAITING_NCPC_REVIEW',
  REJECTED: 'REJECTED',
  LINK_STALE: 'LINK_STALE',
  LINK_ERROR: 'LINK_ERROR',
  LOCAL_ONLY: 'LOCAL_ONLY'
};

var TF_STANDARD_MAX_SHOPS = 3;
var TF_STANDARD_DEFAULT_SHOP_ID = 'shop-main';
var TF_STANDARD_LOCATION_CATALOGUE_VERSION = '5.0';
var TF_STANDARD_MULTI_SHOP_READY_KEY = 'TRADEFLOW_STANDARD_MULTI_SHOP_READY_V1';
var TF_STANDARD_CONTROL_SHEET_ID_KEY = 'TRADEFLOW_STANDARD_CONTROL_SHEET_ID_V1';
var TF_STANDARD_SHOP_SHEETS_FOLDER_URL_KEY = 'TRADEFLOW_STANDARD_SHOP_SHEETS_FOLDER_URL';
var TF_STANDARD_SHOP_STATE_SHEET = 'AppState';

var TF_STANDARD_CONTROL_SHEET_DEFS = {
  Shops: ["Shop ID", "Shop Name", "Location", "Spreadsheet ID", "Status", "Primary", "Config JSON", "Created At", "Updated At", "Location JSON"],
  Users: ["User ID", "Display Name", "Username", "Password Hash", "Role", "Active", "Created At", "Updated At"],
  UserAssignments: ["Assignment ID", "User ID", "Username", "Role", "Shop ID", "Active", "Created At", "Updated At"],
  StaffAssignments: ["Assignment ID", "Staff ID", "Username", "Shop ID", "Active", "Created At", "Updated At"],
  Sessions: ["Session ID", "Token Hash", "User ID", "Username", "Role", "Shop ID", "Expires At", "Revoked", "Created At", "Last Seen At"],
  AuditLog: ["Event ID", "Created At", "Actor", "Action", "Shop ID", "Record JSON"]
};

var TF_STANDARD_FEATURE_DEFAULTS = {
  pos: true, inventory: true, barcode: true, restocking: true, revenue: true, expenses: true, customerOrders: true, reports: true
};

function _normalizeStandardFeatures_(features) {
  var input = features && typeof features === 'object' && !Array.isArray(features) ? features : {};
  var normalized = {};
  Object.keys(TF_STANDARD_FEATURE_DEFAULTS).forEach(function(key) {
    normalized[key] = input[key] === undefined ? TF_STANDARD_FEATURE_DEFAULTS[key] : input[key] === true;
  });
  if (!normalized.inventory) { normalized.restocking = false; normalized.barcode = false; }
  normalized.reports = true;
  return normalized;
}


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

function _openSpreadsheetById_(spreadsheetId) {
  const id = _normalizeString(spreadsheetId);
  if (!id) throw new Error('Spreadsheet ID is required.');
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Spreadsheet ID could not be opened: ' + (e && e.message ? e.message : e));
  }
}

function _appendStandardControlAudit_(control, action, shopId, record) {
  try {
    const sheet = _ensureSheet(control, 'AuditLog', TF_STANDARD_CONTROL_SHEET_DEFS.AuditLog).sheet;
    _appendRow(sheet, [Utilities.getUuid(), new Date(), _safeSheetText_((record && record.actor) || ''), _safeSheetText_(action), _safeSheetText_(shopId || ''), JSON.stringify(record || {})]);
  } catch (e) {}
}

function isStandardMultiShopReady_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(TF_STANDARD_MULTI_SHOP_READY_KEY) === 'true' && !!props.getProperty(TF_STANDARD_CONTROL_SHEET_ID_KEY);
}

function getStandardControlSpreadsheet_() {
  const id = getScriptProperty_(TF_STANDARD_CONTROL_SHEET_ID_KEY);
  if (!id) throw new Error('Standard multi-shop control spreadsheet is not configured.');
  return _openSpreadsheetById_(id);
}

function ensureStandardControlSheets_(control) {
  const ss = control || getStandardControlSpreadsheet_();
  Object.keys(TF_STANDARD_CONTROL_SHEET_DEFS).forEach(function(name) {
    _ensureSheet(ss, name, TF_STANDARD_CONTROL_SHEET_DEFS[name]);
  });
  return ss;
}

function _standardControlRows_(sheetName) {
  const control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  const sheet = control.getSheetByName(sheetName);
  const headers = TF_STANDARD_CONTROL_SHEET_DEFS[sheetName] || [];
  return _getSheetData(sheet, 2, null, headers.length).map(function(row) {
    const record = {};
    headers.forEach(function(header, index) { record[header] = row[index]; });
    return record;
  });
}


function _standardBool_(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function _standardNormalizeBusinessHours_(hours) {
  var days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  var source = Array.isArray(hours) ? hours : [];
  return days.map(function(day) {
    var row = source.find(function(item) { return _normalizeString(item && item.day).toLowerCase() === day.toLowerCase(); }) || {};
    var closed = row.closed === true;
    return {
      day: day,
      open: closed ? '' : (_normalizeString(row.open) || '08:00'),
      close: closed ? '' : (_normalizeString(row.close) || '17:00'),
      closed: closed
    };
  });
}

function _standardUserRows_() {
  if (!isStandardMultiShopReady_()) return [];
  return _standardControlRows_('Users').map(function(row) {
    return {
      userId: _normalizeString(row['User ID']),
      displayName: _normalizeString(row['Display Name']),
      username: _normalizeString(row.Username).toLowerCase(),
      passwordHash: _normalizeString(row['Password Hash']),
      role: _normalizeString(row.Role).toLowerCase(),
      active: _standardBool_(row.Active),
      createdAt: row['Created At'],
      updatedAt: row['Updated At']
    };
  }).filter(function(row) { return row.userId && row.username; });
}

function _standardUserAssignmentRows_() {
  if (!isStandardMultiShopReady_()) return [];
  return _standardControlRows_('UserAssignments').map(function(row) {
    return {
      assignmentId: _normalizeString(row['Assignment ID']),
      userId: _normalizeString(row['User ID']),
      username: _normalizeString(row.Username).toLowerCase(),
      role: _normalizeString(row.Role).toLowerCase(),
      shopId: normalizeShopId_(row['Shop ID']),
      active: _standardBool_(row.Active),
      createdAt: row['Created At'],
      updatedAt: row['Updated At']
    };
  });
}

function _standardFindUserByUsername_(username) {
  var wanted = _normalizeString(username).toLowerCase();
  return _standardUserRows_().find(function(row) { return row.username === wanted; }) || null;
}

function _standardFindUserById_(userId) {
  var wanted = _normalizeString(userId);
  return _standardUserRows_().find(function(row) { return row.userId === wanted; }) || null;
}

function _standardAssignmentForUser_(userId) {
  var wanted = _normalizeString(userId);
  return _standardUserAssignmentRows_().find(function(row) { return row.active && row.userId === wanted; }) || null;
}

function _standardAnyAssignmentForUser_(userId) {
  var wanted = _normalizeString(userId);
  var rows = _standardUserAssignmentRows_().filter(function(row) { return row.userId === wanted; });
  if (!rows.length) return null;
  rows.sort(function(a, b) {
    var aTime = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
    var bTime = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
    return bTime - aTime;
  });
  return rows[0] || null;
}

function _standardUpsertUser_(record) {
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var sheet = control.getSheetByName('Users');
  var headers = TF_STANDARD_CONTROL_SHEET_DEFS.Users;
  var rows = _getSheetData(sheet, 2, null, headers.length);
  var userId = _normalizeString(record.userId) || ('user-' + Utilities.getUuid().slice(0, 12));
  var username = _normalizeString(record.username).toLowerCase();
  if (!username) throw new Error('Username is required.');
  var values = [
    _safeSheetText_(userId), _safeSheetText_(record.displayName || username), _safeSheetText_(username),
    _safeSheetText_(record.passwordHash || ''), _safeSheetText_(_normalizeString(record.role).toLowerCase()),
    record.active !== false, record.createdAt || new Date(), new Date()
  ];
  var match = -1;
  rows.forEach(function(row, index) {
    if (_normalizeString(row[0]) === userId || _normalizeString(row[2]).toLowerCase() === username) match = index + 2;
  });
  if (match > 0) sheet.getRange(match, 1, 1, headers.length).setValues([values]);
  else _appendRow(sheet, values);
  return userId;
}

function _standardUpsertUserAssignment_(userId, username, role, shopId, active) {
  var normalizedShopId = normalizeShopId_(shopId);
  if (!normalizedShopId) return null;
  getStandardShopById_(normalizedShopId);
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var sheet = control.getSheetByName('UserAssignments');
  var headers = TF_STANDARD_CONTROL_SHEET_DEFS.UserAssignments;
  var rows = _getSheetData(sheet, 2, null, headers.length);
  var now = new Date();
  var rowNumber = -1;
  var assignmentId = '';
  rows.forEach(function(row, index) {
    if (_normalizeString(row[1]) === _normalizeString(userId)) { rowNumber = index + 2; assignmentId = _normalizeString(row[0]); }
  });
  var values = [assignmentId || Utilities.getUuid(), _safeSheetText_(userId), _safeSheetText_(username), _safeSheetText_(role), _safeSheetText_(normalizedShopId), active !== false, rowNumber > 0 ? rows[rowNumber - 2][6] || now : now, now];
  if (rowNumber > 0) sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  else _appendRow(sheet, values);
  return normalizedShopId;
}

function _standardSeedControlAccountsFromLegacy_() {
  if (!isStandardMultiShopReady_()) return;
  ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  if (_standardUserRows_().length) return;
  var root = SpreadsheetApp.getActiveSpreadsheet();
  var state = getAppStateInternal_(root);
  var owner = _normalizeString((state.settings || {}).businessOwnerName || state.businessOwnerName) || 'Business Owner';
  var adminUsername = _normalizeString((state.settings || {}).adminPortalUsername) || 'admin';
  var passwordHash = '';
  var safe = root.getSheetByName('SafeConfig');
  if (safe) {
    _getSheetData(safe, 2, null, 4).forEach(function(row) {
      if (_normalizeString(row[1]) === 'admin') { adminUsername = _normalizeString(row[2]) || adminUsername; passwordHash = _normalizeString(row[3]); }
    });
  }
  var superId = _standardUpsertUser_({ userId: 'super-admin', displayName: owner, username: adminUsername, passwordHash: passwordHash, role: 'super_admin', active: true });
  listStandardShopSources_().forEach(function(shop) {
    try {
      var shopState = getAppStateInternal_(getStandardShopSpreadsheet_(shop.id));
      (shopState.staffMembers || []).forEach(function(member) {
        if (!member || member.active === false || member._delete) return;
        var username = _normalizeString(member.username).toLowerCase();
        if (!username || _standardFindUserByUsername_(username)) return;
        var userId = _standardUpsertUser_({ userId: _normalizeString(member.id || member.staffId) || ('staff-' + Utilities.getUuid().slice(0, 12)), displayName: _normalizeString(member.fullName || member.name || username), username: username, passwordHash: _normalizeString(member.password || member.pin), role: 'staff', active: true, createdAt: member.createdAt });
        _standardUpsertUserAssignment_(userId, username, 'staff', shop.id, true);
      });
    } catch (e) {}
  });
  _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.accounts.bootstrap', '', { actor: adminUsername, superAdminUserId: superId });
}

function _standardRecordSession_(token, session) {
  if (!isStandardMultiShopReady_()) return;
  try {
    var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
    var sheet = control.getSheetByName('Sessions');
    var tokenHash = _sessionPropertyKey_(token).replace(EP_SESSION_PREFIX, '');
    _appendRow(sheet, [session.sessionId || Utilities.getUuid(), tokenHash, _safeSheetText_(session.userId || ''), _safeSheetText_(session.username || ''), _safeSheetText_(session.role || ''), _safeSheetText_(session.shopId || ''), new Date(Number(session.expiresAt || Date.now())), false, new Date(), new Date()]);
  } catch (e) {}
}

function _standardTouchSession_(token, session, revoked) {
  if (!isStandardMultiShopReady_()) return;
  try {
    var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
    var sheet = control.getSheetByName('Sessions');
    var headers = TF_STANDARD_CONTROL_SHEET_DEFS.Sessions;
    var tokenHash = _sessionPropertyKey_(token).replace(EP_SESSION_PREFIX, '');
    var rows = _getSheetData(sheet, 2, null, headers.length);
    for (var i = rows.length - 1; i >= 0; i--) {
      if (_normalizeString(rows[i][1]) === tokenHash) {
        sheet.getRange(i + 2, 8).setValue(revoked === true);
        sheet.getRange(i + 2, 10).setValue(new Date());
        return;
      }
    }
  } catch (e) {}
}

function listStandardShopSources_() {
  if (!isStandardMultiShopReady_()) return [];
  return _standardControlRows_('Shops').map(function(row) {
    var config = {};
    var location = {};
    try { config = JSON.parse(row['Config JSON'] || '{}'); } catch (e) { config = {}; }
    try { location = JSON.parse(row['Location JSON'] || '{}'); } catch (e) { location = {}; }
    if (!location || typeof location !== 'object' || Array.isArray(location)) location = {};
    var spreadsheetId = _normalizeString(row['Spreadsheet ID']);
    if (!location.provinceName && !location.districtName && !location.townName && spreadsheetId) {
      try {
        var shopState = getAppStateInternal_(_openSpreadsheetById_(spreadsheetId));
        var localShop = (shopState.shops || [])[0] || {};
        location = normalizeShopLocation_(localShop.location || (shopState.settings || {}).shopLocation || {});
      } catch (e) {}
    }
    return {
      id: normalizeShopId_(row['Shop ID']),
      shopId: normalizeShopId_(row['Shop ID']),
      name: _normalizeString(row['Shop Name']) || 'Shop',
      location: normalizeShopLocation_(location),
      locationLabel: _normalizeString(row.Location),
      spreadsheetId: spreadsheetId,
      status: _normalizeString(row.Status) || 'active',
      isPrimary: row.Primary === true || String(row.Primary).toLowerCase() === 'true',
      config: config
    };
  }).filter(function(shop) { return shop.id && shop.status !== 'deleted'; });
}

function getStandardShopById_(shopId) {
  var normalized = normalizeShopId_(shopId);
  var shops = listStandardShopSources_();
  if (!normalized && shops.length) {
    var primary = shops.find(function(shop) { return shop.isPrimary && shop.status !== 'inactive'; }) || shops[0];
    normalized = primary.id;
  }
  var shop = shops.find(function(item) { return item.id === normalized && item.status !== 'inactive'; });
  if (!shop) throw new Error('Shop is not configured or inactive.');
  return shop;
}

function getStandardShopSpreadsheet_(shopId) {
  if (!isStandardMultiShopReady_()) return SpreadsheetApp.getActiveSpreadsheet();
  var shop = getStandardShopById_(shopId);
  if (!shop.spreadsheetId) throw new Error('Shop spreadsheet is missing for ' + shop.name + '.');
  return _openSpreadsheetById_(shop.spreadsheetId);
}

function getStandardShopSheetsFolder_() {
  var value = getScriptProperty_(TF_STANDARD_SHOP_SHEETS_FOLDER_URL_KEY);
  if (!value) return null;
  var match = String(value).match(/[-\w]{20,}/);
  if (!match) throw new Error('Shop sheets folder URL or ID is invalid.');
  try {
    return DriveApp.getFolderById(match[0]);
  } catch (e) {
    throw new Error('Shop sheets folder could not be opened: ' + (e && e.message ? e.message : e));
  }
}

function createStandardShopSpreadsheet_(businessName, shop) {
  var name = [businessName || 'TradeFlow Standard', shop.name || shop.id, 'Shop Sheet'].filter(Boolean).join(' - ');
  var ss = SpreadsheetApp.create(name);
  var folder = getStandardShopSheetsFolder_();
  if (folder) {
    try {
      var file = DriveApp.getFileById(ss.getId());
      folder.addFile(file);
      try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}
    } catch (e) {}
  }
  return ss;
}

function normalizeStandardSetupShops_(shops, businessName, owner) {
  var raw = Array.isArray(shops) ? shops : [];
  if (!raw.length) raw = [{ name: businessName || 'Main Shop', isPrimary: true }];
  if (raw.length > TF_STANDARD_MAX_SHOPS) throw new Error('Standard TradeFlow setup supports a maximum of three shops.');
  var byId = {};
  var requestedPrimary = raw.findIndex(function(shop) { return shop && (shop.isPrimary === true || shop.primary === true); });
  if (requestedPrimary < 0) requestedPrimary = 0;
  var normalized = raw.map(function(shop, index) {
    shop = shop && typeof shop === 'object' ? shop : {};
    var id = normalizeShopId_(shop.id || shop.shopId || (index === 0 ? TF_STANDARD_DEFAULT_SHOP_ID : 'shop-' + (index + 1)));
    if (!id) throw new Error('Shop ID is required.');
    if (byId[id]) throw new Error('Duplicate shop ID: ' + id);
    byId[id] = true;
    return {
      id: id,
      shopId: id,
      branchId: id,
      name: _normalizeString(shop.name || shop.shopName) || (index === 0 ? (businessName || 'Main Shop') : 'Shop ' + (index + 1)),
      status: 'active',
      isPrimary: index === requestedPrimary,
      spreadsheetId: _normalizeString(shop.spreadsheetId),
      config: {
        managerName: _normalizeString((shop.config && shop.config.managerName) || shop.managerName || owner.name),
        whatsapp: _normalizeString((shop.config && shop.config.whatsapp) || shop.whatsapp || owner.whatsapp),
        email: _normalizeString((shop.config && shop.config.email) || shop.email || owner.email),
        receiptPrefix: _normalizeString((shop.config && shop.config.receiptPrefix) || shop.receiptPrefix || ('SHOP' + (index + 1))).slice(0, 16),
        notes: _normalizeString((shop.config && shop.config.notes) || shop.notes),
        businessHours: _standardNormalizeBusinessHours_((shop.config && (shop.config.businessHours || shop.config.openingHours)) || shop.businessHours || shop.openingHours),
        staffCanSwitchShops: false
      },
      location: canonicalizeStandardShopLocation_(shop.location || shop.shopLocation || {})
    };
  });
  if (!normalized.some(function(shop) { return shop.isPrimary; })) normalized[0].isPrimary = true;
  return normalized;
}

function buildStandardShopState_(baseState, shop) {
  var state = JSON.parse(JSON.stringify(baseState || _getDefaultState()));
  state.shops = [shop];
  state.activeShopId = shop.id;
  state.settings = Object.assign({}, state.settings || {}, {
    activeShopId: shop.id,
    shopLocation: shop.location || {},
    setupCompleted: true
  });
  state.products = [];
  state.sales = [];
  state.revenue = [];
  state.expenses = [];
  state.restockOrders = [];
  state.customerOrders = [];
  state.handoverRequests = [];
  state.ncpcCorrectionRequests = [];
  state.stockEntries = [];
  state.stockAdjustments = [];
  state.notifications = [];
  return state;
}

function setupStandardMultiShopSourceModel_(baseState, shops, actor) {
  var control = SpreadsheetApp.create((baseState.businessName || 'TradeFlow Standard') + ' - Control');
  ensureStandardControlSheets_(control);
  var now = new Date();
  var created = shops.map(function(shop) {
    var shopSheet = shop.spreadsheetId ? _openSpreadsheetById_(shop.spreadsheetId) : createStandardShopSpreadsheet_(baseState.businessName, shop);
    shop.spreadsheetId = shopSheet.getId();
    _ensureAllSheets(shopSheet);
    saveAppStateInternal_(buildStandardShopState_(baseState, shop), shopSheet);
    return shop;
  });
  var controlShopSheet = control.getSheetByName('Shops');
  created.forEach(function(shop) {
    _appendRow(controlShopSheet, [
      _safeSheetText_(shop.id),
      _safeSheetText_(shop.name),
      _safeSheetText_([
        (shop.location || {}).provinceName,
        (shop.location || {}).districtName,
        (shop.location || {}).townName,
        (shop.location || {}).area
      ].filter(Boolean).join(', ')),
      _safeSheetText_(shop.spreadsheetId),
      _safeSheetText_(shop.status || 'active'),
      shop.isPrimary === true,
      JSON.stringify(shop.config || {}),
      now,
      now,
      JSON.stringify(normalizeShopLocation_(shop.location || {}))
    ]);
  });
  _appendStandardControlAudit_(control, 'standard.multishop.setup', '', { actor: actor || '', shopCount: created.length });
  var props = PropertiesService.getScriptProperties();
  props.setProperty(TF_STANDARD_CONTROL_SHEET_ID_KEY, control.getId());
  props.setProperty(TF_STANDARD_MULTI_SHOP_READY_KEY, 'true');
  return { controlSpreadsheetId: control.getId(), shops: created };
}

function syncStandardStaffAssignments_(state) {
  if (!isStandardMultiShopReady_()) return;
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var sheet = control.getSheetByName('StaffAssignments');
  var headers = TF_STANDARD_CONTROL_SHEET_DEFS.StaffAssignments;
  var rows = _getSheetData(sheet, 2, null, headers.length);
  var existingByStaff = {};
  rows.forEach(function(row, index) {
    var staffId = _normalizeString(row[1]) || _normalizeString(row[2]).toLowerCase();
    if (staffId) existingByStaff[staffId] = index + 2;
  });
  var now = new Date();
  (state.staffMembers || []).forEach(function(member) {
    var staffId = _normalizeString(member.id || member.staffId || member.username);
    if (!staffId) return;
    var shopId = normalizeShopId_(member.shopId || state.activeShopId);
    if (!shopId) return;
    var values = [
      _normalizeString(member.assignmentId) || Utilities.getUuid(),
      _safeSheetText_(staffId),
      _safeSheetText_(member.username || ''),
      _safeSheetText_(shopId),
      member.status !== 'inactive',
      member.createdAt || now,
      now
    ];
    if (existingByStaff[staffId]) sheet.getRange(existingByStaff[staffId], 1, 1, headers.length).setValues([values]);
    else _appendRow(sheet, values);
    var username = _normalizeString(member.username).toLowerCase();
    if (username) {
      var controlUser = _standardFindUserByUsername_(username);
      var userId = controlUser ? controlUser.userId : _standardUpsertUser_({ userId: staffId, displayName: _normalizeString(member.fullName || member.name || username), username: username, passwordHash: _normalizeString(member.password || member.pin), role: 'staff', active: member.active !== false && member.status !== 'inactive', createdAt: member.createdAt });
      _standardUpsertUserAssignment_(userId, username, 'staff', shopId, member.active !== false && member.status !== 'inactive');
    }
  });
}

function _getStandardStaffAssignment_(session) {
  if (!session || session.role !== 'staff' || !isStandardMultiShopReady_()) return null;
  var username = _normalizeString(session.username).toLowerCase();
  return _standardControlRows_('StaffAssignments').map(function(row) {
    return {
      assignmentId: _normalizeString(row['Assignment ID']),
      staffId: _normalizeString(row['Staff ID']),
      username: _normalizeString(row.Username).toLowerCase(),
      shopId: normalizeShopId_(row['Shop ID']),
      active: row.Active === true || String(row.Active).toLowerCase() === 'true'
    };
  }).find(function(row) {
    return row.active && row.shopId && (row.username === username || row.staffId.toLowerCase() === username);
  }) || null;
}

function resolveStandardSessionShopId_(session, requestedShopId) {
  var requested = normalizeShopId_(requestedShopId);
  if (!isStandardMultiShopReady_()) return requested || TF_STANDARD_DEFAULT_SHOP_ID;
  if (session && (session.role === 'staff' || session.role === 'admin')) {
    var assignment = session.userId ? _standardAssignmentForUser_(session.userId) : null;
    if (!assignment && session.role === 'staff') {
      var legacyAssignment = _getStandardStaffAssignment_(session);
      if (legacyAssignment) assignment = { shopId: legacyAssignment.shopId };
    }
    if (!assignment) throw new Error((session.role === 'staff' ? 'Staff' : 'Admin') + ' account is not assigned to a shop.');
    if (requested && requested !== assignment.shopId) throw new Error((session.role === 'staff' ? 'Staff' : 'Admin') + ' account cannot access another shop.');
    return assignment.shopId;
  }
  return getStandardShopById_(requested || (session && session.shopId)).id;
}

function _standardShopPublicAdminRecord_(shop) {
  shop = shop || {};
  return {
    shopId: normalizeShopId_(shop.id || shop.shopId),
    name: _normalizeString(shop.name),
    status: _normalizeString(shop.status) || 'active',
    primary: shop.isPrimary === true,
    location: normalizeShopLocation_(shop.location || {}),
    config: {
      managerName: _normalizeString((shop.config || {}).managerName),
      whatsapp: _normalizeString((shop.config || {}).whatsapp),
      email: _normalizeString((shop.config || {}).email),
      receiptPrefix: _normalizeString((shop.config || {}).receiptPrefix),
      notes: _normalizeString((shop.config || {}).notes),
      businessHours: _standardNormalizeBusinessHours_((shop.config || {}).businessHours || (shop.config || {}).openingHours)
    }
  };
}

function getStandardMultiShopAdminContext(sessionToken) {
  requirePortalSession_(sessionToken, 'super_admin');
  if (!isStandardMultiShopReady_()) {
    var legacyState = getAppStateInternal_();
    return { ok: true, requiresMigration: true, maxShops: TF_STANDARD_MAX_SHOPS, shops: normalizeShops_(legacyState).map(_standardShopPublicAdminRecord_), staffAssignments: [] };
  }
  var shops = listStandardShopSources_().filter(function(shop) { return shop.status !== 'deleted'; });
  return {
    ok: true,
    requiresMigration: false,
    maxShops: TF_STANDARD_MAX_SHOPS,
    shops: shops.map(_standardShopPublicAdminRecord_),
    staffAssignments: _standardControlRows_('StaffAssignments').map(function(row) {
      return { staffId: _normalizeString(row['Staff ID']), username: _normalizeString(row.Username), shopId: normalizeShopId_(row['Shop ID']), active: row.Active === true || String(row.Active).toLowerCase() === 'true' };
    }).filter(function(row) { return row.active; })
  };
}

function _buildStandardShopStateFromLegacy_(legacyState, shop, primaryShopId) {
  var state = JSON.parse(JSON.stringify(legacyState || _getDefaultState()));
  var shopId = normalizeShopId_(shop.id || shop.shopId);
  var primaryId = normalizeShopId_(primaryShopId || TF_STANDARD_DEFAULT_SHOP_ID);
  function belongs(row) {
    var rowShopId = normalizeShopId_(row && row.shopId);
    return rowShopId ? rowShopId === shopId : shopId === primaryId;
  }
  state.shops = [shop];
  state.activeShopId = shopId;
  state.settings = Object.assign({}, state.settings || {}, { activeShopId: shopId, shopLocation: shop.location || {}, setupCompleted: true });
  state.products = (legacyState.products || []).filter(function(product) { return product && product._delete !== true && product.active !== false; }).map(function(product) {
    var copy = JSON.parse(JSON.stringify(product));
    copy.batches = (copy.batches || []).filter(belongs).map(function(row) { row.shopId = shopId; row.shopName = shop.name; return row; });
    copy.stockMovements = (copy.stockMovements || []).filter(belongs).map(function(row) {
      row.shopId = shopId; row.shopName = shop.name;
      row.allocation = (row.allocation || []).filter(belongs).map(function(part) { part.shopId = shopId; part.shopName = shop.name; return part; });
      return row;
    });
    return copy;
  });
  ['sales','revenue','expenses','restockOrders','customerOrders','handoverRequests','stockEntries','stockAdjustments','notifications'].forEach(function(key) {
    state[key] = (legacyState[key] || []).filter(belongs).map(function(row) { var copy = JSON.parse(JSON.stringify(row)); copy.shopId = shopId; copy.shopName = shop.name; return copy; });
  });
  state.ncpcCorrectionRequests = (legacyState.ncpcCorrectionRequests || []).filter(function(row) { return belongs(row); }).map(function(row) { return JSON.parse(JSON.stringify(row)); });
  state.staffMembers = (legacyState.staffMembers || []).filter(function(member) {
    var assigned = normalizeShopId_(member && (member.shopId || member.assignedShopId || member.shop_id));
    return assigned ? assigned === shopId : shopId === primaryId;
  }).map(function(member) { var copy = JSON.parse(JSON.stringify(member)); copy.shopId = shopId; copy.shopName = shop.name; return copy; });
  var budget = legacyState.activeBudget && typeof legacyState.activeBudget === 'object' ? JSON.parse(JSON.stringify(legacyState.activeBudget)) : { id: Number(legacyState.nextId || 1000) + 1, date: _formatDate(new Date()), items: [], status: 'draft', totalBudget: 0 };
  var budgetShopId = normalizeShopId_(budget.shopId);
  if ((budgetShopId && budgetShopId !== shopId) || (!budgetShopId && shopId !== primaryId)) budget = { id: Number(legacyState.nextId || 1000) + 1, date: _formatDate(new Date()), items: [], status: 'draft', totalBudget: 0, shopId: shopId, shopName: shop.name };
  else { budget.shopId = shopId; budget.shopName = shop.name; budget.items = (budget.items || []).filter(function(item) { var id = normalizeShopId_(item && item.shopId); return !id || id === shopId; }).map(function(item) { item.shopId = shopId; item.shopName = shop.name; return item; }); }
  state.activeBudget = budget;
  state._meta = Object.assign({}, state._meta || {}, { migratedToStandardMultiShopAt: new Date().toISOString(), shopId: shopId });
  return state;
}

function migrateStandardLegacyWorkspaceToMultiShop(sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  var control = null;
  var createdFiles = [];
  try {
    if (isStandardMultiShopReady_()) return getStandardMultiShopAdminContext(sessionToken);
    var legacyState = getAppStateInternal_();
    var shops = normalizeShops_(legacyState).slice(0, TF_STANDARD_MAX_SHOPS);
    if (!shops.length) shops = [getDefaultShop_(legacyState)];
    var primary = shops.find(function(shop) { return shop.isPrimary && shop.status !== 'inactive'; }) || shops[0];
    control = SpreadsheetApp.create((legacyState.businessName || (legacyState.settings || {}).businessName || 'TradeFlow Standard') + ' - Control');
    createdFiles.push(control.getId());
    ensureStandardControlSheets_(control);
    var prepared = [];
    shops.forEach(function(shop) {
      var ss = createStandardShopSpreadsheet_(legacyState.businessName || (legacyState.settings || {}).businessName || 'TradeFlow Standard', shop);
      createdFiles.push(ss.getId());
      shop.spreadsheetId = ss.getId();
      var shopState = _buildStandardShopStateFromLegacy_(legacyState, shop, primary.id);
      _ensureAllSheets(ss);
      saveAppStateInternal_(shopState, ss);
      prepared.push({ shop: shop, state: shopState });
    });
    var now = new Date();
    var shopSheet = control.getSheetByName('Shops');
    prepared.forEach(function(item) {
      var shop = item.shop;
      _appendRow(shopSheet, [_safeSheetText_(shop.id), _safeSheetText_(shop.name), _safeSheetText_(standardShopLocationLabel_(shop.location)), _safeSheetText_(shop.spreadsheetId), _safeSheetText_(shop.status || 'active'), shop.isPrimary === true, JSON.stringify(shop.config || {}), now, now, JSON.stringify(normalizeShopLocation_(shop.location || {}))]);
    });
    var props = PropertiesService.getScriptProperties();
    props.setProperty(TF_STANDARD_CONTROL_SHEET_ID_KEY, control.getId());
    props.setProperty(TF_STANDARD_MULTI_SHOP_READY_KEY, 'true');
    prepared.forEach(function(item) { syncStandardStaffAssignments_(item.state); });
    _appendStandardControlAudit_(control, 'standard.multishop.migrate', primary.id, { actor: session.username || 'admin', shopCount: prepared.length, legacyRootPreserved: true });
    return getStandardMultiShopAdminContext(sessionToken);
  } catch (error) {
    if (!isStandardMultiShopReady_()) {
      createdFiles.reverse().forEach(function(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} });
      PropertiesService.getScriptProperties().deleteProperty(TF_STANDARD_CONTROL_SHEET_ID_KEY);
      PropertiesService.getScriptProperties().deleteProperty(TF_STANDARD_MULTI_SHOP_READY_KEY);
    }
    throw error;
  } finally { lock.releaseLock(); }
}

function _findStandardControlShopRow_(shopId) {
  var wanted = normalizeShopId_(shopId);
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var sheet = control.getSheetByName('Shops');
  var headers = TF_STANDARD_CONTROL_SHEET_DEFS.Shops;
  var rows = _getSheetData(sheet, 2, null, headers.length);
  for (var i = 0; i < rows.length; i++) {
    if (normalizeShopId_(rows[i][0]) === wanted) return { control: control, sheet: sheet, rowNumber: i + 2, values: rows[i], headers: headers };
  }
  throw new Error('Shop is not configured.');
}

function createStandardManagedShop(input, sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  if (!isStandardMultiShopReady_()) throw new Error('Complete Standard multi-shop setup first.');
  var existing = listStandardShopSources_().filter(function(shop) { return shop.status !== 'deleted'; });
  if (existing.length >= TF_STANDARD_MAX_SHOPS) throw new Error('Standard TradeFlow supports a maximum of three shops.');
  input = input && typeof input === 'object' ? input : {};
  var name = _normalizeString(input.name);
  if (!name) throw new Error('Shop name is required.');
  var idBase = normalizeShopId_(input.shopId || ('shop-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))).slice(0, 48);
  var id = idBase || ('shop-' + Utilities.getUuid().slice(0, 8));
  var suffix = 2;
  while (listStandardShopSources_().some(function(shop) { return shop.id === id; })) id = (idBase || 'shop') + '-' + (suffix++);
  var location = canonicalizeStandardShopLocation_(input.location || {});
  var shop = normalizeShopRecord_({
    id: id, name: name, status: 'active', isPrimary: existing.length === 0,
    config: {
      managerName: _normalizeString((input.config || {}).managerName),
      whatsapp: _normalizeString((input.config || {}).whatsapp),
      email: _normalizeString((input.config || {}).email),
      receiptPrefix: _normalizeString((input.config || {}).receiptPrefix || id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)),
      notes: _normalizeString((input.config || {}).notes),
      businessHours: _standardNormalizeBusinessHours_((input.config || {}).businessHours || input.businessHours),
      staffCanSwitchShops: false
    },
    location: location
  }, {});
  var rootState = getAppStateInternal_();
  var ss = createStandardShopSpreadsheet_(rootState.businessName || (rootState.settings || {}).businessName || 'TradeFlow Standard', shop);
  try {
    shop.spreadsheetId = ss.getId();
    _ensureAllSheets(ss);
    saveAppStateInternal_(buildStandardShopState_(rootState, shop), ss);
    var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
    var sheet = control.getSheetByName('Shops');
    var now = new Date();
    _appendRow(sheet, [
      _safeSheetText_(shop.id), _safeSheetText_(shop.name), _safeSheetText_(standardShopLocationLabel_(location)), _safeSheetText_(shop.spreadsheetId),
      'active', shop.isPrimary === true, JSON.stringify(shop.config || {}), now, now, JSON.stringify(location)
    ]);
    _appendStandardControlAudit_(control, 'standard.shop.create', shop.id, { actor: session.username || 'admin', shopName: shop.name });
    return { ok: true, shop: _standardShopPublicAdminRecord_(shop) };
  } catch (error) {
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}
    throw error;
  }
}

function updateStandardManagedShop(shopId, input, sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  var found = _findStandardControlShopRow_(shopId);
  input = input && typeof input === 'object' ? input : {};
  var current = getStandardShopById_(shopId);
  var name = _normalizeString(input.name) || current.name;
  var location = canonicalizeStandardShopLocation_(input.location || current.location || {});
  var cfg = Object.assign({}, current.config || {}, input.config || {});
  cfg.receiptPrefix = _normalizeString(cfg.receiptPrefix || current.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)).slice(0, 16);
  cfg.businessHours = _standardNormalizeBusinessHours_(cfg.businessHours || cfg.openingHours);
  cfg.staffCanSwitchShops = false;
  var now = new Date();
  found.sheet.getRange(found.rowNumber, 1, 1, found.headers.length).setValues([[
    current.id, _safeSheetText_(name), _safeSheetText_(standardShopLocationLabel_(location)), current.spreadsheetId,
    current.status || 'active', current.isPrimary === true, JSON.stringify(cfg), found.values[7] || now, now, JSON.stringify(location)
  ]]);
  var ss = getStandardShopSpreadsheet_(current.id);
  var state = getAppStateInternal_(ss);
  var localShop = normalizeShopRecord_({ id: current.id, name: name, status: current.status, isPrimary: current.isPrimary, spreadsheetId: current.spreadsheetId, config: cfg, location: location }, state);
  state.shops = [localShop];
  state.activeShopId = current.id;
  state.settings = Object.assign({}, state.settings || {}, { activeShopId: current.id, shopLocation: location });
  saveAppStateInternal_(state, ss);
  _appendStandardControlAudit_(found.control, 'standard.shop.update', current.id, { actor: session.username || 'admin', shopName: name });
  return { ok: true, shop: _standardShopPublicAdminRecord_(localShop) };
}

function deactivateStandardManagedShop(shopId, sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  var active = listStandardShopSources_().filter(function(shop) { return shop.status !== 'inactive' && shop.status !== 'deleted'; });
  if (active.length <= 1) throw new Error('At least one active shop must remain.');
  var current = getStandardShopById_(shopId);
  if (current.isPrimary) throw new Error('Choose another primary shop before deactivating the primary shop.');
  var found = _findStandardControlShopRow_(shopId);
  found.sheet.getRange(found.rowNumber, 5).setValue('inactive');
  found.sheet.getRange(found.rowNumber, 9).setValue(new Date());
  var assignmentSheet = found.control.getSheetByName('StaffAssignments');
  var assignmentRows = _getSheetData(assignmentSheet, 2, null, TF_STANDARD_CONTROL_SHEET_DEFS.StaffAssignments.length);
  assignmentRows.forEach(function(row, index) {
    if (normalizeShopId_(row[3]) === current.id) {
      assignmentSheet.getRange(index + 2, 5).setValue(false);
      assignmentSheet.getRange(index + 2, 7).setValue(new Date());
    }
  });
  var userAssignmentSheet = found.control.getSheetByName('UserAssignments');
  var userAssignmentRows = _getSheetData(userAssignmentSheet, 2, null, TF_STANDARD_CONTROL_SHEET_DEFS.UserAssignments.length);
  userAssignmentRows.forEach(function(row, index) {
    if (normalizeShopId_(row[4]) === current.id) {
      userAssignmentSheet.getRange(index + 2, 6).setValue(false);
      userAssignmentSheet.getRange(index + 2, 8).setValue(new Date());
      _standardRevokeUserSessions_(_normalizeString(row[1]));
    }
  });
  _appendStandardControlAudit_(found.control, 'standard.shop.deactivate', current.id, { actor: session.username || 'admin' });
  return { ok: true, shopId: current.id };
}

function reactivateStandardManagedShop(shopId, sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  var wanted = normalizeShopId_(shopId);
  var found = _findStandardControlShopRow_(wanted);
  var activeCount = listStandardShopSources_().filter(function(shop) { return shop.status !== 'inactive' && shop.status !== 'deleted'; }).length;
  if (activeCount >= TF_STANDARD_MAX_SHOPS) throw new Error('Standard TradeFlow already has three active shops.');
  found.sheet.getRange(found.rowNumber, 5).setValue('active');
  found.sheet.getRange(found.rowNumber, 9).setValue(new Date());
  _appendStandardControlAudit_(found.control, 'standard.shop.reactivate', wanted, { actor: session.username || 'admin' });
  return { ok: true, shopId: wanted };
}

function reassignStandardStaffShop(usernameOrStaffId, targetShopId, sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  var wanted = _normalizeString(usernameOrStaffId).toLowerCase();
  if (!wanted) throw new Error('Staff account is required.');
  var targetShop = getStandardShopById_(targetShopId);
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var assignmentSheet = control.getSheetByName('StaffAssignments');
  var headers = TF_STANDARD_CONTROL_SHEET_DEFS.StaffAssignments;
  var rows = _getSheetData(assignmentSheet, 2, null, headers.length);
  var rowIndex = -1;
  var assignment = null;
  rows.forEach(function(row, index) {
    if (rowIndex >= 0) return;
    var staffId = _normalizeString(row[1]).toLowerCase();
    var username = _normalizeString(row[2]).toLowerCase();
    if (wanted === staffId || wanted === username) {
      rowIndex = index + 2;
      assignment = { assignmentId: _normalizeString(row[0]) || Utilities.getUuid(), staffId: _normalizeString(row[1]), username: _normalizeString(row[2]), shopId: normalizeShopId_(row[3]), active: row[4] === true || String(row[4]).toLowerCase() === 'true', createdAt: row[5] || new Date() };
    }
  });
  if (!assignment || !assignment.active) throw new Error('Active staff assignment not found.');
  if (assignment.shopId === targetShop.id) return { ok: true, unchanged: true, shopId: targetShop.id };
  var sourceShop = getStandardShopById_(assignment.shopId);
  var sourceSs = getStandardShopSpreadsheet_(sourceShop.id);
  var targetSs = getStandardShopSpreadsheet_(targetShop.id);
  var sourceState = getAppStateInternal_(sourceSs);
  var targetState = getAppStateInternal_(targetSs);
  sourceState.staffMembers = Array.isArray(sourceState.staffMembers) ? sourceState.staffMembers : [];
  targetState.staffMembers = Array.isArray(targetState.staffMembers) ? targetState.staffMembers : [];
  var sourceIndex = sourceState.staffMembers.findIndex(function(member) {
    return _normalizeString(member.id || member.staffId).toLowerCase() === assignment.staffId.toLowerCase() || _normalizeString(member.username).toLowerCase() === assignment.username.toLowerCase();
  });
  if (sourceIndex < 0) throw new Error('Staff credential record was not found in the assigned source shop.');
  var staff = Object.assign({}, sourceState.staffMembers[sourceIndex]);
  if (targetState.staffMembers.some(function(member) { return member.active !== false && _normalizeString(member.username).toLowerCase() === _normalizeString(staff.username).toLowerCase(); })) {
    throw new Error('The target shop already has a staff account with this username.');
  }
  sourceState.staffMembers.splice(sourceIndex, 1);
  staff.shopId = targetShop.id;
  staff.shopName = targetShop.name;
  staff.updatedAt = new Date().toISOString();
  targetState.staffMembers.push(staff);
  saveAppStateInternal_(sourceState, sourceSs);
  saveAppStateInternal_(targetState, targetSs);
  assignmentSheet.getRange(rowIndex, 1, 1, headers.length).setValues([[
    assignment.assignmentId, assignment.staffId || staff.id || staff.username, staff.username || assignment.username, targetShop.id, true, assignment.createdAt, new Date()
  ]]);
  _appendStandardControlAudit_(control, 'standard.staff.reassign', targetShop.id, { actor: session.username || 'admin', username: staff.username || assignment.username, fromShopId: sourceShop.id, toShopId: targetShop.id });
  return { ok: true, username: staff.username || assignment.username, fromShopId: sourceShop.id, shopId: targetShop.id };
}


function setStandardPrimaryShop(shopId, sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  var target = getStandardShopById_(shopId);
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var sheet = control.getSheetByName('Shops');
  var headers = TF_STANDARD_CONTROL_SHEET_DEFS.Shops;
  var rows = _getSheetData(sheet, 2, null, headers.length);
  rows.forEach(function(row, index) {
    var id = normalizeShopId_(row[0]);
    if (!id) return;
    sheet.getRange(index + 2, 6).setValue(id === target.id);
    sheet.getRange(index + 2, 9).setValue(new Date());
    try {
      var ss = getStandardShopSpreadsheet_(id);
      var state = getAppStateInternal_(ss);
      if (state.shops && state.shops[0]) state.shops[0].isPrimary = id === target.id;
      saveAppStateInternal_(state, ss);
    } catch (e) {}
  });
  _appendStandardControlAudit_(control, 'standard.shop.primary', target.id, { actor: session.username || '', shopName: target.name });
  return { ok: true, shopId: target.id };
}

function _standardRevokeUserSessions_(userId) {
  if (!isStandardMultiShopReady_()) return;
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var sessionSheet = control.getSheetByName('Sessions');
  var headers = TF_STANDARD_CONTROL_SHEET_DEFS.Sessions;
  var rows = _getSheetData(sessionSheet, 2, null, headers.length);
  rows.forEach(function(row, index) {
    if (_normalizeString(row[2]) === _normalizeString(userId) && !_standardBool_(row[7])) {
      sessionSheet.getRange(index + 2, 8).setValue(true);
      sessionSheet.getRange(index + 2, 10).setValue(new Date());
    }
  });
  var props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).filter(function(key) { return key.indexOf(EP_SESSION_PREFIX) === 0; }).forEach(function(key) {
    var session = _parseJson(props.getProperty(key));
    if (session && _normalizeString(session.userId) === _normalizeString(userId)) props.deleteProperty(key);
  });
}

function _standardPublicAccount_(user) {
  var assignment = _standardAssignmentForUser_(user.userId) || _standardAnyAssignmentForUser_(user.userId);
  return {
    userId: user.userId, displayName: user.displayName, username: user.username, role: user.role,
    active: user.active, shopId: assignment ? assignment.shopId : '', assignmentActive: assignment ? assignment.active === true : false,
    createdAt: user.createdAt, updatedAt: user.updatedAt
  };
}

function createStandardManagedAccount(input, sessionToken) {
  var actor = requirePortalSession_(sessionToken, 'super_admin');
  if (!isStandardMultiShopReady_()) throw new Error('Complete the multi-shop architecture first.');
  input = input && typeof input === 'object' ? input : {};
  var displayName = _normalizeString(input.displayName || input.name);
  var username = _normalizeString(input.username).toLowerCase();
  var password = String(input.password || '');
  var role = _normalizeString(input.role).toLowerCase();
  var shopId = normalizeShopId_(input.shopId);
  if (role !== 'admin' && role !== 'staff') throw new Error('Create either an Admin or Staff account.');
  if (!displayName || !/^[a-z0-9._-]{3,64}$/i.test(username) || password.length < 8) throw new Error('Name, a valid username, and an 8-character password are required.');
  if (_standardFindUserByUsername_(username)) throw new Error('That username already exists.');
  var shop = getStandardShopById_(shopId);
  var userId = (role === 'admin' ? 'admin-' : 'staff-') + Utilities.getUuid().slice(0, 12);
  _standardUpsertUser_({ userId: userId, displayName: displayName, username: username, passwordHash: _hashPassword(role === 'staff' ? 'staff' : 'admin', username, password), role: role, active: true });
  _standardUpsertUserAssignment_(userId, username, role, shop.id, true);
  if (role === 'staff') {
    var ss = getStandardShopSpreadsheet_(shop.id);
    var state = getAppStateInternal_(ss);
    state.staffMembers = Array.isArray(state.staffMembers) ? state.staffMembers : [];
    state.staffMembers.push({ id: userId, fullName: displayName, username: username, password: _hashPassword('staff', username, password), role: _normalizeString(input.staffRole) || 'Staff', shopId: shop.id, shopName: shop.name, active: true, createdAt: new Date().toISOString() });
    saveAppStateInternal_(state, ss);
  }
  _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.account.create', shop.id, { actor: actor.username || '', userId: userId, username: username, role: role });
  return { ok: true, account: _standardPublicAccount_(_standardFindUserById_(userId)) };
}

function assignStandardManagedAccountShop(userId, shopId, sessionToken) {
  var actor = requirePortalSession_(sessionToken, 'super_admin');
  var user = _standardFindUserById_(userId);
  if (!user || user.role === 'super_admin') throw new Error('Assignable account not found.');
  var target = getStandardShopById_(shopId);
  var previous = _standardAssignmentForUser_(user.userId);
  if (user.role === 'staff' && previous && previous.shopId !== target.id) {
    reassignStandardStaffShop(user.username, target.id, sessionToken);
  }
  _standardUpsertUserAssignment_(user.userId, user.username, user.role, target.id, true);
  _standardRevokeUserSessions_(user.userId);
  _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.account.assign', target.id, { actor: actor.username || '', userId: user.userId, username: user.username, role: user.role, fromShopId: previous ? previous.shopId : '', toShopId: target.id });
  return { ok: true, account: _standardPublicAccount_(_standardFindUserById_(user.userId)) };
}

function resetStandardManagedAccountPassword(userId, newPassword, sessionToken) {
  var actor = requirePortalSession_(sessionToken, 'super_admin');
  var user = _standardFindUserById_(userId);
  var password = String(newPassword || '');
  if (!user || user.role === 'super_admin') throw new Error('Managed Admin/Staff account not found.');
  if (password.length < 8) throw new Error('Password must contain at least 8 characters.');
  user.passwordHash = _hashPassword(user.role === 'staff' ? 'staff' : 'admin', user.username, password);
  _standardUpsertUser_(user);
  if (user.role === 'staff') {
    var assignment = _standardAssignmentForUser_(user.userId);
    if (assignment) {
      var ss = getStandardShopSpreadsheet_(assignment.shopId);
      var state = getAppStateInternal_(ss);
      var member = (state.staffMembers || []).find(function(row) { return _normalizeString(row.id) === user.userId || _normalizeString(row.username).toLowerCase() === user.username; });
      if (member) { member.password = _hashPassword('staff', user.username, password); delete member.pin; member.updatedAt = new Date().toISOString(); saveAppStateInternal_(state, ss); }
    }
  }
  _standardRevokeUserSessions_(user.userId);
  _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.account.password_reset', '', { actor: actor.username || '', userId: user.userId, username: user.username, role: user.role });
  return { ok: true };
}

function setStandardManagedAccountActive(userId, active, sessionToken) {
  var actor = requirePortalSession_(sessionToken, 'super_admin');
  var user = _standardFindUserById_(userId);
  if (!user || user.role === 'super_admin') throw new Error('Managed Admin/Staff account not found.');
  var assignment = _standardAssignmentForUser_(user.userId) || _standardAnyAssignmentForUser_(user.userId);
  var activate = active === true;
  if (activate && assignment) {
    var targetShop = getStandardShopById_(assignment.shopId);
    if (targetShop.status === 'inactive' || targetShop.status === 'deleted') throw new Error('Assign this account to an active shop before reactivating it.');
  }
  user.active = activate;
  _standardUpsertUser_(user);
  if (assignment) _standardUpsertUserAssignment_(user.userId, user.username, user.role, assignment.shopId, user.active);
  if (user.role === 'staff' && assignment) {
    try {
      var ss = getStandardShopSpreadsheet_(assignment.shopId);
      var state = getAppStateInternal_(ss);
      var member = (state.staffMembers || []).find(function(row) {
        return _normalizeString(row.id) === user.userId || _normalizeString(row.username).toLowerCase() === user.username;
      });
      if (member) {
        member.active = user.active;
        member.status = user.active ? 'Active' : 'Inactive';
        member.updatedAt = new Date().toISOString();
        saveAppStateInternal_(state, ss);
      }
    } catch (e) {}
  }
  _standardRevokeUserSessions_(user.userId);
  _appendStandardControlAudit_(getStandardControlSpreadsheet_(), user.active ? 'standard.account.activate' : 'standard.account.deactivate', assignment ? assignment.shopId : '', { actor: actor.username || '', userId: user.userId, username: user.username, role: user.role });
  return { ok: true, active: user.active };
}

function changeOwnStandardSuperAdminPassword(currentPassword, newPassword, sessionToken) {
  var actor = requirePortalSession_(sessionToken, 'super_admin');
  var user = _standardFindUserById_(actor.userId) || _standardFindUserByUsername_(actor.username);
  if (!user || user.role !== 'super_admin') throw new Error('Super admin account not found.');
  if (_hashPassword('admin', user.username, String(currentPassword || '')) !== user.passwordHash) throw new Error('Current password is incorrect.');
  if (String(newPassword || '').length < 8) throw new Error('New password must contain at least 8 characters.');
  user.passwordHash = _hashPassword('admin', user.username, String(newPassword));
  _standardUpsertUser_(user);
  _standardRevokeUserSessions_(user.userId);
  _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.super_admin.password_change', '', { actor: user.username, userId: user.userId });
  return { ok: true };
}


function updateStandardBusinessProfile(input, sessionToken) {
  var actor = requirePortalSession_(sessionToken, 'super_admin');
  input = input && typeof input === 'object' ? input : {};
  var fields = {
    businessName: _normalizeString(input.businessName), businessType: _normalizeString(input.businessType) || 'retail_supermarket',
    businessOwnerName: _normalizeString(input.businessOwnerName), businessOwnerEmail: _normalizeString(input.businessOwnerEmail),
    businessWhatsapp: _normalizeString(input.businessWhatsapp)
  };
  if (!fields.businessName || !fields.businessOwnerName || !fields.businessWhatsapp) throw new Error('Business name, owner name and phone/WhatsApp are required.');
  var root = SpreadsheetApp.getActiveSpreadsheet();
  var rootState = getAppStateInternal_(root);
  Object.keys(fields).forEach(function(key) { rootState[key] = fields[key]; });
  rootState.settings = Object.assign({}, rootState.settings || {}, fields);
  saveAppStateInternal_(rootState, root);
  if (isStandardMultiShopReady_()) {
    listStandardShopSources_().forEach(function(shop) {
      var ss = getStandardShopSpreadsheet_(shop.id);
      var state = getAppStateInternal_(ss);
      Object.keys(fields).forEach(function(key) { state[key] = fields[key]; });
      state.settings = Object.assign({}, state.settings || {}, fields);
      saveAppStateInternal_(state, ss);
    });
    var ownerUser = _standardUserRows_().find(function(user) { return user.role === 'super_admin'; });
    if (ownerUser) { ownerUser.displayName = fields.businessOwnerName; _standardUpsertUser_(ownerUser); }
    _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.business.profile_update', '', { actor: actor.username || '', businessName: fields.businessName });
  }
  return { ok: true, profile: fields };
}

function updateStandardBusinessFeatures(features, sessionToken) {
  var actor = requirePortalSession_(sessionToken, 'super_admin');
  var normalized = _normalizeStandardFeatures_(features);
  var root = SpreadsheetApp.getActiveSpreadsheet();
  var rootState = getAppStateInternal_(root);
  rootState.settings = Object.assign({}, rootState.settings || {}, { enabledFeatures: normalized, ncpcEnabled: true, ntheembaEnabled: (rootState.settings || {}).ntheembaEnabled === true });
  saveAppStateInternal_(rootState, root);
  if (isStandardMultiShopReady_()) {
    listStandardShopSources_().forEach(function(shop) {
      var ss = getStandardShopSpreadsheet_(shop.id);
      var state = getAppStateInternal_(ss);
      state.settings = Object.assign({}, state.settings || {}, { enabledFeatures: normalized, ncpcEnabled: true, ntheembaEnabled: (state.settings || {}).ntheembaEnabled === true });
      saveAppStateInternal_(state, ss);
    });
    _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.business.features_update', '', { actor: actor.username || '', enabledFeatures: normalized });
  }
  return { ok: true, enabledFeatures: normalized };
}

function getStandardSuperAdminContext(sessionToken) {
  var session = requirePortalSession_(sessionToken, 'super_admin');
  _standardSeedControlAccountsFromLegacy_();
  var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
  var shops = listStandardShopSources_().filter(function(shop) { return shop.status !== 'deleted'; });
  var users = _standardUserRows_();
  var sessionRows = _standardControlRows_('Sessions').slice(-50).reverse().map(function(row) {
    var expiresAt = row['Expires At'];
    var revoked = _standardBool_(row.Revoked);
    var active = !revoked && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
    return { sessionId: _normalizeString(row['Session ID']), username: _normalizeString(row.Username), role: _normalizeString(row.Role), shopId: normalizeShopId_(row['Shop ID']), expiresAt: expiresAt, revoked: revoked, active: active, createdAt: row['Created At'], lastSeenAt: row['Last Seen At'] };
  });
  var audits = _standardControlRows_('AuditLog').slice(-100).reverse().map(function(row) {
    var record = {}; try { record = JSON.parse(row['Record JSON'] || '{}'); } catch (e) {}
    return { eventId: _normalizeString(row['Event ID']), createdAt: row['Created At'], actor: _normalizeString(row.Actor), action: _normalizeString(row.Action), shopId: normalizeShopId_(row['Shop ID']), record: record };
  });
  var rootState = getAppStateInternal_();
  return {
    ok: true,
    system: {
      multiShopReady: isStandardMultiShopReady_(), maxShops: TF_STANDARD_MAX_SHOPS, shopCount: shops.length,
      controlSpreadsheetId: control.getId(), controlSpreadsheetUrl: control.getUrl(), rootSpreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
      ncpcEnabled: (rootState.settings || {}).ncpcEnabled !== false, ntheembaEnabled: (rootState.settings || {}).ntheembaEnabled === true,
      enabledFeatures: _normalizeStandardFeatures_((rootState.settings || {}).enabledFeatures)
    },
    shops: shops.map(function(shop) { var row = _standardShopPublicAdminRecord_(shop); row.spreadsheetId = shop.spreadsheetId; try { row.spreadsheetUrl = getStandardShopSpreadsheet_(shop.id).getUrl(); } catch (e) { row.spreadsheetUrl = ''; } return row; }),
    accounts: users.map(_standardPublicAccount_), sessions: sessionRows, audit: audits,
    currentUser: { userId: session.userId, username: session.username, role: session.role, shopId: session.shopId }
  };
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

function getAppStateInternal_(spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TF_STANDARD_SHOP_STATE_SHEET);
  if (!sheet) {
    _ensureSheet(ss, TF_STANDARD_SHOP_STATE_SHEET, ['Key', 'Value', 'Updated At']);
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
  if (isStandardMultiShopReady_()) {
    const resolvedShopId = resolveStandardSessionShopId_(session, session.shopId);
    const ss = getStandardShopSpreadsheet_(resolvedShopId);
    const state = getAppStateInternal_(ss);
    state.activeShopId = resolvedShopId;
    state.settings = Object.assign({}, state.settings || {}, { activeShopId: resolvedShopId });
    return projectStateForSession_(state, session);
  }
  return projectStateForSession_(getAppStateInternal_(), session);
}

function getAppStateForShop(shopId, sessionToken) {
  const session = requirePortalSession_(sessionToken);
  const resolvedShopId = resolveStandardSessionShopId_(session, shopId);
  const ss = getStandardShopSpreadsheet_(resolvedShopId);
  const state = getAppStateInternal_(ss);
  state.activeShopId = resolvedShopId;
  state.settings = Object.assign({}, state.settings || {}, { activeShopId: resolvedShopId });
  return projectStateForSession_(state, session);
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
    projected.customerOrders = canView('customerOrders') ? projected.customerOrders : [];
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

function saveAppStateInternal_(payload, spreadsheet, options) {
  const ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TF_STANDARD_SHOP_STATE_SHEET);
  if (!sheet) {
    sheet = _ensureSheet(ss, TF_STANDARD_SHOP_STATE_SHEET, ['Key', 'Value', 'Updated At']).sheet;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  payload = validateAppState_(payload || {}, options || {});
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
  syncStandardStaffAssignments_(payload);

  _cacheBustAll();
  return { success: true, savedAt: nowIso, state: payload };
}

function validateAppState_(payload, options) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('State payload must be an object.');
  const state = payload;
  options = options || {};
  const strictMaxStockIds = {};
  if (Array.isArray(options.strictMaxStockProductIds)) {
    options.strictMaxStockProductIds.forEach(function(id) {
      if (id !== undefined && id !== null && String(id).trim() !== '') strictMaxStockIds[String(id)] = true;
    });
  }
  const hasScopedMaxStockValidation = options.scopeMaxStockValidation === true || Array.isArray(options.strictMaxStockProductIds);
  const arrays = ['shops', 'products', 'sales', 'revenue', 'expenses', 'restockOrders', 'customerOrders', 'handoverRequests', 'ncpcCorrectionRequests', 'stockEntries', 'stockAdjustments', 'staffMembers', 'notifications', 'customUnits'];
  arrays.forEach(function(key) {
    if (state[key] !== undefined && !Array.isArray(state[key])) throw new Error(key + ' must be an array.');
    if (Array.isArray(state[key]) && state[key].length > 10000) throw new Error(key + ' exceeds the maximum record count.');
  });
  if (state.nextId !== undefined && (!isFinite(Number(state.nextId)) || Number(state.nextId) < 0)) throw new Error('nextId is invalid.');
  normalizeShops_(state);
  if ((state.shops || []).length > TF_STANDARD_MAX_SHOPS) throw new Error('Standard TradeFlow supports a maximum of three shops in Sprint-01.');
  stampLegacyShopScope_(state);
  const validShopIds = {};
  (state.shops || []).forEach(function(shop) {
    if (!shop.id) throw new Error('Shop ID is required.');
    if (validShopIds[shop.id]) throw new Error('Duplicate shop ID: ' + shop.id);
    validShopIds[shop.id] = true;
    const location = normalizeShopLocation_(shop.location || {});
    if (location.provinceId && !location.districtId) throw new Error('Shop ' + shop.name + ' has province without district.');
    if (location.districtId && !location.provinceId) throw new Error('Shop ' + shop.name + ' has district without province.');
    if (location.townId && !location.districtId) throw new Error('Shop ' + shop.name + ' has town without district.');
    if (!location.townId && location.townOther && !location.districtId) throw new Error('Shop ' + shop.name + ' has other town without district.');
    shop.location = location;
  });

  const seenBarcodes = {};
  (state.products || []).forEach(function(product, index) {
    if (!product || typeof product !== 'object') throw new Error('Product ' + (index + 1) + ' is invalid.');
    ['id', 'name', 'category', 'unit'].forEach(function(key) {
      if (product[key] === undefined || String(product[key]).trim() === '') throw new Error('Product ' + (index + 1) + ' is missing ' + key + '.');
    });
    if (!isFinite(Number(product.sellingPrice)) || Number(product.sellingPrice) < 0) throw new Error('Product ' + product.name + ' has an invalid selling price.');
    if ((!hasScopedMaxStockValidation || strictMaxStockIds[String(product.id)]) && (!isFinite(Number(product.maxStock)) || Number(product.maxStock) <= 0)) throw new Error('Product ' + product.name + ' has an invalid maximum stock.');
    normalizeProductBarcodes_(product);
    getProductBarcodeValues_(product).forEach(function(value) {
      var barcode = String(value || '').trim().toLowerCase();
      if (barcode && seenBarcodes[barcode] && String(seenBarcodes[barcode]) !== String(product.id)) throw new Error('Barcode ' + value + ' is assigned to more than one product.');
      if (barcode) seenBarcodes[barcode] = product.id;
    });
    _deriveTradeFlowProductIdentity_(product);
    if (product.batches !== undefined && !Array.isArray(product.batches)) throw new Error('Product ' + product.name + ' has invalid batches.');
    (product.batches || []).forEach(function(batch) {
      if (!validShopIds[normalizeShopId_(batch.shopId)]) throw new Error('Product ' + product.name + ' has a batch for an invalid shop.');
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

function _deriveTradeFlowProductIdentity_(product) {
  if (!product || product.id === undefined || String(product.id).trim() === '') throw new Error('Product identity is missing its local business product ID.');
  var mapping = product.ncpcMapping || null;
  var status = _deriveNcpcMappingStatus_(mapping);
  return {
    businessProductId: String(product.id),
    ncpcMappingStatus: status,
    ncpcProductId: mapping ? _normalizeString(mapping.ncpcProductId) : '',
    ncpcVariantId: mapping ? _normalizeString(mapping.ncpcVariantId) : ''
  };
}

function _deriveNcpcMappingStatus_(mapping) {
  if (!mapping) return TF_NCPC_MAPPING_STATES.NEEDS_LINK;
  var explicitStatus = _normalizeString(mapping.status);
  if (explicitStatus && TF_NCPC_MAPPING_STATES[explicitStatus]) return explicitStatus;
  var productId = _normalizeString(mapping.ncpcProductId);
  var variantId = _normalizeString(mapping.ncpcVariantId);
  if (/^PRD-[A-Z0-9-]+$/.test(productId) && /^VAR-[A-Z0-9-]+$/.test(variantId)) return TF_NCPC_MAPPING_STATES.LINKED;
  return TF_NCPC_MAPPING_STATES.LINK_ERROR;
}

function normalizeBarcodeValue_(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeProductBarcodes_(product) {
  if (!product || typeof product !== 'object') return [];
  var source = Array.isArray(product.barcodes) ? product.barcodes : [];
  var rows = [];
  var seen = {};
  source.forEach(function(entry) {
    var value = normalizeBarcodeValue_(entry && typeof entry === 'object' ? entry.value : entry);
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
  var primary = normalizeBarcodeValue_(product.barcode);
  if (primary && !seen[primary.toLowerCase()]) {
    rows.unshift({ value: primary, label: '', kind: primary.indexOf('TF') === 0 ? 'tradeflow' : 'manufacturer', isPrimary: true, source: 'legacy' });
    seen[primary.toLowerCase()] = true;
  }
  if (rows.length && !rows.some(function(entry) { return entry.isPrimary === true; })) rows[0].isPrimary = true;
  product.barcodes = rows;
  product.barcode = (rows.find(function(entry) { return entry.isPrimary === true; }) || rows[0] || { value: '' }).value || '';
  return rows;
}

function getProductBarcodeValues_(product) {
  return normalizeProductBarcodes_(product).map(function(entry) { return entry.value; }).filter(Boolean);
}

function normalizeShopId_(value) {
  return _normalizeString(value).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);
}

function getDefaultShop_(state) {
  state = state || {};
  var settings = state.settings || {};
  return {
    id: TF_STANDARD_DEFAULT_SHOP_ID,
    name: _normalizeString(settings.shopName) || _normalizeString(settings.businessName) || _normalizeString(state.businessName) || 'Main Shop',
    status: 'active',
    isPrimary: true,
    location: normalizeShopLocation_(settings.shopLocation || settings.location || {
      addressDetails: _normalizeString(settings.businessAddress || state.businessAddress)
    })
  };
}

function normalizeShopLocation_(location) {
  location = location && typeof location === 'object' ? location : {};
  var townId = _normalizeString(location.townId || location.town_id);
  var townOther = _normalizeString(location.townOther || location.town_other);
  return {
    countryId: 'ZM',
    countryName: 'Zambia',
    provinceId: _normalizeString(location.provinceId || location.province_id),
    provinceName: _normalizeString(location.provinceName || location.province_name_snapshot || location.province),
    districtId: _normalizeString(location.districtId || location.district_id),
    districtName: _normalizeString(location.districtName || location.district_name_snapshot || location.district),
    townId: townId,
    townName: _normalizeString(location.townName || location.town_name_snapshot || location.town),
    townOther: townId ? '' : townOther,
    area: _normalizeString(location.area || location.areaName),
    landmark: _normalizeString(location.landmark),
    addressDetails: _normalizeString(location.addressDetails || location.address_details || location.address),
    catalogueVersion: _normalizeString(location.catalogueVersion || location.location_catalogue_version) || TF_STANDARD_LOCATION_CATALOGUE_VERSION
  };
}

function canonicalizeStandardShopLocation_(location) {
  var input = normalizeShopLocation_(location || {});
  var catalogue = normalizeStandardLocationCatalogue_(getEmbeddedStandardLocationCatalogue_(), 'embedded-canonical');
  function matchByName(rows, name) {
    var wanted = _normalizeString(name).toLowerCase();
    if (!wanted) return null;
    return (rows || []).find(function(row) { return _normalizeString(row.name).toLowerCase() === wanted; }) || null;
  }
  var province = matchByName(catalogue.provinces, input.provinceName);
  if (input.provinceName && !province) throw new Error('Select a valid Zambia province.');
  var district = province ? matchByName(province.districts, input.districtName) : null;
  if (input.districtName && !district) throw new Error('Select a district that belongs to the selected province.');
  var town = district ? matchByName(district.towns, input.townName) : null;
  if (input.townName && !town) throw new Error('Select a town/settlement that belongs to the selected district.');
  return normalizeShopLocation_({
    provinceId: province ? province.id : '', provinceName: province ? province.name : '',
    districtId: district ? district.id : '', districtName: district ? district.name : '',
    townId: town ? town.id : '', townName: town ? town.name : '',
    area: input.area, landmark: input.landmark, addressDetails: input.addressDetails,
    catalogueVersion: catalogue.version || TF_STANDARD_LOCATION_CATALOGUE_VERSION
  });
}

function standardShopLocationLabel_(location) {
  var loc = normalizeShopLocation_(location || {});
  return [loc.provinceName, loc.districtName, loc.townName, loc.area].filter(Boolean).join(', ');
}


function normalizeShopRecord_(shop, state) {
  shop = shop && typeof shop === 'object' ? shop : {};
  var fallback = getDefaultShop_(state);
  var id = normalizeShopId_(shop.id || shop.shopId || shop.branchId) || fallback.id;
  var config = shop.config || shop.shopConfig || {};
  return {
    id: id,
    shopId: id,
    branchId: id,
    name: _normalizeString(shop.name || shop.shopName || shop.branchName) || fallback.name,
    status: _normalizeString(shop.status) || 'active',
    isPrimary: shop.isPrimary === true || shop.primary === true || id === TF_STANDARD_DEFAULT_SHOP_ID,
    spreadsheetId: _normalizeString(shop.spreadsheetId || shop.sheetId || config.spreadsheetId),
    config: {
      managerName: _normalizeString(config.managerName || config.manager || shop.managerName),
      whatsapp: _normalizeString(config.whatsapp || config.phone || shop.whatsapp || shop.phone),
      email: _normalizeString(config.email || shop.email),
      receiptPrefix: _normalizeString(config.receiptPrefix || config.receipt_prefix || shop.receiptPrefix).slice(0, 16),
      notes: _normalizeString(config.notes || shop.notes),
      businessHours: _standardNormalizeBusinessHours_(config.businessHours || config.openingHours || shop.businessHours || shop.openingHours),
      staffCanSwitchShops: false
    },
    location: normalizeShopLocation_(shop.location || shop.shopLocation || {})
  };
}

function normalizeShops_(state) {
  state = state || {};
  var raw = Array.isArray(state.shops) ? state.shops : [];
  var byId = {};
  raw.forEach(function(shop) {
    var normalized = normalizeShopRecord_(shop, state);
    if (normalized.status === 'deleted') return;
    if (!byId[normalized.id]) byId[normalized.id] = normalized;
  });
  var shops = Object.keys(byId).map(function(id) { return byId[id]; });
  if (!shops.length) shops = [getDefaultShop_(state)];
  if (!shops.some(function(shop) { return shop.isPrimary; })) shops[0].isPrimary = true;
  state.shops = shops;
  var active = normalizeShopId_(state.activeShopId || (state.settings || {}).activeShopId);
  if (!shops.some(function(shop) { return shop.id === active && shop.status !== 'inactive'; })) {
    active = (shops.find(function(shop) { return shop.isPrimary && shop.status !== 'inactive'; }) || shops[0]).id;
  }
  state.activeShopId = active;
  if (state.settings) state.settings.activeShopId = active;
  return shops;
}

function getShopSnapshot_(state, shopId) {
  var shops = normalizeShops_(state);
  var normalizedId = normalizeShopId_(shopId) || state.activeShopId || TF_STANDARD_DEFAULT_SHOP_ID;
  var shop = shops.find(function(item) { return item.id === normalizedId; }) || shops[0];
  return { shopId: shop.id, shopName: shop.name };
}

function stampLegacyShopScope_(state) {
  var active = getShopSnapshot_(state, state && state.activeShopId);
  function stamp(row) {
    if (!row || typeof row !== 'object') return;
    if (!row.shopId) row.shopId = active.shopId;
    if (!row.shopName) row.shopName = active.shopName;
  }
  (state.products || []).forEach(function(product) {
    (product.batches || []).forEach(stamp);
    (product.stockMovements || []).forEach(function(movement) {
      stamp(movement);
      (movement.allocation || []).forEach(stamp);
    });
  });
  ['stockEntries', 'stockAdjustments', 'sales', 'customerOrders', 'revenue', 'expenses', 'restockOrders'].forEach(function(key) {
    (state[key] || []).forEach(stamp);
  });
  (state.restockOrders || []).forEach(function(order) { (order.items || []).forEach(stamp); });
  (state.sales || []).forEach(function(sale) { (sale.items || []).forEach(stamp); });
  (state.customerOrders || []).forEach(function(order) { (order.items || []).forEach(stamp); });
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
  const session = requirePortalSession_(sessionToken, 'admin');
  if (isStandardMultiShopReady_()) {
    const requestedShopId = payload && payload.activeShopId ? payload.activeShopId : session.shopId;
    const resolvedShopId = resolveStandardSessionShopId_(session, requestedShopId);
    const ss = getStandardShopSpreadsheet_(resolvedShopId);
    payload = payload && typeof payload === 'object' ? payload : {};
    payload.activeShopId = resolvedShopId;
    payload.settings = Object.assign({}, payload.settings || {}, { activeShopId: resolvedShopId });
    return saveAppStateInternal_(payload, ss);
  }
  return saveAppStateInternal_(payload);
}

function saveAppStateForShop(payload, shopId, sessionToken) {
  const session = requirePortalSession_(sessionToken, 'admin');
  const resolvedShopId = resolveStandardSessionShopId_(session, shopId || (payload && payload.activeShopId));
  const ss = getStandardShopSpreadsheet_(resolvedShopId);
  payload = payload && typeof payload === 'object' ? payload : {};
  payload.activeShopId = resolvedShopId;
  payload.settings = Object.assign({}, payload.settings || {}, { activeShopId: resolvedShopId });
  return saveAppStateInternal_(payload, ss);
}

// AppState is the recovery snapshot. The workflow tables below are rebuilt from
// the same accepted state, so every normal app operation has a readable Sheet
// record as well as a recovery copy.
function _projectAppStateToDedicatedSheets_(ss, state, updatedAt) {
  const products = Array.isArray(state.products) ? state.products : [];
  const activeBudget = state.activeBudget || {};
  const profile = state.settings || {};
  const shops = normalizeShops_(state);
  stampLegacyShopScope_(state);

  _replaceWorkflowSheet_(ss, 'BusinessProfile', [[
    'business', state.businessName || profile.businessName || '', state.businessType || profile.businessType || '',
    state.businessOwnerName || profile.businessOwnerName || '', state.businessOwnerEmail || profile.businessOwnerEmail || '',
    state.businessWhatsapp || profile.businessWhatsapp || '', state.businessAddress || profile.businessAddress || '', updatedAt
  ]]);
  _replaceWorkflowSheet_(ss, 'Shops', shops.map(function(shop) {
    var location = normalizeShopLocation_(shop.location || {});
    return [_safeSheetText_(shop.id), _safeSheetText_(shop.name), _safeSheetText_(shop.spreadsheetId || ''), _safeSheetText_(shop.status || 'active'), shop.isPrimary === true,
      _safeSheetText_(location.provinceId), _safeSheetText_(location.provinceName), _safeSheetText_(location.districtId), _safeSheetText_(location.districtName),
      _safeSheetText_(location.townId), _safeSheetText_(location.townName), _safeSheetText_(location.townOther), _safeSheetText_(location.area),
      _safeSheetText_(location.landmark || location.addressDetails), _safeSheetText_(location.catalogueVersion), updatedAt, JSON.stringify(shop.config || {}), JSON.stringify(shop)];
  }));
  _replaceWorkflowSheet_(ss, 'Products', products.map(function(product) {
    normalizeProductBarcodes_(product);
    return [_safeSheetText_(product.id), _safeSheetText_(product.name), _safeSheetText_(product.category), _safeSheetText_(product.unit),
      _safeSheetText_(product.productType || 'packed'), Number(product.sellingPrice || 0), Number(product.maxStock || 0),
      _safeSheetText_(product.barcode), updatedAt, JSON.stringify(product)];
  }));
  _replaceWorkflowSheet_(ss, 'ProductBarcodes', products.reduce(function(rows, product) {
    normalizeProductBarcodes_(product);
    return rows.concat((product.barcodes || []).map(function(entry) {
      return [_safeSheetText_(product.id), _safeSheetText_(product.name), _safeSheetText_(entry.value), _safeSheetText_(entry.label || ''),
        _safeSheetText_(entry.kind || 'manufacturer'), entry.isPrimary === true, _safeSheetText_(entry.source || ''), updatedAt, JSON.stringify(entry)];
    }));
  }, []));

  const batches = [];
  const deliveries = [];
  products.forEach(function(product) {
    (Array.isArray(product.batches) ? product.batches : []).forEach(function(batch) {
      var shop = getShopSnapshot_(state, batch.shopId);
      batches.push([_safeSheetText_(batch.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), _safeSheetText_(product.id), _safeSheetText_(product.name), _safeSheetText_(batch.restockEventId),
        batch.restockDate || '', batch.receivedDate || '', Number(batch.quantityReceived || batch.qty || 0), Number(batch.quantityRemaining || 0),
        Number(batch.unitCost || 0), Number(batch.sellingPriceSnapshot || product.sellingPrice || 0), _safeSheetText_(batch.status || ''), JSON.stringify(batch)]);
      if (String(batch.restockEventId || '') !== 'owner-restock') {
        deliveries.push([_safeSheetText_(batch.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), batch.receivedDate || batch.restockDate || '', _safeSheetText_(product.id), _safeSheetText_(product.name),
          Number(batch.quantityReceived || batch.qty || 0), Number(batch.unitCost || 0), _safeSheetText_(batch.source || batch.restockEventId || 'supplier'),
          _safeSheetText_(batch.notes || ''), _safeSheetText_(batch.receivedBy || ''), JSON.stringify(batch)]);
      }
    });
  });
  _replaceWorkflowSheet_(ss, 'InventoryBatches', batches);
  _replaceWorkflowSheet_(ss, 'SupplierDeliveries', deliveries);

  _replaceWorkflowSheet_(ss, 'RestockOrders', (state.restockOrders || []).map(function(order) {
    var shop = getShopSnapshot_(state, order.shopId);
    return [_safeSheetText_(order.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), order.date || order.createdAt || '', _safeSheetText_(order.status || 'Draft'), Number(order.totalBudget || order.total || 0),
      _safeSheetText_(order.notes || ''), _safeSheetText_(order.userName || order.createdBy || ''), updatedAt, JSON.stringify(order)];
  }));
  _replaceWorkflowSheet_(ss, 'RestockOrderItems', (state.restockOrders || []).reduce(function(rows, order) {
    var orderShop = getShopSnapshot_(state, order.shopId);
    return rows.concat((order.items || []).map(function(item) {
      var shop = getShopSnapshot_(state, item.shopId || orderShop.shopId);
      return [_safeSheetText_(order.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), _safeSheetText_(item.productId), _safeSheetText_(item.productName), Number(item.expectedQty || item.restockQty || item.quantity || 0),
        Number(item.receivedQty || item.actualQuantity || 0), Number(item.cost || item.costPrice || item.unitCost || 0), _safeSheetText_(item.receiptStatus || order.status || ''), JSON.stringify(item)];
    }));
  }, []));
  _replaceWorkflowSheet_(ss, 'StockAdjustments', (state.stockAdjustments || []).map(function(item) {
    var shop = getShopSnapshot_(state, item.shopId);
    return [_safeSheetText_(item.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), item.date || item.createdAt || '', _safeSheetText_(item.productId), Number(item.qty || 0), _safeSheetText_(item.reason),
      Number(item.cogs || 0), Number(item.estimatedRevenue || 0), Number(item.estimatedMargin || 0), _safeSheetText_(item.userName || ''), JSON.stringify(item)];
  }));
  _replaceWorkflowSheet_(ss, 'POSSales', (state.sales || []).map(function(sale) {
    var shop = getShopSnapshot_(state, sale.shopId);
    return [_safeSheetText_(sale.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), sale.date || sale.createdAt || '', _safeSheetText_(sale.status || 'Completed'), _safeSheetText_(sale.paymentMethod || 'Cash'),
      Number(sale.itemCount || (sale.items || []).length || 0), Number(sale.subtotal || sale.total || 0), Number(sale.total || 0), _safeSheetText_(sale.userName || ''), JSON.stringify(sale)];
  }));
  _replaceWorkflowSheet_(ss, 'POSSaleItems', (state.sales || []).reduce(function(rows, sale) {
    var saleShop = getShopSnapshot_(state, sale.shopId);
    return rows.concat((sale.items || []).map(function(item) {
      var shop = getShopSnapshot_(state, item.shopId || saleShop.shopId);
      return [_safeSheetText_(sale.id), _safeSheetText_(item.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), _safeSheetText_(item.productId), _safeSheetText_(item.productName), _safeSheetText_(item.unit || ''),
        Number(item.qty || 0), Number(item.unitPrice || 0), Number(item.lineTotal || 0), Number(item.cogs || 0), Number(item.estimatedMargin || 0), JSON.stringify(item.allocation || []), JSON.stringify(item)];
    }));
  }, []));
  _replaceWorkflowSheet_(ss, 'CustomerOrders', (state.customerOrders || []).map(function(order) {
    var shop = getShopSnapshot_(state, order.shopId);
    return [_safeSheetText_(order.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), order.createdAt || '', _safeSheetText_(order.status || 'requested'), _safeSheetText_(order.idempotencyKey || ''),
      Number((order.totals || {}).itemCount || (order.items || []).length || 0), Number((order.totals || {}).total || 0), _safeSheetText_((order.totals || {}).currency || ''), JSON.stringify(order)];
  }));
  _replaceWorkflowSheet_(ss, 'CustomerOrderItems', (state.customerOrders || []).reduce(function(rows, order) {
    var orderShop = getShopSnapshot_(state, order.shopId);
    return rows.concat((order.items || []).map(function(item) {
      var shop = getShopSnapshot_(state, item.shopId || orderShop.shopId);
      return [_safeSheetText_(order.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), _safeSheetText_(item.business_product_id), _safeSheetText_((item.identity || {}).ncpc_prd_id), _safeSheetText_((item.identity || {}).ncpc_var_id),
        _safeSheetText_(item.name), Number(item.quantity || 0), Number(item.selling_price || 0), Number(item.line_total || 0), JSON.stringify(item)];
    }));
  }, []));
  _replaceWorkflowSheet_(ss, 'HandoverRequests', (state.handoverRequests || []).map(function(item) {
    var customer = item.customer || {};
    var shop = getShopSnapshot_(state, item.shopId || state.activeShopId);
    return [_safeSheetText_(item.id), _safeSheetText_(shop.shopId), _safeSheetText_(shop.shopName), item.createdAt || '', _safeSheetText_(item.status || 'requested'), _safeSheetText_(item.channel || 'api'),
      _safeSheetText_(item.idempotencyKey || ''), _safeSheetText_(customer.display_name || customer.name || ''), _safeSheetText_(customer.phone || ''),
      _safeSheetText_(item.reason || ''), JSON.stringify(item)];
  }));
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
  // NCPC links are reference-only. This projection deliberately has no local
  // price, cost, supplier, batch, stock, or description columns.
  _replaceWorkflowSheet_(ss, 'NcpcProductMappings', products.filter(function(product) {
    return product && product.ncpcMapping;
  }).map(function(product) {
    var mapping = product.ncpcMapping || {};
    return [_safeSheetText_(product.id), _safeSheetText_(_deriveNcpcMappingStatus_(mapping)), _safeSheetText_(mapping.ncpcProductId), _safeSheetText_(mapping.ncpcVariantId), _safeSheetText_(mapping.suggestedNcpcProductId), _safeSheetText_(mapping.suggestedNcpcVariantId),
      _safeSheetText_(mapping.submissionId), _safeSheetText_(mapping.submissionStatus), mapping.lastStatusCheckAt || '', _safeSheetText_(mapping.catalogueVersion), _safeSheetText_(mapping.releaseVersion), mapping.linkedAt || mapping.submittedAt || '',
      _safeSheetText_(mapping.linkedBy || mapping.submittedBy), mapping.publicForNtheemba === true, JSON.stringify(mapping)];
  }));
  _replaceWorkflowSheet_(ss, 'NcpcCorrectionRequests', (state.ncpcCorrectionRequests || []).map(function(item) {
    return [_safeSheetText_(item.correctionRequestId), _safeSheetText_(item.correctionId), _safeSheetText_(item.correctionStatus || 'PENDING_REVIEW'),
      _safeSheetText_(item.localProductId), _safeSheetText_(item.ncpcProductId), _safeSheetText_(item.ncpcVariantId), _safeSheetText_(item.field),
      _safeSheetText_(item.previousValue), _safeSheetText_(item.proposedValue), _safeSheetText_(item.source), item.submittedAt || '',
      _safeSheetText_(item.submittedBy), JSON.stringify(item)];
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
  if (isStandardMultiShopReady_()) return getSyncSnapshotForShop(clientRevision, session.shopId, sessionToken);
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

function getSyncSnapshotForShop(clientRevision, shopId, sessionToken) {
  const session = requirePortalSession_(sessionToken);
  const resolvedShopId = resolveStandardSessionShopId_(session, shopId);
  const ss = getStandardShopSpreadsheet_(resolvedShopId);
  const state = getAppStateInternal_(ss);
  state.activeShopId = resolvedShopId;
  state.settings = Object.assign({}, state.settings || {}, { activeShopId: resolvedShopId });
  state._sync = state._sync || { revision: 0, appliedOps: [] };
  return {
    ok: true,
    state: projectStateForSession_(state, session),
    serverRevision: Number(state._sync.revision || 0),
    serverUpdatedAt: (state._meta && state._meta.serverUpdatedAt) || '',
    clientRevision: Number(clientRevision || 0),
    shopId: resolvedShopId
  };
}

function pushSyncOps(ops, clientRevision, deviceId, sessionToken) {
  const session = requirePortalSession_(sessionToken);
  if (isStandardMultiShopReady_()) return pushSyncOpsForShop(ops, clientRevision, deviceId, session.shopId, sessionToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let state = getAppStateInternal_();
    state._sync = state._sync || { revision: 0, appliedOps: [] };
    const applied = {};
    const strictMaxStockProductIds = {};
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
      incoming = applySyncShopContext_(state, incoming, action);
      _collectTouchedSyncProductIds_(strictMaxStockProductIds, state, incoming);
      state = mergeStateRecords_(state, incoming);
      _appendSyncOperation_(ss, op, opId, deviceId);
      applied[opId] = true;
      state._sync.revision = Number(state._sync.revision || 0) + 1;
    });
    state._sync.deviceId = String(deviceId || state._sync.deviceId || '');
    state._sync.appliedOps = Object.keys(applied).slice(-2000);
    state._sync.lastSyncAt = new Date().toISOString();
    const result = saveAppStateInternal_(state, null, { scopeMaxStockValidation: true, strictMaxStockProductIds: Object.keys(strictMaxStockProductIds) });
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

function pushSyncOpsForShop(ops, clientRevision, deviceId, shopId, sessionToken) {
  const session = requirePortalSession_(sessionToken);
  const resolvedShopId = resolveStandardSessionShopId_(session, shopId);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getStandardShopSpreadsheet_(resolvedShopId);
    let state = getAppStateInternal_(ss);
    state.activeShopId = resolvedShopId;
    state.settings = Object.assign({}, state.settings || {}, { activeShopId: resolvedShopId });
    state._sync = state._sync || { revision: 0, appliedOps: [] };
    const applied = {};
    const strictMaxStockProductIds = {};
    (state._sync.appliedOps || []).forEach(function(opId) { applied[String(opId)] = true; });
    (Array.isArray(ops) ? ops : []).forEach(function(op) {
      const opId = String((op && op.opId) || '');
      if (!opId || applied[opId]) return;
      const action = Object.assign({}, (op && op.action) || {}, { shopId: resolvedShopId });
      let incoming = (op && (op.payload || op.state)) || {};
      const opBaseRevision = Number((op && op.baseRevision) || clientRevision || 0);
      const serverRevision = Number(state._sync.revision || 0);
      if (opBaseRevision < serverRevision && !stateHasMergeTimestamps_(incoming)) {
        throw new Error('This browser has older shop data. Refresh before saving to avoid overwriting newer edits.');
      }
      if (session.role === 'staff') incoming = _mergeStaffState_(state, incoming, action);
      incoming = _protectStaffCredentials_(incoming);
      incoming = applySyncShopContext_(state, incoming, action);
      incoming.activeShopId = resolvedShopId;
      incoming.settings = Object.assign({}, incoming.settings || {}, { activeShopId: resolvedShopId });
      _collectTouchedSyncProductIds_(strictMaxStockProductIds, state, incoming);
      state = mergeStateRecords_(state, incoming);
      _appendSyncOperation_(ss, Object.assign({}, op, { action: action }), opId, deviceId);
      applied[opId] = true;
      state._sync.revision = Number(state._sync.revision || 0) + 1;
    });
    state._sync.deviceId = String(deviceId || state._sync.deviceId || '');
    state._sync.appliedOps = Object.keys(applied).slice(-2000);
    state._sync.lastSyncAt = new Date().toISOString();
    const result = saveAppStateInternal_(state, ss, { scopeMaxStockValidation: true, strictMaxStockProductIds: Object.keys(strictMaxStockProductIds) });
    return {
      ok: true,
      state: projectStateForSession_(result.state || state, session),
      serverRevision: Number(state._sync.revision || 0),
      appliedOps: state._sync.appliedOps,
      clientRevision: Number(clientRevision || 0),
      deviceId: String(deviceId || ''),
      shopId: resolvedShopId
    };
  } finally {
    lock.releaseLock();
  }
}

function _collectTouchedSyncProductIds_(target, currentState, incoming) {
  target = target || {};
  if (!incoming || !Array.isArray(incoming.products)) return target;
  const currentById = {};
  (currentState.products || []).forEach(function(product) {
    if (product && product.id !== undefined && product.id !== null) currentById[String(product.id)] = product;
  });
  incoming.products.forEach(function(product) {
    if (!product || product.id === undefined || product.id === null || String(product.id).trim() === '') return;
    const id = String(product.id);
    if (!currentById[id] || JSON.stringify(currentById[id]) !== JSON.stringify(product)) target[id] = true;
  });
  return target;
}

function applySyncShopContext_(state, incoming, action) {
  incoming = incoming && typeof incoming === 'object' ? incoming : {};
  action = action || {};
  var shop = getShopSnapshot_(state, action.shopId || incoming.activeShopId);
  function stamp(row) {
    if (!row || typeof row !== 'object') return;
    if (!row.shopId) row.shopId = shop.shopId;
    if (!row.shopName) row.shopName = shop.shopName;
  }
  ['stockEntries', 'stockAdjustments', 'sales', 'customerOrders', 'revenue', 'expenses', 'restockOrders'].forEach(function(key) {
    (incoming[key] || []).forEach(stamp);
  });
  (incoming.products || []).forEach(function(product) {
    (product.batches || []).forEach(stamp);
    (product.stockMovements || []).forEach(function(movement) {
      stamp(movement);
      (movement.allocation || []).forEach(stamp);
    });
  });
  (incoming.sales || []).forEach(function(sale) { (sale.items || []).forEach(stamp); });
  (incoming.customerOrders || []).forEach(function(order) { (order.items || []).forEach(stamp); });
  (incoming.restockOrders || []).forEach(function(order) { (order.items || []).forEach(stamp); });
  return incoming;
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
  revenue: ['revenue'],
  customerOrders: ['customerOrders', 'products', 'sales', 'revenue', 'stockAdjustments', 'notifications']
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

function _mergeStaffCustomerOrderProducts_(currentProducts, incomingProducts) {
  const incomingById = {};
  (incomingProducts || []).forEach(function(product) {
    if (product && product.id !== undefined) incomingById[String(product.id)] = product;
  });
  return (currentProducts || []).map(function(existing) {
    const update = incomingById[String(existing && existing.id)];
    if (!update) return existing;
    const merged = Object.assign({}, existing);
    merged.stockMovements = mergeRowsByIdentity_(existing.stockMovements || [], update.stockMovements || [], 'productStockMovements');
    const oldTs = Date.parse(existing.updatedAt || existing.timestamp || existing.createdAt || 0) || 0;
    const newTs = Date.parse(update.updatedAt || update.timestamp || update.createdAt || 0) || 0;
    if (newTs >= oldTs && update.updatedAt) merged.updatedAt = update.updatedAt;
    return merged;
  });
}

function _mergeStaffState_(current, incoming, action) {
  const view = _assertStaffWriteAccess_(current, action);
  const merged = JSON.parse(JSON.stringify(current || {}));
  if (view === 'products') merged.products = _mergeStaffProducts_(current.products, incoming.products);
  if (view === 'revenue' && incoming.revenue !== undefined) merged.revenue = mergeRowsByIdentity_(current.revenue || [], incoming.revenue || [], 'revenue');
  if (view === 'customerOrders') {
    if (incoming.customerOrders !== undefined) merged.customerOrders = mergeRowsByIdentity_(current.customerOrders || [], incoming.customerOrders || [], 'customerOrders');
    if (incoming.products !== undefined) merged.products = _mergeStaffCustomerOrderProducts_(current.products || [], incoming.products || []);
    if (incoming.sales !== undefined) merged.sales = mergeRowsByIdentity_(current.sales || [], incoming.sales || [], 'sales');
    if (incoming.revenue !== undefined) merged.revenue = mergeRowsByIdentity_(current.revenue || [], incoming.revenue || [], 'revenue');
    if (incoming.stockAdjustments !== undefined) merged.stockAdjustments = mergeRowsByIdentity_(current.stockAdjustments || [], incoming.stockAdjustments || [], 'stockAdjustments');
    if (incoming.notifications !== undefined) merged.notifications = mergeRowsByIdentity_(current.notifications || [], incoming.notifications || [], 'notifications');
  }
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
  requirePortalSession_(sessionToken, 'super_admin');
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  return saveAppState(parsed, sessionToken).state;
}

function _getDefaultState() {
  return {
    _meta: {},
    nextId: 1000,
    shops: [getDefaultShop_({ settings: { businessName: 'TradeFlow Pro', businessAddress: '' }, businessName: 'TradeFlow Pro' })],
    activeShopId: TF_STANDARD_DEFAULT_SHOP_ID,
    products: [],
    sales: [],
    revenue: [],
    expenses: [],
    restockOrders: [],
    customerOrders: [],
    handoverRequests: [],
    ncpcCorrectionRequests: [],
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
      activeShopId: TF_STANDARD_DEFAULT_SHOP_ID,
      setupCompleted: false,
      ncpcEnabled: true,
      ntheembaEnabled: false,
      enabledFeatures: _normalizeStandardFeatures_({}),
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
  const session = requirePortalSession_(sessionToken, 'super_admin');
  const state = getAppStateInternal_();
  const phrase = 'RESET ' + String(state.businessName || (state.settings || {}).businessName || 'TradeFlow Pro').trim();
  const nonce = Utilities.getUuid().replace(/-/g, '');
  const key = EP_RESET_CHALLENGE_PREFIX + _sessionPropertyKey_(sessionToken);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({ nonce: nonce, phrase: phrase, username: session.username, expiresAt: Date.now() + EP_RESET_CHALLENGE_TTL_MS }));
  return { phrase: phrase, resetToken: nonce, expiresAt: Date.now() + EP_RESET_CHALLENGE_TTL_MS };
}

function resetAppState(sessionToken, confirmation, resetToken, shopId) {
  const resetSession = requirePortalSession_(sessionToken, 'super_admin');
  const key = EP_RESET_CHALLENGE_PREFIX + _sessionPropertyKey_(sessionToken);
  const challenge = _parseJson(PropertiesService.getScriptProperties().getProperty(key));
  // Consume the challenge before changing state so it cannot be replayed.
  PropertiesService.getScriptProperties().deleteProperty(key);
  if (!challenge || Number(challenge.expiresAt || 0) <= Date.now() || String(challenge.nonce || '') !== String(resetToken || '') || String(challenge.phrase || '') !== String(confirmation || '').trim()) {
    throw new Error('Reset confirmation is invalid or has expired. Start again.');
  }
  const resetShopId = isStandardMultiShopReady_() ? resolveStandardSessionShopId_(resetSession, shopId) : TF_STANDARD_DEFAULT_SHOP_ID;
  const resetSs = isStandardMultiShopReady_() ? getStandardShopSpreadsheet_(resetShopId) : SpreadsheetApp.getActiveSpreadsheet();
  const previous = getAppStateInternal_(resetSs);
  const shop = isStandardMultiShopReady_() ? getStandardShopById_(resetShopId) : getDefaultShop_(previous);
  const defaults = buildStandardShopState_(previous, shop);
  saveAppStateInternal_(defaults, resetSs);
  if (isStandardMultiShopReady_()) {
    var control = ensureStandardControlSheets_(getStandardControlSpreadsheet_());
    var assignmentSheet = control.getSheetByName('StaffAssignments');
    var rows = _getSheetData(assignmentSheet, 2, null, TF_STANDARD_CONTROL_SHEET_DEFS.StaffAssignments.length);
    rows.forEach(function(row, index) {
      if (normalizeShopId_(row[3]) === resetShopId) {
        assignmentSheet.getRange(index + 2, 5).setValue(false);
        assignmentSheet.getRange(index + 2, 7).setValue(new Date());
      }
    });
    var userAssignmentSheet = control.getSheetByName('UserAssignments');
    var userRows = _getSheetData(userAssignmentSheet, 2, null, TF_STANDARD_CONTROL_SHEET_DEFS.UserAssignments.length);
    userRows.forEach(function(row, index) {
      if (normalizeShopId_(row[4]) === resetShopId) {
        userAssignmentSheet.getRange(index + 2, 6).setValue(false);
        userAssignmentSheet.getRange(index + 2, 8).setValue(new Date());
        _standardRevokeUserSessions_(_normalizeString(row[1]));
      }
    });
  }
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

function setupOrRepairSheets(data, sessionToken, shopId) {
  try {
    const session = requirePortalSession_(sessionToken, 'super_admin');
    const resolvedShopId = isStandardMultiShopReady_() ? resolveStandardSessionShopId_(session, shopId) : TF_STANDARD_DEFAULT_SHOP_ID;
    const ss = isStandardMultiShopReady_() ? getStandardShopSpreadsheet_(resolvedShopId) : SpreadsheetApp.getActiveSpreadsheet();
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

    var mappingReviewSweepTrigger = { ok: false, skipped: true, reason: 'trigger installer unavailable' };
    if (typeof installNcpcMappingReviewSweepAt20 === 'function') {
      mappingReviewSweepTrigger = installNcpcMappingReviewSweepAt20();
    }

    return {
      success: true,
      message: 'Sheets ready: ' + Object.keys(results).filter(function(k) { return results[k]; }).join(', '),
      sheetsCreated: Object.keys(results).filter(function(k) { return results[k]; }),
      startedFresh: startedFresh,
      mappingReviewSweepTrigger: mappingReviewSweepTrigger,
      state: currentState,
      workflowTablesReady: ['BusinessProfile', 'Shops', 'Products', 'ProductBarcodes', 'InventoryBatches', 'SupplierDeliveries', 'RestockOrders', 'RestockOrderItems', 'StockAdjustments', 'POSSales', 'POSSaleItems', 'CustomerOrders', 'CustomerOrderItems', 'HandoverRequests', 'RevenueEntries', 'ExpenseEntries', 'Staff', 'BusinessSettings', 'BudgetHeader', 'BudgetItems', 'Notifications', 'CustomUnits', 'NcpcProductMappings', 'NcpcCorrectionRequests', 'SyncAudit']
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
  const setupPreflight = getTradeFlowSetupPreflight_();
  const result = {
    required: required,
    requireAdminPortalLogin: false,
    requireStaffPortalLogin: false,
    adminPortalUsername: '',
    setupPreflight: setupPreflight.public,
    setupBlocked: required && !setupPreflight.ready,
    supportCode: setupPreflight.supportCode
  };
  if (required) return result;

  if (isStandardMultiShopReady_()) {
    _standardSeedControlAccountsFromLegacy_();
    const users = _standardUserRows_();
    const owner = users.find(function(user) { return user.active && user.role === 'super_admin'; }) || null;
    result.requireAdminPortalLogin = users.some(function(user) { return user.active && (user.role === 'super_admin' || user.role === 'admin'); });
    result.requireStaffPortalLogin = users.some(function(user) { return user.active && user.role === 'staff'; });
    result.adminPortalUsername = owner ? owner.username : '';
    return result;
  }

  try {
    const state = getAppStateInternal_(ss);
    const settings = state.settings || {};
    result.requireAdminPortalLogin = settings.requireAdminPortalLogin === true;
    result.requireStaffPortalLogin = settings.requireStaffPortalLogin === true;
    result.adminPortalUsername = _normalizeString(settings.adminPortalUsername || '');
  } catch (e) {}

  const safe = ss.getSheetByName('SafeConfig');
  if (safe) {
    _getSheetData(safe, 2, null, 4).forEach(function(row) {
      const portal = _normalizeString(row[1]);
      const username = _normalizeString(row[2]);
      const passwordHash = _normalizeString(row[3]);
      if (portal === 'admin') {
        result.adminPortalUsername = username || result.adminPortalUsername;
        result.requireAdminPortalLogin = passwordHash !== '' && passwordHash !== EP_PORTAL_PASSWORD_NOT_SET;
      }
      if (portal === 'staff' && passwordHash !== '' && passwordHash !== EP_PORTAL_PASSWORD_NOT_SET) result.requireStaffPortalLogin = true;
    });
  }
  return result;
}

function completeFirstTimeSetup(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const existingAppState = ss.getSheetByName('AppState');
    if (existingAppState && existingAppState.getLastRow() >= 2) throw new Error('This business has already been set up. Sign in as the existing administrator.');
    const setupPreflight = getTradeFlowSetupPreflight_();
    if (!setupPreflight.ready) {
      throw new Error('This TradeFlow copy is not ready for business setup. Please call NDS technical support for assistance. Reference: ' + setupPreflight.supportCode + '.');
    }
    const businessName = _normalizeString(data && data.businessName);
    const businessType = _normalizeString(data && data.businessType) || 'retail_supermarket';
    const ownerName = _normalizeString(data && data.ownerName);
    const ownerEmail = _normalizeString(data && data.ownerEmail);
    const whatsapp = _normalizeString(data && data.whatsapp);
    const address = _normalizeString(data && data.address);
    const enabledFeatures = _normalizeStandardFeatures_(data && data.enabledFeatures);
    const adminUsername = _normalizeString(data && data.adminUsername).toLowerCase();
    const adminPassword = String((data && data.adminPassword) || '');
    if (!businessName || !ownerName || !whatsapp || !adminUsername || adminPassword.length < 8) throw new Error('Business name, owner name, phone/WhatsApp, super admin username, and an 8-character password are required.');
    if (!/^[a-z0-9._-]{3,64}$/i.test(adminUsername)) throw new Error('Admin username may use letters, numbers, dots, underscores, and hyphens only.');
    const setupShops = normalizeStandardSetupShops_(data && data.shops, businessName, { name: ownerName, email: ownerEmail, whatsapp: whatsapp });

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
      requireStaffPortalLogin: true,
      ncpcEnabled: true,
      ntheembaEnabled: false,
      enabledFeatures: enabledFeatures,
      setupCompleted: true
    });
    state.shops = setupShops;
    const primaryShop = setupShops.find(function(shop) { return shop.isPrimary === true; }) || setupShops[0];
    const primaryAddress = address || standardShopLocationLabel_(primaryShop.location || {});
    state.businessAddress = primaryAddress;
    state.settings.businessAddress = primaryAddress;
    state.activeShopId = primaryShop.id;
    state.settings.activeShopId = primaryShop.id;
    state.settings.shopLocation = primaryShop.location;
    const sourceModel = setupStandardMultiShopSourceModel_(state, setupShops, adminUsername);
    const superAdminUserId = _standardUpsertUser_({ userId: 'super-admin', displayName: ownerName, username: adminUsername, passwordHash: _hashPassword('admin', adminUsername, adminPassword), role: 'super_admin', active: true });
    saveAppStateInternal_(state);
    _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.super_admin.setup', primaryShop.id, { actor: adminUsername, userId: superAdminUserId, shopCount: sourceModel.shops.length, enabledFeatures: enabledFeatures, ncpcEnabled: true, ntheembaEnabled: false });
    const session = _createPortalSession_('admin', adminUsername, 'super_admin', superAdminUserId, primaryShop.id);
    const primaryState = getAppStateInternal_(getStandardShopSpreadsheet_(primaryShop.id));
    return { ok: true, state: projectStateForSession_(primaryState, { role: 'super_admin' }), sessionToken: session.token, expiresAt: session.expiresAt, accountRole: 'super_admin', userId: superAdminUserId, displayName: ownerName, shopId: primaryShop.id, multiShop: { configured: true, shopCount: sourceModel.shops.length } };
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

function _createPortalSession_(portal, username, role, userId, shopId) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = {
    sessionId: Utilities.getUuid(), portal: portal, username: username || '', role: role || 'admin',
    userId: _normalizeString(userId), shopId: normalizeShopId_(shopId), expiresAt: Date.now() + EP_SESSION_TTL_MS
  };
  PropertiesService.getScriptProperties().setProperty(_sessionPropertyKey_(token), JSON.stringify(session));
  _standardRecordSession_(token, session);
  return { token: token, expiresAt: session.expiresAt, role: session.role, userId: session.userId, shopId: session.shopId };
}

function requirePortalSession_(token, requiredRole) {
  const key = _sessionPropertyKey_(token);
  const props = PropertiesService.getScriptProperties();
  const session = _parseJson(props.getProperty(key));
  if (!session || !session.expiresAt || Number(session.expiresAt) <= Date.now()) {
    props.deleteProperty(key);
    _standardTouchSession_(token, session || {}, true);
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (isStandardMultiShopReady_()) {
    _standardSeedControlAccountsFromLegacy_();
    var user = session.userId ? _standardFindUserById_(session.userId) : _standardFindUserByUsername_(session.username);
    if (user) {
      if (!user.active) throw new Error('This account is inactive.');
      session.userId = user.userId;
      session.username = user.username;
      session.role = user.role;
      if ((session.role === 'admin' || session.role === 'staff') && !session.shopId) {
        var assignment = _standardAssignmentForUser_(user.userId);
        if (assignment) session.shopId = assignment.shopId;
      }
      props.setProperty(key, JSON.stringify(session));
    }
  }
  var allowed = !requiredRole || session.role === requiredRole || (requiredRole === 'admin' && session.role === 'super_admin') || (requiredRole === 'super_admin' && session.role === 'admin' && !isStandardMultiShopReady_());
  if (!allowed) throw new Error(requiredRole === 'super_admin' ? 'Super admin access is required.' : 'You are not authorized for this action.');
  _standardTouchSession_(token, session, false);
  return session;
}

function endPortalSession(token) {
  if (token) {
    _standardTouchSession_(token, {}, true);
    PropertiesService.getScriptProperties().deleteProperty(_sessionPropertyKey_(token));
  }
  return { ok: true };
}

function getPortalAuthStatus(data) {
  const portal = _normalizeString(data?.portal || '');
  if (!portal) return { error: true, message: 'Portal is required' };

  if (isStandardMultiShopReady_()) {
    _standardSeedControlAccountsFromLegacy_();
    var users = _standardUserRows_().filter(function(user) {
      return user.active && (portal === 'staff' ? user.role === 'staff' : (user.role === 'super_admin' || user.role === 'admin'));
    });
    var preferred = users.find(function(user) { return user.role === 'super_admin'; }) || users[0];
    return { portal: portal, passwordRequired: !!(preferred && preferred.passwordHash && preferred.passwordHash !== EP_PORTAL_PASSWORD_NOT_SET), username: preferred ? preferred.username : '', configuredAccounts: users.length };
  }

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

  if (isStandardMultiShopReady_()) {
    _standardSeedControlAccountsFromLegacy_();
    var user = _standardFindUserByUsername_(username);
    var portalAllowsRole = user && user.active && (portal === 'staff' ? user.role === 'staff' : (user.role === 'super_admin' || user.role === 'admin'));
    if (!portalAllowsRole) return { error: true, message: 'Invalid username or password' };
    var stored = _normalizeString(user.passwordHash);
    var passwordOk = stored === '' || stored === EP_PORTAL_PASSWORD_NOT_SET;
    if (!passwordOk && password) {
      var hashPortal = user.role === 'staff' ? 'staff' : 'admin';
      passwordOk = _hashPassword(hashPortal, user.username, password) === stored || String(password) === stored;
      if (passwordOk && String(password) === stored && stored.indexOf('sha256:') !== 0) {
        user.passwordHash = _hashPassword(hashPortal, user.username, password);
        _standardUpsertUser_(user);
      }
    }
    if (!passwordOk) return { error: true, message: 'Invalid username or password' };
    var assignment = (user.role === 'admin' || user.role === 'staff') ? _standardAssignmentForUser_(user.userId) : null;
    if ((user.role === 'admin' || user.role === 'staff') && !assignment) return { error: true, message: 'This account is not assigned to an active shop.' };
    var defaultShop = user.role === 'super_admin' ? getStandardShopById_('').id : assignment.shopId;
    var session = _createPortalSession_(portal, user.username, user.role, user.userId, defaultShop);
    _appendStandardControlAudit_(getStandardControlSpreadsheet_(), 'standard.login', defaultShop, { actor: user.username, role: user.role, userId: user.userId });
    return { success: true, portal: portal, username: user.username, accountRole: user.role, userId: user.userId, displayName: user.displayName, shopId: defaultShop, sessionToken: session.token, expiresAt: session.expiresAt };
  }

  // Staff credentials are matched against the staff record, not the generic
  // portal row. This prevents an unset generic staff password from granting a
  // session to every caller.
  if (portal === 'staff') {
    let staffSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let assignedShopId = TF_STANDARD_DEFAULT_SHOP_ID;
    if (isStandardMultiShopReady_()) {
      const assignment = _standardControlRows_('StaffAssignments').find(function(row) {
        return (row.Active === true || String(row.Active).toLowerCase() === 'true') && _normalizeString(row.Username).toLowerCase() === username.toLowerCase();
      });
      if (!assignment) return { error: true, message: 'Invalid username or password' };
      assignedShopId = normalizeShopId_(assignment['Shop ID']);
      staffSpreadsheet = getStandardShopSpreadsheet_(assignedShopId);
    }
    const state = getAppStateInternal_(staffSpreadsheet);
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
      saveAppStateInternal_(state, staffSpreadsheet);
    }
    const session = _createPortalSession_('staff', username, 'staff');
    return { success: true, portal: 'staff', username: username, staffId: staff.id, shopId: assignedShopId, sessionToken: session.token, expiresAt: session.expiresAt };
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
  requirePortalSession_(sessionToken, 'super_admin');
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
  if (isStandardMultiShopReady_()) return changeOwnStandardSuperAdminPassword(currentPassword, newPassword, sessionToken);
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

function exportReportTablesToSheets(bundle, sessionToken, shopId) {
  try {
    const session = requirePortalSession_(sessionToken);
    const resolvedShopId = isStandardMultiShopReady_() ? resolveStandardSessionShopId_(session, shopId) : TF_STANDARD_DEFAULT_SHOP_ID;
    const reportSs = isStandardMultiShopReady_() ? getStandardShopSpreadsheet_(resolvedShopId) : SpreadsheetApp.getActiveSpreadsheet();
    if (session.role === 'staff') {
      const state = getAppStateInternal_(reportSs);
      const access = (((state || {}).settings || {}).staffTabAccess || {}).reports || {};
      if (access.view !== true) throw new Error('You do not have access to reports.');
    }
    const ss = reportSs;

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
    const reportShopId = isStandardMultiShopReady_() ? resolveStandardSessionShopId_(session, session.shopId) : TF_STANDARD_DEFAULT_SHOP_ID;
    const reportStateSs = isStandardMultiShopReady_() ? getStandardShopSpreadsheet_(reportShopId) : SpreadsheetApp.getActiveSpreadsheet();
    const state = getAppStateInternal_(reportStateSs);
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
