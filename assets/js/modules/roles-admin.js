import {
  addRoleMember,
  createAdminRole,
  deleteAdminRole,
  getAdminRoles,
  listRoleMembers,
  removeRoleMember,
  reorderAdminRole,
  updateAdminRole
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
  const roleMemberSearchInput = document.querySelector(config.roleMemberSearchInputSelector);
  const roleMemberSearchBtn = document.querySelector(config.roleMemberSearchBtnSelector);
  const roleMemberCandidates = document.querySelector(config.roleMemberCandidatesSelector);
  const roleMembersList = document.querySelector(config.roleMembersListSelector);

  if (!feedback || !list || !form || !hint || !permissionsEditor || !createRoleForm) return;

  let roles = [];
  let permissionCatalog = [];
  let selectedRoleId = null;
  const pendingMoves = new Set();
  let currentMemberQuery = '';

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

  function employeeLabel(employee) {
    const roblox = text(employee?.roblox_username);
    const primary = roblox || `Employee #${Number(employee?.id || 0)}`;
    const meta = [employee?.rank ? `Rank ${text(employee.rank)}` : '', employee?.employee_status ? `${text(employee.employee_status)}` : '']
      .filter(Boolean)
      .join(' • ');
    return { primary, meta };
  }

  function renderRoleMembersPayload(roleId, payload) {
    if (Number(roleId) !== Number(selectedRoleId)) return;
    if (!roleMemberCandidates || !roleMembersList) return;
    const members = Array.isArray(payload?.members) ? payload.members : [];
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];

    if (!members.length) {
      roleMembersList.innerHTML = '<p class="rank-link-empty">No members assigned to this group.</p>';
    } else {
      roleMembersList.innerHTML = members
        .map((member) => {
          const label = employeeLabel(member);
          return `
            <div class="roles-member-row">
              <div>
                <strong>${escapeHtml(label.primary)}</strong>
                <small>${escapeHtml(label.meta || `ID ${Number(member.id)}`)}</small>
              </div>
              <button class="btn btn-secondary btn-compact" type="button" data-remove-role-member="${Number(member.id)}">Remove</button>
            </div>
          `;
        })
        .join('');
    }

    if (!currentMemberQuery) {
      roleMemberCandidates.innerHTML = '<p class="rank-link-empty">Search employees to add to this group.</p>';
    } else if (!candidates.length) {
      roleMemberCandidates.innerHTML = '<p class="rank-link-empty">No matching employees found.</p>';
    } else {
      roleMemberCandidates.innerHTML = candidates
        .map((candidate) => {
          const label = employeeLabel(candidate);
          return `
            <div class="roles-member-row">
              <div>
                <strong>${escapeHtml(label.primary)}</strong>
                <small>${escapeHtml(label.meta || `ID ${Number(candidate.id)}`)}</small>
              </div>
              <button class="btn btn-primary btn-compact" type="button" data-add-role-member="${Number(candidate.id)}">Add</button>
            </div>
          `;
        })
        .join('');
    }

    roleMembersList.querySelectorAll('[data-remove-role-member]').forEach((button) => {
      button.addEventListener('click', async () => {
        const employeeId = Number(button.getAttribute('data-remove-role-member'));
        if (!employeeId) return;
        const selected = selectedRole();
        if (!selected) return;
        button.disabled = true;
        try {
          const nextPayload = await removeRoleMember(selected.id, employeeId);
          renderRoleMembersPayload(selected.id, nextPayload);
          showMessage(feedback, 'Group member removed.', 'success');
        } catch (error) {
          button.disabled = false;
          showMessage(feedback, error.message || 'Unable to remove group member.', 'error');
        }
      });
    });

    roleMemberCandidates.querySelectorAll('[data-add-role-member]').forEach((button) => {
      button.addEventListener('click', async () => {
        const employeeId = Number(button.getAttribute('data-add-role-member'));
        if (!employeeId) return;
        const selected = selectedRole();
        if (!selected) return;
        button.disabled = true;
        try {
          const nextPayload = await addRoleMember(selected.id, employeeId);
          if (currentMemberQuery) {
            const refreshed = await listRoleMembers(selected.id, currentMemberQuery);
            renderRoleMembersPayload(selected.id, {
              members: nextPayload?.members || [],
              candidates: refreshed?.candidates || []
            });
          } else {
            renderRoleMembersPayload(selected.id, { members: nextPayload?.members || [], candidates: [] });
          }
          showMessage(feedback, 'Group member added.', 'success');
        } catch (error) {
          button.disabled = false;
          showMessage(feedback, error.message || 'Unable to add group member.', 'error');
        }
      });
    });
  }

  async function loadRoleMembers(roleId, query = '') {
    if (!roleMemberCandidates || !roleMembersList) return;
    currentMemberQuery = text(query).toLowerCase();
    try {
      const payload = await listRoleMembers(roleId, currentMemberQuery);
      renderRoleMembersPayload(roleId, payload);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load group members.', 'error');
    }
  }

  function renderRoleList() {
    if (!roles.length) {
      list.innerHTML = '<li class="role-item"><span class="role-id">No user groups found.</span></li>';
      return;
    }

    list.innerHTML = roles
      .map((role, index) => {
        const selected = Number(role.id) === Number(selectedRoleId);
        const isSaving = pendingMoves.has(Number(role.id));
        return `
          <li class="role-item role-row ${selected ? 'role-row-selected' : ''}">
            <button class="btn btn-secondary role-row-main" type="button" data-select-role="${role.id}">
              <span>${text(role.name)}</span>
              <small>${text(role.description || '')}</small>
              <small>${role.discord_role_id ? `Discord Role ID: ${text(role.discord_role_id)}` : 'Discord Role ID: —'}</small>
            </button>
            <div class="modal-actions">
              <button class="btn btn-secondary" type="button" data-role-move="${role.id}" data-direction="up" ${
          index === 0 || isSaving ? 'disabled' : ''
        }>&uarr;</button>
              <button class="btn btn-secondary" type="button" data-role-move="${role.id}" data-direction="down" ${
          index === roles.length - 1 || isSaving ? 'disabled' : ''
        }>${isSaving ? '...' : '↓'}</button>
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
        const currentIndex = roles.findIndex((role) => Number(role.id) === roleId);
        const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (currentIndex < 0 || swapIndex < 0 || swapIndex >= roles.length) return;
        if (pendingMoves.has(roleId)) return;

        const previous = roles.map((role) => ({ ...role }));
        const next = roles.map((role) => ({ ...role }));
        const moving = next[currentIndex];
        next[currentIndex] = next[swapIndex];
        next[swapIndex] = moving;
        roles = next;
        pendingMoves.add(roleId);
        renderRoleList();
        try {
          await reorderAdminRole({ id: roleId, direction });
          pendingMoves.delete(roleId);
          showMessage(feedback, 'User group order updated.', 'success');
        } catch (error) {
          roles = previous;
          pendingMoves.delete(roleId);
          renderRoleList();
          showMessage(feedback, error.message || 'Unable to reorder user groups.', 'error');
          return;
        }
        renderRoleList();
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
    form.querySelector('[name="discordRoleId"]').value = role.discord_role_id || '';
    renderPermissions(role);
    if (roleMemberSearchInput) roleMemberSearchInput.value = '';
    void loadRoleMembers(role.id, '');
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
        description: text(data.get('description')),
        discordRoleId: text(data.get('discordRoleId'))
      });
      roles = payload.roles || [];
      createRoleForm.reset();
      selectedRoleId = roles[roles.length - 1]?.id || selectedRoleId;
      closeModal('createRoleModal');
      renderRoleList();
      renderRoleDetails();
      showMessage(feedback, 'User group created.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to create user group.', 'error');
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
        discordRoleId: text(form.querySelector('[name="discordRoleId"]').value),
        permissionKeys
      });
      roles = payload.roles || [];
      renderRoleList();
      renderRoleDetails();
      showMessage(feedback, 'User group updated.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save user group.', 'error');
    }
  });

  cloneRoleBtn?.addEventListener('click', async () => {
    const role = selectedRole();
    if (!role) return;
    try {
      const createPayload = await createAdminRole({
        name: `${role.name} Copy`,
        description: role.description || '',
        discordRoleId: ''
      });
      roles = createPayload.roles || [];
      const cloned = roles.find((item) => item.name === `${role.name} Copy`) || roles[roles.length - 1];
      if (cloned) {
        await updateAdminRole({
          id: cloned.id,
          name: cloned.name,
          description: cloned.description || '',
          discordRoleId: cloned.discord_role_id || '',
          permissionKeys: role.permissions || []
        });
      }
      await refreshRoles();
      showMessage(feedback, 'User group cloned.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to clone user group.', 'error');
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
      showMessage(feedback, 'User group deleted.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to delete user group.', 'error');
    }
  });

  roleMemberSearchBtn?.addEventListener('click', () => {
    const role = selectedRole();
    if (!role) return;
    void loadRoleMembers(role.id, roleMemberSearchInput?.value || '');
  });

  roleMemberSearchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const role = selectedRole();
    if (!role) return;
    void loadRoleMembers(role.id, roleMemberSearchInput.value || '');
  });

  try {
    await refreshRoles();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize user groups page.', 'error');
  }
}
