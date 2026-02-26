import { addDisciplinary, addEmployeeNote, createEmployee, getConfig, getEmployeeDrawer, listEmployees } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

const VISIBLE_COLUMNS_STORAGE_KEY = 'manageEmployees_visibleColumns';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value, withTime = false) {
  const raw = String(value || '').trim();
  if (!raw) return 'N/A';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

function statusClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'on duty') return 'is-active';
  if (normalized === 'suspended') return 'is-suspended';
  if (normalized === 'inactive' || normalized === 'terminated' || normalized === 'on leave') return 'is-inactive';
  return '';
}

function fillOptions(select, items, placeholder = 'All') {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.value)}</option>`).join('');
  if (current) select.value = current;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

const DEFAULT_VISIBLE_COLUMNS = ['roblox_username', 'roblox_user_id', 'rank', 'grade', 'serial_number', 'employee_status', 'hire_date'];
const COLUMN_LABELS = {
  roblox_username: 'Roblox Username',
  roblox_user_id: 'Roblox User ID',
  rank: 'Rank',
  grade: 'Grade',
  serial_number: 'Serial',
  employee_status: 'Status',
  hire_date: 'Hire Date'
};

function loadVisibleColumns() {
  try {
    const raw = window.localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_VISIBLE_COLUMNS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_VISIBLE_COLUMNS);
    const valid = parsed.filter((key) => Object.prototype.hasOwnProperty.call(COLUMN_LABELS, key));
    if (!valid.length) return new Set(DEFAULT_VISIBLE_COLUMNS);
    return new Set(valid);
  } catch {
    return new Set(DEFAULT_VISIBLE_COLUMNS);
  }
}

function saveVisibleColumns(columns) {
  try {
    window.localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify([...columns]));
  } catch {
    // best effort only
  }
}

function employeeRowSkeleton() {
  return `<tr>
    <td><span class="skeleton-line skeleton-w-55"></span></td>
    <td><span class="skeleton-line skeleton-w-80"></span></td>
    <td><span class="skeleton-line skeleton-w-70"></span></td>
    <td><span class="skeleton-line skeleton-w-55"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-60"></span></td>
    <td><span class="skeleton-line skeleton-w-55"></span></td>
    <td><span class="skeleton-line skeleton-w-60"></span></td>
  </tr>`;
}

function renderStatCards(payload) {
  const counts = payload?.meta?.counts || null;
  const overview = payload?.overview || null;
  const totalNode = document.querySelector('#employeeStatTotal');
  const activeNode = document.querySelector('#employeeStatActive');
  const inactiveNode = document.querySelector('#employeeStatInactive');
  const newHiresNode = document.querySelector('#employeeStatNewHires');

  const total = Number(counts?.total ?? overview?.totalEmployees ?? 0);
  const active = Number(counts?.active ?? overview?.activeEmployees ?? 0);
  const inactive = Number(counts?.inactiveSuspended ?? overview?.inactiveEmployees ?? 0);
  const newHires = Number(counts?.newHires30d ?? overview?.newHires30d ?? 0);

  if (totalNode) totalNode.textContent = String(total);
  if (activeNode) activeNode.textContent = String(active);
  if (inactiveNode) inactiveNode.textContent = String(inactive);
  if (newHiresNode) newHiresNode.textContent = String(newHires);
}

function renderSortHeaders(sortBy, sortDir) {
  document.querySelectorAll('.table-sort-btn').forEach((btn) => {
    const key = String(btn.getAttribute('data-sort') || '');
    if (!key) return;
    const active = key === sortBy;
    const baseLabel = String(btn.getAttribute('data-label') || btn.textContent || '').replace(/[↑↓]/g, '').trim();
    btn.setAttribute('data-label', baseLabel);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-sort', active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    btn.textContent = `${baseLabel}${active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`;
  });
}

function renderTable(target, employees, visibleColumns) {
  if (!target) return;
  if (!employees.length) {
    target.innerHTML = '<tr><td colspan="8">No employees found for the selected filters.</td></tr>';
    return;
  }

  target.innerHTML = employees
    .map(
      (emp) => `
      <tr class="admin-employee-row" data-employee-id="${Number(emp.id)}">
        <td>${Number(emp.id)}</td>
        <td data-col="roblox_username">${escapeHtml(text(emp.roblox_username))}</td>
        <td data-col="roblox_user_id">${escapeHtml(text(emp.roblox_user_id))}</td>
        <td data-col="rank">${escapeHtml(text(emp.rank))}</td>
        <td data-col="grade">${escapeHtml(text(emp.grade))}</td>
        <td data-col="serial_number">${escapeHtml(text(emp.serial_number))}</td>
        <td data-col="employee_status"><span class="badge badge-status ${statusClass(emp.employee_status)}">${escapeHtml(text(emp.employee_status))}</span></td>
        <td data-col="hire_date">${escapeHtml(formatDate(emp.hire_date))}</td>
      </tr>`
    )
    .join('');

  target.querySelectorAll('[data-col]').forEach((cell) => {
    const col = String(cell.getAttribute('data-col') || '');
    if (col && !visibleColumns.has(col)) cell.classList.add('hidden');
  });
}

function renderDrawerOverview(target, payload) {
  if (!target) return;
  const employee = payload?.employee || {};
  target.innerHTML = `
    <div class="profile-kv-grid">
      <dt>Roblox Username</dt><dd>${escapeHtml(text(employee.roblox_username))}</dd>
      <dt>Roblox User ID</dt><dd>${escapeHtml(text(employee.roblox_user_id))}</dd>
      <dt>Rank</dt><dd>${escapeHtml(text(employee.rank))}</dd>
      <dt>Grade</dt><dd>${escapeHtml(text(employee.grade))}</dd>
      <dt>Serial</dt><dd>${escapeHtml(text(employee.serial_number))}</dd>
      <dt>Status</dt><dd><span class="badge badge-status ${statusClass(employee.employee_status)}">${escapeHtml(text(employee.employee_status))}</span></dd>
      <dt>Hire Date</dt><dd>${escapeHtml(formatDate(employee.hire_date))}</dd>
      <dt>Last Updated</dt><dd>${escapeHtml(formatDate(employee.updated_at, true))}</dd>
    </div>
  `;
}

function renderDrawerVoyages(target, payload) {
  if (!target) return;
  const voyages = Array.isArray(payload?.recentVoyages) ? payload.recentVoyages : [];
  if (!voyages.length) {
    target.innerHTML = '<p class="finance-inline-caption">No recent voyages found.</p>';
    return;
  }
  target.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Vessel</th><th>Route</th><th>Status</th><th>Ended</th><th class="align-right">Net Profit</th></tr>
        </thead>
        <tbody>
          ${voyages
            .map(
              (voyage) => `<tr>
              <td>${escapeHtml(text(voyage.vessel_name))} (${escapeHtml(text(voyage.vessel_callsign))})</td>
              <td>${escapeHtml(text(voyage.departure_port))} → ${escapeHtml(text(voyage.destination_port))}</td>
              <td>${escapeHtml(text(voyage.status))}</td>
              <td>${escapeHtml(formatDate(voyage.ended_at || voyage.started_at, true))}</td>
              <td class="align-right">ƒ ${Math.round(Number(voyage.net_profit || 0)).toLocaleString()}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function renderDrawerActivity(target, payload) {
  if (!target) return;
  const activity = Array.isArray(payload?.activity) ? payload.activity : [];
  if (!activity.length) {
    target.innerHTML = '<p class="finance-inline-caption">No activity records found for this employee.</p>';
    return;
  }
  target.innerHTML = `
    <ul class="role-list">
      ${activity
        .map(
          (entry) => `
        <li class="role-item">
          <div>
            <strong>${escapeHtml(text(entry.actionType))}</strong>
            <p class="finance-inline-caption">${escapeHtml(text(entry.summary))}</p>
            <p class="finance-inline-caption">${escapeHtml(formatDate(entry.createdAt, true))}</p>
          </div>
          <span class="role-id">${escapeHtml(text(entry.actorName || entry.actorDiscordId || 'System'))}</span>
        </li>
      `
        )
        .join('')}
    </ul>`;
}

function isSystemNote(noteText) {
  const value = String(noteText || '').trim().toLowerCase();
  return value.startsWith('[activity]') || value.startsWith('[system]');
}

function renderDrawerNotes(target, payload, showSystem, notesFeedback, selectedEmployeeId, refreshDrawerData, setShowSystem) {
  if (!target) return;
  const allNotes = Array.isArray(payload?.notes) ? payload.notes : [];
  const canAddNotes = Boolean(payload?.capabilities?.canAddNotes);
  const notes = showSystem ? allNotes : allNotes.filter((note) => !isSystemNote(note.note));

  target.innerHTML = `
    <div class="button-row">
      <label class="finance-toggle-wrap"><input id="drawerSystemNotesToggle" type="checkbox" ${showSystem ? 'checked' : ''}/> Show system messages</label>
    </div>
    ${
      canAddNotes
        ? `<form id="drawerAddNoteForm" class="finance-cashflow-entry-form">
      <div>
        <label for="drawerNoteCategory">Category</label>
        <select id="drawerNoteCategory" name="category">
          <option value="">General</option>
          <option value="Info">Info</option>
          <option value="Warning">Warning</option>
          <option value="Performance">Performance</option>
          <option value="HR">HR</option>
        </select>
      </div>
      <div class="finance-cashflow-entry-wide">
        <label for="drawerNoteBody">Note</label>
        <textarea id="drawerNoteBody" name="note" rows="3" minlength="2" required></textarea>
      </div>
      <div class="finance-cashflow-entry-wide finance-cashflow-entry-actions">
        <button class="btn btn-primary" type="submit">Add Note</button>
      </div>
    </form>`
        : '<p class="finance-inline-caption">You do not have permission to add notes.</p>'
    }
    <div id="drawerNotesFeedback" class="feedback" role="status" aria-live="polite"></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Created</th><th>Author</th><th>Note</th></tr></thead>
        <tbody>
          ${notes.length ? notes
            .map((entry) => `<tr><td>${escapeHtml(formatDate(entry.created_at, true))}</td><td>${escapeHtml(text(entry.authored_by || 'System'))}</td><td>${escapeHtml(text(entry.note))}</td></tr>`)
            .join('') : '<tr><td colspan="3">No notes found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const feedbackNode = target.querySelector('#drawerNotesFeedback');
  if (feedbackNode && notesFeedback?.message) showMessage(feedbackNode, notesFeedback.message, notesFeedback.type || 'info');

  const toggle = target.querySelector('#drawerSystemNotesToggle');
  toggle?.addEventListener('change', () => {
    const nextShowSystem = Boolean(toggle.checked);
    if (typeof setShowSystem === 'function') setShowSystem(nextShowSystem);
    renderDrawerNotes(target, payload, nextShowSystem, null, selectedEmployeeId, refreshDrawerData, setShowSystem);
  });

  const form = target.querySelector('#drawerAddNoteForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const note = String(fd.get('note') || '').trim();
    if (!note) return;
    try {
      await addEmployeeNote(selectedEmployeeId, {
        category: String(fd.get('category') || '').trim(),
        note
      });
      await refreshDrawerData(selectedEmployeeId, {
        force: true,
        feedback: { message: 'Note added.', type: 'success' },
        tab: 'notes',
        showSystem: Boolean(toggle?.checked)
      });
    } catch (error) {
      renderDrawerNotes(
        target,
        payload,
        Boolean(toggle?.checked),
        { message: error.message || 'Unable to add note.', type: 'error' },
        selectedEmployeeId,
        refreshDrawerData,
        setShowSystem
      );
    }
  });
}

function renderDrawerDisciplinary(target, payload, disciplinaryFeedback, selectedEmployeeId, refreshDrawerData) {
  if (!target) return;
  const records = Array.isArray(payload?.disciplinaries) ? payload.disciplinaries : [];
  const canAddDisciplinary = Boolean(payload?.capabilities?.canAddDisciplinary);

  target.innerHTML = `
    ${
      canAddDisciplinary
        ? `<form id="drawerAddDisciplinaryForm" class="finance-cashflow-entry-form">
      <div>
        <label for="drawerRecordType">Action Type</label>
        <input id="drawerRecordType" name="recordType" type="text" required placeholder="Warning, Suspension, Demotion" />
      </div>
      <div>
        <label for="drawerRecordStatus">Status</label>
        <select id="drawerRecordStatus" name="recordStatus"><option value="open">Open</option><option value="resolved">Resolved</option></select>
      </div>
      <div>
        <label for="drawerRecordDate">Record Date</label>
        <input id="drawerRecordDate" name="recordDate" type="date" />
      </div>
      <div class="finance-cashflow-entry-wide">
        <label for="drawerRecordReason">Reason / Notes</label>
        <textarea id="drawerRecordReason" name="reason" rows="3" minlength="2"></textarea>
      </div>
      <div class="finance-cashflow-entry-wide finance-cashflow-entry-actions">
        <button class="btn btn-primary" type="submit">Add Disciplinary Record</button>
      </div>
    </form>`
        : '<p class="finance-inline-caption">You do not have permission to add disciplinary records.</p>'
    }
    <div id="drawerDisciplinaryFeedback" class="feedback" role="status" aria-live="polite"></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Date</th><th>Type</th><th>Status</th><th>Issued By</th><th>Notes</th></tr></thead>
        <tbody>
          ${records.length ? records
            .map((entry) => `<tr><td>${escapeHtml(formatDate(entry.record_date || entry.created_at))}</td><td>${escapeHtml(text(entry.record_type))}</td><td><span class="badge badge-status ${statusClass(entry.record_status)}">${escapeHtml(text(entry.record_status))}</span></td><td>${escapeHtml(text(entry.issued_by || 'System'))}</td><td>${escapeHtml(text(entry.notes))}</td></tr>`)
            .join('') : '<tr><td colspan="5">No disciplinary records found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const feedbackNode = target.querySelector('#drawerDisciplinaryFeedback');
  if (feedbackNode && disciplinaryFeedback?.message) showMessage(feedbackNode, disciplinaryFeedback.message, disciplinaryFeedback.type || 'info');

  const form = target.querySelector('#drawerAddDisciplinaryForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    try {
      await addDisciplinary(selectedEmployeeId, {
        recordType: String(fd.get('recordType') || '').trim(),
        recordStatus: String(fd.get('recordStatus') || '').trim(),
        recordDate: String(fd.get('recordDate') || '').trim(),
        reason: String(fd.get('reason') || '').trim()
      });
      await refreshDrawerData(selectedEmployeeId, {
        force: true,
        feedback: { message: 'Disciplinary record added.', type: 'success' },
        tab: 'disciplinary'
      });
    } catch (error) {
      renderDrawerDisciplinary(target, payload, { message: error.message || 'Unable to add disciplinary record.', type: 'error' }, selectedEmployeeId, refreshDrawerData);
    }
  });
}

function normalizeEmployeesPayload(payload) {
  const employees = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.employees) ? payload.employees : [];
  const pagination = payload?.pagination || {};
  const meta = payload?.meta || {};
  return {
    ...payload,
    employees,
    pagination: {
      page: Number(meta.page || pagination.page || 1),
      pageSize: Number(meta.pageSize || pagination.pageSize || employees.length || 20),
      total: Number(meta.total || pagination.total || 0),
      totalPages: Number(meta.totalPages || pagination.totalPages || 1)
    }
  };
}

export async function initManageEmployees(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.employeeTableBodySelector);

  const filterQuery = document.querySelector(config.filterQuerySelector);
  const filterRank = document.querySelector(config.filterRankSelector);
  const filterGrade = document.querySelector(config.filterGradeSelector);
  const filterStatus = document.querySelector(config.filterStatusSelector);
  const filterHireDateFrom = document.querySelector(config.filterHireDateFromSelector);
  const filterHireDateTo = document.querySelector(config.filterHireDateToSelector);
  const clearFiltersBtn = document.querySelector(config.clearFiltersBtnSelector);
  const toggleMoreFiltersBtn = document.querySelector(config.toggleMoreFiltersBtnSelector);
  const moreFiltersPanel = document.querySelector(config.moreFiltersPanelSelector);

  const paginationInfo = document.querySelector(config.paginationInfoSelector);
  const prevPageBtn = document.querySelector(config.prevPageBtnSelector);
  const nextPageBtn = document.querySelector(config.nextPageBtnSelector);

  const columnVisibilityBtn = document.querySelector(config.columnVisibilityBtnSelector);
  const columnVisibilityMenu = document.querySelector(config.columnVisibilityMenuSelector);

  const openCreateEmployeeBtn = document.querySelector(config.openCreateEmployeeBtnSelector);
  const createForm = document.querySelector(config.createFormSelector);

  const drawer = document.querySelector(config.drawerSelector);
  const drawerName = document.querySelector(config.drawerNameSelector);
  const drawerMeta = document.querySelector(config.drawerMetaSelector);
  const drawerOverview = document.querySelector(config.drawerOverviewSelector);
  const drawerVoyages = document.querySelector(config.drawerVoyagesSelector);
  const drawerActivity = document.querySelector(config.drawerActivitySelector);
  const drawerNotes = document.querySelector(config.drawerNotesSelector);
  const drawerDisciplinary = document.querySelector(config.drawerDisciplinarySelector);

  if (!feedback || !tableBody || !createForm) return;

  const state = {
    page: 1,
    pageSize: 20,
    totalPages: 1,
    sortBy: 'id',
    sortDir: 'desc',
    visibleColumns: loadVisibleColumns(),
    drawerTab: 'overview',
    selectedEmployeeId: null,
    showSystemNotes: false
  };
  const drawerCache = new Map();
  let debounceTimer = null;

  function applyColumnVisibility() {
    document.querySelectorAll('[data-col]').forEach((node) => {
      const col = String(node.getAttribute('data-col') || '');
      if (!col) return;
      node.classList.toggle('hidden', !state.visibleColumns.has(col));
    });
  }

  function renderColumnMenu() {
    if (!columnVisibilityMenu) return;
    columnVisibilityMenu.innerHTML = Object.entries(COLUMN_LABELS)
      .map(
        ([key, label]) => `
        <label class="admin-column-option">
          <input type="checkbox" data-column-key="${key}" ${state.visibleColumns.has(key) ? 'checked' : ''} />
          <span>${escapeHtml(label)}</span>
        </label>`
      )
      .join('');

    columnVisibilityMenu.querySelectorAll('input[data-column-key]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const key = String(checkbox.getAttribute('data-column-key') || '');
        if (!key) return;
        if (checkbox.checked) {
          state.visibleColumns.add(key);
        } else {
          if (state.visibleColumns.size <= 1) {
            checkbox.checked = true;
            showMessage(feedback, 'At least one column must stay visible.', 'error');
            return;
          }
          state.visibleColumns.delete(key);
        }
        saveVisibleColumns(state.visibleColumns);
        applyColumnVisibility();
      });
    });
  }

  function validateFilterDates() {
    const from = String(filterHireDateFrom?.value || '').trim();
    const to = String(filterHireDateTo?.value || '').trim();
    if (from && to && from > to) {
      showMessage(feedback, 'Hire date range is invalid. "From" must be on or before "To".', 'error');
      return false;
    }
    clearMessage(feedback);
    return true;
  }

  function collectFilters() {
    return {
      q: filterQuery?.value || '',
      rank: filterRank?.value || '',
      grade: filterGrade?.value || '',
      status: filterStatus?.value || '',
      hireFrom: filterHireDateFrom?.value || '',
      hireTo: filterHireDateTo?.value || '',
      page: state.page,
      pageSize: state.pageSize,
      sortBy: state.sortBy,
      sortDir: state.sortDir
    };
  }

  async function loadEmployees() {
    if (!validateFilterDates()) return;

    tableBody.innerHTML = Array.from({ length: 8 }, () => employeeRowSkeleton()).join('');
    try {
      const rawPayload = await listEmployees(collectFilters());
      const payload = normalizeEmployeesPayload(rawPayload);
      renderStatCards(payload);
      renderTable(tableBody, payload.employees || [], state.visibleColumns);
      const pagination = payload.pagination || {};
      state.totalPages = Math.max(1, Number(pagination.totalPages || 1));
      state.page = Math.min(state.totalPages, Math.max(1, Number(pagination.page || 1)));
      if (paginationInfo) paginationInfo.textContent = `Page ${state.page} of ${state.totalPages} • ${Number(pagination.total || 0)} total`;
      if (prevPageBtn) prevPageBtn.disabled = state.page <= 1;
      if (nextPageBtn) nextPageBtn.disabled = state.page >= state.totalPages;
      renderSortHeaders(state.sortBy, state.sortDir);
      applyColumnVisibility();
      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load employees.', 'error');
      tableBody.innerHTML = '<tr><td colspan="8">Unable to load employees.</td></tr>';
    }
  }

  async function refreshConfig() {
    const [statuses, ranks, grades] = await Promise.all([getConfig('statuses'), getConfig('ranks'), getConfig('grades')]);
    fillOptions(filterRank, ranks.items || [], 'All Ranks');
    fillOptions(filterGrade, grades.items || [], 'All Grades');
    fillOptions(filterStatus, statuses.items || [], 'All Statuses');
    fillOptions(createForm.querySelector('[name="employeeStatus"]'), statuses.items || [], 'Select');
    fillOptions(createForm.querySelector('[name="rank"]'), ranks.items || [], 'Select');
    fillOptions(createForm.querySelector('[name="grade"]'), grades.items || [], 'Select');
  }

  function setDrawerTab(tab) {
    state.drawerTab = tab;
    drawer?.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-drawer-tab') === tab);
    });
    drawerOverview?.classList.toggle('hidden', tab !== 'overview');
    drawerVoyages?.classList.toggle('hidden', tab !== 'voyages');
    drawerActivity?.classList.toggle('hidden', tab !== 'activity');
    drawerNotes?.classList.toggle('hidden', tab !== 'notes');
    drawerDisciplinary?.classList.toggle('hidden', tab !== 'disciplinary');
  }

  async function refreshDrawerData(employeeId, options = {}) {
    const force = Boolean(options.force);
    let payload = drawerCache.get(employeeId);
    if (!payload || force) {
      payload = await getEmployeeDrawer(employeeId, { activityPageSize: 20 });
      drawerCache.set(employeeId, payload);
    }

    if (drawerName) drawerName.textContent = payload.employee?.roblox_username || `Employee #${employeeId}`;
    if (drawerMeta) {
      const serial = payload.employee?.serial_number ? payload.employee.serial_number : 'No serial';
      const rank = payload.employee?.rank ? payload.employee.rank : 'Unset rank';
      const status = payload.employee?.employee_status ? payload.employee.employee_status : 'Unknown status';
      drawerMeta.textContent = `${serial} • ${rank} • ${status}`;
    }

    renderDrawerOverview(drawerOverview, payload);
    renderDrawerVoyages(drawerVoyages, payload);
    renderDrawerActivity(drawerActivity, payload);
    renderDrawerNotes(
      drawerNotes,
      payload,
      options.showSystem ?? state.showSystemNotes,
      options.tab === 'notes' ? options.feedback : null,
      employeeId,
      refreshDrawerData,
      (value) => {
        state.showSystemNotes = Boolean(value);
      }
    );
    renderDrawerDisciplinary(
      drawerDisciplinary,
      payload,
      options.tab === 'disciplinary' ? options.feedback : null,
      employeeId,
      refreshDrawerData
    );
    if (options.tab) setDrawerTab(options.tab);
  }

  async function openDrawer(employeeId) {
    if (!drawer) return;
    state.selectedEmployeeId = employeeId;
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    setDrawerTab('overview');
    if (drawerOverview) drawerOverview.innerHTML = '<span class="skeleton-line skeleton-w-70"></span><span class="skeleton-line skeleton-w-90"></span>';
    if (drawerVoyages) drawerVoyages.innerHTML = '<div class="finance-chart-skeleton"></div>';
    if (drawerActivity) drawerActivity.innerHTML = '<div class="finance-chart-skeleton"></div>';
    if (drawerNotes) drawerNotes.innerHTML = '<div class="finance-chart-skeleton"></div>';
    if (drawerDisciplinary) drawerDisciplinary.innerHTML = '<div class="finance-chart-skeleton"></div>';

    try {
      await refreshDrawerData(employeeId);
    } catch (error) {
      if (drawerOverview) drawerOverview.innerHTML = `<p class="finance-inline-caption">${escapeHtml(error.message || 'Unable to load employee details.')}</p>`;
    }
  }

  openCreateEmployeeBtn?.addEventListener('click', () => openModal('createEmployeeModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-close-modal');
      if (target) closeModal(target);
    });
  });

  document.querySelectorAll('[data-close-drawer]').forEach((button) => {
    button.addEventListener('click', () => {
      drawer?.classList.add('hidden');
      drawer?.setAttribute('aria-hidden', 'true');
      state.selectedEmployeeId = null;
    });
  });

  drawer?.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setDrawerTab(String(btn.getAttribute('data-drawer-tab') || 'overview')));
  });

  tableBody.addEventListener('click', (event) => {
    const row = event.target instanceof HTMLElement ? event.target.closest('tr.admin-employee-row') : null;
    if (!row) return;
    const employeeId = Number(row.getAttribute('data-employee-id'));
    if (Number.isInteger(employeeId) && employeeId > 0) openDrawer(employeeId);
  });

  const scheduleReload = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      state.page = 1;
      loadEmployees();
    }, 360);
  };

  [filterQuery, filterRank, filterGrade, filterStatus, filterHireDateFrom, filterHireDateTo].forEach((input) => {
    input?.addEventListener('input', scheduleReload);
    input?.addEventListener('change', scheduleReload);
  });

  clearFiltersBtn?.addEventListener('click', () => {
    [filterQuery, filterRank, filterGrade, filterStatus, filterHireDateFrom, filterHireDateTo].forEach((input) => {
      if (!input) return;
      input.value = '';
    });
    state.page = 1;
    loadEmployees();
  });

  toggleMoreFiltersBtn?.addEventListener('click', () => {
    moreFiltersPanel?.classList.toggle('hidden');
  });

  prevPageBtn?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadEmployees();
  });
  nextPageBtn?.addEventListener('click', () => {
    if (state.page >= state.totalPages) return;
    state.page += 1;
    loadEmployees();
  });

  document.querySelectorAll('.table-sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sortKey = String(btn.getAttribute('data-sort') || '');
      if (!sortKey) return;
      if (state.sortBy === sortKey) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortBy = sortKey;
        state.sortDir = sortKey === 'id' ? 'desc' : 'asc';
      }
      state.page = 1;
      loadEmployees();
    });
  });

  columnVisibilityBtn?.addEventListener('click', () => {
    columnVisibilityMenu?.classList.toggle('hidden');
  });
  document.addEventListener('click', (event) => {
    if (!columnVisibilityMenu || !columnVisibilityBtn) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (columnVisibilityMenu.contains(target) || columnVisibilityBtn.contains(target)) return;
    columnVisibilityMenu.classList.add('hidden');
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    const data = new FormData(createForm);
    try {
      await createEmployee({
        discordUserId: String(data.get('discordUserId') || '').trim(),
        robloxUsername: String(data.get('robloxUsername') || '').trim(),
        robloxUserId: String(data.get('robloxUserId') || '').trim(),
        rank: String(data.get('rank') || '').trim(),
        grade: String(data.get('grade') || '').trim(),
        serialNumber: String(data.get('serialNumber') || '').trim(),
        employeeStatus: String(data.get('employeeStatus') || '').trim(),
        hireDate: String(data.get('hireDate') || '').trim()
      });
      createForm.reset();
      closeModal('createEmployeeModal');
      state.page = 1;
      await loadEmployees();
      showMessage(feedback, 'Employee created.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to create employee.', 'error');
    }
  });

  try {
    renderColumnMenu();
    await refreshConfig();
    await loadEmployees();
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize Manage Employees.', 'error');
  }
}
