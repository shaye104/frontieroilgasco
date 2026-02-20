import { json } from '../auth/_lib/auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { getVoyageDetail, requireVoyagePermission } from '../_lib/voyages.js';

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

  return json({
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
  });
}
