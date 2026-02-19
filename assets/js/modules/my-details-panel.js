import { clearMessage, showMessage } from './notice.js';

function safeText(value) {
  const text = String(value ?? '').trim();
  return text || 'N/A';
}

function renderDisciplinaryList(target, items, emptyMessage) {
  if (!target) return;

  if (!Array.isArray(items) || items.length === 0) {
    target.innerHTML = `<li class="role-item"><span class="role-id">${emptyMessage}</span></li>`;
    return;
  }

  target.innerHTML = items
    .map((item) => {
      const status = safeText(item.record_status);
      const type = safeText(item.record_type);
      const date = safeText(item.record_date || item.created_at);
      const notes = safeText(item.notes);
      const issuedBy = safeText(item.issued_by);
      return `<li class="role-item"><span class="role-id">${type} | ${status} | ${date} | Issued By: ${issuedBy} | ${notes}</span></li>`;
    })
    .join('');
}

async function fetchMyDetails() {
  const response = await fetch('/api/me/details', { method: 'GET', credentials: 'include' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error || 'Unable to load profile details.');
  return payload;
}

export async function initMyDetailsPanel(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const accessPendingPanel = document.querySelector(config.accessPendingSelector);
  const detailsPanel = document.querySelector(config.detailsPanelSelector);
  const activeList = document.querySelector(config.activeDisciplinarySelector);
  const historyList = document.querySelector(config.disciplinaryHistorySelector);

  const fields = Object.fromEntries(
    Object.entries(config.fields || {}).map(([key, selector]) => [key, document.querySelector(selector)])
  );

  if (!feedback || !accessPendingPanel || !detailsPanel || !activeList || !historyList) return;

  try {
    const details = await fetchMyDetails();
    clearMessage(feedback);

    if (details.accessPending) {
      accessPendingPanel.classList.remove('hidden');
      detailsPanel.classList.add('hidden');
      return;
    }

    accessPendingPanel.classList.add('hidden');
    detailsPanel.classList.remove('hidden');

    const employee = details.employee || {};
    if (fields.robloxUsername) fields.robloxUsername.textContent = safeText(employee.robloxUsername);
    if (fields.robloxUserId) fields.robloxUserId.textContent = safeText(employee.robloxUserId);
    if (fields.rank) fields.rank.textContent = safeText(employee.rank);
    if (fields.grade) fields.grade.textContent = safeText(employee.grade);
    if (fields.serialNumber) fields.serialNumber.textContent = safeText(employee.serialNumber);
    if (fields.employeeStatus) fields.employeeStatus.textContent = safeText(employee.employeeStatus);
    if (fields.hireDate) fields.hireDate.textContent = safeText(employee.hireDate);
    if (fields.tenureDays) fields.tenureDays.textContent = safeText(employee.tenureDays);

    renderDisciplinaryList(activeList, details.activeDisciplinaryRecords || [], 'No active disciplinary records.');
    renderDisciplinaryList(historyList, details.disciplinaryHistory || [], 'No disciplinary history.');
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load My Details.', 'error');
  }
}
