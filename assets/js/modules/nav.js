export function hasPermission(session, permissionKey) {
  if (!session || !permissionKey) return false;
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  return permissions.includes('super.admin') || permissions.includes(permissionKey);
}

export async function performLogout(redirectTo = '/') {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = redirectTo;
}

function buildNavLink(href, label) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  return link;
}

export function renderPublicNavbar() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  nav.innerHTML = '';
  nav.append(buildNavLink('/', 'Home'));
  const spacer = document.createElement('span');
  spacer.className = 'nav-spacer';
  nav.append(spacer);

  const login = buildNavLink('/login', 'Login');
  login.className = 'btn btn-primary';
  nav.append(login);
}

export function renderIntranetNavbar(session) {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  nav.innerHTML = '';
  nav.append(buildNavLink('/my-details.html', 'My Details'));
  nav.append(buildNavLink('/voyage-tracker.html', 'Voyages'));
  nav.append(buildNavLink('/my-fleet.html', 'My Fleet'));
  nav.append(buildNavLink('/forms.html', 'Forms'));

  if (hasPermission(session, 'admin.access')) {
    nav.append(buildNavLink('/admin-panel.html', 'Admin Panel'));
  }

  const spacer = document.createElement('span');
  spacer.className = 'nav-spacer';
  nav.append(spacer);

  if (session?.displayName) {
    const user = document.createElement('span');
    user.className = 'nav-user';
    user.textContent = session.displayName;
    nav.append(user);
  }

  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'btn btn-secondary';
  logoutButton.textContent = 'Logout';
  logoutButton.addEventListener('click', () => performLogout('/'));
  nav.append(logoutButton);
}
