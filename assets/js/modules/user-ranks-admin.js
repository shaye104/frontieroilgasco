import {
  addUserRankDiscordRoleLink,
  addUserRankGroupLink,
  createUserRank,
  deleteUserRank,
  getUserRankLinks,
  getUserRankPermissions,
  listUserRanks,
  removeUserRankDiscordRoleLink,
  removeUserRankGroupLink,
  saveUserRankPermissions,
  updateUserRank
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

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

function normalizeTemplate(templateKey) {
  const key = text(templateKey).toLowerCase();
  if (['viewer', 'staff', 'manager', 'admin'].includes(key)) return key;
  return '';
}

function defaultPermissionTemplate(templateKey, permissionCatalog) {
  const key = normalizeTemplate(templateKey);
  const allKeys = (permissionCatalog || []).map((permission) => String(permission.key || '').trim()).filter(Boolean);
  if (!key || !allKeys.length) return [];

  const byPrefix = (prefix) => allKeys.filter((permissionKey) => permissionKey.startsWith(prefix));
  const always = ['dashboard.view', 'my_details.view', 'voyages.read'];
  if (key === 'viewer') return [...new Set(always)];
  if (key === 'staff') return [...new Set([...always, 'voyages.create', 'finances.view'])];
  if (key === 'manager') {
    return [...new Set([...always, ...byPrefix('employees.'), ...byPrefix('voyages.'), 'finances.view', 'admin.access'])];
  }
  if (key === 'admin') return [...new Set(allKeys)];
  return [];
}

function groupPermissions(permissionCatalog) {
  const groups = new Map();
  (permissionCatalog || []).forEach((permission) => {
    const groupName = text(permission.groupLabel || permission.group || 'Other');
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(permission);
  });
  return groups;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function initUserRanksAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const list = document.querySelector(config.listSelector);
  const hint = document.querySelector(config.hintSelector);
  const form = document.querySelector(config.formSelector);
  const editorShell = document.querySelector('#userRanksEditorShell');
  const editorTitle = document.querySelector('#userRanksEditorTitle');
  const tabs = document.querySelector('#userRanksTabs');
  const panels = [...document.querySelectorAll('[data-rank-panel]')];
  const openCreateRankBtn = document.querySelector(config.openCreateRankBtnSelector);
  const createForm = document.querySelector(config.createFormSelector);
  const deleteButton = document.querySelector(config.deleteButtonSelector);
  const searchInput = document.querySelector('#userRanksSearchInput');
  const linksDiscordList = document.querySelector('#userRankDiscordLinksList');
  const linksGroupList = document.querySelector('#userRankGroupLinksList');
  const discordLinkForm = document.querySelector('#userRankDiscordLinkForm');
  const groupLinkForm = document.querySelector('#userRankGroupLinkForm');
  const groupSelect = document.querySelector('#userRankGroupKeySelect');
  const permissionsEditor = document.querySelector(config.permissionsEditorSelector);
  const permissionsSearchInput = document.querySelector('#userRanksPermissionsSearch');
  const savePermissionsButton = document.querySelector('#saveUserRanksPermissionsBtn');
  if (
    !feedback ||
    !list ||
    !hint ||
    !form ||
    !editorShell ||
    !tabs ||
    !panels.length ||
    !permissionsEditor ||
    !createForm ||
    !deleteButton
  ) {
    return;
  }

  let ranks = [];
  let selectedRankId = null;
  let searchTerm = '';
  let activeTab = 'overview';
  let linksCache = new Map();
  let permissionsCache = new Map();

  function selectedRank() {
    return ranks.find((rank) => Number(rank.id) === Number(selectedRankId)) || null;
  }

  function visibleRanks() {
    if (!searchTerm) return ranks;
    const query = searchTerm.toLowerCase();
    return ranks.filter((rank) => {
      const value = text(rank.value).toLowerCase();
      const description = text(rank.description).toLowerCase();
      return value.includes(query) || description.includes(query);
    });
  }

  function renderRankList() {
    const visible = visibleRanks();
    if (!visible.length) {
      list.innerHTML = '<li class="role-item"><span class="role-id">No ranks found.</span></li>';
      return;
    }

    list.innerHTML = visible
      .map((rank) => {
        const isActive = Number(rank.id) === Number(selectedRankId);
        return `
          <li class="role-item">
            <button class="user-rank-list-button ${isActive ? 'is-active' : ''}" type="button" data-select-rank="${rank.id}">
              <span class="user-rank-list-title">${escapeHtml(rank.value)}</span>
              <span class="user-rank-list-meta">Level ${Number(rank.level || 0)}</span>
              <span class="user-rank-list-badges">
                <span class="user-rank-list-badge">Discord: ${Number(rank.discord_links_count || 0)}</span>
                <span class="user-rank-list-badge">Groups: ${Number(rank.group_links_count || 0)}</span>
                <span class="user-rank-list-badge">Perms: ${Number(rank.permission_count || 0)}</span>
              </span>
            </button>
          </li>
        `;
      })
      .join('');

    list.querySelectorAll('[data-select-rank]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedRankId = Number(button.getAttribute('data-select-rank'));
        activeTab = 'overview';
        renderRankList();
        renderEditorShell();
      });
    });
  }

  function renderEditorShell() {
    const rank = selectedRank();
    if (!rank) {
      hint.classList.remove('hidden');
      editorShell.classList.add('hidden');
      return;
    }

    hint.classList.add('hidden');
    editorShell.classList.remove('hidden');
    editorTitle.textContent = `${text(rank.value) || 'Rank'} · Level ${Number(rank.level || 0)}`;
    form.querySelector('[name="id"]').value = String(rank.id);
    form.querySelector('[name="value"]').value = rank.value || '';
    form.querySelector('[name="level"]').value = String(Number(rank.level || 0));
    form.querySelector('[name="description"]').value = rank.description || '';

    tabs.querySelectorAll('[data-rank-tab]').forEach((button) => {
      const isActive = button.getAttribute('data-rank-tab') === activeTab;
      button.classList.toggle('is-active', isActive);
    });
    panels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.getAttribute('data-rank-panel') !== activeTab);
    });

    if (activeTab === 'links') void loadLinks(rank.id);
    if (activeTab === 'permissions') void loadPermissions(rank.id);
  }

  function renderLinks(rankId, payload) {
    if (Number(rankId) !== Number(selectedRankId)) return;
    const discordLinks = payload?.discordLinks || [];
    const groupLinks = payload?.groupLinks || [];
    const availableGroups = payload?.availableGroups || [];

    groupSelect.innerHTML = ['<option value="">Select user group...</option>']
      .concat(
        availableGroups.map((group) => `<option value="${escapeHtml(group.key)}">${escapeHtml(group.label)} (${escapeHtml(group.key)})</option>`)
      )
      .join('');

    if (!discordLinks.length) {
      linksDiscordList.innerHTML = '<p class="rank-link-empty">No Discord role links configured.</p>';
    } else {
      linksDiscordList.innerHTML = `
        <table class="rank-link-table">
          <thead>
            <tr>
              <th>Role Name</th>
              <th>Discord Role ID</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${discordLinks
              .map(
                (link) => `
                  <tr>
                    <td>${escapeHtml(link.discord_role_name || '—')}</td>
                    <td>${escapeHtml(link.discord_role_id)}</td>
                    <td class="align-right">
                      <button class="btn btn-secondary btn-compact" type="button" data-remove-discord-link="${escapeHtml(link.discord_role_id)}">Remove</button>
                    </td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      `;
      linksDiscordList.querySelectorAll('[data-remove-discord-link]').forEach((button) => {
        button.addEventListener('click', async () => {
          const discordRoleId = text(button.getAttribute('data-remove-discord-link'));
          try {
            const nextPayload = await removeUserRankDiscordRoleLink(rankId, discordRoleId);
            linksCache.set(Number(rankId), nextPayload);
            await refreshRanks();
            renderLinks(rankId, nextPayload);
            showMessage(feedback, 'Discord role link removed.', 'success');
          } catch (error) {
            showMessage(feedback, error.message || 'Unable to remove Discord role link.', 'error');
          }
        });
      });
    }

    if (!groupLinks.length) {
      linksGroupList.innerHTML = '<p class="rank-link-empty">No user group links configured.</p>';
    } else {
      linksGroupList.innerHTML = `
        <table class="rank-link-table">
          <thead>
            <tr>
              <th>Group Key</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${groupLinks
              .map(
                (link) => `
                  <tr>
                    <td>${escapeHtml(link.group_key)}</td>
                    <td class="align-right">
                      <button class="btn btn-secondary btn-compact" type="button" data-remove-group-link="${escapeHtml(link.group_key)}">Remove</button>
                    </td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      `;
      linksGroupList.querySelectorAll('[data-remove-group-link]').forEach((button) => {
        button.addEventListener('click', async () => {
          const groupKey = text(button.getAttribute('data-remove-group-link'));
          try {
            const nextPayload = await removeUserRankGroupLink(rankId, groupKey);
            linksCache.set(Number(rankId), nextPayload);
            await refreshRanks();
            renderLinks(rankId, nextPayload);
            showMessage(feedback, 'User group link removed.', 'success');
          } catch (error) {
            showMessage(feedback, error.message || 'Unable to remove user group link.', 'error');
          }
        });
      });
    }
  }

  async function loadLinks(rankId) {
    const key = Number(rankId);
    const cached = linksCache.get(key);
    if (cached) {
      renderLinks(rankId, cached);
      return;
    }
    try {
      const payload = await getUserRankLinks(rankId);
      linksCache.set(key, payload);
      renderLinks(rankId, payload);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load rank links.', 'error');
    }
  }

  function renderPermissions(rankId, payload) {
    if (Number(rankId) !== Number(selectedRankId)) return;
    const assigned = new Set(payload?.assignedPermissionKeys || []);
    const query = text(permissionsSearchInput?.value).toLowerCase();
    const groups = groupPermissions(payload?.permissions || []);

    permissionsEditor.innerHTML = [...groups.entries()]
      .map(([groupLabel, permissions]) => {
        const visible = permissions.filter((permission) => {
          if (!query) return true;
          const key = text(permission.key).toLowerCase();
          const label = text(permission.label).toLowerCase();
          const description = text(permission.description).toLowerCase();
          return key.includes(query) || label.includes(query) || description.includes(query);
        });
        if (!visible.length) return '';
        const enabledCount = visible.filter((permission) => assigned.has(permission.key)).length;
        return `
          <section class="permissions-group" data-permission-group="${escapeHtml(groupLabel)}">
            <div class="modal-header">
              <h4>${escapeHtml(groupLabel)} <small>(${enabledCount} enabled)</small></h4>
              <div class="modal-actions">
                <button class="btn btn-secondary btn-compact" type="button" data-select-group="${escapeHtml(groupLabel)}">Select all</button>
                <button class="btn btn-secondary btn-compact" type="button" data-clear-group="${escapeHtml(groupLabel)}">Select none</button>
              </div>
            </div>
            <div class="permissions-list">
              ${visible
                .map(
                  (permission) => `
                    <label class="permissions-item">
                      <input type="checkbox" data-rank-permission-key="${escapeHtml(permission.key)}" ${assigned.has(permission.key) ? 'checked' : ''} />
                      <span>
                        <strong>${escapeHtml(permission.label || permission.key)}</strong><br />
                        <small>${escapeHtml(permission.description || permission.key)}</small>
                      </span>
                    </label>
                  `
                )
                .join('')}
            </div>
          </section>
        `;
      })
      .join('');

    permissionsEditor.querySelectorAll('[data-select-group]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.closest('[data-permission-group]');
        section?.querySelectorAll('[data-rank-permission-key]').forEach((input) => {
          input.checked = true;
        });
      });
    });
    permissionsEditor.querySelectorAll('[data-clear-group]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.closest('[data-permission-group]');
        section?.querySelectorAll('[data-rank-permission-key]').forEach((input) => {
          input.checked = false;
        });
      });
    });
  }

  async function loadPermissions(rankId, force = false) {
    const key = Number(rankId);
    const cached = permissionsCache.get(key);
    if (cached && !force) {
      renderPermissions(rankId, cached);
      return;
    }
    try {
      const payload = await getUserRankPermissions(rankId);
      permissionsCache.set(key, payload);
      renderPermissions(rankId, payload);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load rank permissions.', 'error');
    }
  }

  async function refreshRanks() {
    const payload = await listUserRanks();
    ranks = payload?.ranks || [];
    if (!ranks.some((rank) => Number(rank.id) === Number(selectedRankId))) {
      selectedRankId = ranks[0]?.id || null;
      activeTab = 'overview';
    }
    renderRankList();
    renderEditorShell();
  }

  openCreateRankBtn?.addEventListener('click', () => openModal('createUserRankModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-close-modal');
      if (target) closeModal(target);
    });
  });

  searchInput?.addEventListener('input', () => {
    searchTerm = text(searchInput.value).toLowerCase();
    renderRankList();
  });

  tabs.querySelectorAll('[data-rank-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = text(button.getAttribute('data-rank-tab')).toLowerCase() || 'overview';
      renderEditorShell();
    });
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(createForm);
    const value = text(data.get('value'));
    const level = Number(data.get('level'));
    const template = normalizeTemplate(data.get('template'));
    try {
      const createPayload = await createUserRank({
        value,
        level,
        description: ''
      });
      await refreshRanks();
      selectedRankId = Number(createPayload?.createdId || selectedRankId || ranks[0]?.id || 0);
      activeTab = 'overview';
      renderRankList();
      renderEditorShell();
      closeModal('createUserRankModal');
      createForm.reset();

      if (template && Number.isInteger(selectedRankId) && selectedRankId > 0) {
        const permissionsPayload = await getUserRankPermissions(selectedRankId);
        const templatePermissions = defaultPermissionTemplate(template, permissionsPayload.permissions || []);
        if (templatePermissions.length) {
          await saveUserRankPermissions(selectedRankId, templatePermissions);
          permissionsCache.delete(Number(selectedRankId));
          await refreshRanks();
        }
      }

      showMessage(feedback, 'User rank created.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to create user rank.', 'error');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rank = selectedRank();
    if (!rank) return;
    const data = new FormData(form);
    try {
      await updateUserRank({
        id: rank.id,
        value: text(data.get('value')),
        level: Number(data.get('level')),
        description: text(data.get('description'))
      });
      linksCache.delete(Number(rank.id));
      permissionsCache.delete(Number(rank.id));
      await refreshRanks();
      showMessage(feedback, 'Rank overview updated.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update rank.', 'error');
    }
  });

  deleteButton.addEventListener('click', async () => {
    const rank = selectedRank();
    if (!rank) return;
    if (!window.confirm(`Delete rank "${rank.value}"?`)) return;
    try {
      await deleteUserRank(rank.id);
      linksCache.delete(Number(rank.id));
      permissionsCache.delete(Number(rank.id));
      await refreshRanks();
      showMessage(feedback, 'Rank deleted.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to delete rank.', 'error');
    }
  });

  discordLinkForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rank = selectedRank();
    if (!rank) return;
    const data = new FormData(discordLinkForm);
    const discordRoleId = text(data.get('discordRoleId'));
    const discordRoleName = text(data.get('discordRoleName'));
    try {
      const payload = await addUserRankDiscordRoleLink(rank.id, { discordRoleId, discordRoleName });
      linksCache.set(Number(rank.id), payload);
      discordLinkForm.reset();
      await refreshRanks();
      renderLinks(rank.id, payload);
      showMessage(feedback, 'Discord role link added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add Discord role link.', 'error');
    }
  });

  groupLinkForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rank = selectedRank();
    if (!rank) return;
    const data = new FormData(groupLinkForm);
    const groupKey = text(data.get('groupKey'));
    if (!groupKey) {
      showMessage(feedback, 'Select a user group.', 'error');
      return;
    }
    try {
      const payload = await addUserRankGroupLink(rank.id, groupKey);
      linksCache.set(Number(rank.id), payload);
      await refreshRanks();
      renderLinks(rank.id, payload);
      showMessage(feedback, 'User group link added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add user group link.', 'error');
    }
  });

  permissionsSearchInput?.addEventListener('input', () => {
    const rank = selectedRank();
    if (!rank) return;
    const payload = permissionsCache.get(Number(rank.id));
    if (!payload) return;
    renderPermissions(rank.id, payload);
  });

  savePermissionsButton?.addEventListener('click', async () => {
    const rank = selectedRank();
    if (!rank) return;
    const permissionKeys = [...permissionsEditor.querySelectorAll('[data-rank-permission-key]:checked')]
      .map((node) => text(node.getAttribute('data-rank-permission-key')))
      .filter(Boolean);
    try {
      await saveUserRankPermissions(rank.id, permissionKeys);
      permissionsCache.delete(Number(rank.id));
      await refreshRanks();
      await loadPermissions(rank.id, true);
      showMessage(feedback, 'Rank permissions updated.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update rank permissions.', 'error');
    }
  });

  try {
    await refreshRanks();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize user ranks.', 'error');
  }
}
