import { clearMessage, showMessage } from './notice.js';

function readFormValues(form) {
  const data = new FormData(form);
  return {
    fullName: String(data.get('fullName') || '').trim(),
    email: String(data.get('email') || '').trim(),
    phone: String(data.get('phone') || '').trim(),
    position: String(data.get('position') || '').trim(),
    experience: String(data.get('experience') || '').trim(),
    certifications: String(data.get('certifications') || '').trim(),
    startDate: String(data.get('startDate') || '').trim(),
    notes: String(data.get('notes') || '').trim()
  };
}

function validateApplication(values) {
  const errors = [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!values.fullName) errors.push('Full name is required.');
  if (!emailPattern.test(values.email)) errors.push('A valid email address is required.');
  if (!values.phone) errors.push('Phone is required.');
  if (!values.position) errors.push('Position of interest is required.');
  if (!values.experience || Number(values.experience) < 0) errors.push('Years of experience must be 0 or greater.');
  if (!values.startDate) errors.push('Earliest start date is required.');

  return errors;
}

function persistApplication(values) {
  const key = 'frontierApplications';
  const entry = { ...values, submittedAt: new Date().toISOString() };

  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    stored.push(entry);
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Local persistence is best-effort for static hosting.
  }
}

export function initApplicationForm(formSelector, feedbackSelector) {
  const form = document.querySelector(formSelector);
  const feedback = document.querySelector(feedbackSelector);
  if (!form || !feedback) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const values = readFormValues(form);
    const errors = validateApplication(values);

    if (errors.length > 0) {
      showMessage(feedback, errors.join(' '), 'error');
      return;
    }

    persistApplication(values);
    showMessage(feedback, 'Application submitted successfully. Our team will follow up soon.', 'success');
    form.reset();
  });
}
