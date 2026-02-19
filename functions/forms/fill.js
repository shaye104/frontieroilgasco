export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const target = new URL('/form-fill.html', context.request.url);
  if (url.search) target.search = url.search;
  return context.env.ASSETS.fetch(new Request(target.toString(), context.request));
}
