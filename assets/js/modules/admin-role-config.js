import { clearMessage, showMessage } from './notice.js';

function normalizeRoleId(raw) {
  const value = String(raw || '').trim();
  return /^\d{6,30}$/.test(value) ? value : '';
}

function renderRoleList(roleList, roleIds, onRemove) {
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

async function fetchAdminRoles() {
  const response = await fetch('/api/admin/roles', { method: 'GET', credentials: 'include' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error || 'Unable to load role configuration.');
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
  if (!response.ok) throw new Error(payload.error || 'Unable to save role configuration.');
  return Array.isArray(payload.roleIds) ? payload.roleIds : [];
}

export async function initAdminRoleConfig(config) {
  const roleInput = document.querySelector(config.roleInputSelector);
  const addRoleButton = document.querySelector(config.addRoleButtonSelector);
  const saveRolesButton = document.querySelector(config.saveRolesButtonSelector);
  const roleList = document.querySelector(config.roleListSelector);
  const feedback = document.querySelector(config.feedbackSelector);

  if (!roleInput || !addRoleButton || !saveRolesButton || !roleList || !feedback) return;

  let managedRoleIds = [];

  const removeRole = (removeId) => {
    managedRoleIds = managedRoleIds.filter((id) => id !== removeId);
    renderRoleList(roleList, managedRoleIds, removeRole);
  };

  addRoleButton.addEventListener('click', () => {
    clearMessage(feedback);
    const roleId = normalizeRoleId(roleInput.value);

    if (!roleId) {
      showMessage(feedback, 'Role ID must be a numeric Discord snowflake.', 'error');
      return;
    }

    if (managedRoleIds.includes(roleId)) {
      showMessage(feedback, 'That role is already in the list.', 'error');
      return;
    }

    managedRoleIds.push(roleId);
    roleInput.value = '';
    renderRoleList(roleList, managedRoleIds, removeRole);
  });

  saveRolesButton.addEventListener('click', async () => {
    clearMessage(feedback);
    try {
      managedRoleIds = await saveAdminRoles(managedRoleIds);
      renderRoleList(roleList, managedRoleIds, removeRole);
      showMessage(feedback, 'Allowed roles updated.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save roles.', 'error');
    }
  });

  try {
    managedRoleIds = await fetchAdminRoles();
    renderRoleList(roleList, managedRoleIds, removeRole);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load role settings.', 'error');
  }
}
