export async function onRequestGet(context) {
  const target = new URL('/admin/employees', context.request.url);
  return context.env.ASSETS.fetch(new Request(target.toString(), context.request));
}
