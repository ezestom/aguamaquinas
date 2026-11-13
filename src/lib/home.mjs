import sharp from 'sharp';
import { db } from './db.mjs';
import { FormError, text } from './submissions.mjs';

export const featuredLimit = 5;
export const campaignLimit = 8;
const campaignFields = 'id, title, description, label, href, position, active, sponsored, image IS NOT NULL AS has_image';

export function homeCampaigns(publicOnly = false) {
  return db().prepare(`SELECT ${campaignFields} FROM home_campaigns
    WHERE (? = 0 OR active = 1) ORDER BY position, id`).all(Number(publicOnly));
}

function campaignHref(value) {
  try {
    const url = new URL(value, 'https://aguamaquinas.invalid');
    if (value.startsWith('/') && !value.startsWith('//') && url.origin === 'https://aguamaquinas.invalid') {
      return url.pathname + url.search + url.hash;
    }
    if (value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {}
  throw new FormError('Ingresá un enlace interno, como /consulta, o una URL HTTPS.');
}

export async function saveCampaign(form, id) {
  const title = text(form, 'title', 80);
  const description = text(form, 'description', 180);
  const label = text(form, 'label', 34);
  const href = campaignHref(text(form, 'href', 500));
  const position = Number(text(form, 'position', 4));
  const active = Number(form.get('active') === '1');
  const sponsored = Number(form.get('sponsored') === '1');
  if (!title || !description || !label || !Number.isInteger(position) || position < 1 || position > 99) {
    throw new FormError('Completá el título, el texto, el botón y el orden de la campaña.');
  }
  const file = form.get('image');
  let image = null;
  if (file instanceof File && file.size) {
    if (file.size > 4 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new FormError('Elegí una imagen JPG, PNG o WebP de hasta 4 MB.');
    }
    try {
      const source = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 24_000_000 });
      if (!['jpeg', 'png', 'webp'].includes((await source.metadata()).format)) throw new Error('Formato inválido');
      image = await source.rotate().resize(2560, 1000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    } catch { throw new FormError('No se pudo leer la imagen.'); }
    if (image.length > 1024 * 1024) throw new FormError('La imagen es demasiado pesada después de comprimirla.');
  }
  const connection = db();
  const fields = [title, description, label, href, position, active, sponsored];
  if (id) {
    const change = connection.prepare(`UPDATE home_campaigns SET title = ?, description = ?, label = ?, href = ?,
      position = ?, active = ?, sponsored = ?, image = CASE WHEN ? = 1 THEN NULL ELSE coalesce(?, image) END WHERE id = ?`)
      .run(...fields, Number(!image && form.get('remove-image') === '1'), image, id);
    if (!change.changes) throw new FormError('La campaña ya no está disponible.', 404);
  } else {
    const change = connection.prepare(`INSERT INTO home_campaigns (title, description, label, href, position, active, sponsored, image)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM home_campaigns) < ?`).run(...fields, image, campaignLimit);
    if (!change.changes) throw new FormError('Se alcanzó el límite de campañas. Editá una de las existentes.', 409);
  }
}

export function featuredSlots() {
  return db().prepare(`SELECT f.*, m.title FROM home_featured f JOIN machines m ON m.ref = f.machine_ref ORDER BY f.position`).all();
}

export function deleteCampaign(id) {
  if (!db().prepare('DELETE FROM home_campaigns WHERE id = ?').run(id).changes) {
    throw new FormError('La campaña ya no está disponible.', 404);
  }
}

export function featuredListings() {
  return db().prepare(`SELECT m.*, d.price_max, c.locality, f.position AS featured_position, f.sponsored
    FROM home_featured f JOIN machines m ON m.ref = f.machine_ref LEFT JOIN listing_details d ON d.machine_ref = m.ref
    LEFT JOIN listing_contacts c ON c.machine_ref = m.ref
    WHERE m.status = 'published' AND m.sample = 0 ORDER BY f.position LIMIT ?`).all(featuredLimit);
}

export function saveFeatured(form) {
  const connection = db();
  const choices = Array.from({ length: featuredLimit }, (_, index) => {
    const position = index + 1;
    return { position, ref: text(form, 'ref-' + position, 32), sponsored: Number(form.get('sponsor-' + position) === '1') };
  }).filter(item => item.ref);
  connection.exec('BEGIN IMMEDIATE');
  try {
    const allowed = connection.prepare(`SELECT 1 FROM machines WHERE ref = ? AND sample = 0 AND (status = 'published'
      OR EXISTS (SELECT 1 FROM home_featured WHERE machine_ref = machines.ref AND position = ?))`);
    if (choices.some(({ ref, position }) => !allowed.get(ref, position))) throw new FormError('Elegí avisos publicados.');
    connection.exec('DELETE FROM home_featured');
    const insert = connection.prepare('INSERT INTO home_featured VALUES (?, ?, ?)');
    for (const { position, ref, sponsored } of choices) insert.run(position, ref, sponsored);
    connection.exec('COMMIT');
  } catch (error) {
    if (connection.isTransaction) connection.exec('ROLLBACK');
    throw error;
  }
}
