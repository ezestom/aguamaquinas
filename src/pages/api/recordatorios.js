import { publicAvailabilityOrigin, runAvailabilityReminders } from '../../lib/availability.mjs';
import { safeEqual } from '../../lib/db.mjs';

export async function POST({ request }) {
  const headers = { 'Cache-Control': 'no-store' };
  const secret = process.env.AGUA_REMINDER_KEY;
  if (!secret || !safeEqual(request.headers.get('Authorization'), 'Bearer ' + secret)) {
    return new Response(null, { status: 403, headers });
  }
  const origin = publicAvailabilityOrigin(process.env.AGUA_PUBLIC_URL);
  if (!origin || !process.env.RESEND_API_KEY || !process.env.AGUA_EMAIL_FROM) {
    return Response.json({ error: 'Falta configurar el dominio público o el envío de correo.' }, { status: 503, headers });
  }
  const summary = await runAvailabilityReminders(origin);
  return Response.json(summary, { status: summary.failed ? 502 : 200, headers });
}
