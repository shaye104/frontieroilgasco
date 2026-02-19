import {
  createFormAdmin,
  createFormCategory,
  deleteFormAdmin,
  deleteFormCategory,
  getFormAdmin,
  listEmployees,
  listFormCategories,
  listFormsAdmin,
  updateFormAdmin,
  updateFormCategory
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

const QUESTION_TYPES = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'multiple_select', label: 'Multiple select' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'yes_no', label: 'Yes/No' }
];

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function attr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function csvFromIds(values) {
  return (values || []).map((v) => String(v)).join(', ');
}

function parseQuestions(root) {
  return Array.from(root.querySelectorAll('[data-question-row]')).map((row, index) => {
    const label = String(row.querySelector('[name="label"]')?.value || '').trim();
    const questionType = String(row.querySelector('[name="questionType"]')?.value || '').trim();
    const isRequired = String(row.querySelector('[name="isRequired"]')?.value || 'false') === 'true';
    const helpText = String(row.querySelector('[name="helpText"]')?.value || '').trim();
    const sortOrder = Number(row.querySelector('[name="sortOrder"]')?.value || index);
    const options = String(row.querySelector('[name="options"]')?.value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    return {
      label,
      questionType,
      isRequired,
      helpText,
      sortOrder,
      options
    };
  });
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

export async function initFormsAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const categoryForm = document.querySelector(config.categoryFormSelector);
  const saveCategoryBtn = document.querySelector(config.saveCategoryBtnSelector);
  const resetCategoryBtn = document.querySelector(config.resetCategoryBtnSelector);
  const categoryList = document.querySelector(config.categoryListSelector);

  const formList = document.querySelector(config.formListSelector);
  const formEditorForm = document.querySelector(config.formEditorFormSelector);
  const newFormBtn = document.querySelector(config.newFormBtnSelector);
  const deleteFormBtn = document.querySelector(config.deleteFormBtnSelector);
  const addQuestionBtn = document.querySelector(config.addQuestionBtnSelector);
  const questionBuilder = document.querySelector(config.questionBuilderSelector);
  const categoriesPanel = document.querySelector(config.categoriesPanelSelector);
  const formBuilderPanel = document.querySelector(config.formBuilderPanelSelector);

  if (!feedback || !categoryForm || !categoryList || !formList || !formEditorForm || !questionBuilder) return;

  let categories = [];
  let forms = [];
  let employees = [];
  let selectedFormId = null;
  const url = new URL(window.location.href);
  const mode = String(url.searchParams.get('mode') || '').trim().toLowerCase();
  const returnTo = String(url.searchParams.get('returnTo') || '').trim();

  function maybeReturnToForms() {
    if (!returnTo) return;
    window.location.href = `${returnTo}${returnTo.includes('?') ? '&' : '?'}updated=${Date.now()}`;
  }

  function applyMode() {
    if (!categoriesPanel || !formBuilderPanel) return;
    if (mode === 'categories') {
      categoriesPanel.classList.remove('hidden');
      formBuilderPanel.classList.add('hidden');
      return;
    }

    if (mode === 'create') {
      categoriesPanel.classList.add('hidden');
      formBuilderPanel.classList.remove('hidden');
      return;
    }

    categoriesPanel.classList.remove('hidden');
    formBuilderPanel.classList.remove('hidden');
  }

  function bindQuestionEvents() {
    questionBuilder.querySelectorAll('[data-remove-question]').forEach((button) => {
      button.addEventListener('click', () => {
        button.closest('[data-question-row]')?.remove();
      });
    });
  }

  function renderCategories() {
    categoryList.innerHTML = (categories || [])
      .map(
        (category) => `
          <li class="role-item">
            <span class="role-id">${text(category.name)} | Order ${category.sort_order} | ${text(category.description || '')}</span>
            <span class="modal-actions">
              <button class="btn btn-secondary" type="button" data-edit-category="${category.id}">Edit</button>
              <button class="btn btn-danger" type="button" data-delete-category="${category.id}">Delete</button>
            </span>
          </li>
        `
      )
      .join('');

    categoryList.querySelectorAll('[data-edit-category]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-edit-category'));
        const category = categories.find((item) => Number(item.id) === id);
        if (!category) return;
        categoryForm.querySelector('[name="id"]').value = String(category.id);
        categoryForm.querySelector('[name="name"]').value = category.name || '';
        categoryForm.querySelector('[name="description"]').value = category.description || '';
        categoryForm.querySelector('[name="sortOrder"]').value = String(category.sort_order || 0);
      });
    });

    categoryList.querySelectorAll('[data-delete-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.getAttribute('data-delete-category'));
        try {
          await deleteFormCategory(id);
          await refreshAll();
          showMessage(feedback, 'Category deleted.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to delete category.', 'error');
        }
      });
    });
  }

  function renderForms() {
    formList.innerHTML = (forms || [])
      .map(
        (form) => `
          <li class="role-item">
            <span class="role-id">#${form.id} | ${text(form.title)} | ${text(form.status)} | ${text(form.category_name || 'Uncategorized')}</span>
            <button class="btn btn-secondary" type="button" data-open-form="${form.id}">Open</button>
          </li>
        `
      )
      .join('');

    formList.querySelectorAll('[data-open-form]').forEach((button) => {
      button.addEventListener('click', async () => {
        const formId = Number(button.getAttribute('data-open-form'));
        await openForm(formId);
      });
    });
  }

  function fillFormCategorySelect() {
    const select = formEditorForm.querySelector('[name="categoryId"]');
    if (!select) return;
    select.innerHTML = `<option value="">Uncategorized</option>${categories
      .map((category) => `<option value="${category.id}">${category.name}</option>`)
      .join('')}`;
  }

  function resetFormEditor() {
    selectedFormId = null;
    formEditorForm.reset();
    formEditorForm.querySelector('[name="id"]').value = '';
    questionBuilder.innerHTML = '';
    fillFormCategorySelect();
    questionBuilder.insertAdjacentHTML('beforeend', questionRowHtml({}, 0));
    bindQuestionEvents();
  }

  async function openForm(formId) {
    const detail = await getFormAdmin(formId);
    selectedFormId = formId;

    const { form, questions, allowedEmployeeIds, allowedRoleIds } = detail;

    formEditorForm.querySelector('[name="id"]').value = String(form.id);
    formEditorForm.querySelector('[name="title"]').value = form.title || '';
    formEditorForm.querySelector('[name="description"]').value = form.description || '';
    formEditorForm.querySelector('[name="instructions"]').value = form.instructions || '';
    formEditorForm.querySelector('[name="status"]').value = form.status || 'draft';
    fillFormCategorySelect();
    formEditorForm.querySelector('[name="categoryId"]').value = form.category_id || '';
    formEditorForm.querySelector('[name="allowedEmployeeIds"]').value = csvFromIds(allowedEmployeeIds);
    formEditorForm.querySelector('[name="allowedRoleIds"]').value = csvFromIds(allowedRoleIds);

    questionBuilder.innerHTML = (questions || []).map((question, index) => questionRowHtml(question, index)).join('');
    if (!questions?.length) questionBuilder.insertAdjacentHTML('beforeend', questionRowHtml({}, 0));
    bindQuestionEvents();
  }

  async function refreshAll() {
    const [categoryPayload, formsPayload, employeesPayload] = await Promise.all([listFormCategories(), listFormsAdmin(), listEmployees()]);
    categories = categoryPayload.categories || [];
    forms = formsPayload.forms || [];
    employees = employeesPayload.employees || [];

    renderCategories();
    renderForms();
    fillFormCategorySelect();
  }

  saveCategoryBtn?.addEventListener('click', async () => {
    clearMessage(feedback);

    const payload = {
      id: categoryForm.querySelector('[name="id"]').value,
      name: categoryForm.querySelector('[name="name"]').value,
      description: categoryForm.querySelector('[name="description"]').value,
      sortOrder: categoryForm.querySelector('[name="sortOrder"]').value
    };

    try {
      if (payload.id) await updateFormCategory(payload);
      else await createFormCategory(payload);

      categoryForm.reset();
      categoryForm.querySelector('[name="id"]').value = '';
      await refreshAll();
      showMessage(feedback, 'Category saved.', 'success');
      if (mode === 'categories' && returnTo) maybeReturnToForms();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save category.', 'error');
    }
  });

  resetCategoryBtn?.addEventListener('click', () => {
    categoryForm.reset();
    categoryForm.querySelector('[name="id"]').value = '';
  });

  newFormBtn?.addEventListener('click', () => {
    resetFormEditor();
    clearMessage(feedback);
  });

  addQuestionBtn?.addEventListener('click', () => {
    const index = questionBuilder.querySelectorAll('[data-question-row]').length;
    questionBuilder.insertAdjacentHTML('beforeend', questionRowHtml({}, index));
    bindQuestionEvents();
  });

  formEditorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const formData = new FormData(formEditorForm);
    const payload = {
      title: String(formData.get('title') || '').trim(),
      description: String(formData.get('description') || '').trim(),
      instructions: String(formData.get('instructions') || '').trim(),
      categoryId: String(formData.get('categoryId') || '').trim(),
      status: String(formData.get('status') || 'draft').trim(),
      allowedEmployeeIds: String(formData.get('allowedEmployeeIds') || '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
      allowedRoleIds: String(formData.get('allowedRoleIds') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      questions: parseQuestions(questionBuilder)
    };

    try {
      if (selectedFormId) await updateFormAdmin(selectedFormId, payload);
      else {
        const created = await createFormAdmin(payload);
        selectedFormId = created?.form?.id || selectedFormId;
      }

      await refreshAll();
      if (selectedFormId) await openForm(selectedFormId);
      showMessage(feedback, 'Form saved.', 'success');
      if (mode === 'create' && returnTo) maybeReturnToForms();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save form.', 'error');
    }
  });

  deleteFormBtn?.addEventListener('click', async () => {
    if (!selectedFormId) {
      showMessage(feedback, 'Select a form first.', 'error');
      return;
    }

    try {
      await deleteFormAdmin(selectedFormId);
      await refreshAll();
      resetFormEditor();
      showMessage(feedback, 'Form deleted.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to delete form.', 'error');
    }
  });

  try {
    await refreshAll();
    resetFormEditor();
    applyMode();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize forms admin.', 'error');
  }

  void employees;
}
