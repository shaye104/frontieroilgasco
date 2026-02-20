import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema } from './db.js';
import { enrichSessionWithPermissions, hasPermission } from './permissions.js';

export function toMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number);
}

export async function requireVoyagePermission(context, permissionKey) {
  const { env, request } = context;
  const payload = await readSessionFromRequest(env, request);
  if (!payload) return { errorResponse: json({ error: 'Authentication required.' }, 401), session: null, employee: null };

  let session;
  try {
    await ensureCoreSchema(env);
    session = await enrichSessionWithPermissions(env, payload);
  } catch (error) {
    return { errorResponse: json({ error: error.message || 'Database unavailable.' }, 500), session: null, employee: null };
  }

  if (!hasPermission(session, permissionKey)) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null, employee: null };
  }

  if (!session.employee) {
    return { errorResponse: json({ error: 'Employee profile required for voyages.' }, 403), session: null, employee: null };
  }

  return { errorResponse: null, session, employee: session.employee };
}

export async function getVoyageBase(env, voyageId) {
  return env.DB
    .prepare(
      `SELECT v.*,
              ow.roblox_username AS officer_name, ow.discord_user_id AS officer_discord_user_id,
              owner.roblox_username AS owner_name, owner.discord_user_id AS owner_discord_user_id
       FROM voyages v
       LEFT JOIN employees ow ON ow.id = v.officer_of_watch_employee_id
       LEFT JOIN employees owner ON owner.id = v.owner_employee_id
       WHERE v.id = ?`
    )
    .bind(voyageId)
    .first();
}

export async function getVoyageDetail(env, voyageId, options = {}) {
  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return null;
  const includeManifest = options.includeManifest !== false;
  const includeLogs = options.includeLogs !== false;

  const [crewRows, manifestRows, logRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT e.id, e.roblox_username, e.discord_user_id, e.rank, e.grade
         FROM voyage_crew_members vcm
         INNER JOIN employees e ON e.id = vcm.employee_id
         WHERE vcm.voyage_id = ?
         ORDER BY e.roblox_username ASC, e.id ASC`
      )
      .bind(voyageId)
      .all(),
    includeManifest
      ? env.DB
          .prepare(
            `SELECT vml.id, vml.cargo_type_id, ct.name AS cargo_name, ct.active, ct.default_price,
                    vml.quantity, vml.buy_price, vml.line_total, vml.updated_at
             FROM voyage_manifest_lines vml
             INNER JOIN cargo_types ct ON ct.id = vml.cargo_type_id
             WHERE vml.voyage_id = ?
             ORDER BY ct.name ASC, ct.id ASC`
          )
          .bind(voyageId)
          .all()
      : Promise.resolve({ results: [] }),
    includeLogs
      ? env.DB
          .prepare(
            `SELECT vl.id, vl.message, vl.log_type, vl.created_at, vl.updated_at,
                    e.id AS author_employee_id, e.roblox_username AS author_name
             FROM voyage_logs vl
             INNER JOIN employees e ON e.id = vl.author_employee_id
             WHERE vl.voyage_id = ?
             ORDER BY vl.created_at DESC, vl.id DESC`
          )
          .bind(voyageId)
          .all()
      : Promise.resolve({ results: [] })
  ]);

  const manifest = manifestRows?.results || [];
  const buyTotal = toMoney(manifest.reduce((acc, line) => acc + Number(line.line_total || 0), 0));

  return {
    voyage,
    crew: crewRows?.results || [],
    manifest,
    logs: logRows?.results || [],
    buyTotal
  };
}

export async function syncVoyageParticipants(env, voyageId, officerOfWatchEmployeeId, crewComplementIds = []) {
  const crewIds = [...new Set((Array.isArray(crewComplementIds) ? crewComplementIds : []).map((value) => Number(value)).filter((v) => Number.isInteger(v) && v > 0))];
  const oowId = Number(officerOfWatchEmployeeId);
  const statements = [env.DB.prepare('DELETE FROM voyage_participants WHERE voyage_id = ?').bind(voyageId)];
  if (Number.isInteger(oowId) && oowId > 0) {
    statements.push(
      env.DB
        .prepare('INSERT OR IGNORE INTO voyage_participants (voyage_id, employee_id, role_in_voyage) VALUES (?, ?, ?)')
        .bind(voyageId, oowId, 'OOW')
    );
  }
  crewIds.forEach((crewId) => {
    statements.push(
      env.DB
        .prepare('INSERT OR IGNORE INTO voyage_participants (voyage_id, employee_id, role_in_voyage) VALUES (?, ?, ?)')
        .bind(voyageId, crewId, 'CREW')
    );
  });
  await env.DB.batch(statements);
}
