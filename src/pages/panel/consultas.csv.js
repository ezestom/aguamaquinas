import { adminSessionCookie, hasAdminSession } from '../../lib/db.mjs';
import { inquiryCsv, managedInquiries } from '../../lib/listing-management.mjs';

export function GET({ cookies, url }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!hasAdminSession(cookies.get(adminSessionCookie)?.value)) return new Response(null, { status: 403, headers });
  const channel = url?.searchParams.get('canal');
  const rows = managedInquiries().filter(item => !['web', 'manual'].includes(channel) || Boolean(item.manual) === (channel === 'manual'));
  return new Response(inquiryCsv(rows), { headers: {
    ...headers,
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="agua-maquinas-consultas.csv"',
  } });
}
