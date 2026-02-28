import {
  activateEmployee,
  addDisciplinary,
  addEmployeeNote,
  checkEmployeeSerial,
  createEmployee,
  deleteEmployee,
  getEmployeeConfigBootstrap,
  getConfig,
  getEmployeeDrawer,
  listEmployees,
  purgeUserByDiscord,
  suggestEmployeeSerial,
  updateDisciplinary,
  updateEmployee
} from './admin-api.js';
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
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  if (!withTime) return `${dd}/${mm}/${yyyy}`;
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${min}`;
}

function statusClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'on duty') return 'is-active';
  if (normalized === 'suspended') return 'is-suspended';
  if (normalized === 'inactive' || normalized === 'terminated' || normalized === 'on leave') return 'is-inactive';
  return '';
}

function disciplinaryStatusClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'open') return 'is-active';
  if (normalized === 'closed' || normalized === 'resolved') return 'is-inactive';
  if (normalized === 'revoked' || normalized === 'expired') return 'is-suspended';
  return '';
}

function fillOptions(select, items, placeholder = 'All') {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.value)}</option>`).join('');
  if (current) select.value = current;
}

function renderSelectOptions(items, selectedValue = '', placeholder = 'Select') {
  const selected = String(selectedValue || '').trim();
  const options = (items || [])
    .map((item) => String(item?.value || '').trim())
    .filter(Boolean)
    .map((value) => `<option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
  return `<option value="">${escapeHtml(placeholder)}</option>${options}`;
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

const DEFAULT_VISIBLE_COLUMNS = ['roblox_username', 'roblox_user_id', 'rank', 'grade', 'serial_number', 'employee_status', 'activation_status', 'hire_date'];
const COLUMN_LABELS = {
  roblox_username: 'Roblox Username',
  roblox_user_id: 'Roblox User ID',
  rank: 'Rank',
  grade: 'Grade',
  serial_number: 'Serial',
  employee_status: 'Status',
  activation_status: 'Activation',
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
    <td><span class="skeleton-line skeleton-w-55"></span></td>
    <td><span class="skeleton-line skeleton-w-60"></span></td>
  </tr>`;
}

function activationClass(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active') return 'is-active';
  if (normalized === 'pending') return 'is-inactive';
  if (normalized === 'disabled' || normalized === 'rejected') return 'is-suspended';
  return '';
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
    target.innerHTML = '<tr><td colspan="9">No employees found for the selected filters.</td></tr>';
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
        <td data-col="activation_status"><span class="badge badge-status ${activationClass(emp.activation_status)}">${escapeHtml(
          text(emp.activation_status || 'PENDING')
        )}</span></td>
        <td data-col="hire_date">${escapeHtml(formatDate(emp.hire_date))}</td>
      </tr>`
    )
    .join('');

  target.querySelectorAll('[data-col]').forEach((cell) => {
    const col = String(cell.getAttribute('data-col') || '');
    if (col && !visibleColumns.has(col)) cell.classList.add('hidden');
  });
}

function renderDrawerUserGroupsSection(payload, options = {}) {
  const assignedRoles = Array.isArray(payload?.assignedRoles) ? payload.assignedRoles : [];
  const availableRoles = Array.isArray(payload?.availableRoles) ? payload.availableRoles : [];
  const canAssign = Boolean(payload?.capabilities?.canAssignUserGroups);
  const isBusy = Boolean(options.isBusy);
  const assignedIds = new Set(assignedRoles.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0));
  const addable = availableRoles.filter((row) => !assignedIds.has(Number(row.id)));

  return `
    <article class="drawer-user-groups-card">
      <div class="admin-employees-table-header">
        <h3>User Groups</h3>
      </div>
      ${
        assignedRoles.length
          ? `<ul class="drawer-user-groups-list">
              ${assignedRoles
                .map(
                  (role) => `
                    <li class="drawer-user-groups-item">
                      <div>
                        <strong>${escapeHtml(text(role.name))}</strong>
                        <small>${escapeHtml(text(role.description || 'No description'))}</small>
                      </div>
                      ${
                        canAssign
                          ? `<button class="btn btn-secondary btn-compact" type="button" data-remove-employee-group="${Number(role.id)}" ${
                              isBusy ? 'disabled' : ''
                            }>Remove</button>`
                          : ''
                      }
                    </li>
                  `
                )
                .join('')}
            </ul>`
          : '<p class="finance-inline-caption">No user groups assigned.</p>'
      }
      ${
        canAssign
          ? `<div class="drawer-user-groups-actions">
               <select id="drawerUserGroupSelect" ${isBusy ? 'disabled' : ''}>
                 <option value="">Select user group...</option>
                 ${addable
                   .map((row) => `<option value="${Number(row.id)}">${escapeHtml(text(row.name))}</option>`)
                   .join('')}
               </select>
               <button id="drawerAddEmployeeGroupBtn" class="btn btn-primary btn-compact" type="button" ${
                 isBusy || !addable.length ? 'disabled' : ''
               }>Add Group</button>
             </div>`
          : '<p class="finance-inline-caption">You do not have permission to assign user groups.</p>'
      }
      <div id="drawerUserGroupsFeedback" class="feedback" role="status" aria-live="polite"></div>
    </article>
  `;
}

function renderDrawerOverview(target, payload, options = {}) {
  if (!target) return;
  const employee = payload?.employee || {};
  const canEdit = Boolean(options.canEdit);
  const isEditing = Boolean(options.isEditing);
  const draft = options.draft || {};
  const ranks = options?.configOptions?.ranks || [];
  const grades = options?.configOptions?.grades || [];
  const statuses = options?.configOptions?.statuses || [];
  const activationStatus = String(employee.activation_status || 'PENDING').trim().toUpperCase() || 'PENDING';
  const isSuspended = Boolean(payload?.suspensionState?.isSuspended || employee?.suspension_active_record_id);
  const suspendedUntil = String(payload?.suspensionState?.suspendedUntil || employee?.suspension_ends_at || '').trim();

  if (!isEditing) {
    target.innerHTML = `
      <div class="admin-employees-table-header">
        <h3>Overview</h3>
        ${
          canEdit
            ? `<div class="button-row">
                 <button id="drawerEditEmployeeBtn" class="btn btn-secondary btn-compact" type="button">Edit details</button>
                 ${payload?.capabilities?.canDelete ? '<button id="drawerDeleteEmployeeBtn" class="btn btn-danger btn-compact" type="button">Delete user</button>' : ''}
               </div>`
            : ''
        }
      </div>
      <div class="profile-kv-grid">
        <dt>Discord User ID</dt><dd>${escapeHtml(text(employee.discord_user_id))}</dd>
        <dt>Roblox Username</dt><dd>${escapeHtml(text(employee.roblox_username))}</dd>
        <dt>Roblox User ID</dt><dd>${escapeHtml(text(employee.roblox_user_id))}</dd>
        <dt>Rank</dt><dd>${escapeHtml(text(employee.rank))}</dd>
        <dt>Grade</dt><dd>${escapeHtml(text(employee.grade))}</dd>
        <dt>Serial</dt><dd>${escapeHtml(text(employee.serial_number))}</dd>
        <dt>Status</dt><dd><span class="badge badge-status ${statusClass(employee.employee_status)}">${escapeHtml(text(employee.employee_status))}</span></dd>
        <dt>Activation</dt><dd><span class="badge badge-status ${activationClass(employee.activation_status)}">${escapeHtml(activationStatus)}</span></dd>
        <dt>Disciplinary</dt><dd>${
          isSuspended
            ? `<span class="badge badge-status is-suspended">Suspended${suspendedUntil ? ` until ${escapeHtml(formatDate(suspendedUntil, true))}` : ''}</span> <button class="btn btn-secondary btn-compact" type="button" data-drawer-tab="disciplinary">View record</button>`
            : '<span class="badge badge-status is-active">No active suspension</span>'
        }</dd>
        <dt>Hire Date</dt><dd>${escapeHtml(formatDate(employee.hire_date))}</dd>
        <dt>Last Updated</dt><dd>${escapeHtml(formatDate(employee.updated_at, true))}</dd>
      </div>
      ${renderDrawerUserGroupsSection(payload, { isBusy: options.userGroupsBusy })}
      ${
        activationStatus === 'PENDING' && payload?.capabilities?.canActivate
          ? '<div class="button-row"><button id="drawerActivateEmployeeBtn" class="btn btn-primary" type="button">Activate</button></div>'
          : ''
      }
      <div id="drawerOverviewFeedback" class="feedback" role="status" aria-live="polite"></div>
    `;
    return;
  }

  target.innerHTML = `
    <div class="admin-employees-table-header">
      <h3>Edit Overview</h3>
    </div>
    <form id="drawerOverviewEditForm" class="finance-cashflow-entry-form">
      <div>
        <label for="drawerEditRobloxUsername">Roblox Username</label>
        <input id="drawerEditRobloxUsername" name="robloxUsername" type="text" value="${escapeHtml(text(draft.robloxUsername))}" />
      </div>
      <div>
        <label for="drawerEditRobloxUserId">Roblox User ID</label>
        <input id="drawerEditRobloxUserId" name="robloxUserId" type="text" value="${escapeHtml(text(draft.robloxUserId))}" inputmode="numeric" />
      </div>
      <div>
        <label for="drawerEditRank">Rank</label>
        <select id="drawerEditRank" name="rank">${renderSelectOptions(ranks, draft.rank)}</select>
      </div>
      <div>
        <label for="drawerEditGrade">Grade</label>
        <select id="drawerEditGrade" name="grade">${renderSelectOptions(grades, draft.grade)}</select>
      </div>
      <div>
        <label for="drawerEditSerialNumber" class="drawer-serial-label">
          <span>Serial</span>
          <button id="drawerRandomizeSerialBtn" class="drawer-serial-randomize-link" type="button">Randomise</button>
        </label>
        <input id="drawerEditSerialNumber" name="serialNumber" type="text" value="${escapeHtml(text(draft.serialNumber))}" />
      </div>
      <div>
        <label for="drawerEditEmployeeStatus">Status</label>
        <select id="drawerEditEmployeeStatus" name="employeeStatus">${renderSelectOptions(statuses, draft.employeeStatus)}</select>
      </div>
      <div>
        <label for="drawerEditActivationStatus">Activation</label>
        <select id="drawerEditActivationStatus" name="activationStatus">
          <option value="ACTIVE" ${String(draft.activationStatus).toUpperCase() === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
          <option value="PENDING" ${String(draft.activationStatus).toUpperCase() === 'PENDING' ? 'selected' : ''}>PENDING</option>
          <option value="DISABLED" ${String(draft.activationStatus).toUpperCase() === 'DISABLED' ? 'selected' : ''}>DISABLED</option>
          <option value="REJECTED" ${String(draft.activationStatus).toUpperCase() === 'REJECTED' ? 'selected' : ''}>REJECTED</option>
        </select>
      </div>
      <div>
        <label for="drawerEditHireDate">Hire Date</label>
        <input id="drawerEditHireDate" name="hireDate" type="date" value="${escapeHtml(text(draft.hireDate))}" />
      </div>
      <div class="finance-cashflow-entry-wide finance-cashflow-entry-actions">
        <button id="drawerSaveOverviewBtn" class="btn btn-primary" type="submit">Save</button>
        <button id="drawerCancelOverviewBtn" class="btn btn-secondary" type="button">Cancel</button>
      </div>
    </form>
    ${renderDrawerUserGroupsSection(payload, { isBusy: options.userGroupsBusy })}
    <div id="drawerOverviewFeedback" class="feedback" role="status" aria-live="polite"></div>
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
          <span class="role-id">${escapeHtml(text(entry.actorRobloxUsername || entry.actorName || entry.actorDiscordId || 'System'))}</span>
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
  const rawNotes = (Array.isArray(payload?.notes) ? payload.notes : []).filter(
    (entry) => !String(entry?.note || '').trim().toLowerCase().startsWith('[activity]')
  );
  const systemActivity = Array.isArray(payload?.activity) ? payload.activity : [];
  const allNotes = [
    ...rawNotes.map((entry) => ({
      id: `note-${entry.id}`,
      note: entry.note,
      authored_by: entry.authored_by,
      created_at: entry.created_at,
      isSystem: isSystemNote(entry.note)
    })),
    ...systemActivity.map((entry) => ({
      id: `activity-${entry.id}`,
      note: `${text(entry.actionType)}: ${text(entry.summary)}`,
      authored_by: entry.actorRobloxUsername || entry.actorName || entry.actorDiscordId || 'System',
      created_at: entry.createdAt,
      isSystem: true
    }))
  ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const canAddNotes = Boolean(payload?.capabilities?.canAddNotes);
  const notes = showSystem ? allNotes : allNotes.filter((note) => !note.isSystem);

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
        <thead><tr><th>When</th><th>Author</th><th>Entry</th></tr></thead>
        <tbody>
          ${notes.length
            ? notes
                .map(
                  (entry) =>
                    `<tr>
                      <td>${escapeHtml(formatDate(entry.created_at, true))}</td>
                      <td>${escapeHtml(text(entry.authored_by || 'System'))}</td>
                      <td>${entry.isSystem ? '<span class="badge badge-status is-inactive">SYSTEM</span> ' : ''}${escapeHtml(text(entry.note))}</td>
                    </tr>`
                )
                .join('')
            : '<tr><td colspan="3">No notes found.</td></tr>'}
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
  const types = Array.isArray(payload?.disciplinaryTypes) ? payload.disciplinaryTypes : [];
  const canAddDisciplinary = Boolean(payload?.capabilities?.canAddDisciplinary);
  const activeCount = records.filter((entry) => ['ACTIVE', 'OPEN'].includes(String(entry.status || entry.record_status || '').toUpperCase())).length;
  const suspendedUntil = String(payload?.suspensionState?.suspendedUntil || '').trim();

  target.innerHTML = `
    <div class="admin-employees-table-header">
      <h3>Disciplinary</h3>
      <span class="finance-inline-caption">Active: ${activeCount}${payload?.suspensionState?.isSuspended ? ` • Suspended${suspendedUntil ? ` until ${escapeHtml(formatDate(suspendedUntil, true))}` : ''}` : ''}</span>
    </div>
    ${
      canAddDisciplinary
        ? `<form id="drawerAddDisciplinaryForm" class="finance-cashflow-entry-form">
      <div>
        <label for="drawerTypeKey">Type</label>
        <select id="drawerTypeKey" name="typeKey" required>
          <option value="">Select disciplinary type</option>
          ${types
            .map(
              (row) =>
                `<option value="${escapeHtml(String(row.key || ''))}" data-requires-end="${Number(row.requires_end_date || 0)}">${escapeHtml(
                  text(row.label || row.value || row.key)
                )}</option>`
            )
            .join('')}
        </select>
      </div>
      <div>
        <label for="drawerDisciplinaryStatus">Status</label>
        <select id="drawerDisciplinaryStatus" name="status">
          <option value="ACTIVE">ACTIVE</option>
          <option value="OPEN">OPEN</option>
        </select>
      </div>
      <div>
        <label for="drawerEffectiveAt">Effective</label>
        <input id="drawerEffectiveAt" name="effectiveAt" type="datetime-local" />
      </div>
      <div>
        <label for="drawerEndsAt">Ends At</label>
        <input id="drawerEndsAt" name="endsAt" type="datetime-local" />
      </div>
      <div class="finance-cashflow-entry-wide">
        <label for="drawerReasonText">Reason</label>
        <textarea id="drawerReasonText" name="reasonText" rows="3" minlength="2" required></textarea>
      </div>
      <div class="finance-cashflow-entry-wide">
        <label for="drawerInternalNotes">Internal Notes (optional)</label>
        <textarea id="drawerInternalNotes" name="internalNotes" rows="2"></textarea>
      </div>
      <div class="finance-cashflow-entry-wide finance-cashflow-entry-actions">
        <button class="btn btn-primary" type="submit">Create Record</button>
      </div>
    </form>`
        : '<p class="finance-inline-caption">You do not have permission to add disciplinary records.</p>'
    }
    <div id="drawerDisciplinaryFeedback" class="feedback" role="status" aria-live="polite"></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>When</th><th>Type</th><th>Status</th><th>Issued By</th><th>Reason</th><th class="align-right">Actions</th></tr></thead>
        <tbody>
          ${
            records.length
              ? records
                  .map((entry) => {
                    const rowStatus = String(entry.status || entry.record_status || '').toUpperCase();
                    const canModify = ['ACTIVE', 'OPEN'].includes(rowStatus) && canAddDisciplinary;
                    return `<tr>
                      <td>${escapeHtml(formatDate(entry.effective_at || entry.record_date || entry.created_at, true))}${entry.ends_at ? `<br><small>Ends: ${escapeHtml(formatDate(entry.ends_at, true))}</small>` : ''}</td>
                      <td>${escapeHtml(text(entry.type_label || entry.record_type || entry.type_key))}</td>
                      <td><span class="badge badge-status ${disciplinaryStatusClass(rowStatus)}">${escapeHtml(rowStatus || 'ACTIVE')}</span></td>
                      <td>${escapeHtml(text(entry.issued_by_name || entry.issued_by || 'System'))}</td>
                      <td>${escapeHtml(text(entry.reason_text || entry.notes))}</td>
                      <td class="align-right">
                        ${
                          canModify
                            ? `<button class="btn btn-secondary btn-compact" type="button" data-discipline-action="close" data-record-id="${Number(entry.id)}">Close</button>
                               <button class="btn btn-warning btn-compact" type="button" data-discipline-action="revoke" data-record-id="${Number(entry.id)}">Revoke</button>
                               <button class="btn btn-primary btn-compact" type="button" data-discipline-action="extend" data-record-id="${Number(entry.id)}">Extend</button>`
                            : '<span class="finance-inline-caption">—</span>'
                        }
                      </td>
                    </tr>`;
                  })
                  .join('')
              : '<tr><td colspan="6">No disciplinary records found.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  const feedbackNode = target.querySelector('#drawerDisciplinaryFeedback');
  if (feedbackNode && disciplinaryFeedback?.message) showMessage(feedbackNode, disciplinaryFeedback.message, disciplinaryFeedback.type || 'info');

  const typeSelect = target.querySelector('#drawerTypeKey');
  const endsAtInput = target.querySelector('#drawerEndsAt');
  typeSelect?.addEventListener('change', () => {
    const selected = typeSelect.options[typeSelect.selectedIndex];
    const requiresEnd = Number(selected?.getAttribute('data-requires-end') || 0) === 1;
    if (endsAtInput) endsAtInput.required = requiresEnd;
  });

  const form = target.querySelector('#drawerAddDisciplinaryForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    try {
      await addDisciplinary(selectedEmployeeId, {
        typeKey: String(fd.get('typeKey') || '').trim(),
        status: String(fd.get('status') || '').trim(),
        effectiveAt: String(fd.get('effectiveAt') || '').trim(),
        endsAt: String(fd.get('endsAt') || '').trim(),
        reasonText: String(fd.get('reasonText') || '').trim(),
        internalNotes: String(fd.get('internalNotes') || '').trim()
      });
      await refreshDrawerData(selectedEmployeeId, {
        force: true,
        feedback: { message: 'Disciplinary record created.', type: 'success' },
        tab: 'disciplinary'
      });
    } catch (error) {
      renderDrawerDisciplinary(target, payload, { message: error.message || 'Unable to create disciplinary record.', type: 'error' }, selectedEmployeeId, refreshDrawerData);
    }
  });

  target.querySelectorAll('[data-discipline-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = String(button.getAttribute('data-discipline-action') || '').trim();
      const recordId = Number(button.getAttribute('data-record-id'));
      if (!action || !Number.isInteger(recordId) || recordId <= 0) return;
      try {
        let payloadData = { recordId, action };
        if (action === 'extend') {
          const nextEndsAt = window.prompt('Enter new end date/time (YYYY-MM-DDTHH:mm):', '');
          if (!nextEndsAt) return;
          payloadData = { ...payloadData, endsAt: nextEndsAt };
        }
        await updateDisciplinary(selectedEmployeeId, payloadData);
        await refreshDrawerData(selectedEmployeeId, {
          force: true,
          feedback: { message: `Record ${action}d.`, type: 'success' },
          tab: 'disciplinary'
        });
      } catch (error) {
        renderDrawerDisciplinary(target, payload, { message: error.message || 'Unable to update disciplinary record.', type: 'error' }, selectedEmployeeId, refreshDrawerData);
      }
    });
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
  const filterActivation = document.querySelector(config.filterActivationSelector);
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
  const openDeleteUserBtn = document.querySelector('#openDeleteUserBtn');
  const deleteUserForm = document.querySelector('#deleteUserForm');

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
    showSystemNotes: false,
    drawerOverviewEditMode: false,
    drawerOverviewDraft: null,
    drawerPayload: null,
    drawerUserGroupsBusy: false,
    configBootstrapped: false,
    configOptions: {
      ranks: [],
      grades: [],
      statuses: []
    }
  };
  const drawerCache = new Map();
  let debounceTimer = null;

  function buildOverviewDraft(employee = {}) {
    return {
      robloxUsername: employee?.roblox_username || '',
      robloxUserId: employee?.roblox_user_id || '',
      rank: employee?.rank || '',
      grade: employee?.grade || '',
      serialNumber: employee?.serial_number || '',
      employeeStatus: employee?.employee_status || '',
      activationStatus: employee?.activation_status || 'PENDING',
      hireDate: employee?.hire_date || ''
    };
  }

  function renderOverviewFromState() {
    if (!drawerOverview || !state.drawerPayload) return;
    renderDrawerOverview(drawerOverview, state.drawerPayload, {
      canEdit: Boolean(state.drawerPayload?.capabilities?.canActivate),
      isEditing: state.drawerOverviewEditMode,
      draft: state.drawerOverviewDraft,
      configOptions: state.configOptions,
      userGroupsBusy: state.drawerUserGroupsBusy
    });
  }

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
      activationStatus: filterActivation?.value || '',
      hireFrom: filterHireDateFrom?.value || '',
      hireTo: filterHireDateTo?.value || '',
      includeConfig: !state.configBootstrapped,
      page: state.page,
      pageSize: state.pageSize,
      sortBy: state.sortBy,
      sortDir: state.sortDir
    };
  }

  function applyConfigOptions(statusesItems = [], ranksItems = [], gradesItems = []) {
    state.configOptions.statuses = statusesItems;
    state.configOptions.ranks = ranksItems;
    state.configOptions.grades = gradesItems;
    fillOptions(filterRank, ranksItems, 'All Ranks');
    fillOptions(filterGrade, gradesItems, 'All Grades');
    fillOptions(filterStatus, statusesItems, 'All Statuses');
    fillOptions(createForm.querySelector('[name="employeeStatus"]'), statusesItems, 'Select');
    fillOptions(createForm.querySelector('[name="rank"]'), ranksItems, 'Select');
    fillOptions(createForm.querySelector('[name="grade"]'), gradesItems, 'Select');
  }

  async function loadEmployees() {
    if (!validateFilterDates()) return;

    tableBody.innerHTML = Array.from({ length: 8 }, () => employeeRowSkeleton()).join('');
    try {
      const rawPayload = await listEmployees(collectFilters());
      const payload = normalizeEmployeesPayload(rawPayload);
      if (!state.configBootstrapped && payload?.config) {
        applyConfigOptions(
          Array.isArray(payload.config.statuses) ? payload.config.statuses : [],
          Array.isArray(payload.config.ranks) ? payload.config.ranks : [],
          Array.isArray(payload.config.grades) ? payload.config.grades : []
        );
        state.configBootstrapped = true;
      } else if (!state.configBootstrapped) {
        await refreshConfig();
      }
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
      tableBody.innerHTML = '<tr><td colspan="9">Unable to load employees.</td></tr>';
    }
  }

  async function refreshConfig() {
    if (state.configBootstrapped) return;
    let statusesItems = [];
    let ranksItems = [];
    let gradesItems = [];
    try {
      const bootstrap = await getEmployeeConfigBootstrap();
      statusesItems = Array.isArray(bootstrap?.statuses) ? bootstrap.statuses : [];
      ranksItems = Array.isArray(bootstrap?.ranks) ? bootstrap.ranks : [];
      gradesItems = Array.isArray(bootstrap?.grades) ? bootstrap.grades : [];
    } catch {
      // Fallback for legacy deployments.
      const [statuses, ranks, grades] = await Promise.all([getConfig('statuses'), getConfig('ranks'), getConfig('grades')]);
      statusesItems = statuses.items || [];
      ranksItems = ranks.items || [];
      gradesItems = grades.items || [];
    }

    applyConfigOptions(statusesItems, ranksItems, gradesItems);
    state.configBootstrapped = true;
  }

  function setDrawerTab(tab) {
    const allowedTabs = new Set(['overview', 'voyages', 'activity', 'notes', 'disciplinary']);
    const activeTab = allowedTabs.has(tab) ? tab : 'overview';
    state.drawerTab = activeTab;
    const setPanelVisibility = (panel, isActive) => {
      if (!panel) return;
      panel.classList.toggle('hidden', !isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (isActive) panel.style.removeProperty('display');
      else panel.style.display = 'none';
    };
    drawer?.querySelectorAll('[data-drawer-tab], [data-employee-tab]').forEach((btn) => {
      const tabKey = String(btn.getAttribute('data-drawer-tab') || btn.getAttribute('data-employee-tab') || '');
      const isActive = tabKey === activeTab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    setPanelVisibility(drawerOverview, activeTab === 'overview');
    setPanelVisibility(drawerVoyages, activeTab === 'voyages');
    setPanelVisibility(drawerActivity, activeTab === 'activity');
    setPanelVisibility(drawerNotes, activeTab === 'notes');
    setPanelVisibility(drawerDisciplinary, activeTab === 'disciplinary');
    if (state.drawerPayload && state.selectedEmployeeId) {
      renderActiveDrawerTab(state.drawerPayload, state.selectedEmployeeId, {});
    }
  }

  function renderActiveDrawerTab(payload, employeeId, options = {}) {
    const activeTab = state.drawerTab || 'overview';

    if (activeTab === 'overview') {
      renderDrawerOverview(drawerOverview, payload, {
        canEdit: Boolean(payload?.capabilities?.canActivate),
        isEditing: state.drawerOverviewEditMode,
        draft: state.drawerOverviewDraft,
        configOptions: state.configOptions,
        userGroupsBusy: state.drawerUserGroupsBusy
      });
      return;
    }

    if (activeTab === 'voyages') {
      renderDrawerVoyages(drawerVoyages, payload);
      return;
    }

    if (activeTab === 'activity') {
      renderDrawerActivity(drawerActivity, payload);
      return;
    }

    if (activeTab === 'notes') {
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
      return;
    }

    if (activeTab === 'disciplinary') {
      renderDrawerDisciplinary(
        drawerDisciplinary,
        payload,
        options.tab === 'disciplinary' ? options.feedback : null,
        employeeId,
        refreshDrawerData
      );
    }
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

    if (!state.drawerOverviewDraft) state.drawerOverviewDraft = buildOverviewDraft(payload.employee);

    state.drawerPayload = payload;
    if (options.tab) setDrawerTab(options.tab);
    renderActiveDrawerTab(payload, employeeId, options);
  }

  async function openDrawer(employeeId) {
    if (!drawer) return;
    state.selectedEmployeeId = employeeId;
    state.drawerOverviewEditMode = false;
    state.drawerOverviewDraft = null;
    state.drawerPayload = null;
    state.drawerUserGroupsBusy = false;
    state.showSystemNotes = false;
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
  openDeleteUserBtn?.addEventListener('click', () => openModal('deleteUserModal'));
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

  drawer?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest('#drawerEditEmployeeBtn')) {
      if (!state.drawerPayload) return;
      state.drawerOverviewEditMode = true;
      state.drawerOverviewDraft = buildOverviewDraft(state.drawerPayload.employee);
      renderOverviewFromState();
      return;
    }

    if (target.closest('#drawerCancelOverviewBtn')) {
      state.drawerOverviewEditMode = false;
      state.drawerOverviewDraft = null;
      renderOverviewFromState();
      return;
    }

    if (target.closest('#drawerRandomizeSerialBtn')) {
      if (!state.selectedEmployeeId) return;
      const serialInput = drawerOverview?.querySelector('#drawerEditSerialNumber');
      if (!(serialInput instanceof HTMLInputElement)) return;
      const btn = target.closest('#drawerRandomizeSerialBtn');
      if (!(btn instanceof HTMLButtonElement)) return;
      btn.disabled = true;
      const previousLabel = btn.textContent;
      btn.textContent = 'Generating...';
      void (async () => {
        try {
          const payload = await suggestEmployeeSerial({ employeeId: state.selectedEmployeeId });
          serialInput.value = String(payload?.serial || '').trim();
          serialInput.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (error) {
          const feedbackNode = drawerOverview?.querySelector('#drawerOverviewFeedback');
          if (feedbackNode) showMessage(feedbackNode, error.message || 'Unable to generate serial.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = previousLabel;
        }
      })();
      return;
    }

    if (target.closest('#drawerActivateEmployeeBtn')) {
      if (!state.selectedEmployeeId || !state.drawerPayload) return;
      const employeeId = state.selectedEmployeeId;
      void (async () => {
        try {
          state.drawerPayload.employee.activation_status = 'ACTIVE';
          drawerCache.set(employeeId, state.drawerPayload);
          state.drawerOverviewEditMode = false;
          state.drawerOverviewDraft = null;
          renderOverviewFromState();
          await activateEmployee(employeeId);
          drawerCache.delete(employeeId);
          void loadEmployees();
          await refreshDrawerData(employeeId, { force: true, tab: 'overview' });
          showMessage(feedback, 'Employee activated.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to activate employee.', 'error');
        }
      })();
      return;
    }

    if (target.closest('#drawerDeleteEmployeeBtn')) {
      if (!state.selectedEmployeeId || !state.drawerPayload) return;
      const employeeId = state.selectedEmployeeId;
      const targetName = String(state.drawerPayload?.employee?.roblox_username || `#${employeeId}`);
      const confirmation = window.prompt(`Type DELETE to remove ${targetName}.`);
      if (confirmation !== 'DELETE') return;
      const reason = window.prompt('Delete reason (required):') || '';
      if (!String(reason || '').trim()) {
        showMessage(feedback, 'Delete reason is required.', 'error');
        return;
      }
      void (async () => {
        try {
          await deleteEmployee(employeeId, { reason: String(reason).trim() });
          drawerCache.delete(employeeId);
          drawer?.classList.add('hidden');
          drawer?.setAttribute('aria-hidden', 'true');
          state.selectedEmployeeId = null;
          await loadEmployees();
          showMessage(feedback, 'User deleted from employee records.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to delete employee.', 'error');
        }
      })();
      return;
    }

    if (target.closest('#drawerAddEmployeeGroupBtn')) {
      if (!state.selectedEmployeeId || !state.drawerPayload || state.drawerUserGroupsBusy) return;
      const employeeId = state.selectedEmployeeId;
      const select = drawerOverview?.querySelector('#drawerUserGroupSelect');
      const roleId = Number(select?.value || 0);
      if (!Number.isInteger(roleId) || roleId <= 0) return;

      const payload = state.drawerPayload;
      const existingIds = new Set((payload.assignedRoles || []).map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0));
      if (existingIds.has(roleId)) return;
      const roleRow = (payload.availableRoles || []).find((row) => Number(row.id) === roleId);
      if (!roleRow) return;

      const previousAssigned = [...(payload.assignedRoles || [])];
      const nextRoleIds = [...existingIds, roleId];
      payload.assignedRoles = [...previousAssigned, roleRow].sort(
        (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id || 0) - Number(b.id || 0)
      );
      state.drawerUserGroupsBusy = true;
      drawerCache.set(employeeId, payload);
      renderOverviewFromState();

      void (async () => {
        try {
          await updateEmployee(employeeId, { roleIds: nextRoleIds });
          state.drawerUserGroupsBusy = false;
          renderOverviewFromState();
          const feedbackNode = drawerOverview?.querySelector('#drawerUserGroupsFeedback');
          if (feedbackNode) showMessage(feedbackNode, 'User group added.', 'success');
        } catch (error) {
          payload.assignedRoles = previousAssigned;
          state.drawerUserGroupsBusy = false;
          drawerCache.set(employeeId, payload);
          renderOverviewFromState();
          const feedbackNode = drawerOverview?.querySelector('#drawerUserGroupsFeedback');
          if (feedbackNode) showMessage(feedbackNode, error.message || 'Unable to add user group.', 'error');
        }
      })();
      return;
    }

    const removeRoleButton = target.closest('[data-remove-employee-group]');
    if (removeRoleButton) {
      if (!state.selectedEmployeeId || !state.drawerPayload || state.drawerUserGroupsBusy) return;
      const employeeId = state.selectedEmployeeId;
      const roleId = Number(removeRoleButton.getAttribute('data-remove-employee-group'));
      if (!Number.isInteger(roleId) || roleId <= 0) return;

      const payload = state.drawerPayload;
      const previousAssigned = [...(payload.assignedRoles || [])];
      const nextAssigned = previousAssigned.filter((row) => Number(row.id) !== roleId);
      const nextRoleIds = nextAssigned.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);

      payload.assignedRoles = nextAssigned;
      state.drawerUserGroupsBusy = true;
      drawerCache.set(employeeId, payload);
      renderOverviewFromState();

      void (async () => {
        try {
          await updateEmployee(employeeId, { roleIds: nextRoleIds });
          state.drawerUserGroupsBusy = false;
          renderOverviewFromState();
          const feedbackNode = drawerOverview?.querySelector('#drawerUserGroupsFeedback');
          if (feedbackNode) showMessage(feedbackNode, 'User group removed.', 'success');
        } catch (error) {
          payload.assignedRoles = previousAssigned;
          state.drawerUserGroupsBusy = false;
          drawerCache.set(employeeId, payload);
          renderOverviewFromState();
          const feedbackNode = drawerOverview?.querySelector('#drawerUserGroupsFeedback');
          if (feedbackNode) showMessage(feedbackNode, error.message || 'Unable to remove user group.', 'error');
        }
      })();
      return;
    }

    const tabButton = target.closest('[data-drawer-tab], [data-employee-tab]');
    if (!tabButton) return;
    setDrawerTab(String(tabButton.getAttribute('data-drawer-tab') || tabButton.getAttribute('data-employee-tab') || 'overview'));
  });

  drawer?.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id !== 'drawerOverviewEditForm') return;
    event.preventDefault();
    if (!state.selectedEmployeeId || !state.drawerPayload) return;
    const employeeId = state.selectedEmployeeId;
    const payload = state.drawerPayload;
    const formData = new FormData(form);
    const nextDraft = {
      robloxUsername: String(formData.get('robloxUsername') || '').trim(),
      robloxUserId: String(formData.get('robloxUserId') || '').trim(),
      rank: String(formData.get('rank') || '').trim(),
      grade: String(formData.get('grade') || '').trim(),
      serialNumber: String(formData.get('serialNumber') || '').trim(),
      employeeStatus: String(formData.get('employeeStatus') || '').trim(),
      activationStatus: String(formData.get('activationStatus') || '').trim().toUpperCase() || 'PENDING',
      hireDate: String(formData.get('hireDate') || '').trim()
    };
    const changedPayload = {};
    if (nextDraft.robloxUsername !== String(payload.employee?.roblox_username || '')) changedPayload.robloxUsername = nextDraft.robloxUsername;
    if (nextDraft.robloxUserId !== String(payload.employee?.roblox_user_id || '')) changedPayload.robloxUserId = nextDraft.robloxUserId;
    if (nextDraft.rank !== String(payload.employee?.rank || '')) changedPayload.rank = nextDraft.rank;
    if (nextDraft.grade !== String(payload.employee?.grade || '')) changedPayload.grade = nextDraft.grade;
    if (nextDraft.serialNumber !== String(payload.employee?.serial_number || '')) changedPayload.serialNumber = nextDraft.serialNumber;
    if (nextDraft.employeeStatus !== String(payload.employee?.employee_status || '')) changedPayload.employeeStatus = nextDraft.employeeStatus;
    if (nextDraft.activationStatus !== String(payload.employee?.activation_status || 'PENDING').toUpperCase()) changedPayload.activationStatus = nextDraft.activationStatus;
    if (nextDraft.hireDate !== String(payload.employee?.hire_date || '')) changedPayload.hireDate = nextDraft.hireDate;

    const overviewFeedback = drawerOverview?.querySelector('#drawerOverviewFeedback');
    if (!Object.keys(changedPayload).length) {
      state.drawerOverviewEditMode = false;
      state.drawerOverviewDraft = null;
      renderOverviewFromState();
      if (overviewFeedback) showMessage(overviewFeedback, 'No changes to save.', 'info');
      return;
    }

    if (Object.prototype.hasOwnProperty.call(changedPayload, 'serialNumber')) {
      void (async () => {
        try {
          const serialCheck = await checkEmployeeSerial(changedPayload.serialNumber, { employeeId });
          if (!serialCheck?.available) {
            if (overviewFeedback) showMessage(overviewFeedback, 'Serial number already exists for another employee.', 'error');
            return;
          }
        } catch (error) {
          if (overviewFeedback) showMessage(overviewFeedback, error.message || 'Unable to validate serial number.', 'error');
          return;
        }
        const previous = { ...payload.employee };
        payload.employee = {
          ...payload.employee,
          roblox_username: nextDraft.robloxUsername,
          roblox_user_id: nextDraft.robloxUserId,
          rank: nextDraft.rank,
          grade: nextDraft.grade,
          serial_number: nextDraft.serialNumber,
          employee_status: nextDraft.employeeStatus,
          activation_status: nextDraft.activationStatus,
          hire_date: nextDraft.hireDate
        };
        state.drawerOverviewEditMode = false;
        state.drawerOverviewDraft = null;
        drawerCache.set(employeeId, payload);
        renderOverviewFromState();
        if (drawerMeta) drawerMeta.textContent = `${nextDraft.serialNumber || 'No serial'} • ${nextDraft.rank || 'Unset rank'} • ${nextDraft.employeeStatus || 'Unknown status'}`;
        if (overviewFeedback) showMessage(overviewFeedback, 'Saved.', 'success');

        try {
          await updateEmployee(employeeId, changedPayload);
          void loadEmployees();
        } catch (error) {
          payload.employee = previous;
          drawerCache.set(employeeId, payload);
          renderOverviewFromState();
          const nextFeedback = drawerOverview?.querySelector('#drawerOverviewFeedback');
          if (nextFeedback) showMessage(nextFeedback, error.message || 'Unable to save employee.', 'error');
        }
      })();
      return;
    }

    const previous = { ...payload.employee };
    payload.employee = {
      ...payload.employee,
      roblox_username: nextDraft.robloxUsername,
      roblox_user_id: nextDraft.robloxUserId,
      rank: nextDraft.rank,
      grade: nextDraft.grade,
      serial_number: nextDraft.serialNumber,
      employee_status: nextDraft.employeeStatus,
      activation_status: nextDraft.activationStatus,
      hire_date: nextDraft.hireDate
    };
    state.drawerOverviewEditMode = false;
    state.drawerOverviewDraft = null;
    drawerCache.set(employeeId, payload);
    renderOverviewFromState();
    if (drawerMeta) drawerMeta.textContent = `${nextDraft.serialNumber || 'No serial'} • ${nextDraft.rank || 'Unset rank'} • ${nextDraft.employeeStatus || 'Unknown status'}`;
    if (overviewFeedback) showMessage(overviewFeedback, 'Saved.', 'success');

    void (async () => {
      try {
        await updateEmployee(employeeId, changedPayload);
        void loadEmployees();
      } catch (error) {
        payload.employee = previous;
        drawerCache.set(employeeId, payload);
        renderOverviewFromState();
        const nextFeedback = drawerOverview?.querySelector('#drawerOverviewFeedback');
        if (nextFeedback) showMessage(nextFeedback, error.message || 'Unable to save employee.', 'error');
      }
    })();
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

  filterQuery?.addEventListener('input', scheduleReload);
  [filterRank, filterGrade, filterStatus, filterActivation, filterHireDateFrom, filterHireDateTo].forEach((input) => {
    input?.addEventListener('change', scheduleReload);
  });

  clearFiltersBtn?.addEventListener('click', () => {
    [filterQuery, filterRank, filterGrade, filterStatus, filterActivation, filterHireDateFrom, filterHireDateTo].forEach((input) => {
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
    const serialNumber = String(data.get('serialNumber') || '').trim();
    try {
      if (serialNumber) {
        const serialCheck = await checkEmployeeSerial(serialNumber);
        if (!serialCheck?.available) {
          showMessage(feedback, 'Serial number already exists for another employee.', 'error');
          return;
        }
      }
      await createEmployee({
        discordUserId: String(data.get('discordUserId') || '').trim(),
        robloxUsername: String(data.get('robloxUsername') || '').trim(),
        robloxUserId: String(data.get('robloxUserId') || '').trim(),
        rank: String(data.get('rank') || '').trim(),
        grade: String(data.get('grade') || '').trim(),
        serialNumber,
        employeeStatus: String(data.get('employeeStatus') || '').trim(),
        activationStatus: String(data.get('activationStatus') || '').trim(),
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

  deleteUserForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    const data = new FormData(deleteUserForm);
    const discordUserId = String(data.get('discordUserId') || '').trim();
    const reason = String(data.get('reason') || '').trim();
    if (!discordUserId || !reason) {
      showMessage(feedback, 'Discord User ID and reason are required.', 'error');
      return;
    }
    try {
      const result = await purgeUserByDiscord({ discordUserId, reason });
      deleteUserForm.reset();
      closeModal('deleteUserModal');
      await loadEmployees();
      const message = result?.removedEmployee
        ? 'User deleted (employee + related access request records).'
        : 'User deleted from unauthorised/pending access records.';
      showMessage(feedback, message, 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to delete user.', 'error');
    }
  });

  try {
    renderColumnMenu();
    await loadEmployees();
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize Manage Employees.', 'error');
  }
}
