import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { adminSessionCookie, dataDir, db, hasAdminSession } from '../../lib/db.mjs';

export async function GET({ params, cookies }) {
  const file = params.file ?? '';
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.webp$/.test(file)) return new Response(null, { status: 404 });
  const record = db().prepare('SELECT status FROM machines, json_each(machines.photos) WHERE machines.sample = 0 AND json_each.value = ?').get(`/media/${file}`);
  const publicPhoto = record?.status === 'published';
  if (!record || (!publicPhoto && !hasAdminSession(cookies.get(adminSessionCookie)?.value))) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const image = await readFile(resolve(dataDir(), 'fotos', file));
    return new Response(image, { headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(image.length), 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': publicPhoto ? 'public, max-age=60, must-revalidate' : 'private, no-store',
    } });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
}
