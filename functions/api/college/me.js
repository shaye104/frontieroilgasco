import { cachedJson, json } from '../auth/_lib/auth.js';
import { getCollegeOverview, requireCollegeSession } from '../_lib/college.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { errorResponse, employee } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const overview = await getCollegeOverview(env, employee);
  if (!overview) return json({ error: 'Unable to load college profile.' }, 500);

  return cachedJson(
    request,
    {
      ok: true,
      ...overview
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
