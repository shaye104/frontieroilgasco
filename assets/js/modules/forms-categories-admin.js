import { createFormCategory, deleteFormCategory, listFormCategories, updateFormCategory } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

export async function initFormsCategoriesAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const list = document.querySelector(config.listSelector);
  const form = document.querySelector(config.formSelector);
  const editor = document.querySelector(config.editorSelector);
  const openBtn = document.querySelector(config.openBtnSelector);
  const saveBtn = document.querySelector(config.saveBtnSelector);
  const cancelBtn = document.querySelector(config.cancelBtnSelector);

  if (!feedback || !list || !form || !editor) return;

  let categories = [];

  function hideEditor() {
    editor.classList.add('hidden');
    form.reset();
    form.querySelector('[name="id"]').value = '';
  }

  function showEditor(category = null) {
    editor.classList.remove('hidden');
    if (!category) {
      form.reset();
      form.querySelector('[name="id"]').value = '';
      return;
    }

    form.querySelector('[name="id"]').value = String(category.id);
    form.querySelector('[name="name"]').value = category.name || '';
    form.querySelector('[name="sortOrder"]').value = String(category.sort_order || 0);
    form.querySelector('[name="description"]').value = category.description || '';
  }

  function render() {
    list.innerHTML = (categories || [])
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

    list.querySelectorAll('[data-edit-category]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-edit-category'));
        const category = categories.find((item) => Number(item.id) === id);
        if (category) showEditor(category);
      });
    });

    list.querySelectorAll('[data-delete-category]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.getAttribute('data-delete-category'));
        try {
          await deleteFormCategory(id);
          await refresh();
          showMessage(feedback, 'Category deleted.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to delete category.', 'error');
        }
      });
    });
  }

  async function refresh() {
    const payload = await listFormCategories();
    categories = payload.categories || [];
    render();
  }

  openBtn?.addEventListener('click', () => showEditor(null));
  cancelBtn?.addEventListener('click', hideEditor);

  saveBtn?.addEventListener('click', async () => {
    clearMessage(feedback);
    const payload = {
      id: String(form.querySelector('[name="id"]').value || '').trim(),
      name: String(form.querySelector('[name="name"]').value || '').trim(),
      sortOrder: String(form.querySelector('[name="sortOrder"]').value || '0').trim(),
      description: String(form.querySelector('[name="description"]').value || '').trim()
    };

    try {
      if (payload.id) await updateFormCategory(payload);
      else await createFormCategory(payload);
      await refresh();
      hideEditor();
      showMessage(feedback, 'Category saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save category.', 'error');
    }
  });

  try {
    await refresh();
    hideEditor();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load categories.', 'error');
  }
}
