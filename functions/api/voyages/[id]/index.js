import { cachedJson, json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { getVoyageBase, getVoyageDetail, requireVoyagePermission } from '../../_lib/voyages.js';

export async function onRequestGet(context) {
  const { params, request } = context;
  const { errorResponse, session, employee } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;
  const url = new URL(request.url);
  const includeSetup = url.searchParams.get('includeSetup') === '1';
  const includeManifest = url.searchParams.get('includeManifest') === '1';
  const includeLogs = url.searchParams.get('includeLogs') === '1';

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const detail = await getVoyageDetail(context.env, voyageId, { includeManifest, includeLogs });
  if (!detail) return json({ error: 'Voyage not found.' }, 404);

  const cargoLost = detail.voyage.cargo_lost_json ? JSON.parse(detail.voyage.cargo_lost_json) : [];
  const voyageSettlementLines = detail.voyage.settlement_lines_json ? JSON.parse(detail.voyage.settlement_lines_json) : [];
  const isOwner = Number(detail.voyage.owner_employee_id) === Number(employee.id);
  const [employees, ports, vesselNames, vesselClasses, vesselCallsigns, cargoTypes] = includeSetup
    ? await Promise.all([
        context.env.DB
          .prepare('SELECT id, roblox_username, serial_number, rank, grade FROM employees ORDER BY roblox_username ASC, id ASC')
          .all(),
        context.env.DB.prepare('SELECT id, value FROM config_voyage_ports ORDER BY value ASC, id ASC').all(),
        context.env.DB.prepare('SELECT id, value FROM config_vessel_names ORDER BY value ASC, id ASC').all(),
        context.env.DB.prepare('SELECT id, value FROM config_vessel_classes ORDER BY value ASC, id ASC').all(),
        context.env.DB.prepare('SELECT id, value FROM config_vessel_callsigns ORDER BY value ASC, id ASC').all(),
        context.env.DB.prepare('SELECT id, name, default_price FROM cargo_types WHERE active = 1 ORDER BY name ASC, id ASC').all()
      ])
    : [null, null, null, null, null, null];

  return cachedJson(
    request,
    {
      ...detail,
      cargoLost,
      voyageSettlementLines,
      isOwner,
      employees: employees?.results || [],
      voyageConfig: {
        ports: ports?.results || [],
        vesselNames: vesselNames?.results || [],
        vesselClasses: vesselClasses?.results || [],
        vesselCallsigns: vesselCallsigns?.results || [],
        cargoTypes: cargoTypes?.results || []
      },
      permissions: {
        canRead: hasPermission(session, 'voyages.read'),
        canEdit: hasPermission(session, 'voyages.edit') && isOwner && detail.voyage.status === 'ONGOING',
        canEnd: hasPermission(session, 'voyages.end') && isOwner && detail.voyage.status === 'ONGOING'
      },
      includes: {
        includeSetup,
        includeManifest,
        includeLogs
      }
    },
    { cacheControl: 'private, max-age=15, stale-while-revalidate=30' }
  );
}

export async function onRequestDelete(context) {
  return handleCancel(context);
}

async function handleCancel(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.end');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Only ongoing voyages can be cancelled.' }, 400);
  if (!hasPermission(session, 'voyages.end') || Number(voyage.owner_employee_id) !== Number(employee.id)) {
    return json({ error: 'Only voyage owner can cancel voyage.' }, 403);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM voyage_manifest_lines WHERE voyage_id = ?').bind(voyageId),
    env.DB.prepare('DELETE FROM voyage_logs WHERE voyage_id = ?').bind(voyageId),
    env.DB.prepare('DELETE FROM voyage_crew_members WHERE voyage_id = ?').bind(voyageId),
    env.DB.prepare('DELETE FROM voyages WHERE id = ?').bind(voyageId)
  ]);

  return json({ ok: true });
}

export async function onRequestPost(context) {
  let payload = null;
  try {
    payload = await context.request.json();
  } catch {
    payload = null;
  }

  const action = String(payload?.action || '').trim().toLowerCase();
  if (action !== 'cancel') {
    return json({ error: 'Unsupported action.' }, 405);
  }
  return handleCancel(context);
}
