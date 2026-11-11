import { adminSessionCookie, db, hasAdminSession } from '../../lib/db.mjs';

export function GET({ params, cookies }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!/^[1-9]\d{0,12}$/.test(params.id ?? '')) return new Response(null, { status: 404, headers });
  const campaign = db().prepare('SELECT active, image FROM home_campaigns WHERE id = ?').get(Number(params.id));
  if (!campaign?.image || (!campaign.active && !hasAdminSession(cookies.get(adminSessionCookie)?.value))) {
    return new Response(null, { status: 404, headers });
  }
  return new Response(campaign.image, { headers: { ...headers, 'Content-Type': 'image/webp' } });
}
