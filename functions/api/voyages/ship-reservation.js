import { json } from '../auth/_lib/auth.js';
import { requireVoyagePermission } from '../_lib/voyages.js';
import { releaseShipReservation, reserveShipForStart } from '../_lib/ship-reservations.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, employee } = await requireVoyagePermission(context, 'voyages.create');
  if (errorResponse) return errorResponse;

  let payload = {};
  try {
    payload = (await request.json()) || {};
  } catch {
    payload = {};
  }

  const action = text(payload?.action || 'reserve').toLowerCase();
  const reservationToken = text(payload?.reservationToken);

  if (action === 'reserve') {
    return reserveShipForStart(env, employee.id);
  }

  if (action === 'release') {
    const result = await releaseShipReservation(env, employee.id, reservationToken, { applyCooldown: false });
    return json({ ok: true, released: Boolean(result.released) });
  }

  if (action === 'timeout') {
    const result = await releaseShipReservation(env, employee.id, reservationToken, { applyCooldown: true });
    return json({
      ok: true,
      released: Boolean(result.released),
      cooldown: result.cooldown || { secondsLeft: 60, cooldownUntil: null }
    });
  }

  return json({ error: 'Invalid reservation action.' }, 400);
}
