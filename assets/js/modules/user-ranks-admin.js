import {
  createUserRank,
  deleteUserRank,
  getRankPermissions,
  listUserRanks,
  saveRankPermissions,
  updateUserRank
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';
import { hasPermission } from './nav.js';

function text(value) {
  return String(value ?? '').trim();
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

export async function initUserRanksAdmin(config, session) {
  const feedback = document.querySelector(config.feedbackSelector);
  const list = document.querySelector(config.listSelector);
  const hint = document.querySelector(config.hintSelector);
  const form = document.querySelector(config.formSelector);
  const permissionsEditor = document.querySelector(config.permissionsEditorSelector);
  const openCreateRankBtn = document.querySelector(config.openCreateRankBtnSelector);
  const createForm = document.querySelector(config.createFormSelector);
  const deleteButton = document.querySelector(config.deleteButtonSelector);
  if (!feedback || !list || !hint || !form || !permissionsEditor || !createForm) return;

  const canManageRankPermissions = hasPermission(session, 'user_ranks.permissions.manage');
  let ranks = [];
  let permissionCatalog = [];
  let mappingsByRank = {};
  let selectedRankId = null;

  function getSelectedRank() {
    return ranks.find((rank) => Number(rank.id) === Number(selectedRankId)) || null;
  }

  function renderPermissions(rankValue) {
    if (!canManageRankPermissions) {
      permissionsEditor.innerHTML = '<p class="role-id">You do not have permission to edit rank permissions.</p>';
      return;
    }
    const selected = new Set(mappingsByRank[rankValue] || []);
    const grouped = permissionCatalog.reduce((acc, permission) => {
      const key = permission.groupLabel || permission.group || 'Other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(permission);
      return acc;
    }, {});
    permissionsEditor.innerHTML = Object.entries(grouped)
      .map(
        ([groupLabel, permissions]) => `<section class="permissions-group">
      <h4>${text(groupLabel)}</h4>
      <div class="permissions-list">
      ${permissions
        .map(
          (permission) => `<label class="permissions-item">
          <input type="checkbox" data-rank-permission-key="${permission.key}" ${selected.has(permission.key) ? 'checked' : ''} />
          <span><strong>${text(permission.label)}</strong><br/><small>${text(permission.description)}</small></span>
        </label>`
        )
        .join('')}
      </div>
    </section>`
      )
      .join('');
  }

  function renderDetails() {
    const rank = getSelectedRank();
    if (!rank) {
      hint.classList.remove('hidden');
      form.classList.add('hidden');
      permissionsEditor.innerHTML = '';
      return;
    }
    hint.classList.add('hidden');
    form.classList.remove('hidden');
    form.querySelector('[name="id"]').value = String(rank.id);
    form.querySelector('[name="value"]').value = rank.value || '';
    form.querySelector('[name="level"]').value = String(Number(rank.level || 0));
    form.querySelector('[name="description"]').value = rank.description || '';
    renderPermissions(rank.value || '');
  }

  function renderList() {
    if (!ranks.length) {
      list.innerHTML = '<li class="role-item"><span class="role-id">No user ranks found.</span></li>';
      return;
    }
    list.innerHTML = ranks
      .map((rank, index) => {
        const selected = Number(rank.id) === Number(selectedRankId);
        return `<li class="role-item role-row ${selected ? 'role-row-selected' : ''}">
      <button type="button" class="btn btn-secondary role-row-main" data-select-rank="${rank.id}">
        <span>${text(rank.value)}</span>
        <small>Level ${Number(rank.level || 0)}${rank.description ? ` | ${text(rank.description)}` : ''}</small>
      </button>
      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" data-rank-move="${rank.id}" data-direction="up" ${
          index === 0 ? 'disabled' : ''
        }>&uarr;</button>
        <button class="btn btn-secondary" type="button" data-rank-move="${rank.id}" data-direction="down" ${
          index === ranks.length - 1 ? 'disabled' : ''
        }>&darr;</button>
      </div>
    </li>`;
      })
      .join('');

    list.querySelectorAll('[data-select-rank]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedRankId = Number(button.getAttribute('data-select-rank'));
        renderList();
        renderDetails();
      });
    });

    list.querySelectorAll('[data-rank-move]').forEach((button) => {
      button.addEventListener('click', async () => {
        const rankId = Number(button.getAttribute('data-rank-move'));
        const direction = String(button.getAttribute('data-direction') || '');
        const currentIndex = ranks.findIndex((rank) => Number(rank.id) === rankId);
        const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (currentIndex < 0 || swapIndex < 0 || swapIndex >= ranks.length) return;
        const current = ranks[currentIndex];
        const neighbor = ranks[swapIndex];
        try {
          await Promise.all([
            updateUserRank({
              id: current.id,
              value: current.value,
              description: current.description || '',
              level: neighbor.level
            }),
            updateUserRank({
              id: neighbor.id,
              value: neighbor.value,
              description: neighbor.description || '',
              level: current.level
            })
          ]);
          await refreshData();
          showMessage(feedback, 'Rank order updated.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to reorder ranks.', 'error');
        }
      });
    });
  }

  async function refreshData() {
    const [ranksPayload, permissionsPayload] = await Promise.all([
      listUserRanks(),
      canManageRankPermissions ? getRankPermissions() : Promise.resolve({ permissions: [], mappingsByRank: {} })
    ]);
    ranks = ranksPayload.ranks || [];
    permissionCatalog = permissionsPayload.permissions || [];
    mappingsByRank = permissionsPayload.mappingsByRank || {};
    if (!ranks.some((rank) => Number(rank.id) === Number(selectedRankId))) {
      selectedRankId = ranks[0]?.id || null;
    }
    renderList();
    renderDetails();
  }

  openCreateRankBtn?.addEventListener('click', () => openModal('createUserRankModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-close-modal');
      if (target) closeModal(target);
    });
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(createForm);
    try {
      await createUserRank({
        value: text(data.get('value')),
        level: Number(data.get('level')),
        description: text(data.get('description'))
      });
      closeModal('createUserRankModal');
      createForm.reset();
      await refreshData();
      showMessage(feedback, 'User rank created.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to create user rank.', 'error');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rank = getSelectedRank();
    if (!rank) return;
    const data = new FormData(form);
    const rankValue = text(data.get('value'));
    const level = Number(data.get('level'));
    const description = text(data.get('description'));
    const permissionKeys = canManageRankPermissions
      ? [...form.querySelectorAll('[data-rank-permission-key]:checked')]
          .map((input) => String(input.getAttribute('data-rank-permission-key') || '').trim())
          .filter(Boolean)
      : mappingsByRank[rank.value] || [];
    try {
      await updateUserRank({
        id: rank.id,
        value: rankValue,
        level,
        description
      });
      if (canManageRankPermissions) {
        await saveRankPermissions(rankValue, permissionKeys);
      }
      await refreshData();
      const updated = ranks.find((item) => item.value === rankValue) || ranks.find((item) => Number(item.id) === Number(rank.id));
      selectedRankId = updated?.id || selectedRankId;
      renderList();
      renderDetails();
      showMessage(feedback, 'User rank updated.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update user rank.', 'error');
    }
  });

  deleteButton?.addEventListener('click', async () => {
    const rank = getSelectedRank();
    if (!rank) return;
    if (!window.confirm(`Delete rank "${rank.value}"?`)) return;
    try {
      await deleteUserRank(rank.id);
      selectedRankId = null;
      await refreshData();
      showMessage(feedback, 'User rank deleted.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to delete user rank.', 'error');
    }
  });

  try {
    await refreshData();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize user ranks.', 'error');
  }
}
