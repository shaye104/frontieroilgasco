export function showMessage(target, message, type = 'success') {
  if (!target) return;

  target.textContent = message;
  target.className = `feedback is-visible ${type === 'error' ? 'is-error' : 'is-success'}`;
}

export function clearMessage(target) {
  if (!target) return;

  target.textContent = '';
  target.className = 'feedback';
}
