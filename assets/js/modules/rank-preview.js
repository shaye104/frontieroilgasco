const STORAGE_KEY = 'codswallop:rank-preview:v1';

function normalizePermissionKeys(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function getRankPreviewState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rankId = Number(parsed?.rankId);
    const rankName = String(parsed?.rankName || '').trim();
    const permissionKeys = normalizePermissionKeys(parsed?.permissionKeys);
    if (!Number.isInteger(rankId) || rankId <= 0 || !rankName) return null;
    return {
      rankId,
      rankName,
      permissionKeys,
      appliedAt: String(parsed?.appliedAt || '')
    };
  } catch {
    return null;
  }
}

export function setRankPreviewState({ rankId, rankName, permissionKeys = [] } = {}) {
  const id = Number(rankId);
  const name = String(rankName || '').trim();
  if (!Number.isInteger(id) || id <= 0 || !name) throw new Error('Invalid rank preview payload.');
  const payload = {
    rankId: id,
    rankName: name,
    permissionKeys: normalizePermissionKeys(permissionKeys),
    appliedAt: new Date().toISOString()
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function clearRankPreviewState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
