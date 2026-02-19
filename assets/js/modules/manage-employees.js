import {
  addDisciplinary,
  addEmployeeNote,
  createEmployee,
  getConfig,
  getEmployee,
  listEmployees,
  updateEmployee
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function fillOptions(select, items, placeholder = 'All') {
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

function renderRecords(target, records, format, emptyMessage = 'None.') {
  if (!target) return;
  if (!records.length) {
    target.innerHTML = `<li class="role-item"><span class="role-id">${emptyMessage}</span></li>`;
    return;
  }

  target.innerHTML = records.map((item) => `<li class="role-item"><span class="role-id">${format(item)}</span></li>`).join('');
}

function applyEmployeeFilters(employees, filters) {
  const serialFilter = String(filters.serial || '').trim().toLowerCase();
  const usernameFilter = String(filters.username || '').trim().toLowerCase();

  return employees.filter((emp) => {
    if (filters.rank && String(emp.rank || '') !== filters.rank) return false;
    if (filters.grade && String(emp.grade || '') !== filters.grade) return false;

    const serial = String(emp.serial_number || '').toLowerCase();
    const username = String(emp.roblox_username || '').toLowerCase();

    if (serialFilter && !serial.includes(serialFilter)) return false;
    if (usernameFilter && !username.includes(usernameFilter)) return false;

    return true;
  });
}

function renderEmployeeTable(target, employees, onOpen) {
  if (!target) return;
  if (!employees.length) {
    target.innerHTML = '<tr><td colspan="9">No employees found.</td></tr>';
    return;
  }

  target.innerHTML = employees
    .map(
      (emp) => `
        <tr>
          <td>${emp.id}</td>
          <td>${text(emp.roblox_username)}</td>
          <td>${text(emp.roblox_user_id)}</td>
          <td>${text(emp.rank)}</td>
          <td>${text(emp.grade)}</td>
          <td>${text(emp.serial_number)}</td>
          <td>${text(emp.employee_status)}</td>
          <td>${text(emp.hire_date)}</td>
          <td><button class="btn btn-secondary" type="button" data-open-employee="${emp.id}">Open</button></td>
        </tr>
      `
    )
    .join('');

  target.querySelectorAll('button[data-open-employee]').forEach((button) => {
    button.addEventListener('click', () => onOpen(Number(button.getAttribute('data-open-employee'))));
  });
}

function getActiveDisciplinaries(records) {
  return (records || []).filter((item) => {
    const status = String(item.record_status || '').toLowerCase();
    return status === 'open' || status === 'active';
  });
}

export async function initManageEmployees(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.employeeTableBodySelector);
  const selectedBadge = document.querySelector(config.selectedEmployeeSelector);

  const filterRank = document.querySelector(config.filterRankSelector);
  const filterGrade = document.querySelector(config.filterGradeSelector);
  const filterSerial = document.querySelector(config.filterSerialSelector);
  const filterUsername = document.querySelector(config.filterUsernameSelector);

  const openCreateEmployeeBtn = document.querySelector(config.openCreateEmployeeBtnSelector);
  const createForm = document.querySelector(config.createFormSelector);
  const editForm = document.querySelector(config.editFormSelector);
  const disciplinaryForm = document.querySelector(config.disciplinaryFormSelector);
  const noteForm = document.querySelector(config.noteFormSelector);
  const activeDisciplinaryList = document.querySelector(config.activeDisciplinaryListSelector);
  const activityList = document.querySelector(config.activityListSelector);
  const openDisciplinaryModalBtn = document.querySelector(config.openDisciplinaryModalBtnSelector);
  const openNoteModalBtn = document.querySelector(config.openNoteModalBtnSelector);
  const tenureDaysInput = document.querySelector(config.tenureDaysSelector);

  if (
    !feedback ||
    !tableBody ||
    !selectedBadge ||
    !createForm ||
    !editForm ||
    !disciplinaryForm ||
    !noteForm ||
    !activeDisciplinaryList ||
    !activityList
  ) {
    return;
  }

  let employees = [];
  let selectedEmployeeId = null;
  const cfg = { statuses: [], ranks: [], grades: [], disciplinary_types: [] };

  const refreshTable = () => {
    const filtered = applyEmployeeFilters(employees, {
      rank: filterRank?.value || '',
      grade: filterGrade?.value || '',
      serial: filterSerial?.value || '',
      username: filterUsername?.value || ''
    });

    renderEmployeeTable(tableBody, filtered, openEmployee);
  };

  async function refreshConfig() {
    const [statuses, ranks, grades, disciplinaryTypes] = await Promise.all([
      getConfig('statuses'),
      getConfig('ranks'),
      getConfig('grades'),
      getConfig('disciplinary_types')
    ]);

    cfg.statuses = statuses.items || [];
    cfg.ranks = ranks.items || [];
    cfg.grades = grades.items || [];
    cfg.disciplinary_types = disciplinaryTypes.items || [];

    fillOptions(filterRank, cfg.ranks, 'All Ranks');
    fillOptions(filterGrade, cfg.grades, 'All Grades');

    fillOptions(createForm.querySelector('[name="employeeStatus"]'), cfg.statuses, 'Select');
    fillOptions(createForm.querySelector('[name="rank"]'), cfg.ranks, 'Select');
    fillOptions(createForm.querySelector('[name="grade"]'), cfg.grades, 'Select');

    fillOptions(editForm.querySelector('[name="employeeStatus"]'), cfg.statuses, 'Select');
    fillOptions(editForm.querySelector('[name="rank"]'), cfg.ranks, 'Select');
    fillOptions(editForm.querySelector('[name="grade"]'), cfg.grades, 'Select');

    fillOptions(disciplinaryForm.querySelector('[name="actionType"]'), cfg.disciplinary_types, 'Select Action');
  }

  async function refreshEmployees() {
    const payload = await listEmployees();
    employees = payload.employees || [];
    refreshTable();
  }

  async function openEmployee(employeeId) {
    const payload = await getEmployee(employeeId);
    const employee = payload.employee;

    selectedEmployeeId = employee.id;
    selectedBadge.textContent = `Employee #${employee.id} | Discord ${text(employee.discord_user_id)}`;

    editForm.querySelector('[name="robloxUsername"]').value = employee.roblox_username || '';
    editForm.querySelector('[name="robloxUserId"]').value = employee.roblox_user_id || '';
    editForm.querySelector('[name="rank"]').value = employee.rank || '';
    editForm.querySelector('[name="grade"]').value = employee.grade || '';
    editForm.querySelector('[name="serialNumber"]').value = employee.serial_number || '';
    editForm.querySelector('[name="employeeStatus"]').value = employee.employee_status || '';
    editForm.querySelector('[name="hireDate"]').value = employee.hire_date || '';
    if (tenureDaysInput) tenureDaysInput.value = calculateTenureDays(employee.hire_date);

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
      'No activity yet.'
    );

    openModal('employeeDetailModal');
  }

  openCreateEmployeeBtn?.addEventListener('click', () => openModal('createEmployeeModal'));

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-close-modal');
      if (target) closeModal(target);
    });
  });

  [filterRank, filterGrade, filterSerial, filterUsername].forEach((input) => {
    input?.addEventListener('input', refreshTable);
    input?.addEventListener('change', refreshTable);
  });

  editForm.querySelector('[name="hireDate"]')?.addEventListener('change', (event) => {
    if (!tenureDaysInput) return;
    tenureDaysInput.value = calculateTenureDays(event.target.value);
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
      await refreshEmployees();
      showMessage(feedback, 'Employee created.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to create employee.', 'error');
    }
  });

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    if (!selectedEmployeeId) {
      showMessage(feedback, 'Open an employee first.', 'error');
      return;
    }

    const data = new FormData(editForm);

    try {
      await updateEmployee(selectedEmployeeId, {
        robloxUsername: String(data.get('robloxUsername') || '').trim(),
        robloxUserId: String(data.get('robloxUserId') || '').trim(),
        rank: String(data.get('rank') || '').trim(),
        grade: String(data.get('grade') || '').trim(),
        serialNumber: String(data.get('serialNumber') || '').trim(),
        employeeStatus: String(data.get('employeeStatus') || '').trim(),
        hireDate: String(data.get('hireDate') || '').trim()
      });

      await refreshEmployees();
      await openEmployee(selectedEmployeeId);
      showMessage(feedback, 'Employee updated.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update employee.', 'error');
    }
  });

  openDisciplinaryModalBtn?.addEventListener('click', () => {
    if (!selectedEmployeeId) {
      showMessage(feedback, 'Open an employee first.', 'error');
      return;
    }
    openModal('disciplinaryModal');
  });

  openNoteModalBtn?.addEventListener('click', () => {
    if (!selectedEmployeeId) {
      showMessage(feedback, 'Open an employee first.', 'error');
      return;
    }
    openModal('noteModal');
  });

  disciplinaryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    if (!selectedEmployeeId) {
      showMessage(feedback, 'Open an employee first.', 'error');
      return;
    }

    const data = new FormData(disciplinaryForm);

    try {
      await addDisciplinary(selectedEmployeeId, {
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
      await openEmployee(selectedEmployeeId);
      showMessage(feedback, 'Disciplinary action added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add disciplinary record.', 'error');
    }
  });

  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    if (!selectedEmployeeId) {
      showMessage(feedback, 'Open an employee first.', 'error');
      return;
    }

    const data = new FormData(noteForm);

    try {
      await addEmployeeNote(selectedEmployeeId, {
        category: String(data.get('category') || '').trim(),
        note: String(data.get('note') || '').trim()
      });

      noteForm.reset();
      closeModal('noteModal');
      await openEmployee(selectedEmployeeId);
      showMessage(feedback, 'Note added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add note.', 'error');
    }
  });

  try {
    await refreshConfig();
    await refreshEmployees();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize Manage Employees.', 'error');
  }
}
