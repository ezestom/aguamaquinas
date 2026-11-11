import { adminSessionCookie, hasAdminSession } from '../../lib/db.mjs';
import { listingCsv } from '../../lib/listing-management.mjs';

export function GET({ cookies }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!hasAdminSession(cookies.get(adminSessionCookie)?.value)) return new Response(null, { status: 403, headers });
  return new Response(listingCsv(), { headers: {
    ...headers,
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="agua-maquinas-avisos.csv"',
  } });
}
