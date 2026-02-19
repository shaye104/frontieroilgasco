import { createFormAdmin, deleteFormAdmin, getFormAdmin, listFormCategories, updateFormAdmin } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

const QUESTION_TYPES = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'multiple_choice', label: 'Single choice' },
  { value: 'multiple_select', label: 'Multi choice' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'yes_no', label: 'Yes/No' }
];

function attr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function questionRowHtml(question = {}, index = 0) {
  const typeOptions = QUESTION_TYPES.map((item) => `<option value="${item.value}" ${item.value === question.questionType ? 'selected' : ''}>${item.label}</option>`).join('');

  return `
    <div class="panel" data-question-row>
      <div class="two-column">
        <div>
          <label>Question Label</label>
          <input name="label" type="text" value="${attr(question.label || '')}" />
        </div>
        <div>
          <label>Question Type</label>
          <select name="questionType">${typeOptions}</select>
        </div>
        <div>
          <label>Required</label>
          <select name="isRequired">
            <option value="false" ${question.isRequired ? '' : 'selected'}>No</option>
            <option value="true" ${question.isRequired ? 'selected' : ''}>Yes</option>
          </select>
        </div>
        <div>
          <label>Sort Order</label>
          <input name="sortOrder" type="number" value="${Number.isFinite(Number(question.sortOrder)) ? Number(question.sortOrder) : index}" />
        </div>
        <div>
          <label>Help Text</label>
          <input name="helpText" type="text" value="${attr(question.helpText || '')}" />
        </div>
        <div>
          <label>Options (comma-separated)</label>
          <input name="options" type="text" value="${attr((question.options || []).join(', '))}" />
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" data-remove-question>Remove Question</button>
      </div>
    </div>
  `;
}

function parseQuestions(root) {
  return Array.from(root.querySelectorAll('[data-question-row]')).map((row, index) => ({
    label: String(row.querySelector('[name="label"]')?.value || '').trim(),
    questionType: String(row.querySelector('[name="questionType"]')?.value || '').trim(),
    isRequired: String(row.querySelector('[name="isRequired"]')?.value || 'false') === 'true',
    helpText: String(row.querySelector('[name="helpText"]')?.value || '').trim(),
    sortOrder: Number(row.querySelector('[name="sortOrder"]')?.value || index),
    options: String(row.querySelector('[name="options"]')?.value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }));
}

function parseFormId() {
  const query = new URLSearchParams(window.location.search);
  const queryId = Number(query.get('formId'));
  if (Number.isInteger(queryId) && queryId > 0) return queryId;
  const pathMatch = window.location.pathname.match(/\/forms\/config\/forms\/(\d+)/);
  if (pathMatch?.[1]) return Number(pathMatch[1]);
  return null;
}

export async function initFormsBuilderAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const titleEl = document.querySelector(config.titleSelector);
  const form = document.querySelector(config.formSelector);
  const questionBuilder = document.querySelector(config.questionBuilderSelector);
  const addQuestionBtn = document.querySelector(config.addQuestionBtnSelector);
  const deleteBtn = document.querySelector(config.deleteBtnSelector);

  if (!feedback || !form || !questionBuilder || !titleEl) return;

  const formId = parseFormId();
  let selectedFormId = formId;

  function bindQuestionEvents() {
    questionBuilder.querySelectorAll('[data-remove-question]').forEach((button) => {
      button.addEventListener('click', () => button.closest('[data-question-row]')?.remove());
    });
  }

  function setCategoryOptions(categories) {
    const select = form.querySelector('[name="categoryId"]');
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Uncategorized</option>${(categories || [])
      .map((category) => `<option value="${category.id}">${category.name}</option>`)
      .join('')}`;
    if (current) select.value = current;
  }

  async function loadCategories() {
    const payload = await listFormCategories();
    setCategoryOptions(payload.categories || []);
  }

  async function loadExisting() {
    if (!selectedFormId) {
      titleEl.textContent = 'Create Form';
      questionBuilder.innerHTML = questionRowHtml({}, 0);
      bindQuestionEvents();
      deleteBtn?.classList.add('hidden');
      return;
    }

    const detail = await getFormAdmin(selectedFormId);
    const formData = detail.form;

    titleEl.textContent = `Edit Form #${selectedFormId}`;
    form.querySelector('[name="id"]').value = String(formData.id || '');
    form.querySelector('[name="title"]').value = formData.title || '';
    form.querySelector('[name="description"]').value = formData.description || '';
    form.querySelector('[name="instructions"]').value = formData.instructions || '';
    form.querySelector('[name="status"]').value = formData.status || 'draft';
    form.querySelector('[name="categoryId"]').value = formData.category_id || '';
    form.querySelector('[name="allowedEmployeeIds"]').value = (detail.allowedEmployeeIds || []).join(', ');
    form.querySelector('[name="allowedRoleIds"]').value = (detail.allowedRoleIds || []).join(', ');

    questionBuilder.innerHTML = (detail.questions || []).map((q, i) => questionRowHtml(q, i)).join('');
    if (!detail.questions?.length) questionBuilder.innerHTML = questionRowHtml({}, 0);
    bindQuestionEvents();
    deleteBtn?.classList.remove('hidden');
  }

  addQuestionBtn?.addEventListener('click', () => {
    const index = questionBuilder.querySelectorAll('[data-question-row]').length;
    questionBuilder.insertAdjacentHTML('beforeend', questionRowHtml({}, index));
    bindQuestionEvents();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const data = new FormData(form);
    const payload = {
      title: String(data.get('title') || '').trim(),
      description: String(data.get('description') || '').trim(),
      instructions: String(data.get('instructions') || '').trim(),
      categoryId: String(data.get('categoryId') || '').trim(),
      status: String(data.get('status') || 'draft').trim(),
      allowedEmployeeIds: String(data.get('allowedEmployeeIds') || '')
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isInteger(v) && v > 0),
      allowedRoleIds: String(data.get('allowedRoleIds') || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      questions: parseQuestions(questionBuilder)
    };

    try {
      if (selectedFormId) {
        await updateFormAdmin(selectedFormId, payload);
      } else {
        const created = await createFormAdmin(payload);
        selectedFormId = created?.form?.id || selectedFormId;
      }
      window.location.href = 'forms-manage.html';
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save form.', 'error');
    }
  });

  deleteBtn?.addEventListener('click', async () => {
    if (!selectedFormId) return;
    try {
      await deleteFormAdmin(selectedFormId);
      window.location.href = 'forms-manage.html';
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to delete form.', 'error');
    }
  });

  try {
    await loadCategories();
    await loadExisting();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize form builder.', 'error');
  }
}
