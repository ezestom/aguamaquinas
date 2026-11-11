import { db } from './db.mjs';

export async function sendMail({ to, subject, text, event }) {
  const { AGUA_EMAIL_FROM: from, RESEND_API_KEY: key } = process.env;
  if (!key || !from) throw new Error('Email delivery is unavailable.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': event },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Email delivery failed (${response.status}).`);
}

export async function deliverNotification(event) {
  const to = process.env.AGUA_NOTIFICATION_EMAIL;
  if (!to) return;
  try {
    const connection = db();
    if (!connection.prepare('SELECT 1 FROM notification_outbox WHERE event = ? AND sent_at IS NULL').get(event)) return;
    const [type, reference] = event.split('/');
    const subject = type === 'aviso' ? `Nuevo aviso para revisar · ${reference}` : `Nueva consulta · ${reference}`;
    await sendMail({ to, subject, text: 'Ingresá al panel de Agua Máquinas para ver los datos y responder.', event });
    connection.prepare('UPDATE notification_outbox SET sent_at = unixepoch() WHERE event = ?').run(event);
  } catch {
    // Keep pending notifications available for retry in the panel.
  }
}

export async function retryNotifications() {
  const pending = db().prepare('SELECT event FROM notification_outbox WHERE sent_at IS NULL ORDER BY rowid LIMIT 5').all();
  await Promise.all(pending.map(({ event }) => deliverNotification(event)));
}
