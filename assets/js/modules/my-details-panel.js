import { clearMessage, showMessage } from './notice.js';

function safeText(value) {
  const text = String(value ?? '').trim();
  return text || 'N/A';
}

function applyStatusBadgeClass(element, statusValue) {
  if (!element) return;
  element.classList.remove('is-active', 'is-inactive');
  const status = String(statusValue || '').trim().toLowerCase();
  if (!status) return;
  if (status === 'active') {
    element.classList.add('is-active');
    return;
  }
  if (status === 'terminated' || status === 'suspended' || status === 'inactive') {
    element.classList.add('is-inactive');
  }
}

function renderDisciplinaryList(target, items, emptyMessage) {
  if (!target) return;

  if (!Array.isArray(items) || items.length === 0) {
    target.innerHTML = `<li class="discipline-empty"><span class="discipline-empty-icon" aria-hidden="true">i</span><span>${emptyMessage}</span></li>`;
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

function initDisciplineTabs() {
  const activeButton = document.querySelector('#disciplineTabActive');
  const historyButton = document.querySelector('#disciplineTabHistory');
  const activePanel = document.querySelector('#disciplinePanelActive');
  const historyPanel = document.querySelector('#disciplinePanelHistory');

  if (!activeButton || !historyButton || !activePanel || !historyPanel) return;
  if (activeButton.dataset.bound === '1') return;
  activeButton.dataset.bound = '1';

  const setTab = (tab) => {
    const showActive = tab === 'active';
    activeButton.classList.toggle('is-active', showActive);
    historyButton.classList.toggle('is-active', !showActive);
    activeButton.setAttribute('aria-selected', showActive ? 'true' : 'false');
    historyButton.setAttribute('aria-selected', showActive ? 'false' : 'true');
    activePanel.classList.toggle('hidden', !showActive);
    historyPanel.classList.toggle('hidden', showActive);
  };

  activeButton.addEventListener('click', () => setTab('active'));
  historyButton.addEventListener('click', () => setTab('history'));
  setTab('active');
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
    if (fields.totalVoyages) fields.totalVoyages.textContent = String(Number(details?.voyageActivity?.totalVoyages || 0));
    if (fields.monthlyVoyages) fields.monthlyVoyages.textContent = String(Number(details?.voyageActivity?.monthlyVoyages || 0));
    if (fields.identityUsername) fields.identityUsername.textContent = safeText(employee.robloxUsername);
    if (fields.identityRankBadge) fields.identityRankBadge.textContent = safeText(employee.rank);
    if (fields.identityStatusBadge) fields.identityStatusBadge.textContent = safeText(employee.employeeStatus);
    if (fields.profileUsername) fields.profileUsername.textContent = safeText(employee.robloxUsername);
    if (fields.profileSerial) fields.profileSerial.textContent = `Serial: ${safeText(employee.serialNumber)}`;
    if (fields.profileRankBadge) fields.profileRankBadge.textContent = safeText(employee.rank);
    if (fields.profileStatusBadge) fields.profileStatusBadge.textContent = safeText(employee.employeeStatus);

    applyStatusBadgeClass(fields.identityStatusBadge, employee.employeeStatus);
    applyStatusBadgeClass(fields.profileStatusBadge, employee.employeeStatus);

    renderDisciplinaryList(activeList, details.activeDisciplinaryRecords || [], 'No active disciplinary records.');
    renderDisciplinaryList(historyList, details.disciplinaryHistory || [], 'No disciplinary history.');
    initDisciplineTabs();
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load My Details.', 'error');
  }
}
