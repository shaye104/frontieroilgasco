import { listFormsAdmin } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

export async function initFormsManageAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const list = document.querySelector(config.listSelector);
  if (!feedback || !list) return;

  try {
    const payload = await listFormsAdmin();
    const forms = payload.forms || [];

    if (!forms.length) {
      list.innerHTML = '<li class="role-item"><span class="role-id">No forms created yet.</span></li>';
      clearMessage(feedback);
      return;
    }

    list.innerHTML = forms
      .map(
        (form) => `
          <li class="role-item">
            <span class="role-id">#${form.id} | ${text(form.title)} | ${text(form.status)} | ${text(form.category_name || 'Uncategorized')}</span>
            <a class="btn btn-secondary" href="/forms/config/forms/${form.id}">Open</a>
          </li>
        `
      )
      .join('');

    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load forms.', 'error');
  }
}
