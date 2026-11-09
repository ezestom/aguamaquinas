import sharp from 'sharp';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { categories, conditions, formats, provinces, videoLink } from './catalog.mjs';
import { dataDir, db } from './db.mjs';

export const maxPhotoSize = 3 * 1024 * 1024;
export const text = (form, field, max) => {
  const value = form?.get(field);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
};

export class FormError extends Error {}

export async function submitMachine(form) {
  const title = text(form, 'title', 90);
  const category = text(form, 'category', 25);
  const province = text(form, 'province', 30);
  const format = text(form, 'format', 20);
  const condition = text(form, 'condition', 25);
  const seller = text(form, 'seller', 80);
  const contact = text(form, 'contact', 100);
  const description = text(form, 'description', 1600);
  const currency = text(form, 'currency', 3);
  const amount = text(form, 'price', 14);
  const video = videoLink(text(form, 'video', 300));

  if (!title || !Object.hasOwn(categories, category) || !provinces.includes(province) ||
      !Object.hasOwn(formats, format) || !Object.hasOwn(conditions, condition) || !seller || !contact || !description) {
    throw new FormError('Completá los datos del equipo, la descripción y tu contacto.');
  }
  if (!['ARS', 'USD'].includes(currency) || (amount && !/^[1-9]\d{0,10}$/.test(amount))) {
    throw new FormError('Ingresá el precio como número entero, o dejalo vacío para que se consulte.');
  }
  if (video === null) throw new FormError('Ingresá un enlace de video de YouTube o Vimeo.');

  const files = form.getAll('photos').filter(file => file instanceof File && file.size > 0);
  if (!files.length || files.length > 5) throw new FormError('Subí entre una y cinco fotos.');
  if (files.some(file => file.size > maxPhotoSize || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    throw new FormError('Usá fotos JPG, PNG o WebP de hasta 3 MB cada una.');
  }

  const mediaDir = resolve(dataDir(), 'fotos');
  await mkdir(mediaDir, { recursive: true });
  const written = [];
  try {
    for (const file of files) {
      let image;
      try {
        const source = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 30_000_000 });
        if (!['jpeg', 'png', 'webp'].includes((await source.metadata()).format)) throw new Error('Formato inválido');
        image = await source.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      } catch { throw new FormError('No pudimos leer una de las fotos. Probá con otra imagen.'); }
      const filename = `${randomUUID()}.webp`;
      await writeFile(resolve(mediaDir, filename), image, { flag: 'wx' });
      written.push(`/media/${filename}`);
    }
    const ref = `AM-${randomBytes(5).toString('hex').toUpperCase()}`;
    db().prepare(`INSERT INTO machines (ref,title,category,brand,model,province,format,format_detail,capacity,condition,
      price,currency,photos,description,video,contact,seller) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      ref, title, category, text(form, 'brand', 60), text(form, 'model', 60), province, format, text(form, 'format_detail', 70),
      text(form, 'capacity', 60), condition, amount ? Number(amount) : null, currency, JSON.stringify(written), description, video, contact, seller,
    );
    return ref;
  } catch (error) {
    await Promise.allSettled(written.map(url => unlink(resolve(mediaDir, url.slice('/media/'.length)))));
    throw error;
  }
}

export function submitInquiry(form, ref, origin) {
  const name = text(form, 'name', 80);
  const contact = text(form, 'contact', 100);
  const message = text(form, 'message', 1200);
  if (!name || !contact || !message) throw new FormError('Completá tu nombre, un contacto y tu consulta.');
  db().prepare('INSERT INTO inquiries (machine_ref, name, contact, message, origin) VALUES (?, ?, ?, ?, ?)')
    .run(ref, name, contact, message, origin === 'alloatti' ? 'Alloatti' : 'Agua Máquinas');
}
