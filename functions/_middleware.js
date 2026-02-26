import { readSessionFromRequest } from './api/auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from './api/_lib/db.js';
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

function toDashboardRedirect(url) {
  return new URL('/dashboard', url.origin).toString();
}

function isProtectedPath(pathname) {
  const protectedPaths = new Set([
    '/my-details',
    '/my-details.html',
    '/voyages',
    '/voyages/my',
    '/voyage-tracker',
    '/voyage-tracker.html',
    '/voyage-archive',
    '/voyage-archive.html',
    '/voyage-details',
    '/voyage-details.html',
    '/finances',
    '/finances.html',
    '/admin',
    '/admin-panel',
    '/admin-panel.html',
    '/roles',
    '/roles.html',
    '/user-ranks',
    '/user-ranks.html',
    '/manage-employees',
    '/manage-employees.html',
    '/activity-tracker',
    '/activity-tracker.html',
    '/onboarding',
    '/onboarding.html',
    '/onboarding/status'
  ]);

  if (protectedPaths.has(pathname)) return true;
  if (pathname.startsWith('/voyages/')) return true;
  if (pathname.startsWith('/admin/')) return true;
  if (pathname.startsWith('/finances/')) return true;
  return false;
}

function isPublicPagePath(pathname) {
  const path = normalizePath(pathname);
  return path === '/login' || path === '/login.html';
}

function isOnboardingPath(pathname) {
  const path = normalizePath(pathname);
  return path === '/onboarding' || path === '/onboarding.html' || path === '/onboarding/status';
}

function isOnboardingAllowedApiPath(pathname) {
  const path = normalizePath(pathname);
  return path === '/api/onboarding/me' || path === '/api/onboarding/roblox-profile';
}

async function getLiveActivationStatus(env, session) {
  if (!session || session.isAdmin) return 'ACTIVE';
  try {
    await ensureCoreSchema(env);
    const employee = await getEmployeeByDiscordUserId(env, session.userId);
    if (!employee) return 'NONE';
    return String(employee.activation_status || '').trim().toUpperCase() || 'PENDING';
  } catch {
    return String(session.activationStatus || '').trim().toUpperCase() || 'NONE';
  }
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
    '/manage-employees.html'
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
      pathname.startsWith('/public/') ||
      pathname.startsWith('/functions/') ||
      pathname.startsWith('/favicon') ||
      pathname === '/favicon.ico' ||
      pathname === '/_redirects' ||
      pathname === '/_headers'
    ) {
      return context.next();
    }

    const session = await readSessionFromRequest(context.env, context.request);
    const isLoggedIn = Boolean(session);
    const isApiPath = pathname.startsWith('/api/');
    const requestMethod = String(context.request.method || 'GET').toUpperCase();
    if (isApiPath) {
      if (!isLoggedIn && !pathname.startsWith('/api/auth/')) {
        return new Response(JSON.stringify({ error: 'Authentication required.' }), {
          status: 401,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
      }
      const activationStatus = isLoggedIn ? await getLiveActivationStatus(context.env, session) : 'NONE';
      const isPendingActivation = isLoggedIn && !session?.isAdmin && activationStatus !== 'ACTIVE';

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
      if (isPendingActivation) {
        const allowApi = pathname.startsWith('/api/auth/') || isOnboardingAllowedApiPath(pathname);
        if (!allowApi) {
          return new Response(JSON.stringify({ error: 'Account pending activation.' }), {
            status: 403,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }
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
      return Response.redirect(new URL('/my-details', url.origin).toString(), 302);
    }

    if (pathname === '/intranet' || pathname === '/intranet.html') {
      return Response.redirect(new URL('/login', url.origin).toString(), 302);
    }

    const corePublicAllowedPaths = new Set(['/login', '/login.html']);
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

    if (pathname === '/' || pathname === '/index.html') {
      return Response.redirect(new URL('/login', url.origin).toString(), 302);
    }

    if (pathname === '/login' || pathname === '/login.html') {
      if (url.searchParams.has('auth') || url.searchParams.has('reason')) {
        return context.next();
      }
      if (isLoggedIn) {
        const activationStatus = await getLiveActivationStatus(context.env, session);
        const redirectPath = !session?.isAdmin && activationStatus !== 'ACTIVE' ? '/onboarding' : '/dashboard';
        return Response.redirect(new URL(redirectPath, url.origin).toString(), 302);
      }
      return context.next();
    }

    if (!isLoggedIn && !isPublicPagePath(pathname)) {
      return Response.redirect(toLoginRedirect(url), 302);
    }

    if (isLoggedIn && !session.isAdmin) {
      const activationStatus = await getLiveActivationStatus(context.env, session);
      if (activationStatus !== 'ACTIVE' && !isOnboardingPath(pathname)) {
        return Response.redirect(new URL('/onboarding', url.origin).toString(), 302);
      }
      if (activationStatus === 'ACTIVE' && isOnboardingPath(pathname)) {
        return Response.redirect(toDashboardRedirect(url), 302);
      }
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
