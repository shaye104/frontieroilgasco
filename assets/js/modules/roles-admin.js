import {
  createAdminRole,
  deleteAdminRole,
  getAdminRoles,
  reorderAdminRole,
  updateAdminRole
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || '';
}

function openModal(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.remove('hidden');
  target.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('hidden');
  target.setAttribute('aria-hidden', 'true');
}

export async function initRolesAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const list = document.querySelector(config.listSelector);
  const form = document.querySelector(config.formSelector);
  const hint = document.querySelector(config.hintSelector);
  const permissionsEditor = document.querySelector(config.permissionsEditorSelector);
  const openCreateRoleBtn = document.querySelector(config.openCreateRoleBtnSelector);
  const createRoleForm = document.querySelector(config.createRoleFormSelector);
  const cloneRoleBtn = document.querySelector(config.cloneRoleBtnSelector);
  const deleteRoleBtn = document.querySelector(config.deleteRoleBtnSelector);

  if (!feedback || !list || !form || !hint || !permissionsEditor || !createRoleForm) return;

  let roles = [];
  let permissionCatalog = [];
  let selectedRoleId = null;

  function selectedRole() {
    return roles.find((role) => Number(role.id) === Number(selectedRoleId)) || null;
  }

  function renderPermissions(role) {
    const selectedPermissions = new Set(role?.permissions || []);
    const groups = new Map();
    permissionCatalog.forEach((permission) => {
      if (!groups.has(permission.groupLabel)) groups.set(permission.groupLabel, []);
      groups.get(permission.groupLabel).push(permission);
    });

    permissionsEditor.innerHTML = [...groups.entries()]
      .map(
        ([groupLabel, permissions]) => `
          <section class="panel permissions-group">
            <h4>${text(groupLabel)}</h4>
            <div class="permissions-list">
              ${permissions
                .map(
                  (permission) => `
                    <label class="permissions-item">
                      <input type="checkbox" name="permission" value="${permission.key}" ${
                        selectedPermissions.has(permission.key) ? 'checked' : ''
                      } />
                      <span><strong>${text(permission.label)}</strong><br /><small>${text(permission.description || '')}</small></span>
                    </label>
                  `
                )
                .join('')}
            </div>
          </section>
        `
      )
      .join('');
  }

  function renderRoleList() {
    if (!roles.length) {
      list.innerHTML = '<li class="role-item"><span class="role-id">No roles found.</span></li>';
      return;
    }

    list.innerHTML = roles
      .map((role, index) => {
        const selected = Number(role.id) === Number(selectedRoleId);
        return `
          <li class="role-item role-row ${selected ? 'role-row-selected' : ''}">
            <button class="btn btn-secondary role-row-main" type="button" data-select-role="${role.id}">
              <span>${text(role.name)}</span>
              <small>${text(role.description || '')}</small>
            </button>
            <div class="modal-actions">
              <button class="btn btn-secondary" type="button" data-role-move="${role.id}" data-direction="up" ${
          index === 0 ? 'disabled' : ''
        }>&uarr;</button>
              <button class="btn btn-secondary" type="button" data-role-move="${role.id}" data-direction="down" ${
          index === roles.length - 1 ? 'disabled' : ''
        }>&darr;</button>
            </div>
          </li>
        `;
      })
      .join('');

    list.querySelectorAll('button[data-select-role]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedRoleId = Number(button.getAttribute('data-select-role'));
        renderRoleList();
        renderRoleDetails();
      });
    });

    list.querySelectorAll('button[data-role-move]').forEach((button) => {
      button.addEventListener('click', async () => {
        const roleId = Number(button.getAttribute('data-role-move'));
        const direction = String(button.getAttribute('data-direction') || '');
        try {
          await reorderAdminRole({ id: roleId, direction });
          await refreshRoles();
          showMessage(feedback, 'Role order updated.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to reorder roles.', 'error');
        }
      });
    });
  }

  function renderRoleDetails() {
    const role = selectedRole();
    if (!role) {
      hint.classList.remove('hidden');
      form.classList.add('hidden');
      return;
    }

    hint.classList.add('hidden');
    form.classList.remove('hidden');
    form.querySelector('[name="id"]').value = String(role.id);
    form.querySelector('[name="name"]').value = role.name || '';
    form.querySelector('[name="description"]').value = role.description || '';
    renderPermissions(role);
  }

  async function refreshRoles() {
    const payload = await getAdminRoles();
    roles = payload.roles || [];
    permissionCatalog = payload.permissionCatalog || [];
    if (!roles.some((role) => Number(role.id) === Number(selectedRoleId))) selectedRoleId = roles[0]?.id || null;
    renderRoleList();
    renderRoleDetails();
  }

  openCreateRoleBtn?.addEventListener('click', () => openModal('createRoleModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  createRoleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(createRoleForm);
    try {
      const payload = await createAdminRole({
        name: text(data.get('name')),
        description: text(data.get('description'))
      });
      roles = payload.roles || [];
      createRoleForm.reset();
      selectedRoleId = roles[roles.length - 1]?.id || selectedRoleId;
      closeModal('createRoleModal');
      renderRoleList();
      renderRoleDetails();
      showMessage(feedback, 'Role created.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to create role.', 'error');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const role = selectedRole();
    if (!role) return;

    const permissionKeys = [...form.querySelectorAll('input[name="permission"]:checked')].map((input) => input.value);

    try {
      const payload = await updateAdminRole({
        id: role.id,
        name: text(form.querySelector('[name="name"]').value),
        description: text(form.querySelector('[name="description"]').value),
        permissionKeys
      });
      roles = payload.roles || [];
      renderRoleList();
      renderRoleDetails();
      showMessage(feedback, 'Role updated.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save role.', 'error');
    }
  });

  cloneRoleBtn?.addEventListener('click', async () => {
    const role = selectedRole();
    if (!role) return;
    try {
      const createPayload = await createAdminRole({
        name: `${role.name} Copy`,
        description: role.description || ''
      });
      roles = createPayload.roles || [];
      const cloned = roles.find((item) => item.name === `${role.name} Copy`) || roles[roles.length - 1];
      if (cloned) {
        await updateAdminRole({
          id: cloned.id,
          name: cloned.name,
          description: cloned.description || '',
          permissionKeys: role.permissions || []
        });
      }
      await refreshRoles();
      showMessage(feedback, 'Role cloned.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to clone role.', 'error');
    }
  });

  deleteRoleBtn?.addEventListener('click', async () => {
    const role = selectedRole();
    if (!role) return;
    if (!window.confirm(`Delete role "${role.name}"?`)) return;
    try {
      const payload = await deleteAdminRole(role.id);
      roles = payload.roles || [];
      selectedRoleId = roles[0]?.id || null;
      renderRoleList();
      renderRoleDetails();
      showMessage(feedback, 'Role deleted.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to delete role.', 'error');
    }
  });

  try {
    await refreshRoles();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize roles page.', 'error');
  }
}
