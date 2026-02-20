import { prefetchRouteData } from './admin-api.js';

const PERMISSION_ALIASES = {
  'roles.read': 'user_groups.read',
  'roles.manage': 'user_groups.manage',
  'roles.assign': 'user_groups.assign',
  'user_groups.read': 'roles.read',
  'user_groups.manage': 'roles.manage',
  'user_groups.assign': 'roles.assign'
};

export function hasPermission(session, permissionKey) {
  if (!session || !permissionKey) return false;
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  const requested = String(permissionKey || '').trim();
  const alias = PERMISSION_ALIASES[requested];
  return (
    permissions.includes('super.admin') ||
    permissions.includes('admin.override') ||
    permissions.includes(requested) ||
    (alias ? permissions.includes(alias) : false)
  );
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

function wireLinkPrefetch(link, session) {
  if (!link) return;
  let primed = false;
  const run = () => {
    if (primed) return;
    primed = true;
    prefetchRouteData(link.getAttribute('href') || '', session);
  };
  link.addEventListener('pointerenter', run, { once: true });
  link.addEventListener('focus', run, { once: true });
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
  const myDetailsLink = buildNavLink('/my-details', 'My Details');
  const voyagesLink = buildNavLink('/voyages/my', 'Voyages');
  const fleetLink = buildNavLink('/my-fleet', 'My Fleet');
  const formsLink = buildNavLink('/forms', 'Forms');
  nav.append(myDetailsLink);
  nav.append(voyagesLink);
  nav.append(fleetLink);
  nav.append(formsLink);
  wireLinkPrefetch(myDetailsLink, session);
  wireLinkPrefetch(voyagesLink, session);
  wireLinkPrefetch(formsLink, session);

  if (hasPermission(session, 'admin.access')) {
    const adminLink = buildNavLink('/admin', 'Admin Panel');
    nav.append(adminLink);
    wireLinkPrefetch(adminLink, session);
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
