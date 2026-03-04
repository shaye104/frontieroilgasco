import { initIntranetLayout } from '../modules/intranet-layout.js?v=20260304b';

initIntranetLayout({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['employees.read']
}).then((session) => {
  if (!session) return;

  import('../modules/manage-employees.js?v=20260228a').then(({ initManageEmployees }) =>
    initManageEmployees(
    {
      feedbackSelector: '#manageEmployeesFeedback',
      employeeTableBodySelector: '#employeeTableBody',
      filterQuerySelector: '#filterEmployeeQuery',
      filterRankSelector: '#filterRank',
      filterGradeSelector: '#filterGrade',
      filterStatusSelector: '#filterStatus',
      filterActivationSelector: '#filterActivationStatus',
      filterHireDateFromSelector: '#filterHireDateFrom',
      filterHireDateToSelector: '#filterHireDateTo',
      clearFiltersBtnSelector: '#clearEmployeeFiltersBtn',
      toggleMoreFiltersBtnSelector: '#toggleMoreFiltersBtn',
      moreFiltersPanelSelector: '#moreEmployeeFilters',
      paginationInfoSelector: '#employeePaginationInfo',
      prevPageBtnSelector: '#employeePrevPageBtn',
      nextPageBtnSelector: '#employeeNextPageBtn',
      columnVisibilityBtnSelector: '#columnVisibilityBtn',
      columnVisibilityMenuSelector: '#columnVisibilityMenu',
      drawerSelector: '#employeeDrawer',
      drawerNameSelector: '#drawerEmployeeName',
      drawerMetaSelector: '#drawerEmployeeMeta',
      drawerOverviewSelector: '#drawerTabOverview',
      drawerVoyagesSelector: '#drawerTabVoyages',
      drawerActivitySelector: '#drawerTabActivity',
      drawerNotesSelector: '#drawerTabNotes',
      drawerDisciplinarySelector: '#drawerTabDisciplinary',
      openCreateEmployeeBtnSelector: '#openCreateEmployeeBtn',
      createFormSelector: '#createEmployeeForm'
    })
  );
});
