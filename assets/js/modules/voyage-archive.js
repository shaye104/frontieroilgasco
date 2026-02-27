import { deleteVoyage, listVoyages } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function formatWhen(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderArchivedCards(target, voyages, canDelete) {
  if (!target) return;
  if (!voyages.length) {
    target.innerHTML = `<article class="voyage-empty-state voyage-empty-state-muted">
      <span class="voyage-empty-icon" aria-hidden="true">⌁</span>
      <h3>No archived voyages</h3>
      <p>Ended voyages will appear here.</p>
    </article>`;
    return;
  }

  target.innerHTML = voyages
    .map(
      (voyage) => `<article class="voyage-card voyage-card-archived voyage-card-static" aria-label="Archived voyage preview">
      <div class="voyage-card-head">
        <h3>${text(voyage.vessel_name)} | ${text(voyage.vessel_callsign)}</h3>
        <span class="status-pill status-pill-ended">Ended</span>
      </div>
      <p class="voyage-route-line">${text(voyage.departure_port)} → ${text(voyage.destination_port)}</p>
      <div class="voyage-card-meta">
        <p class="voyage-meta-line"><span>OOW</span>${text(voyage.officer_name)}</p>
        <p class="voyage-meta-line"><span>Ended</span>${formatWhen(voyage.ended_at)}</p>
      </div>
      ${
        canDelete
          ? `<div class="modal-actions">
          <button class="btn btn-danger" type="button" data-delete-voyage-id="${Number(voyage.id || 0)}">Delete Voyage</button>
        </div>`
          : ''
      }
    </article>`
    )
    .join('');
}

function pageFromUrl() {
  const page = Number(new URLSearchParams(window.location.search).get('page'));
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

function setPageUrl(page) {
  const url = new URL(window.location.href);
  if (page <= 1) url.searchParams.delete('page');
  else url.searchParams.set('page', String(page));
  window.history.replaceState({}, '', url.toString());
}

export async function initVoyageArchive(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const grid = document.querySelector(config.gridSelector);
  const prevButton = document.querySelector(config.prevButtonSelector);
  const nextButton = document.querySelector(config.nextButtonSelector);
  const pageInfo = document.querySelector(config.pageInfoSelector);
  const pagination = document.querySelector(config.paginationSelector);
  const deleteModal = document.querySelector(config.deleteModalSelector);
  const deleteForm = document.querySelector(config.deleteFormSelector);
  const deleteVoyageIdInput = document.querySelector(config.deleteVoyageIdSelector);
  const deleteReasonInput = document.querySelector(config.deleteReasonSelector);
  const deleteConfirmInput = document.querySelector(config.deleteConfirmSelector);
  const deleteAcknowledgeInput = document.querySelector(config.deleteAcknowledgeSelector);
  const deleteConfirmBtn = document.querySelector(config.deleteConfirmButtonSelector);
  const deleteSummary = document.querySelector(config.deleteSummarySelector);
  const deleteModalFeedback = document.querySelector(config.deleteModalFeedbackSelector);
  if (!feedback || !grid || !prevButton || !nextButton || !pageInfo || !pagination) return;

  let currentPage = pageFromUrl();
  let totalPages = 1;
  let lastPayload = null;

  const openDeleteModal = (voyage) => {
    if (!deleteModal || !deleteForm) return;
    deleteForm.reset();
    clearMessage(deleteModalFeedback);
    if (deleteVoyageIdInput) deleteVoyageIdInput.value = String(Number(voyage.id || 0));
    if (deleteSummary) {
      deleteSummary.innerHTML = `
        <p><strong>Voyage ID:</strong> ${Number(voyage.id || 0)}</p>
        <p><strong>Vessel:</strong> ${escapeHtml(text(voyage.vessel_name))} (${escapeHtml(text(voyage.vessel_callsign))})</p>
        <p><strong>Route:</strong> ${escapeHtml(text(voyage.departure_port))} → ${escapeHtml(text(voyage.destination_port))}</p>
        <p><strong>Ended:</strong> ${escapeHtml(formatWhen(voyage.ended_at))}</p>
        <p><strong>Officer of Watch:</strong> ${escapeHtml(text(voyage.officer_name))}</p>
      `;
    }
    if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
    deleteModal.classList.remove('hidden');
    deleteModal.setAttribute('aria-hidden', 'false');
  };

  const closeDeleteModal = () => {
    if (!deleteModal) return;
    deleteModal.classList.add('hidden');
    deleteModal.setAttribute('aria-hidden', 'true');
  };

  const syncDeleteValidation = () => {
    if (!deleteConfirmBtn) return;
    const voyageId = Number(deleteVoyageIdInput?.value || 0);
    const reason = String(deleteReasonInput?.value || '').trim();
    const confirmText = String(deleteConfirmInput?.value || '').trim().toUpperCase();
    const acknowledged = Boolean(deleteAcknowledgeInput?.checked);
    deleteConfirmBtn.disabled = !(voyageId > 0 && reason.length >= 4 && confirmText === 'DELETE' && acknowledged);
  };

  async function refresh() {
    try {
      const payload = await listVoyages({ status: 'ENDED', page: currentPage, pageSize: 12 });
      lastPayload = payload;
      const voyages = payload.voyages || payload.archived || [];
      const paginationInfo = payload.pagination || {};
      totalPages = Math.max(1, Number(paginationInfo.totalPages || 1));
      if (currentPage > totalPages) {
        currentPage = totalPages;
        return refresh();
      }
      renderArchivedCards(grid, voyages, Boolean(payload?.permissions?.canDelete));
      pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
      prevButton.disabled = currentPage <= 1;
      nextButton.disabled = currentPage >= totalPages;
      pagination.classList.toggle('hidden', totalPages <= 1);
      setPageUrl(currentPage);
      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load archived voyages.', 'error');
      grid.innerHTML = '<article class="voyage-empty-state"><h3>Unable to load data</h3><p>Please refresh and try again.</p></article>';
      pagination.classList.add('hidden');
    }
  }

  prevButton.addEventListener('click', async () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    await refresh();
  });

  nextButton.addEventListener('click', async () => {
    if (currentPage >= totalPages) return;
    currentPage += 1;
    await refresh();
  });

  grid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('[data-delete-voyage-id]');
    if (!button || !lastPayload?.permissions?.canDelete) return;
    const voyageId = Number(button.getAttribute('data-delete-voyage-id'));
    if (!Number.isInteger(voyageId) || voyageId <= 0) return;
    const voyage = (lastPayload?.voyages || lastPayload?.archived || []).find((row) => Number(row.id) === voyageId);
    if (!voyage) return;
    openDeleteModal(voyage);
  });

  [deleteReasonInput, deleteConfirmInput, deleteAcknowledgeInput].forEach((node) => {
    node?.addEventListener('input', syncDeleteValidation);
    node?.addEventListener('change', syncDeleteValidation);
  });

  document.querySelectorAll('[data-close-voyage-delete-modal]').forEach((button) => {
    button.addEventListener('click', closeDeleteModal);
  });

  deleteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(deleteModalFeedback);
    syncDeleteValidation();
    if (deleteConfirmBtn?.disabled) return;
    const voyageId = Number(deleteVoyageIdInput?.value || 0);
    const reason = String(deleteReasonInput?.value || '').trim();
    if (!voyageId || !reason) return;
    try {
      if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
      await deleteVoyage(voyageId, { reason });
      closeDeleteModal();
      showMessage(feedback, 'Voyage deleted. Financial records updated.', 'success');
      await refresh();
    } catch (error) {
      showMessage(deleteModalFeedback, error.message || 'Unable to delete voyage.', 'error');
      syncDeleteValidation();
    }
  });

  await refresh();
}
