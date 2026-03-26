import { readSessionFromRequest } from './api/auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from './api/_lib/db.js';
import { isCoreAllowedApiPath, isCoreAllowedPagePath, isCoreOnly } from './api/_lib/app-mode.js';
import { readSiteSettings, toAbsoluteUrl } from './api/_lib/site-settings.js';
import { deriveLifecycleStatusFromEmployee, isPendingLifecycle, isRemovedLifecycle, isSuspendedLifecycle } from './api/_lib/lifecycle.js';
import { ADMIN_PANEL_ENTRY_PERMISSIONS, enrichSessionWithPermissions } from './api/_lib/permissions.js';

const FRONTIER_BRAND_NAME = 'Frontier Oil & Gas Company';

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
    '/fleet',
    '/fleet.html',
    '/shipyard',
    '/shipyard.html',
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
    '/site-settings',
    '/site-settings.html',
    '/activity-tracker',
    '/activity-tracker.html',
    '/audit-log',
    '/audit-log.html',
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

function isMaintenancePath(pathname) {
  const path = normalizePath(pathname);
  return path === '/maintenance' || path === '/maintenance.html';
}

function isMaintenanceBypassPagePath(pathname) {
  const path = normalizePath(pathname);
  return (
    isMaintenancePath(path) ||
    path === '/login' ||
    path === '/login.html' ||
    path === '/not-permitted' ||
    path === '/not-permitted.html' ||
    path === '/access-denied' ||
    path === '/access-denied.html'
  );
}

function isMaintenanceBypassApiPath(pathname) {
  const path = normalizePath(pathname);
  return (
    path === '/api/auth/session' ||
    path === '/api/auth/logout' ||
    path.startsWith('/api/auth/discord/')
  );
}

function isPublicPagePath(pathname) {
  const path = normalizePath(pathname);
  return (
    path === '/login' ||
    path === '/login.html' ||
    path === '/not-permitted' ||
    path === '/not-permitted.html' ||
    path === '/access-denied' ||
    path === '/access-denied.html'
  );
}

function isOnboardingPath(pathname) {
  const path = normalizePath(pathname);
  return (
    path === '/onboarding' ||
    path === '/onboarding.html' ||
    path === '/onboarding/status' ||
    path === '/access-setup' ||
    path === '/access-setup.html'
  );
}

function isOnboardingAllowedApiPath(pathname) {
  const path = normalizePath(pathname);
  return (
    path === '/api/onboarding/bootstrap' ||
    path === '/api/onboarding/verify' ||
    path === '/api/onboarding/me' ||
    path === '/api/onboarding/roblox-profile' ||
    path === '/api/onboarding/submit' ||
    path === '/api/me/bootstrap' ||
    path === '/api/roblox/resolve'
  );
}

async function getLiveLifecycleStatus(env, session) {
  if (!session || session.isAdmin) return 'ACTIVE';
  try {
    await ensureCoreSchema(env);
    const employee = await getEmployeeByDiscordUserId(env, session.userId);
    if (!employee) return 'DEACTIVATED';
    return deriveLifecycleStatusFromEmployee(employee, session?.userStatus || 'ACTIVE');
  } catch {
    return deriveLifecycleStatusFromEmployee({ employee_status: session?.userStatus, activation_status: session?.activationStatus }, 'ACTIVE');
  }
}

function isMyDetailsPath(pathname) {
  const path = normalizePath(pathname);
  return path === '/my-details' || path === '/my-details.html';
}

function isAdminLikePath(pathname) {
  if (pathname.startsWith('/admin/')) return true;
  const legacyAdminPaths = new Set([
    '/admin',
    '/admin-panel',
    '/admin-panel.html',
    '/activity-tracker',
    '/activity-tracker.html',
    '/audit-log',
    '/audit-log.html',
    '/roles',
    '/roles.html',
    '/shipyard',
    '/shipyard.html',
    '/user-ranks',
    '/user-ranks.html',
    '/manage-employees',
    '/manage-employees.html',
    '/site-settings',
    '/site-settings.html'
  ]);
  return legacyAdminPaths.has(pathname);
}

const PAGE_PERMISSION_ALIASES = {
  'roles.read': 'user_groups.read',
  'roles.manage': 'user_groups.manage',
  'roles.assign': 'user_groups.assign',
  'user_groups.read': 'roles.read',
  'user_groups.manage': 'roles.manage',
  'user_groups.assign': 'roles.assign'
};

function canViewWithReadOnly(requiredPermission) {
  return (
    String(requiredPermission || '').endsWith('.read') ||
    String(requiredPermission || '').endsWith('.view') ||
    ['voyages.config.manage', 'user_groups.manage', 'user_ranks.manage', 'config.manage'].includes(
      String(requiredPermission || '')
    )
  );
}

function hasEffectivePermission(session, requiredPermission) {
  const requested = String(requiredPermission || '').trim();
  if (!requested) return false;
  const permissions = new Set(Array.isArray(session?.permissions) ? session.permissions.map((value) => String(value || '').trim()) : []);
  if (permissions.has('super.admin') || permissions.has('admin.override')) return true;
  if (permissions.has(requested)) return true;
  const alias = PAGE_PERMISSION_ALIASES[requested];
  if (alias && permissions.has(alias)) return true;
  if (permissions.has('admin.read_only') && canViewWithReadOnly(requested)) return true;
  return false;
}

function requiredAnyPermissionsForPage(pathname) {
  const path = normalizePath(pathname);
  if (path === '/admin' || path === '/admin-panel' || path === '/admin-panel.html') return [...ADMIN_PANEL_ENTRY_PERMISSIONS];
  if (path === '/admin/employees' || path === '/manage-employees' || path === '/manage-employees.html' || path.startsWith('/admin/employees/'))
    return ['employees.read'];
  if (path === '/admin/activity' || path === '/activity-tracker' || path === '/activity-tracker.html' || path.startsWith('/admin/activity/'))
    return ['activity_tracker.view'];
  if (path === '/admin/audit' || path === '/audit-log' || path === '/audit-log.html' || path.startsWith('/admin/audit/'))
    return ['activity_tracker.view'];
  if (path === '/admin/user-groups' || path === '/roles' || path === '/roles.html' || path.startsWith('/admin/user-groups/')) return ['user_groups.manage'];
  if (path === '/admin/user-ranks' || path === '/user-ranks' || path === '/user-ranks.html' || path.startsWith('/admin/user-ranks/'))
    return ['user_ranks.manage'];
  if (path === '/admin/voyages' || path === '/voyage-settings' || path === '/voyage-settings.html' || path.startsWith('/admin/voyages/'))
    return ['voyages.config.manage'];
  if (path === '/admin/site-settings' || path === '/site-settings' || path === '/site-settings.html' || path.startsWith('/admin/site-settings/'))
    return ['config.manage'];
  return [];
}

function shouldAuditRequest(pathname, method, isApiPath) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (pathname.startsWith('/assets/') || pathname === '/favicon.ico') return false;
  if (pathname === '/api/auth/session' || pathname === '/api/auth/logout') return false;
  if (pathname.startsWith('/api/auth/discord/')) return false;
  if (isApiPath) {
    return normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD' && normalizedMethod !== 'OPTIONS';
  }
  // Disable page-view DB writes in middleware to avoid adding latency to every navigation.
  return false;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stripExistingBrandMeta(html) {
  if (!html) return html;
  return html
    .replace(/<meta\s+name=["']theme-color["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']icon["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']shortcut icon["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>\s*/gi, '');
}

function buildBrandMetaTags({ settings, requestUrl, title, description }) {
  const canonicalUrl = requestUrl.toString();
  const ogTitle = title || settings.ogTitle || FRONTIER_BRAND_NAME;
  const ogDescription = description || settings.ogDescription;
  const forcedBrandIcon = '/assets/brand/favicon.svg?v=20260325fix';
  const faviconUrl = toAbsoluteUrl(requestUrl.origin, forcedBrandIcon);
  const appleTouchIconUrl = faviconUrl;
  const ogImageUrl = toAbsoluteUrl(requestUrl.origin, settings.ogImageUrl);
  const twitterCard = settings.twitterCard || 'summary_large_image';
  const themeColor = settings.themeColor || '#112d72';
  return [
    `<meta name="theme-color" content="${escapeHtml(themeColor)}" />`,
    `<link rel="icon" type="image/svg+xml" href="${escapeHtml(faviconUrl)}" />`,
    `<link rel="shortcut icon" href="${escapeHtml(faviconUrl)}" />`,
    `<link rel="apple-touch-icon" href="${escapeHtml(appleTouchIconUrl)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(FRONTIER_BRAND_NAME)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(FRONTIER_BRAND_NAME)} preview" />`,
    `<meta name="twitter:card" content="${escapeHtml(twitterCard)}" />`,
    `<meta name="twitter:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(ogDescription)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />`
  ].join('\n');
}

function buildHeaderBrandMark(settings) {
  const logoUrl = '/assets/brand/frontierlogo.svg?v=20260325fix';
  return `<span class="brand-mark brand-mark-image" aria-hidden="true"><img src="${escapeHtml(logoUrl)}" alt="" loading="eager" decoding="async" /></span>`;
}

function applyHeaderBranding(html, settings) {
  if (!html) return html;
  const brandMark = buildHeaderBrandMark(settings);
  const brandText = escapeHtml(settings?.brandName || FRONTIER_BRAND_NAME);

  let next = html.replace(
    /<span([^>]*class=["'][^"']*\bbrand-mark\b[^"']*["'][^>]*)>[\s\S]*?<\/span>/gi,
    brandMark
  );

  next = next.replace(
    /<span([^>]*class=["'][^"']*\bbrand-text\b[^"']*["'][^>]*)>[\s\S]*?<\/span>/gi,
    `<span$1>${brandText}</span>`
  );
  return next;
}

async function applySiteBranding(env, request, response) {
  if (!response) return response;
  if (response.status < 200 || response.status >= 300) return response;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return response;

  const requestUrl = new URL(request.url);
  const settings = await readSiteSettings(env);
  const source = await response.text();
  const titleMatch = source.match(/<title>([^<]*)<\/title>/i);
  const descriptionMatch = source.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i);
  const title = titleMatch ? String(titleMatch[1] || '').trim() : settings.ogTitle;
  const description = descriptionMatch ? String(descriptionMatch[1] || '').trim() : settings.ogDescription;

  const stripped = stripExistingBrandMeta(source);
  const metaBlock = buildBrandMetaTags({ settings, requestUrl, title, description });
  const withMeta = stripped.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${metaBlock}\n`);
  const updated = applyHeaderBranding(withMeta, settings);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(updated, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
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
    const maintenanceDiscordUserId = String(
      context.env?.DISCORD_USER_ID || context.env?.MAINTENANCE_DISCORD_USER_ID || context.env?.ADMIN_DISCORD_USER_ID || ''
    ).trim();
    // Maintenance mode is currently disabled; keep env parsing for quick re-enable later.
    const maintenanceEnabled = false;
    const isApiPath = pathname.startsWith('/api/');
    const hasMaintenanceAccess = isLoggedIn && String(session?.userId || '').trim() === maintenanceDiscordUserId;
    if (maintenanceEnabled && !hasMaintenanceAccess) {
      if (isApiPath && !isMaintenanceBypassApiPath(pathname)) {
        return new Response(JSON.stringify({ error: 'Site is currently under maintenance.' }), {
          status: 503,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
      }
      if (!isApiPath && !isMaintenanceBypassPagePath(pathname)) {
        return Response.redirect(new URL('/maintenance', url.origin).toString(), 302);
      }
    }

    if (maintenanceEnabled && hasMaintenanceAccess && isMaintenancePath(pathname)) {
      return Response.redirect(new URL('/my-details', url.origin).toString(), 302);
    }

    const lifecycleStatus = isLoggedIn && !session?.isAdmin ? await getLiveLifecycleStatus(context.env, session) : 'ACTIVE';
    const requestMethod = String(context.request.method || 'GET').toUpperCase();
    if (isApiPath) {
      if (!isLoggedIn && !pathname.startsWith('/api/auth/')) {
        return new Response(JSON.stringify({ error: 'Authentication required.' }), {
          status: 401,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
      }

      if (isLoggedIn && !session?.isAdmin) {
        const isAuthApi = pathname.startsWith('/api/auth/');
        if (isRemovedLifecycle(lifecycleStatus) && !isAuthApi) {
          return new Response(JSON.stringify({ error: 'Account removed. Access denied.' }), {
            status: 403,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }
        if (isPendingLifecycle(lifecycleStatus) && !isAuthApi && !isOnboardingAllowedApiPath(pathname)) {
          return new Response(JSON.stringify({ error: 'Account is deactivated. Access setup required.' }), {
            status: 403,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }
        if (
          isSuspendedLifecycle(lifecycleStatus) &&
          !isAuthApi &&
          pathname !== '/api/me/details' &&
          pathname !== '/api/auth/session' &&
          pathname !== '/api/auth/logout'
        ) {
          return new Response(JSON.stringify({ error: 'Account suspended. Only My Details is available.' }), {
            status: 403,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }
      }

      if ((pathname === '/api/finances/overview' || pathname === '/api/finances/overview/') && requestMethod === 'GET') {
        const { onRequestGet } = await import('./api/finances/overview.js');
        const apiResponse = await onRequestGet(context);
        if (isLoggedIn) {
          context.waitUntil(
            logWebsiteAction(context.env, {
              session,
              pathname,
              method: requestMethod,
              responseStatus: apiResponse.status,
              isApiPath,
              metadata: { routedBy: 'middleware_finances_overview' }
            })
          );
        }
        return apiResponse;
      }
      if (pathname === '/api/admin/employees' || pathname === '/api/admin/employees/') {
        const { onRequestGet, onRequestPost } = await import('./api/admin/employees/index.js');
        const apiResponse = requestMethod === 'POST' ? await onRequestPost(context) : requestMethod === 'GET' ? await onRequestGet(context) : null;
        if (apiResponse) {
          if (isLoggedIn) {
            context.waitUntil(
              logWebsiteAction(context.env, {
                session,
                pathname,
                method: requestMethod,
                responseStatus: apiResponse.status,
                isApiPath,
                metadata: { routedBy: 'middleware_admin_employees' }
              })
            );
          }
          return apiResponse;
        }
      }
      if (coreOnlyMode && !isCoreAllowedApiPath(pathname)) {
        const blockedResponse = new Response(JSON.stringify({ error: 'Not found.' }), {
          status: 404,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
        if (isLoggedIn) {
          context.waitUntil(
            logWebsiteAction(context.env, {
              session,
              pathname,
              method: requestMethod,
              responseStatus: blockedResponse.status,
              isApiPath,
              metadata: { reason: 'core_api_blocked' }
            })
          );
        }
        return blockedResponse;
      }
      // Hard-route live notification writes here to avoid any Pages route-method ambiguity.
      if (
        (pathname === '/api/live-notify' || pathname === '/api/notifications/send' || pathname === '/api/notifications') &&
        (requestMethod === 'POST' || requestMethod === 'PUT' || requestMethod === 'PATCH')
      ) {
        const { onRequestPatch, onRequestPost, onRequestPut } = await import('./api/notifications/send.js');
        let apiResponse;
        if (requestMethod === 'PUT') apiResponse = await onRequestPut(context);
        else if (requestMethod === 'PATCH') apiResponse = await onRequestPatch(context);
        else apiResponse = await onRequestPost(context);
        if (isLoggedIn) {
          context.waitUntil(
            logWebsiteAction(context.env, {
              session,
              pathname,
              method: requestMethod,
              responseStatus: apiResponse.status,
              isApiPath,
              metadata: { routedBy: 'middleware_live_notifications' }
            })
          );
        }
        return apiResponse;
      }
      if (pathname === '/api/notifications/dismiss' && requestMethod === 'POST') {
        const { onRequestPost } = await import('./api/notifications/dismiss.js');
        const apiResponse = await onRequestPost(context);
        if (isLoggedIn) {
          context.waitUntil(
            logWebsiteAction(context.env, {
              session,
              pathname,
              method: requestMethod,
              responseStatus: apiResponse.status,
              isApiPath,
              metadata: { routedBy: 'middleware_live_notifications_dismiss' }
            })
          );
        }
        return apiResponse;
      }

      // Hard-route voyage cancel requests to avoid dynamic route ambiguity for [id] and [id]/cancel.
      const voyageCancelMatch = pathname.match(/^\/api\/voyages\/(\d+)(?:\/cancel)?$/);
      if (voyageCancelMatch && (requestMethod === 'POST' || requestMethod === 'DELETE')) {
        const voyageId = String(voyageCancelMatch[1] || '').trim();
        const { onRequestDelete, onRequestPost } = await import('./api/voyages/[id]/cancel.js');
        const voyageContext = {
          ...context,
          params: {
            ...(context.params || {}),
            id: voyageId
          }
        };
        const apiResponse = requestMethod === 'DELETE' ? await onRequestDelete(voyageContext) : await onRequestPost(voyageContext);
        if (isLoggedIn) {
          context.waitUntil(
            logWebsiteAction(context.env, {
              session,
              pathname,
              method: requestMethod,
              responseStatus: apiResponse.status,
              isApiPath,
              metadata: { routedBy: 'middleware_voyage_cancel' }
            })
          );
        }
        return apiResponse;
      }

      const apiResponse = await context.next();
      if (isLoggedIn) {
        context.waitUntil(
          logWebsiteAction(context.env, {
            session,
            pathname,
            method: requestMethod,
            responseStatus: apiResponse.status,
            isApiPath
          })
        );
      }
      return apiResponse;
    }

    if (pathname === '/dashboard') {
      return Response.redirect(new URL('/my-details', url.origin).toString(), 302);
    }

    if (pathname === '/intranet' || pathname === '/intranet.html') {
      return Response.redirect(new URL('/login', url.origin).toString(), 302);
    }

    if (pathname === '/' || pathname === '/index.html') {
      return Response.redirect(new URL('/login', url.origin).toString(), 302);
    }

    // Avoid Cloudflare extension canonicalization loops on auth-facing pages.
    if (pathname === '/login.html') return Response.redirect(new URL('/login', url.origin).toString(), 302);
    // Keep onboarding.html directly routable because _redirects may rewrite /onboarding -> /onboarding.html.
    if (pathname === '/not-permitted.html') return Response.redirect(new URL('/not-permitted', url.origin).toString(), 302);
    if (pathname === '/access-denied.html') return Response.redirect(new URL('/access-denied', url.origin).toString(), 302);

    const corePublicAllowedPaths = new Set([
      '/login',
      '/login.html',
      '/not-permitted',
      '/not-permitted.html',
      '/access-denied',
      '/access-denied.html'
    ]);
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
        return Response.redirect(new URL('/dashboard', url.origin).toString(), 302);
      }
      return context.next();
    }

    if (!isLoggedIn && !isPublicPagePath(pathname)) {
      return Response.redirect(toLoginRedirect(url), 302);
    }

    if (isLoggedIn && !session?.isAdmin) {
      if (isRemovedLifecycle(lifecycleStatus) && !isPublicPagePath(pathname)) {
        const denied = new URL('/access-denied', url.origin);
        denied.searchParams.set('reason', 'removed');
        return Response.redirect(denied.toString(), 302);
      }
      if (isPendingLifecycle(lifecycleStatus) && !isOnboardingPath(pathname)) {
        return Response.redirect(new URL('/onboarding', url.origin).toString(), 302);
      }
      if (isSuspendedLifecycle(lifecycleStatus) && !isMyDetailsPath(pathname) && !isPublicPagePath(pathname)) {
        const target = new URL('/my-details', url.origin);
        target.searchParams.set('auth', 'denied');
        target.searchParams.set('reason', 'suspended');
        return Response.redirect(target.toString(), 302);
      }
    }

    if (isLoggedIn && !session?.isAdmin) {
      const pagePermissionAny = requiredAnyPermissionsForPage(pathname);
      if (pagePermissionAny.length) {
        const sessionWithPermissions = await enrichSessionWithPermissions(context.env, session);
        const isAllowed = pagePermissionAny.some((permissionKey) => hasEffectivePermission(sessionWithPermissions, permissionKey));
        if (!isAllowed) {
          const denied = new URL('/access-denied', url.origin);
          denied.searchParams.set('reason', 'missing_permissions');
          denied.searchParams.set('from', pathname);
          return Response.redirect(denied.toString(), 302);
        }
      }
    }

    const pageResponse = await context.next();
    const noStorePages = isAdminLikePath(pathname) || pathname === '/admin-panel' || pathname === '/admin-panel.html';
    const securedPageResponse = noStorePages
      ? new Response(pageResponse.body, {
          status: pageResponse.status,
          statusText: pageResponse.statusText,
          headers: new Headers(pageResponse.headers)
        })
      : pageResponse;
    if (noStorePages) {
      securedPageResponse.headers.set('cache-control', 'no-store, no-cache, must-revalidate, private, max-age=0');
      securedPageResponse.headers.set('pragma', 'no-cache');
      securedPageResponse.headers.set('expires', '0');
    }
    const brandedPageResponse = await applySiteBranding(context.env, context.request, securedPageResponse);
    return brandedPageResponse;
  } catch {
    return context.next();
  }
}



