import { getAvailableForm, submitFormResponse } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function getFormId() {
  const query = new URLSearchParams(window.location.search);
  const formId = Number(query.get('formId'));
  return Number.isInteger(formId) && formId > 0 ? formId : null;
}

function questionFieldHtml(question) {
  const required = question.isRequired ? 'required' : '';
  const requiredStar = question.isRequired ? ' *' : '';
  const help = question.helpText ? `<p class="lead">${question.helpText}</p>` : '';
  const name = `q_${question.id}`;

  if (question.questionType === 'short_text') {
    return `<label>${question.label}${requiredStar}</label>${help}<input name="${name}" type="text" ${required} />`;
  }

  if (question.questionType === 'long_text') {
    return `<label>${question.label}${requiredStar}</label>${help}<textarea name="${name}" rows="4" ${required}></textarea>`;
  }

  if (question.questionType === 'number') {
    return `<label>${question.label}${requiredStar}</label>${help}<input name="${name}" type="number" ${required} />`;
  }

  if (question.questionType === 'date') {
    return `<label>${question.label}${requiredStar}</label>${help}<input name="${name}" type="date" ${required} />`;
  }

  if (question.questionType === 'yes_no') {
    return `<label>${question.label}${requiredStar}</label>${help}
      <select name="${name}" ${required}>
        <option value="">Select</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>`;
  }

  const options = (question.options || []).map((opt) => `<option value="${opt}">${opt}</option>`).join('');

  if (question.questionType === 'dropdown') {
    return `<label>${question.label}${requiredStar}</label>${help}<select name="${name}" ${required}><option value="">Select</option>${options}</select>`;
  }

  if (question.questionType === 'multiple_choice') {
    return `<label>${question.label}${requiredStar}</label>${help}<select name="${name}" ${required}><option value="">Select</option>${options}</select>`;
  }

  if (question.questionType === 'multiple_select') {
    return `<label>${question.label}${requiredStar}</label>${help}
      <select name="${name}" multiple ${required}>
        ${options}
      </select>`;
  }

  return `<label>${question.label}${requiredStar}</label>${help}<input name="${name}" type="text" ${required} />`;
}

export async function initFormFill(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const formTitle = document.querySelector(config.formTitleSelector);
  const formDescription = document.querySelector(config.formDescriptionSelector);
  const formRoot = document.querySelector(config.formSelector);

  if (!feedback || !formTitle || !formDescription || !formRoot) return;

  const formId = getFormId();
  if (!formId) {
    showMessage(feedback, 'Invalid form id.', 'error');
    return;
  }

  try {
    const payload = await getAvailableForm(formId);
    const form = payload.form;
    const questions = payload.questions || [];

    formTitle.textContent = text(form.title);
    formDescription.textContent = text(form.description || form.instructions || 'Complete the form below.');

    formRoot.innerHTML = `${questions
      .map((q) => `<div class="panel">${questionFieldHtml(q)}</div>`)
      .join('')}<div class="modal-actions"><button class="btn btn-primary" type="submit">Submit Form</button></div>`;

    formRoot.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage(feedback);

      const data = new FormData(formRoot);
      const answers = {};

      questions.forEach((question) => {
        const key = `q_${question.id}`;
        if (question.questionType === 'multiple_select') {
          const select = formRoot.querySelector(`[name="${key}"]`);
          answers[String(question.id)] = select ? Array.from(select.selectedOptions).map((option) => option.value) : [];
          return;
        }

        const value = data.get(key);
        if (question.questionType === 'yes_no') {
          answers[String(question.id)] = value === 'true' ? true : value === 'false' ? false : null;
          return;
        }

        answers[String(question.id)] = value;
      });

      try {
        await submitFormResponse(formId, { answers });
        showMessage(feedback, 'Form submitted successfully.', 'success');
        formRoot.reset();
      } catch (error) {
        showMessage(feedback, error.message || 'Unable to submit form.', 'error');
      }
    });
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load form.', 'error');
  }
}
