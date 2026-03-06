import { readSessionFromRequest } from './api/auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from './api/_lib/db.js';
import { isCoreAllowedApiPath, isCoreAllowedPagePath, isCoreOnly } from './api/_lib/app-mode.js';
import { readSiteSettings, toAbsoluteUrl } from './api/_lib/site-settings.js';

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
    '/site-settings',
    '/site-settings.html',
    '/manage-employees',
    '/manage-employees.html',
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
    '/audit-log',
    '/audit-log.html',
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
  const ogTitle = title || settings.ogTitle || settings.brandName;
  const ogDescription = description || settings.ogDescription;
  const faviconUrl = toAbsoluteUrl(requestUrl.origin, settings.faviconUrl);
  const appleTouchIconUrl = toAbsoluteUrl(requestUrl.origin, settings.appleTouchIconUrl || settings.faviconUrl);
  const ogImageUrl = toAbsoluteUrl(requestUrl.origin, settings.ogImageUrl);
  const twitterCard = settings.twitterCard || 'summary_large_image';
  const themeColor = settings.themeColor || '#112d72';
  return [
    `<meta name="theme-color" content="${escapeHtml(themeColor)}" />`,
    `<link rel="icon" type="image/svg+xml" href="${escapeHtml(faviconUrl)}" />`,
    `<link rel="shortcut icon" href="${escapeHtml(faviconUrl)}" />`,
    `<link rel="apple-touch-icon" href="${escapeHtml(appleTouchIconUrl)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(settings.brandName)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(settings.brandName)} preview" />`,
    `<meta name="twitter:card" content="${escapeHtml(twitterCard)}" />`,
    `<meta name="twitter:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(ogDescription)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />`
  ].join('\n');
}

function buildHeaderBrandMark(settings) {
  const headerLogoUrl = toAbsoluteUrl('', settings.headerLogoUrl, '');
  if (headerLogoUrl) {
    return `<span class="brand-mark brand-mark-image" aria-hidden="true"><img src="${escapeHtml(headerLogoUrl)}" alt="" loading="eager" decoding="async" /></span>`;
  }
  return `<span class="brand-mark" aria-hidden="true">FOG</span>`;
}

function applyHeaderBranding(html, settings) {
  if (!html) return html;
  const brandName = escapeHtml(settings.brandName || 'Frontier Oil & Gas Company');
  const brandMark = buildHeaderBrandMark(settings);

  let next = html.replace(
    /<span([^>]*class=["'][^"']*\bbrand-mark\b[^"']*["'][^>]*)>[\s\S]*?<\/span>/gi,
    brandMark
  );

  next = next.replace(
    /<span([^>]*class=["'][^"']*\bbrand-text\b[^"']*["'][^>]*)>[\s\S]*?<\/span>/gi,
    `<span$1>${brandName}</span>`
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
      if (isPendingActivation) {
        const allowApi = pathname.startsWith('/api/auth/') || isOnboardingAllowedApiPath(pathname);
        if (!allowApi) {
          return new Response(JSON.stringify({ error: 'Account pending activation.' }), {
            status: 403,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }
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
    if (pathname === '/onboarding.html') return Response.redirect(new URL('/onboarding', url.origin).toString(), 302);
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
        const activationStatus = await getLiveActivationStatus(context.env, session);
        let redirectPath = '/dashboard';
        if (!session?.isAdmin && activationStatus === 'PENDING') redirectPath = '/onboarding';
        if (!session?.isAdmin && (activationStatus === 'REJECTED' || activationStatus === 'DISABLED' || activationStatus === 'NONE')) {
          redirectPath = '/not-permitted';
        }
        return Response.redirect(new URL(redirectPath, url.origin).toString(), 302);
      }
      return context.next();
    }

    if (!isLoggedIn && !isPublicPagePath(pathname)) {
      return Response.redirect(toLoginRedirect(url), 302);
    }

    if (isLoggedIn && !session.isAdmin) {
      const activationStatus = await getLiveActivationStatus(context.env, session);
      if (activationStatus !== 'ACTIVE' && !isOnboardingPath(pathname) && !isPublicPagePath(pathname)) {
        const redirectPath = activationStatus === 'PENDING' ? '/onboarding' : '/not-permitted';
        return Response.redirect(new URL(redirectPath, url.origin).toString(), 302);
      }
      if (activationStatus === 'ACTIVE' && isOnboardingPath(pathname)) {
        return Response.redirect(toDashboardRedirect(url), 302);
      }
    }

    const pageResponse = await context.next();
    const brandedPageResponse = await applySiteBranding(context.env, context.request, pageResponse);
    return brandedPageResponse;
  } catch {
    return context.next();
  }
}
