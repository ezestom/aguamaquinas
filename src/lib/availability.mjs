import { createHmac } from 'node:crypto';
import { adminKey, db, safeEqual } from './db.mjs';
import { sendMail } from './mail.mjs';

export const availabilitySeconds = 30 * 86_400;
const retrySeconds = 3600;
const cycle = 'coalesce(d.confirmed_at, unixepoch(m.created_at))';
const published = `FROM machines m JOIN listing_contacts c ON c.machine_ref = m.ref
  LEFT JOIN listing_details d ON d.machine_ref = m.ref
  WHERE m.status = 'published' AND m.sample = 0 AND c.verified_at > 0 AND c.email != ''
  AND NOT EXISTS (SELECT 1 FROM panel_trash WHERE kind = 'aviso' AND record_key = m.ref)`;
const due = `AND ${cycle} <= unixepoch() - ? AND d.reminded_at IS NULL
  AND coalesce(d.reminder_attempted_at, 0) <= unixepoch() - ?`;

export function confirmAvailability(connection, ref) {
  connection.prepare(`INSERT INTO listing_details (machine_ref, confirmed_at) VALUES (?, unixepoch())
    ON CONFLICT(machine_ref) DO UPDATE SET confirmed_at = excluded.confirmed_at,
    reminder_attempted_at = NULL, reminded_at = NULL`).run(ref);
}

const signature = payload => createHmac('sha256', adminKey()).update('availability:' + payload).digest('hex');

export function listingFromAvailabilityLink(token) {
  const parts = /^([a-zA-Z0-9-]{1,32})\.(\d{1,11})\.([a-f0-9]{64})$/.exec(token ?? '');
  if (!parts) return;
  const [, ref, version, proof] = parts;
  if (!safeEqual(proof, signature(ref + '.' + version))) return;
  return db().prepare(`SELECT m.ref, m.title ${published} AND m.ref = ? AND ${cycle} = ?`).get(ref, Number(version));
}

export function respondToAvailability(token, response) {
  if (response !== 'available' && response !== 'sold') return false;
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try {
    const listing = listingFromAvailabilityLink(token);
    if (listing && response === 'available') confirmAvailability(connection, listing.ref);
    if (listing && response === 'sold') {
      connection.prepare("UPDATE machines SET status = 'sold' WHERE ref = ?").run(listing.ref);
    }
    connection.exec('COMMIT');
    return Boolean(listing);
  } catch (error) {
    if (connection.isTransaction) connection.exec('ROLLBACK');
    throw error;
  }
}

export function publicAvailabilityOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') return url.origin;
  } catch { /* Missing or malformed configuration. */ }
}

export async function runAvailabilityReminders(origin, send = sendMail) {
  const connection = db();
  const eligible = connection.prepare(`SELECT m.ref, ${cycle} AS cycle ${published} ${due}
    ORDER BY coalesce(d.reminder_attempted_at, 0), ${cycle}, m.ref LIMIT 10`).all(availabilitySeconds, retrySeconds);
  const claim = connection.prepare(`INSERT INTO listing_details (machine_ref, reminder_attempted_at)
    SELECT m.ref, unixepoch() ${published} ${due} AND m.ref = ? AND ${cycle} = ?
    ON CONFLICT(machine_ref) DO UPDATE SET reminder_attempted_at = excluded.reminder_attempted_at
    RETURNING reminder_attempted_at`);
  const details = connection.prepare(`SELECT c.email ${published} AND m.ref = ? AND ${cycle} = ?`);
  const markSent = connection.prepare(`UPDATE listing_details SET reminded_at = unixepoch()
    WHERE machine_ref = ? AND reminder_attempted_at = ? AND EXISTS (
      SELECT 1 ${published} AND m.ref = ? AND ${cycle} = ?
    )`);
  let sent = 0;
  let failed = 0;
  for (const item of eligible) {
    const attempt = claim.get(availabilitySeconds, retrySeconds, item.ref, item.cycle);
    if (!attempt) continue;
    const contact = details.get(item.ref, item.cycle);
    if (!contact) continue;
    const payload = item.ref + '.' + item.cycle;
    const url = new URL('/disponibilidad', origin);
    url.searchParams.set('aviso', payload + '.' + signature(payload));
    try {
      await send({
        to: contact.email, subject: `¿Sigue disponible el equipo ${item.ref}?`,
        text: `Confirmá si tu equipo sigue disponible o marcalo como vendido en Agua Máquinas.\n\n${url}`,
        event: `disponibilidad/${payload}`,
      });
    } catch {
      failed++;
      continue;
    }
    markSent.run(item.ref, attempt.reminder_attempted_at, item.ref, item.cycle);
    sent++;
  }
  return { sent, failed };
}
