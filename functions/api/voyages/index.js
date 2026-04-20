import { cachedJson, json } from '../auth/_lib/auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { canManageVoyage, requireVoyagePermission, syncVoyageParticipants } from '../_lib/voyages.js';
import { getEmployeeActiveVesselAssignment } from '../_lib/db.js';
import { ensureShipReservationTables, getActiveReservationForStart, purgeExpiredShipReservations, releaseShipReservation } from '../_lib/ship-reservations.js';

function text(value) {
  return String(value || '').trim();
}

function isLegacyStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  return status === 'CANCELLED' || status === 'COMPLETED';
}

function legacyStatusToVoyageStatus(value) {
  return String(value || '').trim().toUpperCase() === 'CANCELLED' ? 'CANCELLED' : 'ENDED';
}

function toLegacyEndedAt(recordDate, etdTime) {
  const date = text(recordDate);
  if (!date) return null;
  const time = text(etdTime) || '00:00';
  return `${date}T${time}:00.000Z`;
}

function archivedSortValue(voyage) {
  const stamp = String(voyage?.ended_at || voyage?.started_at || voyage?.created_at || '').trim();
  if (!stamp) return 0;
  const millis = Date.parse(stamp);
  return Number.isFinite(millis) ? millis : 0;
}

function compareArchive(a, b) {
  const delta = archivedSortValue(b) - archivedSortValue(a);
  if (delta !== 0) return delta;
  return Number(b?.id || 0) - Number(a?.id || 0);
}

function compareVoyageList(a, b) {
  const aOngoing = String(a?.status || '').toUpperCase() === 'ONGOING';
  const bOngoing = String(b?.status || '').toUpperCase() === 'ONGOING';
  if (aOngoing !== bOngoing) return aOngoing ? -1 : 1;
  if (!aOngoing && !bOngoing) return compareArchive(a, b);
  const aStarted = Date.parse(String(a?.started_at || a?.created_at || '').trim());
  const bStarted = Date.parse(String(b?.started_at || b?.created_at || '').trim());
  const safeA = Number.isFinite(aStarted) ? aStarted : 0;
  const safeB = Number.isFinite(bStarted) ? bStarted : 0;
  if (safeA !== safeB) return safeB - safeA;
  return Number(b?.id || 0) - Number(a?.id || 0);
}

async function hasLegacyHistoryTable(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_voyage_history'")
    .first();
  return Boolean(row?.name);
}

async function listLegacyArchiveVoyages(env) {
  if (!(await hasLegacyHistoryTable(env))) return [];
  const rowsResult = await env.DB
    .prepare(
      `SELECT
         id,
         source_row,
         record_date,
         etd_time,
         voyage_id,
         skipper_username,
         arrival_port,
         status,
         revenue_florins,
         profit_florins
       FROM legacy_voyage_history
       WHERE status IN ('COMPLETED', 'CANCELLED')
       ORDER BY record_date DESC, etd_time DESC, voyage_id DESC, id DESC`
    )
    .all();
  const rows = rowsResult?.results || [];
  return rows
    .filter((row) => isLegacyStatus(row.status))
    .map((row) => {
      const voyageId = Number(row.voyage_id || 0);
      const endedAt = toLegacyEndedAt(row.record_date, row.etd_time);
      return {
        id: Number(row.id || 0) * -1,
        status: legacyStatusToVoyageStatus(row.status),
        ship_status: 'IN_PORT',
        owner_employee_id: 0,
        departure_port: text(row.arrival_port) || 'Unknown',
        destination_port: text(row.arrival_port) || 'Unknown',
        vessel_name: `Legacy Voyage #${voyageId > 0 ? voyageId : Number(row.source_row || 0)}`,
        vessel_class: 'LEGACY',
        vessel_callsign: `LEGACY-${voyageId > 0 ? voyageId : Number(row.id || 0)}`,
        officer_of_watch_employee_id: 0,
        started_at: endedAt,
        ended_at: endedAt,
        buy_total: null,
        effective_sell: Number(row.revenue_florins || 0),
        profit: Number(row.profit_florins || 0),
        company_share: Math.round(Number(row.profit_florins || 0) * 0.1),
        officer_name: text(row.skipper_username) || 'Legacy',
        owner_name: text(row.skipper_username) || 'Legacy',
        isLegacy: true,
        canDeleteVoyage: false
      };
    });
}

function asEmployeeIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

async function listConfigValues(env, tableName) {
  const rows = await env.DB.prepare(`SELECT id, value FROM ${tableName} ORDER BY value ASC, id ASC`).all();
  return rows?.results || [];
}

async function listFishTypes(env) {
  const rows = await env.DB
    .prepare('SELECT id, name, unit_price FROM config_fish_types WHERE active = 1 ORDER BY name ASC, id ASC')
    .all();
  return rows?.results || [];
}

async function listSellLocations(env) {
  const rows = await env.DB
    .prepare('SELECT id, name, multiplier, linked_port FROM config_sell_locations WHERE active = 1 ORDER BY name ASC, id ASC')
    .all();
  return rows?.results || [];
}

async function getRandomAvailableShip(env) {
  const row = await env.DB
    .prepare(
      `SELECT
         s.id,
         s.ship_name,
         s.vessel_class,
         s.vessel_callsign
       FROM shipyard_ships s
       WHERE COALESCE(s.is_active, 1) = 1
         AND TRIM(COALESCE(s.ship_name, '')) <> ''
         AND TRIM(COALESCE(s.vessel_class, '')) <> ''
         AND TRIM(COALESCE(s.vessel_callsign, '')) <> ''
         AND NOT EXISTS (
           SELECT 1
           FROM voyages v
           WHERE v.deleted_at IS NULL
             AND v.status = 'ONGOING'
             AND LOWER(COALESCE(v.vessel_callsign, '')) = LOWER(COALESCE(s.vessel_callsign, ''))
         )
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .first();
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    vessel_name: text(row.ship_name),
    vessel_class: text(row.vessel_class),
    vessel_callsign: text(row.vessel_callsign)
  };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session, employee } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const includeSetup = url.searchParams.get('includeSetup') === '1';
  const overviewMode = url.searchParams.get('overview') === '1';
  const archivedLimit = Math.min(24, Math.max(1, Number(url.searchParams.get('archivedLimit')) || 8));
  const baseSelect = `SELECT v.id, v.status, v.ship_status, v.owner_employee_id, v.departure_port, v.destination_port, v.vessel_name, v.vessel_class, v.vessel_callsign,
                             v.officer_of_watch_employee_id, v.started_at, v.ended_at, v.buy_total, v.effective_sell, v.profit, v.company_share,
                             ow.roblox_username AS officer_name,
                             owner.roblox_username AS owner_name
                      FROM voyages v
                      LEFT JOIN employees ow ON ow.id = v.officer_of_watch_employee_id
                      LEFT JOIN employees owner ON owner.id = v.owner_employee_id`;

  if (overviewMode) {
    const [ongoingRows, archivedRows, countRows, legacyArchived] = await Promise.all([
      env.DB
        .prepare(
          `${baseSelect}
           WHERE v.deleted_at IS NULL AND v.status = 'ONGOING'
           ORDER BY COALESCE(v.started_at, v.created_at) DESC, v.id DESC`
        )
        .all(),
      env.DB
        .prepare(
          `${baseSelect}
           WHERE v.deleted_at IS NULL AND v.status IN ('ENDED', 'CANCELLED')
           ORDER BY COALESCE(v.ended_at, v.started_at, v.created_at) DESC, v.id DESC
           LIMIT ?`
        )
        .bind(archivedLimit)
        .all(),
      env.DB.prepare(`SELECT status, COUNT(*) AS total FROM voyages WHERE deleted_at IS NULL GROUP BY status`).all(),
      listLegacyArchiveVoyages(env)
    ]);

    const toView = (voyage) => ({
      ...voyage,
      isOwner: Number(voyage.owner_employee_id) === Number(employee.id),
      isOngoing: String(voyage.status) === 'ONGOING',
      canDeleteVoyage: canManageVoyage(session, employee, voyage, 'voyages.delete')
    });

    const ongoing = (ongoingRows?.results || []).map(toView);
    const archivedCurrent = (archivedRows?.results || []).map(toView);
    const archived = [...archivedCurrent, ...legacyArchived].sort(compareArchive).slice(0, archivedLimit);
    const counts = { ongoing: 0, archived: 0 };
    (countRows?.results || []).forEach((row) => {
      const total = Number(row.total || 0);
      if (String(row.status) === 'ONGOING') counts.ongoing = total;
      if (String(row.status) === 'ENDED' || String(row.status) === 'CANCELLED') counts.archived += total;
    });
    counts.archived += legacyArchived.length;

    const [employees, ports, fishTypes, sellLocations, suggestedShip] = includeSetup
      ? await Promise.all([
          hasPermission(session, 'voyages.create')
            ? (
                await env.DB
                  .prepare(
                    'SELECT id, roblox_username, serial_number, rank, grade FROM employees ORDER BY roblox_username ASC, id ASC'
                  )
                  .all()
              )?.results || []
            : [],
          listConfigValues(env, 'config_voyage_ports'),
          listFishTypes(env),
          listSellLocations(env),
          getRandomAvailableShip(env)
      ])
      : [[], [], [], [], null];
    const myVesselAssignment = includeSetup ? await getEmployeeActiveVesselAssignment(env, employee.id) : null;

    return cachedJson(
      request,
      {
        ongoing,
        archived,
        counts,
        currentEmployee: {
          id: Number(employee.id),
          robloxUsername: text(employee.roblox_username)
        },
        employees,
        voyageConfig: {
          ports,
          fishTypes,
          sellLocations,
          cargoTypes: fishTypes.map((row) => ({ id: row.id, name: row.name, default_price: row.unit_price })),
          vesselNames: [],
          vesselClasses: [],
          vesselCallsigns: []
        },
        myVesselAssignment,
        suggestedShip,
        permissions: {
          canCreate: hasPermission(session, 'voyages.create'),
          canEdit: hasPermission(session, 'voyages.edit'),
          canEnd: hasPermission(session, 'voyages.end'),
          canDelete: hasPermission(session, 'voyages.delete')
        }
      },
      { cacheControl: 'private, no-store' }
    );
  }

  const statusFilterRaw = String(url.searchParams.get('status') || '').trim().toUpperCase();
  const statusFilter =
    statusFilterRaw === 'ONGOING' ||
    statusFilterRaw === 'ENDED' ||
    statusFilterRaw === 'CANCELLED' ||
    statusFilterRaw === 'PAST'
      ? statusFilterRaw
      : '';
  const hasPaging = url.searchParams.has('page') || url.searchParams.has('pageSize') || Boolean(statusFilter);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
  const offset = (page - 1) * pageSize;

  let whereSql = 'WHERE v.deleted_at IS NULL';
  const whereBindings = [];
  if (statusFilter) {
    if (statusFilter === 'PAST') {
      whereSql += " AND v.status IN ('ENDED', 'CANCELLED')";
    } else {
      whereSql += ' AND v.status = ?';
      whereBindings.push(statusFilter);
    }
  }
  const orderSql =
    statusFilter === 'ONGOING'
      ? 'ORDER BY COALESCE(v.started_at, v.created_at) DESC, v.id DESC'
      : statusFilter === 'ENDED' || statusFilter === 'CANCELLED' || statusFilter === 'PAST'
      ? 'ORDER BY COALESCE(v.ended_at, v.started_at, v.created_at) DESC, v.id DESC'
      : "ORDER BY CASE WHEN v.status = 'ONGOING' THEN 0 ELSE 1 END, COALESCE(v.started_at, v.created_at) DESC, v.id DESC";

  const includeLegacyArchive = statusFilter !== 'ONGOING' && (await hasLegacyHistoryTable(env));
  let voyages = [];
  let total = 0;

  if (includeLegacyArchive) {
    const [allCurrentRows, legacyArchived] = await Promise.all([
      env.DB
        .prepare(
          `SELECT v.id, v.status, v.ship_status, v.owner_employee_id, v.departure_port, v.destination_port, v.vessel_name, v.vessel_class, v.vessel_callsign,
                  v.officer_of_watch_employee_id, v.started_at, v.ended_at, v.buy_total, v.effective_sell, v.profit, v.company_share,
                  ow.roblox_username AS officer_name,
                  owner.roblox_username AS owner_name
           FROM voyages v
           LEFT JOIN employees ow ON ow.id = v.officer_of_watch_employee_id
           LEFT JOIN employees owner ON owner.id = v.owner_employee_id
           ${whereSql}
           ${orderSql}`
        )
        .bind(...whereBindings)
        .all(),
      listLegacyArchiveVoyages(env)
    ]);

    const mappedCurrent = (allCurrentRows?.results || []).map((voyage) => ({
      ...voyage,
      isOwner: Number(voyage.owner_employee_id) === Number(employee.id),
      isOngoing: String(voyage.status) === 'ONGOING',
      canDeleteVoyage: canManageVoyage(session, employee, voyage, 'voyages.delete')
    }));

    const legacyFiltered =
      statusFilter === 'ENDED'
        ? legacyArchived.filter((row) => String(row.status) === 'ENDED')
        : statusFilter === 'CANCELLED'
        ? legacyArchived.filter((row) => String(row.status) === 'CANCELLED')
        : statusFilter === 'PAST' || !statusFilter
        ? legacyArchived
        : [];

    const combined = [...mappedCurrent, ...legacyFiltered].sort(compareVoyageList);
    total = combined.length;
    voyages = hasPaging ? combined.slice(offset, offset + pageSize) : combined;
  } else {
    const rows = await env.DB
      .prepare(
        `SELECT v.id, v.status, v.ship_status, v.owner_employee_id, v.departure_port, v.destination_port, v.vessel_name, v.vessel_class, v.vessel_callsign,
                v.officer_of_watch_employee_id, v.started_at, v.ended_at, v.buy_total, v.effective_sell, v.profit, v.company_share,
                ow.roblox_username AS officer_name,
                owner.roblox_username AS owner_name
         FROM voyages v
         LEFT JOIN employees ow ON ow.id = v.officer_of_watch_employee_id
         LEFT JOIN employees owner ON owner.id = v.owner_employee_id
         ${whereSql}
         ${orderSql}
         ${hasPaging ? 'LIMIT ? OFFSET ?' : ''}`
      )
      .bind(...whereBindings, ...(hasPaging ? [pageSize, offset] : []))
      .all();

    const totalRow = await env.DB
      .prepare(`SELECT COUNT(*) AS total FROM voyages v ${whereSql}`)
      .bind(...whereBindings)
      .first();
    total = Number(totalRow?.total || 0);

    voyages = (rows?.results || []).map((voyage) => ({
      ...voyage,
      isOwner: Number(voyage.owner_employee_id) === Number(employee.id),
      isOngoing: String(voyage.status) === 'ONGOING',
      canDeleteVoyage: canManageVoyage(session, employee, voyage, 'voyages.delete')
    }));
  }

  const [employees, ports, fishTypes, sellLocations] = includeSetup
    ? await Promise.all([
        hasPermission(session, 'voyages.create')
          ? (
              await env.DB
                .prepare(
                  'SELECT id, roblox_username, serial_number, rank, grade FROM employees ORDER BY roblox_username ASC, id ASC'
                )
                .all()
            )?.results || []
          : [],
        listConfigValues(env, 'config_voyage_ports'),
        listFishTypes(env),
        listSellLocations(env)
      ])
    : [[], [], [], []];
  const myVesselAssignment = includeSetup ? await getEmployeeActiveVesselAssignment(env, employee.id) : null;

  return cachedJson(
    request,
    {
      voyages,
      ongoing: voyages.filter((voyage) => voyage.isOngoing),
      archived: voyages.filter((voyage) => !voyage.isOngoing),
    currentEmployee: {
      id: Number(employee.id),
      robloxUsername: text(employee.roblox_username)
    },
    employees,
    voyageConfig: {
      ports,
      fishTypes,
      sellLocations,
      cargoTypes: fishTypes.map((row) => ({ id: row.id, name: row.name, default_price: row.unit_price })),
      vesselNames: [],
      vesselClasses: [],
      vesselCallsigns: []
    },
    myVesselAssignment,
    pagination: {
      page: hasPaging ? page : 1,
      pageSize: hasPaging ? pageSize : total,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    },
    permissions: {
      canCreate: hasPermission(session, 'voyages.create'),
      canEdit: hasPermission(session, 'voyages.edit'),
      canEnd: hasPermission(session, 'voyages.end'),
      canDelete: hasPermission(session, 'voyages.delete')
    }
    },
    { cacheControl: 'private, no-store' }
  );
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, employee } = await requireVoyagePermission(context, 'voyages.create');
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const departurePort = text(payload?.departurePort);
  const destinationPort = text(payload?.destinationPort) || departurePort;
  const reservationToken = text(payload?.reservationToken);
  const officerOfWatchEmployeeId = Number(payload?.officerOfWatchEmployeeId);
  const crewComplementIds = asEmployeeIds(payload?.crewComplementIds);

  if (!departurePort) {
    return json({ error: 'All voyage start fields are required.' }, 400);
  }
  if (!reservationToken) {
    return json({ error: 'Ship reservation missing. Reopen Start Voyage and try again.' }, 400);
  }
  const skipperEmployeeId = Number.isInteger(officerOfWatchEmployeeId) && officerOfWatchEmployeeId > 0 ? officerOfWatchEmployeeId : Number(employee.id);
  if (!crewComplementIds.length) {
    return json({ error: 'Crew complement requires at least one employee.' }, 400);
  }
  if (crewComplementIds.includes(skipperEmployeeId)) {
    return json({ error: 'Officer of the Watch (OOTW) cannot be added to crew.' }, 400);
  }

  const ports = await listConfigValues(env, 'config_voyage_ports');
  const allowedPorts = new Set((ports || []).map((item) => String(item.value || '').trim().toLowerCase()).filter(Boolean));
  if (!allowedPorts.has(departurePort.toLowerCase())) {
    return json({ error: 'Voyage must use configured ports.' }, 400);
  }

  await ensureShipReservationTables(env);
  await purgeExpiredShipReservations(env);
  const selectedReservation = await getActiveReservationForStart(env, employee.id, reservationToken);
  if (!selectedReservation) {
    return json({ error: 'Ship reservation expired or unavailable. Reopen Start Voyage and try again.' }, 409);
  }

  const vesselName = text(selectedReservation.vesselName);
  const vesselClass = text(selectedReservation.vesselClass);
  const vesselCallsign = text(selectedReservation.vesselCallsign) || vesselName;

  const employeeRows = await env.DB
    .prepare(
      `SELECT id
       FROM employees
       WHERE id IN (${[skipperEmployeeId, ...crewComplementIds].map(() => '?').join(',')})`
    )
    .bind(skipperEmployeeId, ...crewComplementIds)
    .all();
  const knownIds = new Set((employeeRows?.results || []).map((row) => Number(row.id)));
  if (!knownIds.has(skipperEmployeeId) || crewComplementIds.some((id) => !knownIds.has(id))) {
    return json({ error: 'Selected crew members must exist.' }, 400);
  }

  let insert;
  try {
    insert = await env.DB
      .prepare(
        `INSERT INTO voyages
         (status, ship_status, owner_employee_id, departure_port, destination_port, vessel_name, vessel_class, vessel_callsign, officer_of_watch_employee_id, started_at, updated_at)
         VALUES ('ONGOING', 'IN_PORT', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(employee.id, departurePort, destinationPort, vesselName, vesselClass, vesselCallsign, skipperEmployeeId)
      .run();
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('ux_voyages_active_vessel_callsign')) {
      return json({ error: 'An ongoing voyage already exists for that vessel.' }, 400);
    }
    throw error;
  }
  const voyageId = Number(insert?.meta?.last_row_id);
  await releaseShipReservation(env, employee.id, reservationToken, { applyCooldown: false });

  await env.DB.batch(
    crewComplementIds.map((crewId) =>
      env.DB.prepare('INSERT OR IGNORE INTO voyage_crew_members (voyage_id, employee_id) VALUES (?, ?)').bind(voyageId, crewId)
    )
  );
  await syncVoyageParticipants(env, voyageId, officerOfWatchEmployeeId, crewComplementIds);

  const created = await env.DB.prepare('SELECT id FROM voyages WHERE id = ?').bind(voyageId).first();
  return json({ voyageId: created?.id || voyageId }, 201);
}

