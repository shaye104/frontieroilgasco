import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return [...document.querySelectorAll(selector)];
}

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function toMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function formatGuilders(value) {
  return `\u0192 ${toMoney(value).toLocaleString()}`;
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString();
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function setFeedback(message, type = 'error') {
  const box = $('#collegeFeedback');
  if (!box) return;
  if (!message) {
    box.className = 'feedback';
    box.textContent = '';
    return;
  }
  box.className = `feedback is-visible ${type === 'error' ? 'is-error' : 'is-success'}`;
  box.textContent = message;
}

function normalizeTab(value) {
  const key = String(value || '').trim().toLowerCase();
  return ['overview', 'courses', 'library'].includes(key) ? key : 'overview';
}

function setActiveTab(state, tab) {
  state.activeTab = normalizeTab(tab);
  $$('[data-college-tab]').forEach((button) => {
    const isActive = button.getAttribute('data-college-tab') === state.activeTab;
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $$('[data-college-panel]').forEach((panel) => {
    const isActive = panel.getAttribute('data-college-panel') === state.activeTab;
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('is-active', isActive);
  });
  const next = new URL(window.location.href);
  next.searchParams.set('tab', state.activeTab);
  if (state.selectedCourseId) next.searchParams.set('courseId', String(state.selectedCourseId));
  else next.searchParams.delete('courseId');
  if (state.selectedModuleId) next.searchParams.set('moduleId', String(state.selectedModuleId));
  else next.searchParams.delete('moduleId');
  window.history.replaceState({}, '', next.toString());
}

function findCourse(state, courseId) {
  return (state.overview?.enrollments || []).find((row) => Number(row.courseId) === Number(courseId)) || null;
}

function findModule(state, courseId, moduleId) {
  const course = findCourse(state, courseId);
  if (!course) return null;
  return (course.modules || []).find((row) => Number(row.id) === Number(moduleId)) || null;
}

function renderChecklist(targetSelector, requirements = {}) {
  const target = $(targetSelector);
  if (!target) return;
  const rows = [
    { label: 'Complete Induction Course', done: Boolean(requirements.completeInductionCourse) },
    { label: 'Pass Final Quiz', done: Boolean(requirements.passFinalQuiz) },
    { label: 'Acknowledge Terms', done: Boolean(requirements.acknowledgeTerms) }
  ];
  target.innerHTML = rows
    .map(
      (row) => `<li class="college-checklist-item ${row.done ? 'is-done' : ''}">
      <span class="college-check-status">${row.done ? 'Done' : 'Pending'}</span>
      <span>${text(row.label)}</span>
    </li>`
    )
    .join('');
}

function renderCourseCards(targetSelector, enrollments = []) {
  const target = $(targetSelector);
  if (!target) return;
  if (!enrollments.length) {
    target.innerHTML = '<div class="college-empty">No courses assigned yet.</div>';
    return;
  }
  target.innerHTML = enrollments
    .map(
      (row) => `<article class="college-course-card">
      <h4>${text(row.title)}</h4>
      <p class="college-kpi-meta">${text(row.code)} · ${Math.max(0, Number(row.estimatedMinutes || 0))} mins</p>
      <p class="college-kpi-meta">Progress: ${Math.max(0, Math.min(100, Number(row.progressPct || 0)))}%</p>
      <p class="college-kpi-meta">Next: ${text(row.nextModuleTitle || 'Completed')}</p>
      <div class="college-actions">
        <button type="button" class="btn btn-secondary" data-course-open="${Number(row.courseId || 0)}">Resume</button>
      </div>
    </article>`
    )
    .join('');
}

function renderCourseSidebar(state) {
  const target = $('#collegeCourseSidebar');
  if (!target) return;
  const enrollments = state.overview?.enrollments || [];
  if (!enrollments.length) {
    target.innerHTML = '<div class="college-empty">No courses available.</div>';
    return;
  }

  target.innerHTML = enrollments
    .map((course) => {
      const isCourseActive = Number(course.courseId) === Number(state.selectedCourseId);
      const modules = course.modules || [];
      return `<section class="college-course-group ${isCourseActive ? 'is-active' : ''}">
      <button type="button" class="college-course-group-head" data-course-open="${Number(course.courseId)}">
        <strong>${text(course.title)}</strong>
        <span>${Math.max(0, Math.min(100, Number(course.progressPct || 0)))}%</span>
      </button>
      <div class="college-module-list">
        ${modules
          .map((module) => {
            const isActive = Number(module.id) === Number(state.selectedModuleId);
            return `<button type="button" class="college-module-item ${isActive ? 'is-active' : ''}" data-module-open="${Number(course.courseId)}:${Number(
              module.id
            )}">
              <span>${text(module.title)}</span>
              <small>${module.completed ? 'Completed' : 'Pending'}</small>
            </button>`;
          })
          .join('')}
      </div>
    </section>`;
    })
    .join('');
}

function renderCurrentModule(state) {
  const moduleTitle = $('#collegeModuleTitle');
  const moduleMeta = $('#collegeModuleMeta');
  const moduleBody = $('#collegeModuleBody');
  const markCompleteBtn = $('#collegeMarkCompleteBtn');
  if (!moduleTitle || !moduleMeta || !moduleBody || !markCompleteBtn) return;

  const course = findCourse(state, state.selectedCourseId);
  const module = findModule(state, state.selectedCourseId, state.selectedModuleId);
  if (!course || !module) {
    moduleTitle.textContent = 'Select a module';
    moduleMeta.textContent = '';
    moduleBody.innerHTML = '<div class="college-empty">Choose a module from the sidebar.</div>';
    markCompleteBtn.classList.add('hidden');
    return;
  }

  moduleTitle.textContent = module.title;
  moduleMeta.textContent = `${text(course.title)} · ${text(module.contentType)}`;

  const attachment = module.attachmentUrl ? `<p><a href="${module.attachmentUrl}" target="_blank" rel="noopener">Open attachment</a></p>` : '';
  const video = module.videoUrl ? `<p><a href="${module.videoUrl}" target="_blank" rel="noopener">Open video</a></p>` : '';
  moduleBody.innerHTML = `<div class="college-module-markdown">${text(module.content).replace(/\n/g, '<br />')}</div>${attachment}${video}`;

  const showComplete = state.isRestricted && !module.completed;
  markCompleteBtn.classList.toggle('hidden', !showComplete);
  markCompleteBtn.setAttribute('data-module-id', String(Number(module.id)));
}

function renderLibrary(targetSelector, docs = []) {
  const target = $(targetSelector);
  if (!target) return;
  if (!docs.length) {
    target.innerHTML = '<div class="college-empty">No documents found.</div>';
    return;
  }

  target.innerHTML = docs
    .map(
      (row) => `<article class="college-library-card">
      <h4>${text(row.title)}</h4>
      <p class="college-kpi-meta">${text(row.category)} · Updated ${formatDateTime(row.updatedAt)}</p>
      <p>${text(row.summary || '')}</p>
      <div class="college-tags">
        ${(Array.isArray(row.tags) ? row.tags : []).map((tag) => `<span class="college-tag">${text(tag)}</span>`).join('')}
      </div>
      ${row.documentUrl ? `<a class="btn btn-secondary btn-compact" href="${row.documentUrl}" target="_blank" rel="noopener">Open</a>` : ''}
    </article>`
    )
    .join('');
}

function bindCourseActions(state) {
  $$('[data-course-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const courseId = Number(button.getAttribute('data-course-open') || 0);
      const course = findCourse(state, courseId);
      if (!course) return;
      state.selectedCourseId = courseId;
      state.selectedModuleId = Number(course.nextModuleId || course.modules?.[0]?.id || 0) || null;
      setActiveTab(state, 'courses');
      renderCourseSidebar(state);
      renderCurrentModule(state);
      bindCourseActions(state);
    });
  });

  $$('[data-module-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const [courseId, moduleId] = String(button.getAttribute('data-module-open') || '').split(':').map((v) => Number(v || 0));
      if (!courseId || !moduleId) return;
      state.selectedCourseId = courseId;
      state.selectedModuleId = moduleId;
      setActiveTab(state, state.activeTab);
      renderCourseSidebar(state);
      renderCurrentModule(state);
      bindCourseActions(state);
    });
  });
}

function renderOverview(state) {
  const data = state.overview || {};
  const employee = data.employee || {};
  const isRestricted = Boolean(data.isRestricted);
  state.isRestricted = isRestricted;

  const dueCountdown = $('#collegeDueCountdown');
  const dueDate = $('#collegeDueDate');
  const dueCard = $('#collegeDueCard');
  const progressValue = $('#collegeProgressValue');
  const progressBar = $('#collegeProgressBar');
  const statusPill = $('#collegeStatusPill');
  const statusMeta = $('#collegeStatusMeta');

  if (dueCountdown) dueCountdown.textContent = data.dueInSeconds == null ? '—' : formatDuration(data.dueInSeconds);
  if (dueDate) dueDate.textContent = `Due date: ${formatDateTime(employee.collegeDueAt)}`;
  if (progressValue) progressValue.textContent = `${Math.max(0, Math.min(100, Number(data.progressPct || 0)))}%`;
  if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, Number(data.progressPct || 0)))}%`;
  if (statusPill) {
    statusPill.textContent = text(data.statusPill || 'Active');
    statusPill.classList.toggle('is-overdue', Boolean(data.overdue));
    statusPill.classList.toggle('is-passed', String(data.statusPill || '').toLowerCase() === 'passed');
  }
  if (statusMeta) {
    statusMeta.textContent = isRestricted ? 'Complete within 14 days of acceptance.' : 'College access available.';
  }

  if (dueCard) dueCard.classList.toggle('hidden', !isRestricted);

  $('#collegeApplicantBanner')?.classList.toggle('hidden', !isRestricted);
  $('#collegeApplicantActions')?.classList.toggle('hidden', !isRestricted);
  $('#collegeApplicantOverview')?.classList.toggle('hidden', !isRestricted);
  $('#collegeStaffOverview')?.classList.toggle('hidden', isRestricted);

  renderChecklist('#collegeChecklist', data.requirements || {});
  renderChecklist('#collegeRequirementsList', data.requirements || {});
  renderCourseCards('#collegeApplicantCourses', data.enrollments || []);
  renderCourseCards('#collegeStaffEnrollments', data.enrollments || []);

  state.selectedCourseId = data.current?.courseId || state.selectedCourseId;
  state.selectedModuleId = data.current?.moduleId || state.selectedModuleId;

  renderCourseSidebar(state);
  renderCurrentModule(state);
  bindCourseActions(state);
}

async function loadOverview(state) {
  const payload = await fetchJson('/api/college/me');
  state.overview = payload || {};
  renderOverview(state);
}

async function loadLibrary(state) {
  const search = ($('#collegeLibrarySearch')?.value || '').trim();
  const category = ($('#collegeLibraryCategory')?.value || '').trim();
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const payload = await fetchJson(`/api/college/library${suffix}`);
  state.library = payload?.documents || [];
  renderLibrary('#collegeLibraryRows', state.library);
  renderLibrary('#collegeStaffLibraryPreview', state.library.slice(0, 5));
}

function startCountdown(state) {
  if (state.countdownTimer) window.clearInterval(state.countdownTimer);
  state.countdownTimer = window.setInterval(() => {
    if (!state.overview) return;
    if (state.overview.dueInSeconds == null) return;
    state.overview.dueInSeconds = Math.max(0, Number(state.overview.dueInSeconds || 0) - 1);
    const dueCountdown = $('#collegeDueCountdown');
    if (dueCountdown) dueCountdown.textContent = formatDuration(state.overview.dueInSeconds);
  }, 1000);
}

async function acknowledgeTerms(state) {
  await fetchJson('/api/college/acknowledge-terms', { method: 'POST' });
  setFeedback('Terms acknowledged.', 'success');
  await loadOverview(state);
}

async function completeModule(state, moduleId) {
  await fetchJson(`/api/college/modules/${encodeURIComponent(String(moduleId))}/complete`, { method: 'POST' });
  setFeedback('Module marked as complete.', 'success');
  await loadOverview(state);
}

async function init() {
  const query = new URL(window.location.href).searchParams;
  const session = await initIntranetPageGuard({
    feedbackSelector: '#guardFeedback',
    protectedContentSelector: '#protectedContent',
    requireEmployee: true
  });
  if (!session) return;

  const state = {
    activeTab: normalizeTab(query.get('tab')),
    overview: null,
    library: [],
    selectedCourseId: Number(query.get('courseId') || 0) || null,
    selectedModuleId: Number(query.get('moduleId') || 0) || null,
    isRestricted: false,
    countdownTimer: null
  };

  setActiveTab(state, state.activeTab);

  $$('[data-college-tab]').forEach((button) => {
    button.addEventListener('click', () => setActiveTab(state, button.getAttribute('data-college-tab')));
  });

  const requirementsModal = $('#collegeRequirementsModal');
  $('#collegeRequirementsBtn')?.addEventListener('click', () => requirementsModal?.classList.remove('hidden'));
  $('#collegeRequirementsClose')?.addEventListener('click', () => requirementsModal?.classList.add('hidden'));
  requirementsModal?.addEventListener('click', (event) => {
    if (event.target === requirementsModal) requirementsModal.classList.add('hidden');
  });

  $('#collegeContinueBtn')?.addEventListener('click', () => {
    setActiveTab(state, 'courses');
    renderCourseSidebar(state);
    renderCurrentModule(state);
    bindCourseActions(state);
  });

  $('#collegeAcknowledgeTermsBtn')?.addEventListener('click', async () => {
    try {
      await acknowledgeTerms(state);
    } catch (error) {
      setFeedback(error.message || 'Unable to acknowledge terms.', 'error');
    }
  });

  $('#collegeMarkCompleteBtn')?.addEventListener('click', async () => {
    const moduleId = Number($('#collegeMarkCompleteBtn')?.getAttribute('data-module-id') || 0);
    if (!moduleId) return;
    try {
      await completeModule(state, moduleId);
    } catch (error) {
      setFeedback(error.message || 'Unable to complete module.', 'error');
    }
  });

  let libraryDebounce;
  const scheduleLibraryLoad = () => {
    if (libraryDebounce) window.clearTimeout(libraryDebounce);
    libraryDebounce = window.setTimeout(async () => {
      try {
        await loadLibrary(state);
      } catch (error) {
        setFeedback(error.message || 'Unable to load library.', 'error');
      }
    }, 250);
  };
  $('#collegeLibrarySearch')?.addEventListener('input', scheduleLibraryLoad);
  $('#collegeLibraryCategory')?.addEventListener('input', scheduleLibraryLoad);

  try {
    await Promise.all([loadOverview(state), loadLibrary(state)]);
    startCountdown(state);
    setFeedback('');
  } catch (error) {
    setFeedback(error.message || 'Unable to load college module.', 'error');
  }
}

init().catch((error) => {
  setFeedback(error.message || 'Unable to initialize college module.', 'error');
});
