import { createEmployee, getConfig, listEmployees } from './admin-api.js';
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

function renderEmployeeTable(target, employees) {
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
          <td><a class="btn btn-secondary" href="/admin/employees/${emp.id}?employeeId=${emp.id}">Open</a></td>
        </tr>
      `
    )
    .join('');
}

export async function initManageEmployees(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.employeeTableBodySelector);

  const filterRank = document.querySelector(config.filterRankSelector);
  const filterGrade = document.querySelector(config.filterGradeSelector);
  const filterSerial = document.querySelector(config.filterSerialSelector);
  const filterUsername = document.querySelector(config.filterUsernameSelector);

  const openCreateEmployeeBtn = document.querySelector(config.openCreateEmployeeBtnSelector);
  const createForm = document.querySelector(config.createFormSelector);

  if (!feedback || !tableBody || !createForm) return;

  let employees = [];

  const refreshTable = () => {
    const filtered = applyEmployeeFilters(employees, {
      rank: filterRank?.value || '',
      grade: filterGrade?.value || '',
      serial: filterSerial?.value || '',
      username: filterUsername?.value || ''
    });

    renderEmployeeTable(tableBody, filtered);
  };

  async function refreshConfig() {
    const [statuses, ranks, grades] = await Promise.all([getConfig('statuses'), getConfig('ranks'), getConfig('grades')]);

    fillOptions(filterRank, ranks.items || [], 'All Ranks');
    fillOptions(filterGrade, grades.items || [], 'All Grades');

    fillOptions(createForm.querySelector('[name="employeeStatus"]'), statuses.items || [], 'Select');
    fillOptions(createForm.querySelector('[name="rank"]'), ranks.items || [], 'Select');
    fillOptions(createForm.querySelector('[name="grade"]'), grades.items || [], 'Select');
  }

  async function refreshEmployees() {
    const payload = await listEmployees();
    employees = payload.employees || [];
    refreshTable();
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

  try {
    await refreshConfig();
    await refreshEmployees();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize Manage Employees.', 'error');
  }
}
