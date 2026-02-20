async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

export function getSession() {
  return requestJson('/api/auth/session', { method: 'GET' });
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

export function reorderAdminRole(payload) {
  return requestJson('/api/admin/roles/reorder', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getConfig(type) {
  return requestJson(`/api/admin/config/${type}`, { method: 'GET' });
}

export function createConfigValue(type, value) {
  return requestJson(`/api/admin/config/${type}`, {
    method: 'POST',
    body: JSON.stringify({ value })
  });
}

export function updateConfigValue(type, id, value) {
  return requestJson(`/api/admin/config/${type}`, {
    method: 'PUT',
    body: JSON.stringify({ id, value })
  });
}

export function deleteConfigValue(type, id) {
  return requestJson(`/api/admin/config/${type}?id=${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  });
}

export function listEmployees(options = {}) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/employees${suffix}`, { method: 'GET' });
}

export function createEmployee(employee) {
  return requestJson('/api/admin/employees', {
    method: 'POST',
    body: JSON.stringify(employee)
  });
}

export function getEmployee(employeeId) {
  return requestJson(`/api/admin/employees/${employeeId}`, { method: 'GET' });
}

export function updateEmployee(employeeId, employee) {
  return requestJson(`/api/admin/employees/${employeeId}`, {
    method: 'PUT',
    body: JSON.stringify(employee)
  });
}

export function addDisciplinary(employeeId, entry) {
  return requestJson(`/api/admin/employees/${employeeId}/disciplinary`, {
    method: 'POST',
    body: JSON.stringify(entry)
  });
}

export function addEmployeeNote(employeeId, entry) {
  return requestJson(`/api/admin/employees/${employeeId}/notes`, {
    method: 'POST',
    body: JSON.stringify(entry)
  });
}

export function listAccessRequests(status = '') {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return requestJson(`/api/admin/access-requests${suffix}`, { method: 'GET' });
}

export function processAccessRequest(payload) {
  return requestJson('/api/admin/access-requests', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getMyDetails() {
  return requestJson('/api/me/details', { method: 'GET' });
}

export function listAvailableForms() {
  return requestJson('/api/forms', { method: 'GET' });
}

export function getAvailableForm(formId) {
  return requestJson(`/api/forms/${formId}`, { method: 'GET' });
}

export function submitFormResponse(formId, payload) {
  return requestJson(`/api/forms/${formId}/responses`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function listFormCategories() {
  return requestJson('/api/admin/forms/categories', { method: 'GET' });
}

export function createFormCategory(payload) {
  return requestJson('/api/admin/forms/categories', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateFormCategory(payload) {
  return requestJson('/api/admin/forms/categories', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteFormCategory(categoryId) {
  return requestJson(`/api/admin/forms/categories?id=${encodeURIComponent(String(categoryId))}`, {
    method: 'DELETE'
  });
}

export function listFormsAdmin() {
  return requestJson('/api/admin/forms/forms', { method: 'GET' });
}

export function createFormAdmin(payload) {
  return requestJson('/api/admin/forms/forms', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getFormAdmin(formId) {
  return requestJson(`/api/admin/forms/forms/${formId}`, { method: 'GET' });
}

export function updateFormAdmin(formId, payload) {
  return requestJson(`/api/admin/forms/forms/${formId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteFormAdmin(formId) {
  return requestJson(`/api/admin/forms/forms/${formId}`, { method: 'DELETE' });
}

export function listFormResponses(filters = {}) {
  const params = new URLSearchParams();
  if (filters.formId) params.set('formId', String(filters.formId));
  if (filters.categoryId) params.set('categoryId', String(filters.categoryId));
  if (filters.employeeId) params.set('employeeId', String(filters.employeeId));
  if (filters.dateFrom) params.set('dateFrom', String(filters.dateFrom));
  if (filters.dateTo) params.set('dateTo', String(filters.dateTo));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/forms/responses${suffix}`, { method: 'GET' });
}

export function getFormResponse(responseId) {
  return requestJson(`/api/admin/forms/responses/${responseId}`, { method: 'GET' });
}

export function listAccessibleFormResponses(filters = {}) {
  const params = new URLSearchParams();
  if (filters.formId) params.set('formId', String(filters.formId));
  if (filters.categoryId) params.set('categoryId', String(filters.categoryId));
  if (filters.employeeId) params.set('employeeId', String(filters.employeeId));
  if (filters.dateFrom) params.set('dateFrom', String(filters.dateFrom));
  if (filters.dateTo) params.set('dateTo', String(filters.dateTo));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/forms/responses${suffix}`, { method: 'GET' });
}

export function getAccessibleFormResponse(responseId) {
  return requestJson(`/api/forms/responses/${responseId}`, { method: 'GET' });
}

export function listVoyages(options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.set('status', String(options.status));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.includeSetup) params.set('includeSetup', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/voyages${suffix}`, { method: 'GET' });
}

export function listActivityTracker(options = {}) {
  const params = new URLSearchParams();
  if (options.search) params.set('search', String(options.search));
  if (options.lessThan !== undefined && options.lessThan !== null && options.lessThan !== '') params.set('lessThan', String(options.lessThan));
  if (options.scope) params.set('scope', String(options.scope));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/admin/activity-tracker${suffix}`, { method: 'GET' });
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
  return requestJson(`/api/voyages/${voyageId}${suffix}`, { method: 'GET' });
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
  return requestJson(`/api/voyages/${voyageId}/cancel`, { method: 'DELETE' });
}

export function searchEmployees(options = {}) {
  const params = new URLSearchParams();
  if (options.username) params.set('username', String(options.username));
  if (options.serial) params.set('serial', String(options.serial));
  if (options.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson(`/api/employees/search${suffix}`, { method: 'GET' });
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

export function listCargoTypesAdmin() {
  return requestJson('/api/admin/cargo-types', { method: 'GET' });
}

export function createCargoType(payload) {
  return requestJson('/api/admin/cargo-types', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateCargoType(payload) {
  return requestJson('/api/admin/cargo-types', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteCargoType(cargoTypeId) {
  return requestJson(`/api/admin/cargo-types?id=${encodeURIComponent(String(cargoTypeId))}`, {
    method: 'DELETE'
  });
}
