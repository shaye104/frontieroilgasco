import {
  createConfigValue,
  deleteConfigValue,
  getAdminRoles,
  getConfig,
  saveAdminRoles,
  updateConfigValue
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function renderSimpleList(target, items, onEdit, onDelete) {
  if (!items.length) {
    target.innerHTML = '<li class="role-item"><span class="role-id">No values configured.</span></li>';
    return;
  }

  target.innerHTML = items
    .map(
      (item) => `<li class="role-item"><span class="role-id">${text(item.value)}</span>
      <span>
        <button class="btn btn-secondary" type="button" data-edit-id="${item.id}">Edit</button>
        <button class="btn btn-secondary" type="button" data-delete-id="${item.id}">Delete</button>
      </span></li>`
    )
    .join('');

  target.querySelectorAll('button[data-edit-id]').forEach((button) => {
    button.addEventListener('click', () => onEdit(Number(button.getAttribute('data-edit-id'))));
  });

  target.querySelectorAll('button[data-delete-id]').forEach((button) => {
    button.addEventListener('click', () => onDelete(Number(button.getAttribute('data-delete-id'))));
  });
}

function normalizeRoleId(raw) {
  const value = String(raw || '').trim();
  return /^\d{6,30}$/.test(value) ? value : '';
}

function renderRoleList(target, roleIds, onRemove) {
  if (!roleIds.length) {
    target.innerHTML = '<li class="role-item"><span class="role-id">No roles configured yet.</span></li>';
    return;
  }

  target.innerHTML = roleIds
    .map(
      (roleId) => `<li class="role-item"><span class="role-id">${roleId}</span>
      <button class="btn btn-secondary" data-remove-role="${roleId}" type="button">Remove</button></li>`
    )
    .join('');

  target.querySelectorAll('button[data-remove-role]').forEach((button) => {
    button.addEventListener('click', () => onRemove(button.getAttribute('data-remove-role') || ''));
  });
}

export async function initAdminConfigMenu(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  if (!feedback) return;

  const typeConfigs = [
    { type: 'statuses', list: document.querySelector('#statusList'), input: document.querySelector('#statusInput') },
    {
      type: 'disciplinary_types',
      list: document.querySelector('#disciplinaryTypeList'),
      input: document.querySelector('#disciplinaryTypeInput')
    },
    { type: 'ranks', list: document.querySelector('#rankList'), input: document.querySelector('#rankInput') },
    { type: 'grades', list: document.querySelector('#gradeList'), input: document.querySelector('#gradeInput') }
  ];

  const addButtons = {
    statuses: document.querySelector('#addStatusBtn'),
    disciplinary_types: document.querySelector('#addDisciplinaryTypeBtn'),
    ranks: document.querySelector('#addRankBtn'),
    grades: document.querySelector('#addGradeBtn')
  };

  const roleInput = document.querySelector('#roleIdInput');
  const roleList = document.querySelector('#roleList');
  const addRoleBtn = document.querySelector('#addRoleBtn');
  const saveRolesBtn = document.querySelector('#saveRolesBtn');

  let configState = {
    statuses: [],
    disciplinary_types: [],
    ranks: [],
    grades: []
  };

  let roleIds = [];
  const removeRole = (removeId) => {
    roleIds = roleIds.filter((id) => id !== removeId);
    renderRoleList(roleList, roleIds, removeRole);
  };

  async function refreshType(type) {
    const payload = await getConfig(type);
    configState[type] = payload.items || [];

    const target = typeConfigs.find((x) => x.type === type);
    if (!target || !target.list) return;

    renderSimpleList(
      target.list,
      configState[type],
      async (id) => {
        const existing = configState[type].find((item) => item.id === id);
        const next = window.prompt(`Edit ${type} value`, existing?.value || '');
        if (!next || !next.trim()) return;
        try {
          await updateConfigValue(type, id, next.trim());
          await refreshType(type);
          showMessage(feedback, `${type} value updated.`, 'success');
        } catch (error) {
          showMessage(feedback, error.message || `Unable to update ${type}.`, 'error');
        }
      },
      async (id) => {
        try {
          await deleteConfigValue(type, id);
          await refreshType(type);
          showMessage(feedback, `${type} value deleted.`, 'success');
        } catch (error) {
          showMessage(feedback, error.message || `Unable to delete ${type}.`, 'error');
        }
      }
    );
  }

  async function refreshRoles() {
    const payload = await getAdminRoles();
    roleIds = payload.roleIds || [];
    renderRoleList(roleList, roleIds, removeRole);
  }

  for (const cfg of typeConfigs) {
    const button = addButtons[cfg.type];
    if (!button || !cfg.input) continue;

    button.addEventListener('click', async () => {
      clearMessage(feedback);
      const value = String(cfg.input.value || '').trim();
      if (!value) {
        showMessage(feedback, 'Value is required.', 'error');
        return;
      }

      try {
        await createConfigValue(cfg.type, value);
        cfg.input.value = '';
        await refreshType(cfg.type);
        showMessage(feedback, `${cfg.type} value added.`, 'success');
      } catch (error) {
        showMessage(feedback, error.message || `Unable to add ${cfg.type}.`, 'error');
      }
    });
  }

  if (addRoleBtn && roleInput && roleList) {
    addRoleBtn.addEventListener('click', () => {
      clearMessage(feedback);
      const roleId = normalizeRoleId(roleInput.value);
      if (!roleId) {
        showMessage(feedback, 'Role ID must be a numeric Discord snowflake.', 'error');
        return;
      }
      if (roleIds.includes(roleId)) {
        showMessage(feedback, 'Role already exists.', 'error');
        return;
      }

      roleIds.push(roleId);
      roleInput.value = '';
      renderRoleList(roleList, roleIds, removeRole);
    });
  }

  if (saveRolesBtn) {
    saveRolesBtn.addEventListener('click', async () => {
      try {
        const payload = await saveAdminRoles(roleIds);
        roleIds = payload.roleIds || [];
        renderRoleList(roleList, roleIds, removeRole);
        showMessage(feedback, 'Intranet access roles saved.', 'success');
      } catch (error) {
        showMessage(feedback, error.message || 'Unable to save access roles.', 'error');
      }
    });
  }

  try {
    await Promise.all(typeConfigs.map((entry) => refreshType(entry.type)));
    await refreshRoles();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize config menu.', 'error');
  }
}
