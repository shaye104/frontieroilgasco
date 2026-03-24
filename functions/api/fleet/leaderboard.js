import { json } from '../auth/_lib/auth.js';
import { parseSettlementLines, resolveVoyageEarnings, toMoney } from '../_lib/finances.js';
import { hasPermission } from '../_lib/permissions.js';
import { requireVoyagePermission } from '../_lib/voyages.js';

async function hasTable(env, tableName) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(String(tableName || '').trim())
    .first();
  return Boolean(row?.name);
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse, session } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const [shipsRows, voyageShipRows, assignmentsRows, vesselVoyageRows, unassignedRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, ship_name, vessel_callsign, vessel_type, vessel_class
         FROM shipyard_ships
         WHERE is_active = 1
         ORDER BY LOWER(ship_name) ASC, LOWER(vessel_callsign) ASC, id ASC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT DISTINCT
           TRIM(COALESCE(v.vessel_name, '')) AS ship_name,
           TRIM(COALESCE(v.vessel_callsign, '')) AS vessel_callsign,
           'Freight' AS vessel_type,
           TRIM(COALESCE(v.vessel_class, '')) AS vessel_class
         FROM voyages v
         WHERE TRIM(COALESCE(v.vessel_name, '')) <> ''
           AND TRIM(COALESCE(v.vessel_class, '')) <> ''
         ORDER BY LOWER(TRIM(COALESCE(v.vessel_name, ''))) ASC, LOWER(TRIM(COALESCE(v.vessel_callsign, ''))) ASC`
      )
      .all(),
    env.DB
      .prepare(
        `WITH active_assignments AS (
           SELECT eva.employee_id, eva.ship_id, eva.vessel_name, eva.vessel_class, eva.assigned_at
           FROM employee_vessel_assignments eva
           WHERE eva.ended_at IS NULL
         ),
         participant_counts AS (
           SELECT voyage_id, COUNT(DISTINCT employee_id) AS participant_count
           FROM voyage_participants
           GROUP BY voyage_id
         )
         SELECT
           e.id AS employee_id,
           e.roblox_username,
           e.roblox_user_id,
           e.rank,
           e.employee_status,
           aa.ship_id,
           aa.vessel_name,
           aa.vessel_class,
           aa.vessel_callsign,
           aa.assigned_at,
           COUNT(DISTINCT CASE WHEN v.deleted_at IS NULL AND v.status = 'ENDED' THEN v.id END) AS voyage_count,
           ROUND(
             COALESCE(
               SUM(
                 CASE
                   WHEN v.deleted_at IS NULL AND v.status = 'ENDED'
                   THEN COALESCE(v.profit, 0) / CASE WHEN COALESCE(pc.participant_count, 0) > 0 THEN pc.participant_count ELSE 1 END
                   ELSE 0
                 END
               ),
               0
             )
           ) AS earned_total
         FROM active_assignments aa
         INNER JOIN employees e ON e.id = aa.employee_id
         LEFT JOIN voyage_participants vp ON vp.employee_id = e.id
         LEFT JOIN voyages v
          ON v.id = vp.voyage_id
          AND LOWER(COALESCE(v.vessel_name, '')) = LOWER(COALESCE(aa.vessel_name, ''))
          AND LOWER(COALESCE(v.vessel_class, '')) = LOWER(COALESCE(aa.vessel_class, ''))
          AND LOWER(COALESCE(v.vessel_callsign, '')) = LOWER(COALESCE(aa.vessel_callsign, ''))
         LEFT JOIN participant_counts pc ON pc.voyage_id = v.id
         GROUP BY e.id, e.roblox_username, e.roblox_user_id, e.rank, e.employee_status, aa.ship_id, aa.vessel_name, aa.vessel_class, aa.vessel_callsign, aa.assigned_at
         ORDER BY aa.ship_id ASC, LOWER(COALESCE(aa.vessel_name, '')) ASC, earned_total DESC, LOWER(COALESCE(e.roblox_username, '')) ASC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT
           v.vessel_name,
           v.vessel_class,
           v.vessel_callsign,
           v.settlement_lines_json,
           v.profit
         FROM voyages v
         WHERE v.deleted_at IS NULL AND v.status = 'ENDED'`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT e.id, e.roblox_username, e.roblox_user_id, e.rank, e.employee_status
         FROM employees e
         WHERE NOT EXISTS (
           SELECT 1
           FROM employee_vessel_assignments eva
           WHERE eva.employee_id = e.id AND eva.ended_at IS NULL
         )
         ORDER BY LOWER(COALESCE(e.roblox_username, '')) ASC, e.id ASC`
      )
      .all()
  ]);

  const shipsCatalogBase = shipsRows?.results || [];
  const voyageShipCatalog = voyageShipRows?.results || [];
  const shipIdentity = new Set();
  const shipsCatalog = [];
  shipsCatalogBase.forEach((ship) => {
    const key = `${String(ship.ship_name || '').trim().toLowerCase()}::${String(ship.vessel_callsign || '')
      .trim()
      .toLowerCase()}::${String(ship.vessel_class || '')
      .trim()
      .toLowerCase()}`;
    if (!key || shipIdentity.has(key)) return;
    shipIdentity.add(key);
    shipsCatalog.push(ship);
  });
  voyageShipCatalog.forEach((ship, index) => {
    const key = `${String(ship.ship_name || '').trim().toLowerCase()}::${String(ship.vessel_callsign || '')
      .trim()
      .toLowerCase()}::${String(ship.vessel_class || '')
      .trim()
      .toLowerCase()}`;
    if (!key || shipIdentity.has(key)) return;
    shipIdentity.add(key);
    shipsCatalog.push({
      id: `voyage-${index + 1}`,
      ship_name: ship.ship_name,
      vessel_callsign: ship.vessel_callsign,
      vessel_type: ship.vessel_type || 'Freight',
      vessel_class: ship.vessel_class
    });
  });
  const assignedEmployees = assignmentsRows?.results || [];
  const vesselVoyages = vesselVoyageRows?.results || [];
  const vesselTotals = new Map();

  vesselVoyages.forEach((row) => {
    const vesselName = String(row.vessel_name || '').trim();
    const vesselClass = String(row.vessel_class || '').trim();
    const vesselCallsign = String(row.vessel_callsign || '').trim();
    const key = `${vesselName.toLowerCase()}::${vesselCallsign.toLowerCase()}::${vesselClass.toLowerCase()}`;
    if (!vesselTotals.has(key)) {
      vesselTotals.set(key, { totalVoyages: 0, totalEarnings: 0 });
    }
    const bucket = vesselTotals.get(key);
    bucket.totalVoyages += 1;

    const lines = parseSettlementLines(row.settlement_lines_json);
    const voyageEarnings = resolveVoyageEarnings(row, lines);
    bucket.totalEarnings = toMoney(bucket.totalEarnings + voyageEarnings);
  });
  const byShip = new Map();

  shipsCatalog.forEach((ship) => {
    const numericId = Number(ship.id);
    const key = Number.isInteger(numericId) && numericId > 0 ? numericId : `catalog:${String(ship.ship_name || '').toLowerCase()}::${String(
      ship.vessel_callsign || ''
    ).toLowerCase()}::${String(ship.vessel_class || '').toLowerCase()}`;
    const lookupKey = `${String(ship.ship_name || '').toLowerCase()}::${String(ship.vessel_callsign || '').toLowerCase()}::${String(ship.vessel_class || '').toLowerCase()}`;
    const total = vesselTotals.get(lookupKey);
    byShip.set(key, {
      shipId: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
      vesselName: ship.ship_name,
      vesselCallsign: ship.vessel_callsign,
      vesselType: ship.vessel_type || 'Freight',
      vesselClass: ship.vessel_class,
      shipTotalProfit: Number(total?.totalEarnings || 0),
      shipTotalVoyages: Number(total?.totalVoyages || 0),
      employees: []
    });
  });

  assignedEmployees.forEach((row) => {
    const shipId = Number(row.ship_id || 0);
    const fallbackKey =
      shipId > 0
        ? shipId
        : `legacy:${String(row.vessel_name || '').toLowerCase()}::${String(row.vessel_callsign || '').toLowerCase()}::${String(row.vessel_class || '').toLowerCase()}`;
    if (!byShip.has(fallbackKey)) {
      const lookupKey = `${String(row.vessel_name || '').toLowerCase()}::${String(row.vessel_callsign || '').toLowerCase()}::${String(row.vessel_class || '').toLowerCase()}`;
      const total = vesselTotals.get(lookupKey);
      byShip.set(fallbackKey, {
        shipId: shipId > 0 ? shipId : null,
        vesselName: row.vessel_name,
        vesselCallsign: row.vessel_callsign || row.vessel_name,
        vesselType: 'Freight',
        vesselClass: row.vessel_class,
        shipTotalProfit: Number(total?.totalEarnings || 0),
        shipTotalVoyages: Number(total?.totalVoyages || 0),
        employees: []
      });
    }
    byShip.get(fallbackKey).employees.push({
      employeeId: Number(row.employee_id),
      robloxUsername: row.roblox_username,
      robloxUserId: row.roblox_user_id,
      rank: row.rank,
      employeeStatus: row.employee_status,
      voyageCount: Number(row.voyage_count || 0),
      earnedTotal: Number(row.earned_total || 0),
      assignedAt: row.assigned_at
    });
  });

  const ships = [...byShip.values()].sort((a, b) => b.shipTotalProfit - a.shipTotalProfit || String(a.vesselName || '').localeCompare(String(b.vesselName || '')));
  const canUseLegacyFleet = (await hasTable(env, 'legacy_voyage_history')) && (await hasTable(env, 'legacy_voyage_salaries'));
  if (canUseLegacyFleet) {
    const [legacyHistoryRowsResult, legacySalaryRowsResult] = await Promise.all([
      env.DB
        .prepare(
          `SELECT voyage_id, revenue_florins
           FROM legacy_voyage_history
           WHERE status IN ('COMPLETED', 'CANCELLED')`
        )
        .all(),
      env.DB
        .prepare(
          `SELECT recipient_username, voyage_id, salary_florins
           FROM legacy_voyage_salaries`
        )
        .all()
    ]);

    const legacyHistoryRows = legacyHistoryRowsResult?.results || [];
    const legacySalaryRows = legacySalaryRowsResult?.results || [];
    if (legacyHistoryRows.length || legacySalaryRows.length) {
      const crewByName = new Map();
      legacySalaryRows.forEach((row) => {
        const username = String(row.recipient_username || '').trim();
        if (!username) return;
        if (!crewByName.has(username.toLowerCase())) {
          crewByName.set(username.toLowerCase(), {
            employeeId: 0,
            robloxUsername: username,
            robloxUserId: '',
            rank: 'Legacy',
            employeeStatus: 'Legacy',
            voyageIds: new Set(),
            earnedTotal: 0,
            assignedAt: null
          });
        }
        const entry = crewByName.get(username.toLowerCase());
        const voyageId = Number(row.voyage_id || 0);
        if (voyageId > 0) entry.voyageIds.add(voyageId);
        entry.earnedTotal = toMoney(entry.earnedTotal + Number(row.salary_florins || 0));
      });

      const legacyShip = {
        shipId: -1,
        vesselName: 'Legacy Archive',
        vesselClass: 'LEGACY',
        shipTotalProfit: toMoney(legacyHistoryRows.reduce((sum, row) => sum + Number(row.revenue_florins || 0), 0)),
        shipTotalVoyages: legacyHistoryRows.length,
        employees: [...crewByName.values()]
          .map((entry) => ({
            employeeId: entry.employeeId,
            robloxUsername: entry.robloxUsername,
            robloxUserId: entry.robloxUserId,
            rank: entry.rank,
            employeeStatus: entry.employeeStatus,
            voyageCount: entry.voyageIds.size,
            earnedTotal: entry.earnedTotal,
            assignedAt: entry.assignedAt
          }))
          .sort((a, b) => Number(b.earnedTotal || 0) - Number(a.earnedTotal || 0) || String(a.robloxUsername || '').localeCompare(String(b.robloxUsername || '')))
      };
      ships.push(legacyShip);
    }
  }

  const totalEmployeesAssigned = ships.reduce((sum, ship) => sum + Number((ship?.employees || []).length), 0);
  const totalShips = ships.length;
  const fleetTotalProfit = ships.reduce((sum, ship) => sum + Number(ship.shipTotalProfit || 0), 0);

  return json({
    ships,
    unassignedEmployees: unassignedRows?.results || [],
    totals: {
      totalShips,
      totalEmployeesAssigned,
      fleetTotalProfit
    },
    permissions: {
      canViewEmployeeDrawer: hasPermission(session, 'employees.read'),
      canManageAssignments: hasPermission(session, 'employees.edit')
    }
  });
}

