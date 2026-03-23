function renderStats(stats, container) {
  if (!container) return;

  container.innerHTML = `
    <h2>Snapshot</h2>
    <ul class="stat-list">
      ${stats
        .map(
          (item) => `
            <li>
              <strong>${item.value}</strong>
              <span>${item.label}</span>
            </li>
          `
        )
        .join('')}
    </ul>
  `;
}

function renderDetailCards(cards, container) {
  if (!container) return;

  container.innerHTML = cards
    .map(
      (card) => `
        <article class="panel detail-card">
          <h3>${card.title}</h3>
          <p>${card.description}</p>
        </article>
      `
    )
    .join('');
}

export function renderHomeContent(profile) {
  renderStats(profile.heroStats, document.querySelector('#heroStats'));
  renderDetailCards(profile.detailCards, document.querySelector('#detailCards'));
}
