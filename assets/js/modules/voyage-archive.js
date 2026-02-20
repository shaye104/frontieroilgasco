import { listVoyages } from './admin-api.js';
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

function renderArchivedCards(target, voyages) {
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
  if (!feedback || !grid || !prevButton || !nextButton || !pageInfo || !pagination) return;

  let currentPage = pageFromUrl();
  let totalPages = 1;

  async function refresh() {
    try {
      const payload = await listVoyages({ status: 'ENDED', page: currentPage, pageSize: 12 });
      const voyages = payload.voyages || payload.archived || [];
      const paginationInfo = payload.pagination || {};
      totalPages = Math.max(1, Number(paginationInfo.totalPages || 1));
      if (currentPage > totalPages) {
        currentPage = totalPages;
        return refresh();
      }
      renderArchivedCards(grid, voyages);
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

  await refresh();
}
