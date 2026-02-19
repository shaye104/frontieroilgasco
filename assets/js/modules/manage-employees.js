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

function fillOptions(select, items) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Select</option>' + items.map((item) => `<option value="${item.value}">${item.value}</option>`).join('');
  if (current) select.value = current;
}

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function renderEmployeeList(target, employees, onSelect) {
  if (!target) return;
  if (!employees.length) {
    target.innerHTML = '<li class="role-item"><span class="role-id">No employees yet.</span></li>';
    return;
  }

  target.innerHTML = employees
    .map(
      (emp) => `<li class="role-item"><span class="role-id">#${emp.id} | ${text(emp.roblox_username)} | Discord ${emp.discord_user_id}</span>
      <button class="btn btn-secondary" data-open-employee="${emp.id}" type="button">Open</button></li>`
    )
    .join('');

  target.querySelectorAll('button[data-open-employee]').forEach((button) => {
    button.addEventListener('click', () => onSelect(Number(button.getAttribute('data-open-employee'))));
  });
}

function renderRecords(target, records, format) {
  if (!target) return;
  if (!records.length) {
    target.innerHTML = '<li class="role-item"><span class="role-id">None.</span></li>';
    return;
  }

  target.innerHTML = records.map((item) => `<li class="role-item"><span class="role-id">${format(item)}</span></li>`).join('');
}

export async function initManageEmployees(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const listEl = document.querySelector(config.employeeListSelector);
  const createForm = document.querySelector(config.createFormSelector);
  const editForm = document.querySelector(config.editFormSelector);
  const disciplinaryForm = document.querySelector(config.disciplinaryFormSelector);
  const noteForm = document.querySelector(config.noteFormSelector);
  const selectedBadge = document.querySelector(config.selectedEmployeeSelector);
  const disciplinaryList = document.querySelector(config.disciplinaryListSelector);
  const notesList = document.querySelector(config.notesListSelector);
  const cfg = {
    statuses: [],
    ranks: [],
    grades: [],
    disciplinary_types: []
  };

  if (!feedback || !listEl || !createForm || !editForm || !disciplinaryForm || !noteForm || !selectedBadge) return;

  let employees = [];
  let selectedEmployeeId = null;

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

    fillOptions(createForm.querySelector('[name="employeeStatus"]'), cfg.statuses);
    fillOptions(createForm.querySelector('[name="rank"]'), cfg.ranks);
    fillOptions(createForm.querySelector('[name="grade"]'), cfg.grades);

    fillOptions(editForm.querySelector('[name="employeeStatus"]'), cfg.statuses);
    fillOptions(editForm.querySelector('[name="rank"]'), cfg.ranks);
    fillOptions(editForm.querySelector('[name="grade"]'), cfg.grades);

    fillOptions(disciplinaryForm.querySelector('[name="recordType"]'), cfg.disciplinary_types);
  }

  async function refreshEmployees() {
    const payload = await listEmployees();
    employees = payload.employees || [];
    renderEmployeeList(listEl, employees, openEmployee);
  }

  async function openEmployee(employeeId) {
    const payload = await getEmployee(employeeId);
    const employee = payload.employee;

    selectedEmployeeId = employee.id;
    selectedBadge.textContent = `Selected Employee: #${employee.id}`;

    editForm.querySelector('[name="robloxUsername"]').value = employee.roblox_username || '';
    editForm.querySelector('[name="robloxUserId"]').value = employee.roblox_user_id || '';
    editForm.querySelector('[name="rank"]').value = employee.rank || '';
    editForm.querySelector('[name="grade"]').value = employee.grade || '';
    editForm.querySelector('[name="serialNumber"]').value = employee.serial_number || '';
    editForm.querySelector('[name="employeeStatus"]').value = employee.employee_status || '';
    editForm.querySelector('[name="hireDate"]').value = employee.hire_date || '';

    renderRecords(
      disciplinaryList,
      payload.disciplinaries || [],
      (item) => `${text(item.record_type)} | ${text(item.record_status)} | ${text(item.record_date)} | ${text(item.notes)}`
    );

    renderRecords(notesList, payload.notes || [], (item) => `${text(item.created_at)} | ${text(item.authored_by)} | ${text(item.note)}`);
  }

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
      showMessage(feedback, 'Open an employee before editing.', 'error');
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

  disciplinaryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    if (!selectedEmployeeId) {
      showMessage(feedback, 'Open an employee before adding disciplinary records.', 'error');
      return;
    }

    const data = new FormData(disciplinaryForm);
    try {
      await addDisciplinary(selectedEmployeeId, {
        recordType: String(data.get('recordType') || '').trim(),
        recordDate: String(data.get('recordDate') || '').trim(),
        recordStatus: String(data.get('recordStatus') || '').trim(),
        notes: String(data.get('notes') || '').trim()
      });

      disciplinaryForm.reset();
      await openEmployee(selectedEmployeeId);
      showMessage(feedback, 'Disciplinary record added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add disciplinary record.', 'error');
    }
  });

  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    if (!selectedEmployeeId) {
      showMessage(feedback, 'Open an employee before adding notes.', 'error');
      return;
    }

    const data = new FormData(noteForm);
    try {
      await addEmployeeNote(selectedEmployeeId, {
        note: String(data.get('note') || '').trim()
      });

      noteForm.reset();
      await openEmployee(selectedEmployeeId);
      showMessage(feedback, 'Note added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add note.', 'error');
    }
  });

  try {
    await refreshConfig();
    await refreshEmployees();
    showMessage(feedback, 'Manage Employees ready.', 'success');
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize Manage Employees.', 'error');
  }
}
