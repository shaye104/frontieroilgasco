import { readSessionFromRequest } from './api/auth/_lib/auth.js';

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
  return false;
}

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const pathname = normalizePath(url.pathname);

    if (
      pathname.startsWith('/api/') ||
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

    if (pathname === '/dashboard') {
      return Response.redirect(new URL('/my-details', url.origin).toString(), 302);
    }

    if (pathname === '/intranet' || pathname === '/intranet.html') {
      return Response.redirect(new URL('/login', url.origin).toString(), 302);
    }

    if (pathname === '/login' || pathname === '/login.html') {
      if (url.searchParams.has('auth') || url.searchParams.has('reason')) {
        return context.next();
      }
      if (isLoggedIn) {
        return Response.redirect(new URL('/my-details', url.origin).toString(), 302);
      }
      return context.next();
    }

    if (isLoggedIn && (pathname === '/' || pathname === '/index.html')) {
      return Response.redirect(new URL('/my-details', url.origin).toString(), 302);
    }

    if (!isLoggedIn && isProtectedPath(pathname)) {
      return Response.redirect(toLoginRedirect(url), 302);
    }

    return context.next();
  } catch {
    return context.next();
  }
}
