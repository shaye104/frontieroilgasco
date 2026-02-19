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

export function saveAdminRoles(roleIds) {
  return requestJson('/api/admin/roles', {
    method: 'PUT',
    body: JSON.stringify({ roleIds })
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

export function listEmployees() {
  return requestJson('/api/admin/employees', { method: 'GET' });
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
