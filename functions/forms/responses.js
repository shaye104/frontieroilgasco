export async function onRequestGet(context) {
  const target = new URL('/forms-responses.html', context.request.url);
  return context.env.ASSETS.fetch(new Request(target.toString(), context.request));
}
