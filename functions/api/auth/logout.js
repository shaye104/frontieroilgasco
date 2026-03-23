import { serializeCookie } from './_lib/auth.js';

export async function onRequest() {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append(
    'Set-Cookie',
    serializeCookie('fog_session', '', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 0
    })
  );

  return new Response(JSON.stringify({ loggedOut: true }), { status: 200, headers });
}
