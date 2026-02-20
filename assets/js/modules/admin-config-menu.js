import {
  createConfigValue,
  deleteConfigValue,
  getConfig,
  getRankPermissions,
  saveRankPermissions,
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
  const rankPermissionSelect = document.querySelector('#rankPermissionSelect');
  const rankPermissionsGrid = document.querySelector('#rankPermissionsGrid');
  const saveRankPermissionsButton = document.querySelector('#saveRankPermissionsBtn');

  let configState = {
    statuses: [],
    disciplinary_types: [],
    ranks: [],
    grades: []
  };
  let rankPermissionState = {
    ranks: [],
    permissions: [],
    mappingsByRank: {}
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

    if (type === 'ranks') {
      await refreshRankPermissions();
    }
  }

  function renderRankPermissionOptions() {
    if (!rankPermissionSelect) return;
    const current = rankPermissionSelect.value;
    rankPermissionSelect.innerHTML =
      '<option value="">Select rank</option>' +
      rankPermissionState.ranks.map((rank) => `<option value="${rank.value}">${text(rank.value)}</option>`).join('');
    if (current && rankPermissionState.ranks.some((rank) => String(rank.value) === String(current))) {
      rankPermissionSelect.value = current;
      return;
    }
    if (rankPermissionState.ranks.length) {
      rankPermissionSelect.value = String(rankPermissionState.ranks[0].value || '');
    }
  }

  function renderRankPermissionGrid() {
    if (!rankPermissionsGrid) return;
    const selectedRank = String(rankPermissionSelect?.value || '').trim();
    if (!selectedRank) {
      rankPermissionsGrid.innerHTML = '<p class="role-id">Create at least one rank to map permissions.</p>';
      return;
    }

    const selected = new Set(rankPermissionState.mappingsByRank[selectedRank] || []);
    const grouped = (rankPermissionState.permissions || []).reduce((acc, permission) => {
      const key = permission.group || 'other';
      if (!acc[key]) acc[key] = { label: permission.groupLabel || key, permissions: [] };
      acc[key].permissions.push(permission);
      return acc;
    }, {});

    const groups = Object.entries(grouped).sort((a, b) => a[1].label.localeCompare(b[1].label));
    if (!groups.length) {
      rankPermissionsGrid.innerHTML = '<p class="role-id">No permissions configured.</p>';
      return;
    }

    rankPermissionsGrid.innerHTML = groups
      .map(
        ([groupKey, group]) => `<section class="permissions-group">
      <h3>${text(group.label)}</h3>
      <div class="permissions-list">
        ${group.permissions
          .map(
            (permission) => `<label class="permissions-item">
          <input type="checkbox" data-rank-permission-key="${permission.key}" ${selected.has(permission.key) ? 'checked' : ''} />
          <span><strong>${text(permission.label)}</strong><br /><small>${text(permission.description)}</small></span>
        </label>`
          )
          .join('')}
      </div>
    </section>`
      )
      .join('');
  }

  async function refreshRankPermissions() {
    if (!rankPermissionSelect || !rankPermissionsGrid) return;
    rankPermissionState = await getRankPermissions();
    rankPermissionState.ranks = rankPermissionState.ranks || [];
    rankPermissionState.permissions = rankPermissionState.permissions || [];
    rankPermissionState.mappingsByRank = rankPermissionState.mappingsByRank || {};
    renderRankPermissionOptions();
    renderRankPermissionGrid();
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

  rankPermissionSelect?.addEventListener('change', () => {
    clearMessage(feedback);
    renderRankPermissionGrid();
  });

  saveRankPermissionsButton?.addEventListener('click', async () => {
    clearMessage(feedback);
    const selectedRank = String(rankPermissionSelect?.value || '').trim();
    if (!selectedRank) {
      showMessage(feedback, 'Select a rank to save permissions.', 'error');
      return;
    }

    const permissionKeys = [...(rankPermissionsGrid?.querySelectorAll('[data-rank-permission-key]:checked') || [])]
      .map((input) => String(input.getAttribute('data-rank-permission-key') || '').trim())
      .filter(Boolean);

    try {
      await saveRankPermissions(selectedRank, permissionKeys);
      await refreshRankPermissions();
      if (rankPermissionSelect) rankPermissionSelect.value = selectedRank;
      renderRankPermissionGrid();
      showMessage(feedback, `Saved rank permissions for ${selectedRank}.`, 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save rank permissions.', 'error');
    }
  });

  try {
    await Promise.all(typeConfigs.map((entry) => refreshType(entry.type)));
    await refreshRankPermissions();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize config menu.', 'error');
  }
}
