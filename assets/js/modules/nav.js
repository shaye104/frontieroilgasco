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
  const isReadOnlyAdmin = permissions.includes('admin.read_only');
  const readOnlyViewable =
    isReadOnlyAdmin &&
    (requested.endsWith('.read') ||
      requested.endsWith('.view') ||
      ['voyages.config.manage', 'user_groups.manage', 'user_ranks.manage', 'config.manage'].includes(requested));
  return (
    permissions.includes('super.admin') ||
    permissions.includes('admin.override') ||
    readOnlyViewable ||
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

export function getPreferredUserLabel(session) {
  const robloxUsername = String(session?.robloxUsername || '').trim();
  if (robloxUsername) return robloxUsername;
  const discordUsername = String(session?.discordUsername || '').trim();
  if (discordUsername) return discordUsername;
  const displayName = String(session?.displayName || '').trim();
  if (displayName) return displayName;
  const userId = String(session?.userId || '').trim();
  return userId || '';
}

export const ADMIN_PANEL_ENTRY_PERMISSIONS = [
  'admin.read_only',
  'employees.read',
  'voyages.config.manage',
  'user_groups.manage',
  'user_ranks.manage',
  'config.manage',
  'activity_tracker.view'
];

export function canAccessAdminPanel(session) {
  return ADMIN_PANEL_ENTRY_PERMISSIONS.some((permissionKey) => hasPermission(session, permissionKey));
}

const INTRANET_NAV_ITEMS = [
  { href: '/my-details', label: 'My Details' },
  { href: '/voyage-tracker', label: 'Voyage Tracker' },
  { href: '/fleet', label: 'Fleet', anyPermissions: ['voyages.read'] },
  { href: '/finances', label: 'Finances' },
  { href: '/admin-panel', label: 'Admin Panel', anyPermissions: ADMIN_PANEL_ENTRY_PERMISSIONS }
];

function canRenderNavItem(session, item) {
  if (typeof item?.customVisible === 'function') {
    return Boolean(item.customVisible(session));
  }
  const sessionFlag = String(item?.sessionFlag || '').trim();
  if (sessionFlag && !session?.[sessionFlag]) return false;
  const anyPermissions = Array.isArray(item?.anyPermissions) ? item.anyPermissions : [];
  if (!anyPermissions.length) return true;
  return anyPermissions.some((permissionKey) => hasPermission(session, permissionKey));
}

export function renderPublicNavbar() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  nav.innerHTML = '';
  INTRANET_NAV_ITEMS.forEach((item) => {
    nav.append(buildNavLink(item.href, item.label));
  });
}

export function renderIntranetNavbar(session) {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  nav.innerHTML = '';
  INTRANET_NAV_ITEMS.forEach((item) => {
    if (!canRenderNavItem(session, item)) return;
    nav.append(buildNavLink(item.href, item.label));
  });

  const spacer = document.createElement('span');
  spacer.className = 'nav-spacer';
  nav.append(spacer);

  const preferredLabel = getPreferredUserLabel(session);
  if (preferredLabel) {
    const user = document.createElement('span');
    user.className = 'nav-user';
    user.textContent = preferredLabel;
    nav.append(user);
  }

  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'btn btn-secondary';
  logoutButton.textContent = 'Logout';
  logoutButton.addEventListener('click', async () => {
    try {
      await performLogout('/login');
    } catch {
      window.location.href = '/login';
    }
  });
  nav.append(logoutButton);
}
