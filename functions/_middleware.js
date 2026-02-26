import { readSessionFromRequest } from './api/auth/_lib/auth.js';
import { getEmployeeByDiscordUserId } from './api/_lib/db.js';
import { isCoreAllowedApiPath, isCoreAllowedPagePath, isCoreOnly } from './api/_lib/app-mode.js';

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function toLoginRedirect(url) {
  const target = new URL('/login', url.origin);
  target.searchParams.set('auth', 'denied');
  target.searchParams.set('reason', 'login_required');
  return target.toString();
}

function toCollegeRedirect(url) {
  return new URL('/college', url.origin).toString();
}

function isCollegePath(pathname) {
  return pathname === '/college' || pathname === '/college.html' || pathname.startsWith('/college/');
}

function isAllowedRestrictedApiPath(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/api/college')) return true;
  if (pathname === '/api/auth/session' || pathname === '/api/auth/logout') return true;
  if (pathname.startsWith('/api/auth/discord/')) return true;
  return false;
}

function isProtectedPath(pathname) {
  const protectedPaths = new Set([
    '/my-details',
    '/my-details.html',
    '/my-fleet',
    '/my-fleet.html',
    '/voyages',
    '/voyages/my',
    '/voyage-tracker',
    '/voyage-tracker.html',
    '/voyage-archive',
    '/voyage-archive.html',
    '/voyage-details',
    '/voyage-details.html',
    '/forms',
    '/forms.html',
    '/forms-config',
    '/finances',
    '/finances.html',
    '/finances-analytics',
    '/finances-analytics.html',
    '/finances-debts',
    '/finances-debts.html',
    '/finances-audit',
    '/finances-audit.html',
    '/college',
    '/college.html',
    '/form-fill',
    '/form-fill.html',
    '/forms-categories',
    '/forms-config.html',
    '/forms-manage',
    '/forms-categories.html',
    '/forms-builder',
    '/forms-manage.html',
    '/forms-admin',
    '/forms-builder.html',
    '/forms-responses',
    '/forms-admin.html',
    '/forms-responses.html',
    '/admin',
    '/admin-panel',
    '/admin-panel.html',
    '/admin-config',
    '/admin-config.html',
    '/cargo-admin',
    '/cargo-admin.html',
    '/roles',
    '/roles.html',
    '/user-ranks',
    '/user-ranks.html',
    '/manage-employees',
    '/manage-employees.html',
    '/employee-profile',
    '/activity-tracker',
    '/activity-tracker.html',
    '/employee-profile.html'
  ]);

  if (protectedPaths.has(pathname)) return true;
  if (pathname.startsWith('/voyages/')) return true;
  if (pathname.startsWith('/admin/')) return true;
  if (pathname.startsWith('/forms/')) return true;
  if (pathname.startsWith('/finances/')) return true;
  if (pathname.startsWith('/college/')) return true;
  return false;
}

function isAdminLikePath(pathname) {
  if (pathname.startsWith('/admin/')) return true;
  const legacyAdminPaths = new Set([
    '/admin',
    '/admin-panel',
    '/admin-panel.html',
    '/activity-tracker',
    '/activity-tracker.html',
    '/roles',
    '/roles.html',
    '/user-ranks',
    '/user-ranks.html',
    '/manage-employees',
    '/manage-employees.html',
    '/employee-profile',
    '/employee-profile.html'
  ]);
  return legacyAdminPaths.has(pathname);
}

function shouldAuditRequest(pathname, method, isApiPath) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (pathname.startsWith('/assets/') || pathname === '/favicon.ico') return false;
  if (pathname === '/api/auth/session' || pathname === '/api/auth/logout') return false;
  if (pathname.startsWith('/api/auth/discord/')) return false;
  if (isApiPath) return true;
  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
}

async function logWebsiteAction(env, { session, pathname, method, responseStatus, isApiPath, metadata }) {
  if (!env?.DB || !session?.userId) return;
  if (!shouldAuditRequest(pathname, method, isApiPath)) return;
  const actionType = isApiPath ? `API_${String(method || 'GET').toUpperCase()}` : 'PAGE_VIEW';
  const summary = isApiPath
    ? `${String(method || 'GET').toUpperCase()} ${pathname} -> ${Number(responseStatus || 0)}`
    : `Visited ${pathname}`;
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  try {
    await env.DB
      .prepare(
        `INSERT INTO admin_activity_events
         (actor_employee_id, actor_name, actor_discord_user_id, action_type, target_employee_id, summary, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        null,
        String(session.displayName || session.userId || '').trim() || null,
        String(session.userId || '').trim() || null,
        actionType,
        null,
        summary,
        metadataJson
      )
      .run();
  } catch {
    // Keep middleware non-fatal if audit writes fail.
  }
}

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const pathname = normalizePath(url.pathname);
    const coreOnlyMode = isCoreOnly(context.env);

    if (
      pathname.startsWith('/assets/') ||
      pathname === '/favicon.ico' ||
      pathname === '/_redirects' ||
      pathname === '/_headers' ||
      pathname === '/access-denied' ||
      pathname === '/access-denied.html'
    ) {
      return context.next();
    }

    const session = await readSessionFromRequest(context.env, context.request);
    const isLoggedIn = Boolean(session);
    const isApiPath = pathname.startsWith('/api/');
    const requestMethod = String(context.request.method || 'GET').toUpperCase();
    const sessionPermissions = Array.isArray(session?.permissions) ? session.permissions : [];
    const hasEntryPermission =
      Boolean(session?.isAdmin) ||
      sessionPermissions.includes('my_details.view') ||
      sessionPermissions.includes('admin.override') ||
      sessionPermissions.includes('super.admin');
    const hasCollegePermission =
      sessionPermissions.includes('college.view') ||
      sessionPermissions.includes('college.manage') ||
      sessionPermissions.includes('college.roles.manage') ||
      sessionPermissions.includes('college.enrollments.manage') ||
      sessionPermissions.includes('college.courses.manage') ||
      sessionPermissions.includes('college.library.manage') ||
      sessionPermissions.includes('college.exams.manage') ||
      sessionPermissions.includes('college.exams.grade') ||
      sessionPermissions.includes('admin.override') ||
      sessionPermissions.includes('super.admin');
    let collegeRestricted = false;

    if (isLoggedIn && !session.isAdmin && session.userId) {
      try {
        const employee = await getEmployeeByDiscordUserId(context.env, session.userId);
        const userStatus = String(employee?.user_status || session.userStatus || '').trim().toUpperCase();
        collegeRestricted = userStatus === 'APPLICANT_ACCEPTED' && !(employee?.college_passed_at || session.collegePassedAt);
      } catch {
        collegeRestricted = String(session.userStatus || '').trim().toUpperCase() === 'APPLICANT_ACCEPTED' && !session.collegePassedAt;
      }
    }
    const shouldLandOnCollege = collegeRestricted || (isLoggedIn && !hasEntryPermission && hasCollegePermission);

    if (isApiPath) {
      if (coreOnlyMode && !isCoreAllowedApiPath(pathname)) {
        const blockedResponse = new Response(JSON.stringify({ error: 'Not found.' }), {
          status: 404,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
        if (isLoggedIn) {
          await logWebsiteAction(context.env, {
            session,
            pathname,
            method: requestMethod,
            responseStatus: blockedResponse.status,
            isApiPath,
            metadata: { reason: 'core_api_blocked' }
          });
        }
        return blockedResponse;
      }
      if (isLoggedIn && collegeRestricted && !isAllowedRestrictedApiPath(pathname)) {
        const restrictedResponse = new Response(JSON.stringify({ error: 'College restricted access. Complete onboarding to unlock the full intranet.' }), {
          status: 403,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
        await logWebsiteAction(context.env, {
          session,
          pathname,
          method: requestMethod,
          responseStatus: restrictedResponse.status,
          isApiPath,
          metadata: { reason: 'college_restricted' }
        });
        return restrictedResponse;
      }
      const apiResponse = await context.next();
      if (isLoggedIn) {
        await logWebsiteAction(context.env, {
          session,
          pathname,
          method: requestMethod,
          responseStatus: apiResponse.status,
          isApiPath
        });
      }
      return apiResponse;
    }

    if (pathname === '/dashboard') {
      return Response.redirect(new URL(shouldLandOnCollege ? '/college' : '/my-details', url.origin).toString(), 302);
    }

    if (pathname === '/intranet' || pathname === '/intranet.html') {
      return Response.redirect(new URL('/login', url.origin).toString(), 302);
    }

    const corePublicAllowedPaths = new Set(['/', '/index.html', '/login', '/login.html', '/dashboard', '/intranet', '/intranet.html']);
    const isCoreBlockedRoute = coreOnlyMode && !corePublicAllowedPaths.has(pathname) && !isCoreAllowedPagePath(pathname);
    if (isCoreBlockedRoute) {
      if (isLoggedIn) {
        const redirectPath = isAdminLikePath(pathname) ? '/admin/employees' : '/voyages/my';
        return Response.redirect(new URL(redirectPath, url.origin).toString(), 302);
      }
      return new Response('Not found.', {
        status: 404,
        headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    if (pathname === '/login' || pathname === '/login.html') {
      if (url.searchParams.has('auth') || url.searchParams.has('reason')) {
        return context.next();
      }
      if (isLoggedIn) {
        return Response.redirect(new URL(shouldLandOnCollege ? '/college' : '/my-details', url.origin).toString(), 302);
      }
      return context.next();
    }

    if (isLoggedIn && (pathname === '/' || pathname === '/index.html')) {
      return Response.redirect(new URL(shouldLandOnCollege ? '/college' : '/my-details', url.origin).toString(), 302);
    }

    if (!isLoggedIn && isProtectedPath(pathname)) {
      return Response.redirect(toLoginRedirect(url), 302);
    }

    if (isLoggedIn && collegeRestricted && !isCollegePath(pathname)) {
      return Response.redirect(toCollegeRedirect(url), 302);
    }

    const pageResponse = await context.next();
    if (isLoggedIn) {
      await logWebsiteAction(context.env, {
        session,
        pathname,
        method: requestMethod,
        responseStatus: pageResponse.status,
        isApiPath: false
      });
    }
    return pageResponse;
  } catch {
    return context.next();
  }
}
