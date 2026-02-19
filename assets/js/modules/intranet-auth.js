import { clearMessage, showMessage } from './notice.js';

function normalizeRoleId(raw) {
  const value = String(raw || '').trim();
  return /^\d{6,30}$/.test(value) ? value : '';
}

function renderRoleList(roleList, roleIds, onRemove) {
  if (!roleList) return;

  if (roleIds.length === 0) {
    roleList.innerHTML = '<li class="role-item"><span class="role-id">No roles configured yet.</span></li>';
    return;
  }

  roleList.innerHTML = roleIds
    .map(
      (roleId) => `
        <li class="role-item" data-role-id="${roleId}">
          <span class="role-id">${roleId}</span>
          <button class="btn btn-secondary" type="button" data-remove-role="${roleId}">Remove</button>
        </li>
      `
    )
    .join('');

  roleList.querySelectorAll('button[data-remove-role]').forEach((button) => {
    button.addEventListener('click', () => onRemove(button.getAttribute('data-remove-role') || ''));
  });
}

async function fetchSession() {
  const response = await fetch('/api/auth/session', { method: 'GET', credentials: 'include' });
  if (!response.ok) return { loggedIn: false };
  return response.json();
}

async function fetchAdminRoles() {
  const response = await fetch('/api/admin/roles', { method: 'GET', credentials: 'include' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load role configuration.');
  }

  return Array.isArray(payload.roleIds) ? payload.roleIds : [];
}

async function saveAdminRoles(roleIds) {
  const response = await fetch('/api/admin/roles', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roleIds })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to save role configuration.');
  }

  return Array.isArray(payload.roleIds) ? payload.roleIds : [];
}

function getAuthMessageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  const reason = params.get('reason');

  if (auth === 'denied') {
    return {
      text: reason === 'missing_role' ? 'Access denied. Your Discord role is not authorized for intranet access.' : 'Login failed.',
      type: 'error'
    };
  }

  if (auth === 'error') {
    return { text: 'Login error. Please try again.', type: 'error' };
  }

  if (auth === 'ok') {
    return { text: 'Discord login successful.', type: 'success' };
  }

  return null;
}

function cleanAuthQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth') && !url.searchParams.has('reason')) return;
  url.searchParams.delete('auth');
  url.searchParams.delete('reason');
  window.history.replaceState({}, '', url.toString());
}

export function initIntranetAuth(config) {
  const loginButton = document.querySelector(config.loginButtonSelector);
  const logoutButton = document.querySelector(config.logoutButtonSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  const panel = document.querySelector(config.panelSelector);
  const welcomeText = document.querySelector(config.welcomeSelector);
  const adminPanel = document.querySelector(config.adminPanelSelector);
  const adminFeedback = document.querySelector(config.adminFeedbackSelector);
  const roleInput = document.querySelector(config.roleInputSelector);
  const addRoleButton = document.querySelector(config.addRoleButtonSelector);
  const saveRolesButton = document.querySelector(config.saveRolesButtonSelector);
  const roleList = document.querySelector(config.roleListSelector);

  if (!loginButton || !logoutButton || !feedback || !panel || !welcomeText) return;

  let managedRoleIds = [];
  const removeRole = (removeId) => {
    managedRoleIds = managedRoleIds.filter((id) => id !== removeId);
    if (roleList) renderRoleList(roleList, managedRoleIds, removeRole);
  };

  loginButton.addEventListener('click', () => {
    window.location.href = '/api/auth/discord/start';
  });

  logoutButton.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    panel.classList.add('hidden');
    if (adminPanel) adminPanel.classList.add('hidden');
    showMessage(feedback, 'Logged out.', 'success');
  });

  if (addRoleButton && roleInput && roleList && adminFeedback) {
    addRoleButton.addEventListener('click', () => {
      clearMessage(adminFeedback);
      const roleId = normalizeRoleId(roleInput.value);

      if (!roleId) {
        showMessage(adminFeedback, 'Role ID must be a numeric Discord snowflake.', 'error');
        return;
      }

      if (managedRoleIds.includes(roleId)) {
        showMessage(adminFeedback, 'That role is already in the list.', 'error');
        return;
      }

      managedRoleIds.push(roleId);
      roleInput.value = '';
      renderRoleList(roleList, managedRoleIds, removeRole);
    });
  }

  if (saveRolesButton && adminFeedback && roleList) {
    saveRolesButton.addEventListener('click', async () => {
      clearMessage(adminFeedback);
      try {
        managedRoleIds = await saveAdminRoles(managedRoleIds);
        renderRoleList(roleList, managedRoleIds, removeRole);
        showMessage(adminFeedback, 'Allowed roles updated.', 'success');
      } catch (error) {
        showMessage(adminFeedback, error.message || 'Unable to save roles.', 'error');
      }
    });
  }

  const urlMessage = getAuthMessageFromUrl();
  if (urlMessage) {
    showMessage(feedback, urlMessage.text, urlMessage.type);
    cleanAuthQuery();
  } else {
    clearMessage(feedback);
  }

  fetchSession()
    .then(async (session) => {
      if (!session.loggedIn) {
        panel.classList.add('hidden');
        if (adminPanel) adminPanel.classList.add('hidden');
        return;
      }

      welcomeText.textContent = `Welcome, ${session.displayName}.`;
      panel.classList.remove('hidden');
      if (!urlMessage) showMessage(feedback, 'Authenticated via Discord.', 'success');

      if (!session.isAdmin || !adminPanel || !adminFeedback || !roleList) {
        if (adminPanel) adminPanel.classList.add('hidden');
        return;
      }

      adminPanel.classList.remove('hidden');
      clearMessage(adminFeedback);

      try {
        managedRoleIds = await fetchAdminRoles();
        renderRoleList(roleList, managedRoleIds, removeRole);
      } catch (error) {
        showMessage(adminFeedback, error.message || 'Unable to load admin role settings.', 'error');
      }
    })
    .catch(() => {
      showMessage(feedback, 'Unable to verify session.', 'error');
      panel.classList.add('hidden');
      if (adminPanel) adminPanel.classList.add('hidden');
    });
}
