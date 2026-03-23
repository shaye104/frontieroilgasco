import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260313e';
import { canAccessAdminPanel, hasPermission } from '../modules/nav.js';
import { getUserRankPermissions, listUserRanks } from '../modules/admin-api.js';
import { clearRankPreviewState, getRankPreviewState, setRankPreviewState } from '../modules/rank-preview.js?v=20260313a';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredAnyPermissions: [
    'employees.read',
    'voyages.config.manage',
    'user_groups.manage',
    'user_ranks.manage',
    'config.manage',
    'activity_tracker.view'
  ]
}).then(async (session) => {
  if (!session) return;

  const employeesLink = document.querySelector('#adminLinkEmployees');
  const voyageSettingsLink = document.querySelector('#adminLinkVoyageSettings');
  const rolesLink = document.querySelector('#adminLinkRoles');
  const userRanksLink = document.querySelector('#adminLinkUserRanks');
  const activityTrackerLink = document.querySelector('#adminLinkActivityTracker');
  const auditLogLink = document.querySelector('#adminLinkAuditLog');
  const rankPreviewPanel = document.querySelector('#rankPreviewPanel');
  const rankPreviewSelect = document.querySelector('#rankPreviewSelect');
  const rankPreviewHint = document.querySelector('#rankPreviewHint');
  const applyRankPreviewBtn = document.querySelector('#applyRankPreviewBtn');
  const clearRankPreviewBtn = document.querySelector('#clearRankPreviewBtn');

  if (employeesLink && hasPermission(session, 'employees.read')) employeesLink.classList.remove('hidden');
  if (voyageSettingsLink && hasPermission(session, 'voyages.config.manage')) voyageSettingsLink.classList.remove('hidden');
  if (rolesLink && hasPermission(session, 'user_groups.manage')) rolesLink.classList.remove('hidden');
  if (userRanksLink && hasPermission(session, 'user_ranks.manage')) userRanksLink.classList.remove('hidden');
  if (activityTrackerLink && hasPermission(session, 'activity_tracker.view')) activityTrackerLink.classList.remove('hidden');
  if (auditLogLink && hasPermission(session, 'activity_tracker.view')) auditLogLink.classList.remove('hidden');

  const canPreviewAsRank = hasPermission(session, 'user_ranks.manage');
  if (canPreviewAsRank && rankPreviewPanel && rankPreviewSelect && applyRankPreviewBtn) {
    rankPreviewPanel.classList.remove('hidden');
    const previewState = getRankPreviewState();
    if (previewState) clearRankPreviewBtn?.classList.remove('hidden');
    try {
      const payload = await listUserRanks();
      const ranks = Array.isArray(payload?.ranks) ? payload.ranks : [];
      rankPreviewSelect.innerHTML = ['<option value="">Select rank...</option>']
        .concat(
          ranks.map((rank) => {
            const id = Number(rank?.id || 0);
            const label = String(rank?.value || '').trim() || `Rank #${id}`;
            const selected = previewState && Number(previewState.rankId) === id ? ' selected' : '';
            return `<option value="${id}"${selected}>${label}</option>`;
          })
        )
        .join('');
    } catch {
      rankPreviewHint.textContent = 'Unable to load ranks for preview.';
    }

    applyRankPreviewBtn.addEventListener('click', async () => {
      const selectedId = Number(rankPreviewSelect.value || 0);
      if (!Number.isInteger(selectedId) || selectedId <= 0) {
        rankPreviewHint.textContent = 'Select a rank to preview.';
        return;
      }
      applyRankPreviewBtn.disabled = true;
      try {
        const selectedLabel =
          rankPreviewSelect.options[rankPreviewSelect.selectedIndex]?.textContent?.trim() || `Rank #${selectedId}`;
        const permissionsPayload = await getUserRankPermissions(selectedId);
        const permissionKeys = Array.isArray(permissionsPayload?.assignedPermissionKeys)
          ? permissionsPayload.assignedPermissionKeys
          : [];
        setRankPreviewState({
          rankId: selectedId,
          rankName: selectedLabel,
          permissionKeys
        });
        window.location.href = '/admin-panel';
      } catch (error) {
        rankPreviewHint.textContent = error?.message || 'Unable to apply rank preview.';
      } finally {
        applyRankPreviewBtn.disabled = false;
      }
    });

    clearRankPreviewBtn?.addEventListener('click', () => {
      clearRankPreviewState();
      window.location.href = '/admin-panel';
    });
  }

  if (!canAccessAdminPanel(session)) {
    window.location.href = '/access-denied?reason=missing_permissions';
  }
});

initializeYear();
