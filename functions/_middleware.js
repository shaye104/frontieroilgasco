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
    '/voyages',
    '/voyage-tracker.html',
    '/voyage-details.html',
    '/my-fleet',
    '/my-fleet.html',
    '/forms',
    '/forms.html',
    '/form-fill.html',
    '/forms-config.html',
    '/forms-categories.html',
    '/forms-manage.html',
    '/forms-builder.html',
    '/forms-admin.html',
    '/forms-responses.html',
    '/admin',
    '/admin-panel.html',
    '/admin-config.html',
    '/cargo-admin.html',
    '/roles.html',
    '/manage-employees.html',
    '/employee-profile.html'
  ]);

  if (protectedPaths.has(pathname)) return true;
  if (pathname.startsWith('/voyages/')) return true;
  if (pathname.startsWith('/admin/')) return true;
  if (pathname.startsWith('/forms/')) return true;
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
      pathname === '/_redirects'
    ) {
      return context.next();
    }

    const session = await readSessionFromRequest(context.env, context.request);
    const isLoggedIn = Boolean(session);

    if (pathname === '/dashboard') {
      return Response.redirect(new URL('/my-details.html', url.origin).toString(), 302);
    }

    if (isLoggedIn && (pathname === '/' || pathname === '/index.html')) {
      return Response.redirect(new URL('/my-details.html', url.origin).toString(), 302);
    }

    if (!isLoggedIn && isProtectedPath(pathname)) {
      return Response.redirect(toLoginRedirect(url), 302);
    }

    return context.next();
  } catch {
    return context.next();
  }
}
