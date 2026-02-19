export function initializeYear(selector = '#currentYear') {
  const yearSlot = document.querySelector(selector);
  if (!yearSlot) return;

  yearSlot.textContent = String(new Date().getFullYear());
}
