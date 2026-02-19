import { listAccessRequests, processAccessRequest } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function renderRequests(target, requests, onSelect) {
  if (!requests.length) {
    target.innerHTML = '<li class="role-item"><span class="role-id">No access requests.</span></li>';
    return;
  }

  target.innerHTML = requests
    .map(
      (req) => `<li class="role-item"><span class="role-id">#${req.id} | ${text(req.discord_display_name)} | ${req.discord_user_id} | ${req.status} | ${text(req.requested_at)}</span>
      <button class="btn btn-secondary" data-open-request="${req.id}" type="button">Open</button></li>`
    )
    .join('');

  target.querySelectorAll('button[data-open-request]').forEach((button) => {
    button.addEventListener('click', () => onSelect(Number(button.getAttribute('data-open-request'))));
  });
}

export async function initAccessRequests(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const listEl = document.querySelector(config.listSelector);
  const selectedEl = document.querySelector(config.selectedSelector);
  const approveForm = document.querySelector(config.approveFormSelector);
  const denyForm = document.querySelector(config.denyFormSelector);

  if (!feedback || !listEl || !selectedEl || !approveForm || !denyForm) return;

  let selectedRequest = null;
  let allRequests = [];

  async function refresh() {
    const payload = await listAccessRequests('pending');
    allRequests = payload.requests || [];
    renderRequests(listEl, allRequests, (id) => {
      selectedRequest = allRequests.find((item) => item.id === id) || null;
      selectedEl.textContent = selectedRequest ? `Selected Request: #${selectedRequest.id} (${selectedRequest.discord_user_id})` : 'No request selected.';
      if (selectedRequest) {
        approveForm.querySelector('[name="discordUserId"]').value = selectedRequest.discord_user_id;
      }
    });
  }

  approveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    if (!selectedRequest) {
      showMessage(feedback, 'Select a request first.', 'error');
      return;
    }

    const data = new FormData(approveForm);

    try {
      await processAccessRequest({
        id: selectedRequest.id,
        action: 'approve_create',
        reviewNote: String(data.get('reviewNote') || '').trim(),
        employee: {
          robloxUsername: String(data.get('robloxUsername') || '').trim(),
          robloxUserId: String(data.get('robloxUserId') || '').trim(),
          rank: String(data.get('rank') || '').trim(),
          grade: String(data.get('grade') || '').trim(),
          serialNumber: String(data.get('serialNumber') || '').trim(),
          employeeStatus: String(data.get('employeeStatus') || '').trim(),
          hireDate: String(data.get('hireDate') || '').trim()
        }
      });

      selectedRequest = null;
      selectedEl.textContent = 'No request selected.';
      approveForm.reset();
      await refresh();
      showMessage(feedback, 'Request approved and employee created (if missing).', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to approve request.', 'error');
    }
  });

  denyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    if (!selectedRequest) {
      showMessage(feedback, 'Select a request first.', 'error');
      return;
    }

    const data = new FormData(denyForm);

    try {
      await processAccessRequest({
        id: selectedRequest.id,
        action: 'deny',
        reviewNote: String(data.get('reviewNote') || '').trim()
      });

      selectedRequest = null;
      selectedEl.textContent = 'No request selected.';
      denyForm.reset();
      await refresh();
      showMessage(feedback, 'Request denied.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to deny request.', 'error');
    }
  });

  try {
    await refresh();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load access requests.', 'error');
  }
}
