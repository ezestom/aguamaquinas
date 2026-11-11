import { db } from './db.mjs';

export async function sendMail({ to, subject, text, event, replyTo }) {
  const { AGUA_EMAIL_FROM: from, RESEND_API_KEY: key } = process.env;
  if (!key || !from) throw new Error('Email delivery is unavailable.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': event },
    body: JSON.stringify({ from, to: [to], subject, text, reply_to: replyTo }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Email delivery failed (${response.status}).`);
}

export async function deliverNotification(event, send = sendMail) {
  const to = process.env.AGUA_NOTIFICATION_EMAIL;
  if (!to) return;
  try {
    const connection = db();
    if (!connection.prepare('SELECT 1 FROM notification_outbox WHERE event = ? AND sent_at IS NULL').get(event)) return;
    const [type, reference, id] = event.split('/');
    const panelHint = 'Ingresá a Consultas web en el panel de Agua Máquinas para hacer el seguimiento.';
    let notification = { subject: `Nuevo aviso para revisar · ${reference}`,
      text: 'Ingresá al panel de Agua Máquinas para revisar el aviso.' };
    if (type === 'consulta') {
      const inquiry = connection.prepare(`SELECT i.*, m.title AS current_title FROM inquiries i
        LEFT JOIN machines m ON m.ref = i.machine_ref WHERE i.id = ?`).get(Number(id));
      if (!inquiry) return;
      const title = inquiry.machine_title_at_submission || inquiry.current_title || 'Pedido general';
      const equipment = inquiry.machine_ref ? `${inquiry.machine_ref} · ${title}` : title;
      notification = {
        subject: `Nueva consulta web · ${equipment.replace(/[\r\n]+/g, ' ')}`,
        text: [`Equipo: ${equipment}`, `Nombre: ${inquiry.name}`,
          inquiry.buyer_whatsapp && `WhatsApp: ${inquiry.buyer_whatsapp}`,
          inquiry.buyer_email && `Correo: ${inquiry.buyer_email}`,
          inquiry.contact && `Contacto: ${inquiry.contact}`, `Origen: ${inquiry.origin}`,
          inquiry.message && `\nMensaje: ${inquiry.message}`, '\n' + panelHint].filter(Boolean).join('\n'),
        replyTo: inquiry.buyer_email || undefined,
      };
    }
    await send({ to, ...notification, event });
    connection.prepare('UPDATE notification_outbox SET sent_at = unixepoch() WHERE event = ?').run(event);
  } catch {
    // Keep pending notifications available for retry in the panel.
  }
}

export async function retryNotifications() {
  const pending = db().prepare('SELECT event FROM notification_outbox WHERE sent_at IS NULL ORDER BY rowid LIMIT 5').all();
  await Promise.all(pending.map(({ event }) => deliverNotification(event)));
}
