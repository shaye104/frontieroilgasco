export function initializeYear(selector = '#currentYear') {
  const yearSlot = document.querySelector(selector);
  if (yearSlot) {
    yearSlot.textContent = String(new Date().getFullYear());
  }

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.site-nav a[href]').forEach((link) => {
    try {
      const targetPath = new URL(link.getAttribute('href') || '', window.location.origin).pathname.replace(/\/+$/, '') || '/';
      if (targetPath === currentPath) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('is-active');
        link.removeAttribute('aria-current');
      }
    } catch {
      // Ignore invalid nav href values.
    }
  });
}
