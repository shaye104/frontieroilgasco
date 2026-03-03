const clientDataCache = new Map();

function nowMs() {
  return Date.now();
}

function cacheGet(key, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return null;
  const item = clientDataCache.get(key);
  if (!item) return null;
  if (nowMs() - item.ts > ttlMs) return null;
  return item.payload;
}

function cacheSet(key, payload) {
  clientDataCache.set(key, { ts: nowMs(), payload });
}

function clearDataCache() {
  clientDataCache.clear();
}

function markApiRequest(url) {
  if (typeof window === 'undefined') return;
  const route = window.location.pathname || '/';
  window.__fogRoutePerf = window.__fogRoutePerf || {};
  if (!window.__fogRoutePerf[route]) {
    window.__fogRoutePerf[route] = {
      startedAt: performance.now(),
      apiRequests: 0
    };
  }
  window.__fogRoutePerf[route].apiRequests += 1;
  if (window.__fogPerfVerbose) console.info('[perf] api', { route, url, requests: window.__fogRoutePerf[route].apiRequests });
}

async function requestJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const cacheTtlMs = Number(options.cacheTtlMs || 0);
  const cacheKey = String(options.cacheKey || `${method}:${url}`);
  const timeoutMs = Number(options.timeoutMs || 0);

  if (method === 'GET' && cacheTtlMs > 0) {
    const cached = cacheGet(cacheKey, cacheTtlMs);
    if (cached) return cached;
  }

  const fetchOptions = { ...options };
  delete fetchOptions.cacheTtlMs;
  delete fetchOptions.cacheKey;
  delete fetchOptions.timeoutMs;

  markApiRequest(url);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeoutHandle =
    controller && timeoutMs > 0
      ? setTimeout(() => {
          try {
            controller.abort('timeout');
          } catch {
            // no-op
          }
        }, timeoutMs)
      : null;
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(fetchOptions.headers || {}) },
    keepalive: method !== 'GET',
    signal: controller ? controller.signal : fetchOptions.signal,
    ...fetchOptions
  }).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });

  if (response.status === 304) {
    const cached = clientDataCache.get(cacheKey);
    if (cached?.payload) {
      cacheSet(cacheKey, cached.payload);
      return cached.payload;
    }
    // If browser/proxy returned 304 but in-memory cache is empty, retry once bypassing validators.
    const bust = url.includes('?') ? `&_rt=${Date.now()}` : `?_rt=${Date.now()}`;
    const retryResponse = await fetch(`${url}${bust}`, {
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        ...(fetchOptions.headers || {})
      },
      keepalive: method !== 'GET'
    });
    const retryPayload = await retryResponse.json().catch(() => ({}));
    if (!retryResponse.ok) throw new Error(retryPayload.error || `Request failed: ${retryResponse.status}`);
    if (method === 'GET' && cacheTtlMs > 0) {
      cacheSet(cacheKey, retryPayload);
    }
    return retryPayload;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);

  if (method === 'GET' && cacheTtlMs > 0) {
    cacheSet(cacheKey, payload);
  } else if (method !== 'GET') {
    clearDataCache();
  }

  return payload;
}

export function prefetchJson(url, options = {}) {
  return requestJson(url, { method: 'GET', cacheTtlMs: 30000, ...options }).catch(() => null);
}

export function getSession() {
  return requestJson('/api/auth/session', { method: 'GET' });
}

export function getOnboardingMe() {
  return requestJson('/api/onboarding/me', { method: 'GET' });
}

export function getMeBootstrap() {
  return requestJson('/api/me/bootstrap', {
    method: 'GET',
    timeoutMs: 8000,
    cacheTtlMs: 15000,
    cacheKey: 'GET:/api/me/bootstrap'
  });
}

export function getOnboardingBootstrap() {
  return requestJson('/api/onboarding/bootstrap', {
    method: 'GET',
    timeoutMs: 8000,
    cacheTtlMs: 0,
    cacheKey: 'GET:/api/onboarding/bootstrap',
    headers: {
      'cache-control': 'no-cache',
      pragma: 'no-cache'
    }
  });
}

export function submitOnboardingRobloxProfile(payload) {
  return requestJson('/api/onboarding/roblox-profile', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function submitOnboarding(payload) {
  return requestJson('/api/onboarding/submit', {
    method: 'POST',
    timeoutMs: 15000,
    body: JSON.stringify(payload)
  });
}

export function resolveRobloxIdentity(params = {}) {
  const query = new URLSearchParams();
  if (params.userId) query.set('userId', String(params.userId));
  if (params.username) query.set('username', String(params.username));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return requestJson(`/api/roblox/resolve${suffix}`, {
    method: 'GET',
    timeoutMs: 8000,
    cacheTtlMs: 30000,
    cacheKey: `GET:/api/roblox/resolve:${suffix}`
  });
}

export function verifyOnboardingRoblox(payload) {
  return requestJson('/api/onboarding/verify', {
    method: 'POST',
    timeoutMs: 15000,
    body: JSON.stringify(payload)
  });
}

export function getAdminRoles() {
  return requestJson('/api/admin/roles', { method: 'GET' });
}

export function createAdminRole(payload) {
  return requestJson('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateAdminRole(payload) {
  return requestJson('/api/admin/roles', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteAdminRole(roleId) {
  return requestJson(`/api/admin/roles?id=${encodeURIComponent(String(roleId))}`, {
    method: 'DELETE'
  });
}

export function listRoleMembers(roleId, query = '') {
  const params = new URLSearchParams();
  const q = String(query || '').trim();
  if (q) params.set('query', q);
  params.set('limit', '12');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/roles/${encodeURIComponent(String(roleId))}/members${suffix}`, { method: 'GET' });
}

export function addRoleMember(roleId, employeeId) {
  return requestJson(`/api/admin/roles/${encodeURIComponent(String(roleId))}/members`, {
    method: 'POST',
    body: JSON.stringify({ employeeId })
  });
}

export function removeRoleMember(roleId, employeeId) {
  return requestJson(
    `/api/admin/roles/${encodeURIComponent(String(roleId))}/members?employeeId=${encodeURIComponent(String(employeeId))}`,
    {
      method: 'DELETE'
    }
  );
}

export function reorderAdminRole(payload) {
  return requestJson('/api/admin/roles/reorder', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getConfig(type) {
  return requestJson(`/api/admin/config/${type}`, { method: 'GET' });
}

export function getEmployeeConfigBootstrap() {
  return requestJson('/api/admin/config/bootstrap', {
    method: 'GET',
    cacheTtlMs: 30000,
    cacheKey: 'GET:/api/admin/config/bootstrap'
  });
}

export function createConfigValue(type, value) {
  return requestJson(`/api/admin/config/${type}`, {
    method: 'POST',
    body: JSON.stringify(typeof value === 'object' && value !== null ? value : { value })
  });
}

export function updateConfigValue(type, id, value) {
  return requestJson(`/api/admin/config/${type}`, {
    method: 'PUT',
    body: JSON.stringify(typeof value === 'object' && value !== null ? { id, ...value } : { id, value })
  });
}

export function deleteConfigValue(type, id) {
  return requestJson(`/api/admin/config/${type}?id=${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  });
}

export function getConfigSettings(key = '') {
  const suffix = key ? `?key=${encodeURIComponent(String(key))}` : '';
  return requestJson(`/api/admin/config/settings${suffix}`, { method: 'GET', cacheTtlMs: 10000 });
}

export function setConfigSetting(key, value) {
  return requestJson('/api/admin/config/settings', {
    method: 'PATCH',
    body: JSON.stringify({ key, value })
  });
}

export function getSiteSettings() {
  return requestJson('/api/admin/site-settings', {
    method: 'GET',
    cacheTtlMs: 15000,
    cacheKey: 'GET:/api/admin/site-settings'
  });
}

export function saveSiteSettings(payload) {
  return requestJson('/api/admin/site-settings', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function listEmployees(options = {}) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.q) params.set('q', String(options.q));
  if (options.rank) params.set('rank', String(options.rank));
  if (options.grade) params.set('grade', String(options.grade));
  if (options.status) params.set('status', String(options.status));
  if (options.activationStatus) params.set('activationStatus', String(options.activationStatus));
  if (options.hireFrom) params.set('hireFrom', String(options.hireFrom));
  if (options.hireTo) params.set('hireTo', String(options.hireTo));
  if (options.hireDateFrom) params.set('hireDateFrom', String(options.hireDateFrom));
  if (options.hireDateTo) params.set('hireDateTo', String(options.hireDateTo));
  if (options.sortBy) params.set('sortBy', String(options.sortBy));
  if (options.sortDir) params.set('sortDir', String(options.sortDir));
  if (options.includeConfig) params.set('includeConfig', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/employees${suffix}`, {
    method: 'GET',
    cacheTtlMs: 15000,
    cacheKey: `GET:/api/admin/employees:${suffix}`
  });
}

export function createEmployee(employee) {
  return requestJson('/api/admin/employees', {
    method: 'POST',
    body: JSON.stringify(employee)
  });
}

export function checkEmployeeSerial(serial, options = {}) {
  const params = new URLSearchParams();
  if (serial) params.set('serial', String(serial).trim());
  if (options.employeeId) params.set('employeeId', String(options.employeeId));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/employees/serial${suffix}`, { method: 'GET', timeoutMs: 8000 });
}

export function suggestEmployeeSerial(options = {}) {
  const params = new URLSearchParams();
  params.set('random', '1');
  if (options.employeeId) params.set('employeeId', String(options.employeeId));
  return requestJson(`/api/admin/employees/serial?${params.toString()}`, { method: 'GET', timeoutMs: 8000 });
}

export function getEmployee(employeeId) {
  return requestJson(`/api/admin/employees/${employeeId}`, { method: 'GET', cacheTtlMs: 10000 });
}

export function getEmployeeDrawer(employeeId, options = {}) {
  const params = new URLSearchParams();
  if (options.activityPageSize) params.set('activityPageSize', String(options.activityPageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/employees/${employeeId}/drawer${suffix}`, {
    method: 'GET',
    cacheTtlMs: 10000,
    cacheKey: `GET:/api/admin/employees/${employeeId}/drawer:${suffix}`
  });
}

export function updateEmployee(employeeId, employee) {
  return requestJson(`/api/admin/employees/${employeeId}`, {
    method: 'PUT',
    body: JSON.stringify(employee)
  });
}

export function activateEmployee(employeeId) {
  return requestJson(`/api/admin/employees/${employeeId}/activate`, { method: 'POST' });
}

export function addDisciplinary(employeeId, entry) {
  return requestJson(`/api/admin/employees/${employeeId}/disciplinary`, {
    method: 'POST',
    body: JSON.stringify(entry)
  });
}

export function updateDisciplinary(employeeId, entry) {
  return requestJson(`/api/admin/employees/${employeeId}/disciplinary`, {
    method: 'PATCH',
    body: JSON.stringify(entry)
  });
}

export function addEmployeeNote(employeeId, entry) {
  return requestJson(`/api/admin/employees/${employeeId}/notes`, {
    method: 'POST',
    body: JSON.stringify(entry)
  });
}

export function deleteEmployee(employeeId, payload = {}) {
  return requestJson(`/api/admin/employees/${employeeId}`, {
    method: 'DELETE',
    body: JSON.stringify(payload)
  });
}

export function purgeUserByDiscord(payload = {}) {
  return requestJson('/api/admin/employees/purge', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getMyDetails() {
  return requestJson('/api/me/details', { method: 'GET', cacheTtlMs: 30000 });
}

export function listVoyages(options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.set('status', String(options.status));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.includeSetup) params.set('includeSetup', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/voyages${suffix}`, { method: 'GET', cacheTtlMs: 20000 });
}

export function getVoyageOverview(options = {}) {
  const params = new URLSearchParams();
  params.set('overview', '1');
  if (options.includeSetup) params.set('includeSetup', '1');
  if (options.archivedLimit) params.set('archivedLimit', String(options.archivedLimit));
  return requestJson(`/api/voyages?${params.toString()}`, { method: 'GET', cacheTtlMs: 20000 });
}

export function getFinancesOverview(range = 'month', unsettledScope = 'all') {
  const params = new URLSearchParams();
  params.set('range', String(range || 'month'));
  params.set('unsettledScope', String(unsettledScope || 'all'));
  return requestJson(`/api/finances/overview?${params.toString()}`, { method: 'GET', cacheTtlMs: 20000 });
}

export function listFinanceDebts(options = {}) {
  const params = new URLSearchParams();
  if (options.search) params.set('search', String(options.search));
  if (options.minOutstanding !== undefined && options.minOutstanding !== null && String(options.minOutstanding).trim() !== '') {
    params.set('minOutstanding', String(options.minOutstanding));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/finances/debts${suffix}`, { method: 'GET', cacheTtlMs: 15000 });
}

export function settleFinanceDebt(voyageId) {
  return requestJson(`/api/finances/debts/${encodeURIComponent(String(voyageId))}/settle`, { method: 'POST' });
}

export function listFinanceAudit(options = {}) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/finances/audit${suffix}`, { method: 'GET', cacheTtlMs: 15000 });
}

export function listActivityTracker(options = {}) {
  const params = new URLSearchParams();
  if (options.search) params.set('search', String(options.search));
  if (options.dateFrom) params.set('dateFrom', String(options.dateFrom));
  if (options.dateTo) params.set('dateTo', String(options.dateTo));
  if (options.minVoyages !== undefined && options.minVoyages !== null && String(options.minVoyages).trim() !== '') {
    params.set('minVoyages', String(options.minVoyages));
  }
  if (options.quotaFilter) params.set('quotaFilter', String(options.quotaFilter));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/activity-tracker${suffix}`, {
    method: 'GET',
    cacheTtlMs: 10000,
    cacheKey: `GET:/api/admin/activity-tracker:${suffix}`
  });
}

export function getActivityTrackerCsvUrl(options = {}) {
  const params = new URLSearchParams();
  if (options.search) params.set('search', String(options.search));
  if (options.dateFrom) params.set('dateFrom', String(options.dateFrom));
  if (options.dateTo) params.set('dateTo', String(options.dateTo));
  if (options.minVoyages !== undefined && options.minVoyages !== null && String(options.minVoyages).trim() !== '') {
    params.set('minVoyages', String(options.minVoyages));
  }
  if (options.quotaFilter) params.set('quotaFilter', String(options.quotaFilter));
  params.set('format', 'csv');
  return `/api/admin/activity-tracker?${params.toString()}`;
}

export function listAuditLog(options = {}) {
  const params = new URLSearchParams();
  if (options.search) params.set('search', String(options.search));
  if (options.actionType) params.set('actionType', String(options.actionType));
  if (options.actor) params.set('actor', String(options.actor));
  if (options.targetEmployeeId) params.set('targetEmployeeId', String(options.targetEmployeeId));
  if (options.dateFrom) params.set('dateFrom', String(options.dateFrom));
  if (options.dateTo) params.set('dateTo', String(options.dateTo));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/activity${suffix}`, {
    method: 'GET',
    cacheTtlMs: 10000,
    cacheKey: `GET:/api/admin/activity:${suffix}`
  });
}

export function getAuditLogCsvUrl(options = {}) {
  const params = new URLSearchParams();
  if (options.search) params.set('search', String(options.search));
  if (options.actionType) params.set('actionType', String(options.actionType));
  if (options.actor) params.set('actor', String(options.actor));
  if (options.targetEmployeeId) params.set('targetEmployeeId', String(options.targetEmployeeId));
  if (options.dateFrom) params.set('dateFrom', String(options.dateFrom));
  if (options.dateTo) params.set('dateTo', String(options.dateTo));
  params.set('format', 'csv');
  return `/api/admin/activity?${params.toString()}`;
}

export function getRankPermissions() {
  return requestJson('/api/admin/rank-permissions', { method: 'GET' });
}

export function saveRankPermissions(rankValue, permissionKeys) {
  return requestJson('/api/admin/rank-permissions', {
    method: 'PUT',
    body: JSON.stringify({ rankValue, permissionKeys })
  });
}

export function listUserRanks() {
  return requestJson('/api/admin/user-ranks', { method: 'GET' });
}

export function getUserRankLinks(rankId) {
  return requestJson(`/api/admin/user-ranks/${encodeURIComponent(String(rankId))}/links`, {
    method: 'GET',
    cacheTtlMs: 15000
  });
}

export function addUserRankDiscordRoleLink(rankId, payload) {
  return requestJson(`/api/admin/user-ranks/${encodeURIComponent(String(rankId))}/links`, {
    method: 'POST',
    body: JSON.stringify({
      linkType: 'discord',
      discordRoleId: payload?.discordRoleId,
      discordRoleName: payload?.discordRoleName || '',
      guildId: payload?.guildId || ''
    })
  });
}

export function removeUserRankDiscordRoleLink(rankId, discordRoleId) {
  return requestJson(
    `/api/admin/user-ranks/${encodeURIComponent(String(rankId))}/links?linkType=discord&discordRoleId=${encodeURIComponent(
      String(discordRoleId || '')
    )}`,
    {
      method: 'DELETE'
    }
  );
}

export function addUserRankGroupLink(rankId, groupKey) {
  return requestJson(`/api/admin/user-ranks/${encodeURIComponent(String(rankId))}/links`, {
    method: 'POST',
    body: JSON.stringify({
      linkType: 'group',
      groupKey
    })
  });
}

export function removeUserRankGroupLink(rankId, groupKey) {
  return requestJson(
    `/api/admin/user-ranks/${encodeURIComponent(String(rankId))}/links?linkType=group&groupKey=${encodeURIComponent(String(groupKey || ''))}`,
    {
      method: 'DELETE'
    }
  );
}

export function getUserRankPermissions(rankId) {
  return requestJson(`/api/admin/user-ranks/${encodeURIComponent(String(rankId))}/permissions`, {
    method: 'GET',
    cacheTtlMs: 15000
  });
}

export function saveUserRankPermissions(rankId, permissionKeys) {
  return requestJson(`/api/admin/user-ranks/${encodeURIComponent(String(rankId))}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissionKeys })
  });
}

export function createUserRank(payload) {
  return requestJson('/api/admin/user-ranks', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateUserRank(payload) {
  return requestJson('/api/admin/user-ranks', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteUserRank(rankId) {
  return requestJson(`/api/admin/user-ranks?id=${encodeURIComponent(String(rankId))}`, {
    method: 'DELETE'
  });
}

export function startVoyage(payload) {
  return requestJson('/api/voyages', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getVoyage(voyageId, options = {}) {
  const params = new URLSearchParams();
  if (options.includeSetup) params.set('includeSetup', '1');
  if (options.includeManifest) params.set('includeManifest', '1');
  if (options.includeLogs) params.set('includeLogs', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/voyages/${voyageId}${suffix}`, { method: 'GET', cacheTtlMs: 15000 });
}

export function updateVoyageManifest(voyageId, lines) {
  return requestJson(`/api/voyages/${voyageId}/manifest`, {
    method: 'PUT',
    body: JSON.stringify({ lines })
  });
}

export function getVoyageManifest(voyageId) {
  return requestJson(`/api/voyages/${voyageId}/manifest`, { method: 'GET' });
}

export function updateVoyageDetails(voyageId, payload) {
  return requestJson(`/api/voyages/${voyageId}/details`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function createVoyageLog(voyageId, message) {
  return requestJson(`/api/voyages/${voyageId}/logs`, {
    method: 'POST',
    body: JSON.stringify({ message })
  });
}

export function listVoyageLogs(voyageId, options = {}) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/voyages/${voyageId}/logs${suffix}`, { method: 'GET' });
}

export function updateVoyageLog(voyageId, logId, message) {
  return requestJson(`/api/voyages/${voyageId}/logs/${logId}`, {
    method: 'PUT',
    body: JSON.stringify({ message })
  });
}

export function endVoyage(voyageId, payload) {
  return requestJson(`/api/voyages/${voyageId}/end`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateVoyageShipStatus(voyageId, shipStatus) {
  return requestJson(`/api/voyages/${voyageId}/ship-status`, {
    method: 'PUT',
    body: JSON.stringify({ shipStatus })
  });
}

export function cancelVoyage(voyageId) {
  return requestJson(`/api/voyages/${voyageId}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'cancel' })
  }).catch(async (error) => {
    const status = Number(error?.status || 0);
    if (status && status !== 404 && status !== 405) throw error;

    try {
      return await requestJson(`/api/voyages/${voyageId}`, { method: 'DELETE' });
    } catch (deleteError) {
      const deleteStatus = Number(deleteError?.status || 0);
      if (deleteStatus && deleteStatus !== 404 && deleteStatus !== 405) throw deleteError;
    }

    try {
      return await requestJson(`/api/voyages/${voyageId}/cancel`, { method: 'DELETE' });
    } catch (legacyDeleteError) {
      const legacyStatus = Number(legacyDeleteError?.status || 0);
      if (legacyStatus && legacyStatus !== 405) throw legacyDeleteError;
    }

    return requestJson(`/api/voyages/${voyageId}/cancel`, { method: 'POST' });
  });
}

export function deleteVoyage(voyageId, payload) {
  return requestJson(`/api/voyages/${voyageId}/delete`, {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
}

export function searchEmployees(options = {}) {
  const params = new URLSearchParams();
  if (options.username) params.set('username', String(options.username));
  if (options.serial) params.set('serial', String(options.serial));
  if (options.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/employees/search${suffix}`, {
    method: 'GET',
    cacheTtlMs: 10000,
    cacheKey: `GET:/api/employees/search:${suffix}`
  });
}

export function listCargoTypes(includeInactive = false) {
  return requestJson(`/api/cargo-types${includeInactive ? '?includeInactive=1' : ''}`, { method: 'GET' });
}

export function listVoyageConfig() {
  return requestJson('/api/voyage-config', { method: 'GET' });
}

export function listVoyageConfigAdmin(type) {
  return requestJson(`/api/admin/voyage-config/${encodeURIComponent(type)}`, { method: 'GET' });
}

export function createVoyageConfigValue(type, value) {
  return requestJson(`/api/admin/voyage-config/${encodeURIComponent(type)}`, {
    method: 'POST',
    body: JSON.stringify({ value })
  });
}

export function updateVoyageConfigValue(type, id, value) {
  return requestJson(`/api/admin/voyage-config/${encodeURIComponent(type)}`, {
    method: 'PUT',
    body: JSON.stringify({ id, value })
  });
}

export function deleteVoyageConfigValue(type, id) {
  return requestJson(`/api/admin/voyage-config/${encodeURIComponent(type)}?id=${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  });
}

export function sendLiveNotification(payload) {
  return requestJson('/api/live-notify', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  })
    .catch(async (error) => {
      const statusMatch = /(\d{3})$/.exec(String(error?.message || ''));
      const status = Number(statusMatch?.[1] || 0);
      if (status && status !== 404 && status !== 405) throw error;
      return requestJson('/api/notifications/send', {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    })
    .catch(async (error) => {
      const statusMatch = /(\d{3})$/.exec(String(error?.message || ''));
      const status = Number(statusMatch?.[1] || 0);
      if (status && status !== 404 && status !== 405) throw error;
      return requestJson('/api/notifications', {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    });
}

export function getLiveNotifications(sinceId = 0) {
  const params = new URLSearchParams();
  if (Number(sinceId) > 0) params.set('sinceId', String(Number(sinceId)));
  params.set('limit', '30');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/notifications/live${suffix}`, {
    method: 'GET',
    cacheTtlMs: 0,
    headers: {
      'cache-control': 'no-cache',
      pragma: 'no-cache'
    }
  });
}

export function prefetchRouteData(pathname, session) {
  const route = String(pathname || '').replace(/\/+$/, '') || '/';
  if (route === '/my-details') {
    return prefetchJson('/api/me/details');
  }
  if (route === '/voyages/my' || route === '/voyages') {
    return prefetchJson('/api/voyages?overview=1&includeSetup=1&archivedLimit=6');
  }
  if (route === '/finances') {
    return prefetchJson('/api/finances/overview?range=month&unsettledScope=all');
  }
  if (route === '/finances/debts') {
    return prefetchJson('/api/finances/debts');
  }
  if (route === '/finances/cashflow') {
    return prefetchJson('/api/finances/cashflow?range=month&page=1&pageSize=15');
  }
  if (route === '/finances/audit') {
    return prefetchJson('/api/finances/audit?page=1&pageSize=25');
  }
  if (route === '/admin') {
    const permissions = Array.isArray(session?.permissions) ? session.permissions : [];
    const isAdmin = Boolean(
      session?.isAdmin ||
        permissions.includes('super.admin') ||
        permissions.includes('admin.override') ||
        permissions.includes('employees.read') ||
        permissions.includes('voyages.config.manage') ||
        permissions.includes('user_groups.manage') ||
        permissions.includes('user_ranks.manage') ||
        permissions.includes('config.manage') ||
        permissions.includes('activity_tracker.view')
    );
    if (!isAdmin) return Promise.resolve(null);
    return prefetchJson('/api/admin/employees?page=1&pageSize=20');
  }
  if (route === '/admin/activity') {
    return prefetchJson('/api/admin/activity-tracker?page=1&pageSize=25');
  }
  if (route === '/admin/audit') {
    return prefetchJson('/api/admin/activity?page=1&pageSize=25');
  }
  return Promise.resolve(null);
}
