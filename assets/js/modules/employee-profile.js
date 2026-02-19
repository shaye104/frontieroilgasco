import { addDisciplinary, addEmployeeNote, getConfig, getEmployee, updateEmployee } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function fillOptions(select, items, placeholder = 'Select') {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` + items.map((item) => `<option value="${item.value}">${item.value}</option>`).join('');
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

function calculateTenureDays(hireDateText) {
  if (!hireDateText) return 'N/A';
  const hireDate = new Date(hireDateText);
  if (Number.isNaN(hireDate.getTime())) return 'N/A';
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  return String(Math.max(0, Math.floor((now.getTime() - hireDate.getTime()) / msPerDay)));
}

function renderRecords(target, records, format, emptyMessage) {
  if (!target) return;
  if (!Array.isArray(records) || records.length === 0) {
    target.innerHTML = `<li class="role-item"><span class="role-id">${emptyMessage}</span></li>`;
    return;
  }

  target.innerHTML = records.map((item) => `<li class="role-item"><span class="role-id">${format(item)}</span></li>`).join('');
}

function getActiveDisciplinaries(records) {
  return (records || []).filter((item) => {
    const status = String(item.record_status || '').toLowerCase();
    return status === 'open' || status === 'active';
  });
}

function parseEmployeeIdFromUrl() {
  const pathMatch = window.location.pathname.match(/\/admin\/employees\/(\d+)\/?$/);
  if (pathMatch) return Number(pathMatch[1]);

  const fromQuery = new URLSearchParams(window.location.search).get('employeeId');
  if (/^\d+$/.test(String(fromQuery || ''))) return Number(fromQuery);

  return null;
}

export async function initEmployeeProfilePage(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const employeeHeading = document.querySelector(config.employeeHeadingSelector);

  const editForm = document.querySelector(config.editFormSelector);
  const disciplinaryForm = document.querySelector(config.disciplinaryFormSelector);
  const noteForm = document.querySelector(config.noteFormSelector);

  const activeDisciplinaryList = document.querySelector(config.activeDisciplinaryListSelector);
  const activityList = document.querySelector(config.activityListSelector);

  const openDisciplinaryModalBtn = document.querySelector(config.openDisciplinaryModalBtnSelector);
  const openNoteModalBtn = document.querySelector(config.openNoteModalBtnSelector);
  const resetButton = document.querySelector(config.resetButtonSelector);
  const tenureDaysInput = document.querySelector(config.tenureDaysSelector);

  if (!feedback || !employeeHeading || !editForm || !disciplinaryForm || !noteForm || !activeDisciplinaryList || !activityList) return;

  const employeeId = parseEmployeeIdFromUrl();
  if (!employeeId) {
    showMessage(feedback, 'Invalid employee route.', 'error');
    return;
  }

  let currentEmployee = null;

  async function refreshConfig() {
    const [statuses, ranks, grades, disciplinaryTypes] = await Promise.all([
      getConfig('statuses'),
      getConfig('ranks'),
      getConfig('grades'),
      getConfig('disciplinary_types')
    ]);

    fillOptions(editForm.querySelector('[name="employeeStatus"]'), statuses.items || []);
    fillOptions(editForm.querySelector('[name="rank"]'), ranks.items || []);
    fillOptions(editForm.querySelector('[name="grade"]'), grades.items || []);
    fillOptions(disciplinaryForm.querySelector('[name="actionType"]'), disciplinaryTypes.items || []);
  }

  function applyEmployeeToForm(employee) {
    currentEmployee = employee;
    employeeHeading.textContent = `Employee #${employee.id} | Discord ${text(employee.discord_user_id)} | Roblox ${text(employee.roblox_username)}`;

    editForm.querySelector('[name="robloxUsername"]').value = employee.roblox_username || '';
    editForm.querySelector('[name="robloxUserId"]').value = employee.roblox_user_id || '';
    editForm.querySelector('[name="rank"]').value = employee.rank || '';
    editForm.querySelector('[name="grade"]').value = employee.grade || '';
    editForm.querySelector('[name="serialNumber"]').value = employee.serial_number || '';
    editForm.querySelector('[name="employeeStatus"]').value = employee.employee_status || '';
    editForm.querySelector('[name="hireDate"]').value = employee.hire_date || '';

    if (tenureDaysInput) tenureDaysInput.value = calculateTenureDays(employee.hire_date);
  }

  async function loadEmployee() {
    const payload = await getEmployee(employeeId);
    applyEmployeeToForm(payload.employee);

    const activeDisciplinaries = getActiveDisciplinaries(payload.disciplinaries || []);

    renderRecords(
      activeDisciplinaryList,
      activeDisciplinaries,
      (item) => `${text(item.record_type)} | ${text(item.record_status)} | ${text(item.record_date)} | ${text(item.notes)} | ${text(item.issued_by)}`,
      'No active disciplinary records.'
    );

    renderRecords(
      activityList,
      payload.notes || [],
      (item) => `${text(item.created_at)} | ${text(item.authored_by)} | ${text(item.note)}`,
      'No notes or activity yet.'
    );
  }

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-close-modal');
      if (target) closeModal(target);
    });
  });

  openDisciplinaryModalBtn?.addEventListener('click', () => openModal('disciplinaryModal'));
  openNoteModalBtn?.addEventListener('click', () => openModal('noteModal'));

  editForm.querySelector('[name="hireDate"]')?.addEventListener('change', (event) => {
    if (!tenureDaysInput) return;
    tenureDaysInput.value = calculateTenureDays(event.target.value);
  });

  resetButton?.addEventListener('click', () => {
    if (!currentEmployee) return;
    applyEmployeeToForm(currentEmployee);
    clearMessage(feedback);
  });

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const data = new FormData(editForm);

    try {
      await updateEmployee(employeeId, {
        robloxUsername: String(data.get('robloxUsername') || '').trim(),
        robloxUserId: String(data.get('robloxUserId') || '').trim(),
        rank: String(data.get('rank') || '').trim(),
        grade: String(data.get('grade') || '').trim(),
        serialNumber: String(data.get('serialNumber') || '').trim(),
        employeeStatus: String(data.get('employeeStatus') || '').trim(),
        hireDate: String(data.get('hireDate') || '').trim()
      });

      await loadEmployee();
      showMessage(feedback, 'Employee details saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save employee details.', 'error');
    }
  });

  disciplinaryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const data = new FormData(disciplinaryForm);

    try {
      await addDisciplinary(employeeId, {
        actionType: String(data.get('actionType') || '').trim(),
        recordType: String(data.get('actionType') || '').trim(),
        recordDate: String(data.get('recordDate') || '').trim(),
        recordStatus: String(data.get('recordStatus') || '').trim(),
        reason: String(data.get('reason') || '').trim(),
        severity: String(data.get('severity') || '').trim(),
        effectiveFrom: String(data.get('effectiveFrom') || '').trim(),
        effectiveTo: String(data.get('effectiveTo') || '').trim(),
        notes: String(data.get('notes') || '').trim()
      });

      disciplinaryForm.reset();
      disciplinaryForm.querySelector('[name="recordStatus"]').value = 'open';
      closeModal('disciplinaryModal');
      await loadEmployee();
      showMessage(feedback, 'Disciplinary action added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add disciplinary action.', 'error');
    }
  });

  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const data = new FormData(noteForm);

    try {
      await addEmployeeNote(employeeId, {
        category: String(data.get('category') || '').trim(),
        note: String(data.get('note') || '').trim()
      });

      noteForm.reset();
      closeModal('noteModal');
      await loadEmployee();
      showMessage(feedback, 'Note added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add note.', 'error');
    }
  });

  try {
    await refreshConfig();
    await loadEmployee();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load employee profile.', 'error');
  }
}
