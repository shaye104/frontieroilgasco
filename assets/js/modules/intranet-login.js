import { clearMessage, showMessage } from './notice.js';

const demoUsers = {
  EMP1001: { password: 'Frontier2026!', name: 'Jordan Reyes' },
  EMP2042: { password: 'FieldOps#24', name: 'Maya Patel' }
};

function authenticate(employeeId, password) {
  const candidate = demoUsers[employeeId.toUpperCase()];
  if (!candidate) return null;

  return candidate.password === password ? candidate : null;
}

export function initIntranetLogin(config) {
  const form = document.querySelector(config.formSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  const panel = document.querySelector(config.panelSelector);
  const welcomeText = document.querySelector(config.welcomeSelector);

  if (!form || !feedback || !panel || !welcomeText) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const formData = new FormData(form);
    const employeeId = String(formData.get('employeeId') || '').trim();
    const password = String(formData.get('password') || '').trim();

    if (!employeeId || !password) {
      showMessage(feedback, 'Employee ID and password are required.', 'error');
      return;
    }

    const user = authenticate(employeeId, password);

    if (!user) {
      showMessage(feedback, 'Invalid credentials for demo intranet.', 'error');
      panel.classList.add('hidden');
      return;
    }

    showMessage(feedback, 'Login successful. Dashboard access granted.', 'success');
    welcomeText.textContent = `Welcome, ${user.name}.`;
    panel.classList.remove('hidden');
  });
}
