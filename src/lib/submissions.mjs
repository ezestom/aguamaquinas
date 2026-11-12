import sharp from 'sharp';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, opendirSync, lstatSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { categories, conditions, formats, listingPriceError, provinces, videoLink } from './catalog.mjs';
import { dataDir, db } from './db.mjs';
import { consumeListingVerification, listingVerification } from './listing-verification.mjs';
import { defaultInquirySource, inquirySource, inquirySources, inquiryTimeframes, validBuyerEmail, validBuyerWhatsApp } from './inquiry-options.mjs';
import { findPublicEquipment } from './public-equipment.mjs';

export const maxPhotoSize = 3 * 1024 * 1024;
export const text = (form, field, max) => {
  const value = form?.get(field);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
};

export class FormError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class UploadLimitError extends FormError {
  constructor(message, status, retryAfter) {
    super(message, status);
    this.retryAfter = retryAfter;
  }
}

export function listingPrices(form) {
  const price = text(form, 'price', 32);
  const upper = text(form, 'price_max', 32);
  const error = listingPriceError(price, upper);
  if (error) throw new FormError(error);
  return [price ? Number(price) : null, upper ? Number(upper) : null];
}

const uploadWindowSeconds = 600;
const maxUploadAttempts = 12;
const maxConcurrentUploads = 2;
const maxStoredPhotos = 1000;
let activeUploads = 0;

export function startListingUpload() {
  if (activeUploads >= maxConcurrentUploads) {
    throw new UploadLimitError('Hay otras cargas en curso. Probá de nuevo en unos segundos.', 429, 10);
  }
  const connection = db();
  connection.prepare('DELETE FROM listing_upload_attempts WHERE started_at <= unixepoch() - ?').run(uploadWindowSeconds);
  const attempt = connection.prepare(`INSERT INTO listing_upload_attempts (started_at)
    SELECT unixepoch() WHERE (SELECT count(*) FROM listing_upload_attempts WHERE started_at > unixepoch() - ?) < ?`)
    .run(uploadWindowSeconds, maxUploadAttempts);
  if (!attempt.changes) {
    const { retryAfter } = connection.prepare(`SELECT max(1, min(started_at) + ? - unixepoch()) AS retryAfter
      FROM listing_upload_attempts WHERE started_at > unixepoch() - ?`).get(uploadWindowSeconds, uploadWindowSeconds);
    throw new UploadLimitError('Se alcanzó el límite temporal de cargas. Probá más tarde.', 429, retryAfter ?? 1);
  }
  activeUploads++;
  return () => { activeUploads--; };
}

function assertPhotoCapacity(mediaDir, images) {
  const quota = Number(process.env.AGUA_PHOTO_QUOTA_BYTES ?? 256 * 1024 * 1024);
  if (!Number.isSafeInteger(quota) || quota <= 0) throw new Error('AGUA_PHOTO_QUOTA_BYTES debe ser un entero positivo.');
  let bytes = images.reduce((total, image) => total + image.length, 0);
  let count = images.length;
  const directory = opendirSync(mediaDir);
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (!entry.isFile()) continue;
      bytes += lstatSync(resolve(mediaDir, entry.name)).size;
      if (++count > maxStoredPhotos || bytes > quota) break;
    }
  } finally {
    directory.closeSync();
  }
  if (count > maxStoredPhotos || bytes > quota) {
    throw new UploadLimitError('Por ahora no hay espacio para guardar más fotos.', 503);
  }
}

export async function submitMachine(form, token) {
  if (!listingVerification(token)?.verified_at) throw new FormError('Verificá tu email antes de enviar el aviso.');
  const title = text(form, 'title', 90);
  const category = text(form, 'category', 25);
  const province = text(form, 'province', 30);
  const format = text(form, 'format', 20);
  const condition = text(form, 'condition', 25);
  const seller = text(form, 'seller', 80);
  const phone = text(form, 'phone', 30).replace(/[\s().-]/g, '');
  const locality = text(form, 'locality', 80);
  const address = text(form, 'address', 160);
  const description = text(form, 'description', 1600);
  const [amount, upper] = listingPrices(form);
  const video = videoLink(text(form, 'video', 300));

  if (!title || !Object.hasOwn(categories, category) || !provinces.includes(province) ||
      !Object.hasOwn(formats, format) || !Object.hasOwn(conditions, condition) || !seller || !locality || !address || !description) {
    throw new FormError('Completá los datos del equipo, la descripción y tu contacto.');
  }
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new FormError('Ingresá tu WhatsApp o teléfono con código de país.');
  }
  if (video === null) throw new FormError('Ingresá un enlace de video de YouTube o Vimeo.');

  const files = form.getAll('photos').filter(file => file instanceof File && file.size > 0);
  if (!files.length || files.length > 5) throw new FormError('Subí entre una y cinco fotos.');
  if (files.some(file => file.size > maxPhotoSize || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    throw new FormError('Usá fotos JPG, PNG o WebP de hasta 3 MB cada una.');
  }

  const mediaDir = resolve(dataDir(), 'fotos');
  mkdirSync(mediaDir, { recursive: true });
  const images = [];
  for (const file of files) {
    try {
      const source = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 30_000_000 });
      if (!['jpeg', 'png', 'webp'].includes((await source.metadata()).format)) throw new Error('Formato inválido');
      images.push(await source.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer());
    } catch { throw new FormError('No pudimos leer una de las fotos. Probá con otra imagen.'); }
  }

  const connection = db();
  const written = [];
  // Serialize the disk quota check and writes across processes sharing this database.
  connection.exec('BEGIN IMMEDIATE');
  try {
    const verified = consumeListingVerification(connection, token);
    if (!verified) throw new FormError('La verificación venció o ya se usó. Volvé a verificar tu email.');
    assertPhotoCapacity(mediaDir, images);
    for (const image of images) {
      const filename = `${randomUUID()}.webp`;
      const descriptor = openSync(resolve(mediaDir, filename), 'wx', 0o600);
      written.push(filename);
      try {
        writeFileSync(descriptor, image);
      } finally {
        closeSync(descriptor);
      }
    }
    const ref = `AM-${randomBytes(5).toString('hex').toUpperCase()}`;
    connection.prepare(`INSERT INTO machines (ref,title,category,brand,model,province,format,format_detail,capacity,condition,
      price,currency,photos,description,video,contact,seller) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      ref, title, category, text(form, 'brand', 60), text(form, 'model', 60), province, format, text(form, 'format_detail', 70),
      text(form, 'capacity', 60), condition, amount, 'USD',
      JSON.stringify(written.map(filename => `/media/${filename}`)), description, video, '', seller,
    );
    connection.prepare('INSERT INTO listing_contacts VALUES (?, ?, ?, ?, ?, ?)')
      .run(ref, verified.email, phone, address, locality, verified.verified_at);
    connection.prepare('INSERT INTO listing_details (machine_ref, price_max) VALUES (?, ?)').run(ref, upper);
    connection.prepare('INSERT INTO notification_outbox (event) VALUES (?)').run(`aviso/${ref}`);
    connection.exec('COMMIT');
    return ref;
  } catch (error) {
    for (const filename of written) {
      try { unlinkSync(resolve(mediaDir, filename)); }
      catch (cleanupError) { console.error('No se pudo limpiar una foto de un aviso fallido.', cleanupError.code); }
    }
    if (connection.isTransaction) connection.exec('ROLLBACK');
    throw error;
  }
}

export function submitInquiry(form, ref, origin, manual = false) {
  const name = text(form, 'name', 80);
  const contact = manual ? text(form, 'contact', 100) : '';
  const email = manual ? '' : text(form, 'email', 254);
  const whatsapp = manual ? '' : text(form, 'whatsapp', 30);
  const message = text(form, 'message', 1200);
  const timeframe = text(form, 'timeframe', 12);
  if (!name) throw new FormError('Ingresá tu nombre.');
  if (manual && !contact) throw new FormError('Ingresá un teléfono o correo.');
  if (!manual && !validBuyerWhatsApp(whatsapp)) throw new FormError('Ingresá un número de WhatsApp válido.');
  if (!manual && !validBuyerEmail(email)) throw new FormError('Ingresá un correo electrónico válido.');
  if ((manual || !ref) && !message) throw new FormError('Contanos qué equipo estás buscando.');
  if (timeframe && !Object.hasOwn(inquiryTimeframes, timeframe)) throw new FormError('Elegí un plazo de compra válido.');
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try {
    if (!manual) {
      const { count } = connection.prepare(`SELECT count(*) AS count FROM inquiries i
        LEFT JOIN inquiry_followups f ON f.inquiry_id = i.id
        WHERE i.created_at > datetime('now', '-10 minutes') AND coalesce(f.manual, 0) = 0`).get();
      if (count >= 20) throw new FormError('Hay muchas consultas en este momento. Probá de nuevo más tarde.', 429);
    }
    let equipment;
    if (ref) {
      equipment = manual ? connection.prepare(`SELECT title FROM machines WHERE ref = ? AND sample = 0
        AND NOT EXISTS (SELECT 1 FROM panel_trash WHERE kind = 'aviso' AND record_key = machines.ref)`).get(ref)
        : findPublicEquipment(ref, connection);
      if (!equipment) throw new FormError(manual ? 'La referencia no corresponde a un aviso del panel.' : 'Este equipo ya no está disponible.', manual ? 400 : 404);
    }
    const { id } = connection.prepare(`INSERT INTO inquiries
      (machine_ref, name, contact, message, origin, buyer_email, buyer_whatsapp, machine_title_at_submission)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(
      ref, name, contact, message, inquirySources[inquirySource(origin)] ?? defaultInquirySource,
      email, whatsapp, equipment?.title ?? '',
    );
    connection.prepare('INSERT INTO inquiry_followups (inquiry_id, location, budget, timeframe, manual) VALUES (?, ?, ?, ?, ?)')
      .run(id, text(form, 'location', 100), text(form, 'budget', 80), timeframe, Number(manual));
    const event = `consulta/${ref || 'general'}/${id}`;
    if (!manual) connection.prepare('INSERT INTO notification_outbox (event) VALUES (?)').run(event);
    connection.exec('COMMIT');
    return event;
  } catch (error) {
    if (connection.isTransaction) connection.exec('ROLLBACK');
    throw error;
  }
}
