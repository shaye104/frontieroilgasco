import {
  getAccessibleFormResponse,
  listAccessibleFormResponses,
  listAvailableForms,
  listEmployees,
  listFormCategories,
  listFormsAdmin
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function fillSelect(select, items, valueKey, labelBuilder, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>${items
    .map((item) => `<option value="${item[valueKey]}">${labelBuilder(item)}</option>`)
    .join('')}`;
  if (current) select.value = current;
}

function renderTableRows(target, responses) {
  if (!target) return;
  if (!responses.length) {
    target.innerHTML = '<tr><td colspan="6">No responses found.</td></tr>';
    return;
  }

  target.innerHTML = responses
    .map(
      (response) => `
        <tr>
          <td>${response.id}</td>
          <td>${text(response.form_title)}</td>
          <td>${text(response.category_name || 'Uncategorized')}</td>
          <td>${text(response.respondent_name || response.respondent_discord_user_id)}</td>
          <td>${text(response.submitted_at)}</td>
          <td><button class="btn btn-secondary" type="button" data-open-response="${response.id}">Open</button></td>
        </tr>
      `
    )
    .join('');
}

function renderDetail(target, payload) {
  if (!target) return;
  if (!payload) {
    target.innerHTML = '<p>Select a response to view details.</p>';
    return;
  }

  target.innerHTML = `
    <div class="panel">
      <p><strong>Form:</strong> ${text(payload.response.form_title)}</p>
      <p><strong>Category:</strong> ${text(payload.response.category_name || 'Uncategorized')}</p>
      <p><strong>Respondent:</strong> ${text(payload.response.respondent_name || payload.response.respondent_discord_user_id)}</p>
      <p><strong>Submitted:</strong> ${text(payload.response.submitted_at)}</p>
    </div>
    <ul class="role-list">
      ${(payload.answers || [])
        .map(
          (answer) =>
            `<li class="role-item"><span class="role-id"><strong>${text(answer.label)}</strong> | ${text(
              Array.isArray(answer.answer) ? answer.answer.join(', ') : typeof answer.answer === 'object' ? JSON.stringify(answer.answer) : answer.answer
            )}</span></li>`
        )
        .join('')}
    </ul>
  `;
}

export async function initFormsResponses(config, session) {
  const feedback = document.querySelector(config.feedbackSelector);
  const formFilter = document.querySelector(config.formFilterSelector);
  const categoryFilter = document.querySelector(config.categoryFilterSelector);
  const employeeFilter = document.querySelector(config.employeeFilterSelector);
  const dateFromFilter = document.querySelector(config.dateFromSelector);
  const dateToFilter = document.querySelector(config.dateToSelector);
  const applyFiltersBtn = document.querySelector(config.applyFiltersBtnSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const detailRoot = document.querySelector(config.detailSelector);
  const employeeFilterContainer = employeeFilter?.closest('div');

  if (!feedback || !tableBody || !detailRoot) return;

  async function loadFilters() {
    const [formsPayload, categoriesPayload] = await Promise.all([
      session?.hasFormsAdmin ? listFormsAdmin() : listAvailableForms(),
      listFormCategories()
    ]);

    const forms = session?.hasFormsAdmin
      ? formsPayload.forms || []
      : [
          ...(formsPayload.uncategorized || []),
          ...((formsPayload.categories || []).flatMap((category) => category.forms || []))
        ];
    fillSelect(formFilter, forms, 'id', (item) => item.title, 'All Forms');
    fillSelect(categoryFilter, categoriesPayload.categories || [], 'id', (item) => item.name, 'All Categories');

    if (session?.hasFormsAdmin) {
      const employeesPayload = await listEmployees();
      fillSelect(employeeFilter, employeesPayload.employees || [], 'id', (item) => item.roblox_username || `Employee #${item.id}`, 'All Respondents');
      employeeFilterContainer?.classList.remove('hidden');
    } else {
      if (employeeFilter) employeeFilter.innerHTML = '<option value="">Me</option>';
      employeeFilterContainer?.classList.add('hidden');
    }
  }

  async function loadResponses() {
    const payload = await listAccessibleFormResponses({
      formId: formFilter?.value || '',
      categoryId: categoryFilter?.value || '',
      employeeId: session?.hasFormsAdmin ? employeeFilter?.value || '' : '',
      dateFrom: dateFromFilter?.value || '',
      dateTo: dateToFilter?.value || ''
    });

    const responses = payload.responses || [];
    renderTableRows(tableBody, responses);

    tableBody.querySelectorAll('[data-open-response]').forEach((button) => {
      button.addEventListener('click', async () => {
        const responseId = Number(button.getAttribute('data-open-response'));
        try {
          const detail = await getAccessibleFormResponse(responseId);
          renderDetail(detailRoot, detail);
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to load response detail.', 'error');
        }
      });
    });
  }

  applyFiltersBtn?.addEventListener('click', async () => {
    try {
      await loadResponses();
      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load responses.', 'error');
    }
  });

  try {
    await loadFilters();
    await loadResponses();
    renderDetail(detailRoot, null);
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize form responses.', 'error');
  }
}
