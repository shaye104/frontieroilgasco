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

const INTRANET_NAV_ITEMS = [
  { href: '/my-details', label: 'My Details' },
  { href: '/voyages/my', label: 'Voyages' },
  { href: '/my-fleet', label: 'My Fleet' },
  { href: '/forms', label: 'Forms' },
  { href: '/college', label: 'College' },
  { href: '/finances', label: 'Finances' },
  { href: '/admin', label: 'Admin Panel', anyPermissions: ['admin.access'] }
];

function canRenderNavItem(session, item) {
  const anyPermissions = Array.isArray(item?.anyPermissions) ? item.anyPermissions : [];
  if (!anyPermissions.length) return true;
  return anyPermissions.some((permissionKey) => hasPermission(session, permissionKey));
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
  const restrictedCollegeOnly =
    !session?.isAdmin &&
    String(session?.userStatus || '').trim().toUpperCase() === 'APPLICANT_ACCEPTED' &&
    !session?.collegePassedAt;

  if (restrictedCollegeOnly) {
    nav.append(buildNavLink('/college', 'College'));
  } else {
    INTRANET_NAV_ITEMS.forEach((item) => {
      if (!canRenderNavItem(session, item)) return;
      const link = buildNavLink(item.href, item.label);
      nav.append(link);
    });
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
