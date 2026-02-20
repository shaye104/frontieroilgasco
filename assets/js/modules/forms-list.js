import { listAvailableForms } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';
import { hasPermission } from './nav.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function renderForms(target, forms) {
  if (!target) return;

  if (!forms.length) {
    target.innerHTML = '<p>No forms available.</p>';
    return;
  }

  target.innerHTML = forms
    .map(
      (form) => `
        <article class="panel">
          <h3>${text(form.title)}</h3>
          <p>${text(form.description || form.instructions || 'No description provided.')}</p>
          <p><strong>Category:</strong> ${text(form.category_name || 'Uncategorized')}</p>
          <a class="btn btn-primary" href="form-fill.html?formId=${form.id}">Open</a>
        </article>
      `
    )
    .join('');
}

function renderFormsSkeleton(target, sectionTitle) {
  if (!target) return;
  target.innerHTML = `<h2>${sectionTitle}</h2>
    <div class="card-grid">
      <article class="panel skeleton-shell">
        <div class="skeleton-line skeleton-w-45"></div>
        <div class="skeleton-line skeleton-w-80"></div>
        <div class="skeleton-line skeleton-w-60"></div>
      </article>
      <article class="panel skeleton-shell">
        <div class="skeleton-line skeleton-w-55"></div>
        <div class="skeleton-line skeleton-w-70"></div>
        <div class="skeleton-line skeleton-w-35"></div>
      </article>
    </div>`;
}

export async function initFormsList(config, session) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const feedback = document.querySelector(config.feedbackSelector);
  const categoriesRoot = document.querySelector(config.categoriesSelector);
  const uncategorizedRoot = document.querySelector(config.uncategorizedSelector);
  const adminActions = document.querySelector(config.adminActionsSelector);
  const responsesBtn = document.querySelector(config.responsesButtonSelector);

  if (!feedback || !categoriesRoot || !uncategorizedRoot) return;

  try {
    renderFormsSkeleton(categoriesRoot, 'Categories');
    renderFormsSkeleton(uncategorizedRoot, 'Uncategorized');
    const payload = await listAvailableForms();
    clearMessage(feedback);

    if (adminActions && hasPermission(session, 'forms.manage')) adminActions.classList.remove('hidden');

    const categories = payload.categories || [];
    const uncategorized = payload.uncategorized || [];
    console.info('[forms] loaded', { categories: categories.length, uncategorized: uncategorized.length });
    const accessibleFormCount =
      uncategorized.length + categories.reduce((acc, category) => acc + ((category.forms || []).length || 0), 0);
    if (responsesBtn) {
      if (accessibleFormCount > 0 && hasPermission(session, 'forms.responses.read')) responsesBtn.classList.remove('hidden');
      else responsesBtn.classList.add('hidden');
    }

    if (!categories.length) {
      categoriesRoot.innerHTML = '<h2>Categories</h2><p>No categories configured.</p>';
    } else {
      categoriesRoot.innerHTML = `<h2>Categories</h2><div class="forms-category-stack">${categories
        .map(
          (category) => `
            <section class="panel forms-category-section">
              <h3>${text(category.name)}</h3>
              <p>${text(category.description || 'No description')}</p>
              <div>${(category.forms || []).length ? '' : '<p>No forms in this category.</p>'}</div>
              <div class="card-grid" data-category-forms="${category.id}"></div>
            </section>
          `
        )
        .join('')}</div>`;

      categories.forEach((category) => {
        const target = categoriesRoot.querySelector(`[data-category-forms="${category.id}"]`);
        renderForms(target, category.forms || []);
      });
    }

    uncategorizedRoot.innerHTML = '<h2>Uncategorized</h2><div id="uncategorizedFormsGrid" class="card-grid"></div>';
    renderForms(uncategorizedRoot.querySelector('#uncategorizedFormsGrid'), uncategorized);
    if (startedAt) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.info('[perf] forms first data render', { ms: elapsed });
    }
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load forms.', 'error');
    categoriesRoot.innerHTML = '<h2>Categories</h2><p>Unable to load data</p>';
    uncategorizedRoot.innerHTML = '<h2>Uncategorized</h2><p>Unable to load data</p>';
  }
}
