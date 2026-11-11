import { createHash } from 'node:crypto';
import { db } from './db.mjs';
import { categories, conditions, formats, provinces, videoLink } from './catalog.mjs';
import { FormError, text } from './submissions.mjs';

const listingQuery = `SELECT m.*, c.email, c.phone, c.address, c.locality, c.verified_at, t.deleted_at
    FROM machines m LEFT JOIN listing_contacts c ON c.machine_ref = m.ref
    LEFT JOIN panel_trash t ON t.kind = 'aviso' AND t.record_key = m.ref WHERE m.sample = 0`;
const inquiryQuery = `SELECT i.*, m.title AS machine_title, m.sample, t.deleted_at,
    mt.deleted_at AS listing_deleted_at FROM inquiries i LEFT JOIN machines m ON m.ref = i.machine_ref
    LEFT JOIN panel_trash t ON t.kind = 'consulta' AND t.record_key = CAST(i.id AS TEXT)
    LEFT JOIN panel_trash mt ON mt.kind = 'aviso' AND mt.record_key = m.ref WHERE 1 = 1`;

export const listingStatuses = { pending: 'Pendiente', published: 'Publicado', paused: 'Pausado', sold: 'Vendido' };

export function managedListings(trashed = false) {
  return db().prepare(`${listingQuery} AND (t.deleted_at IS NOT NULL) = ? ORDER BY m.status != 'pending', m.id DESC`).all(Number(trashed));
}

export function managedInquiries(trashed = false) {
  return db().prepare(`${inquiryQuery} AND (t.deleted_at IS NOT NULL) = ? ORDER BY i.id DESC`).all(Number(trashed));
}

export function managedRecord(kind, key) {
  if (kind === 'aviso') return db().prepare(`${listingQuery} AND m.ref = ?`).get(key);
  if (kind === 'consulta' && /^[1-9]\d{0,14}$/.test(key)) return db().prepare(`${inquiryQuery} AND i.id = ?`).get(Number(key));
}

export function setListingStatus(ref, status) {
  if (!['published', 'paused', 'sold'].includes(status)) return false;
  return Boolean(db().prepare(`UPDATE machines SET status = ? WHERE ref = ? AND sample = 0
    AND NOT EXISTS (SELECT 1 FROM panel_trash WHERE kind = 'aviso' AND record_key = machines.ref)
    AND (? != 'published' OR EXISTS (SELECT 1 FROM listing_contacts WHERE machine_ref = machines.ref AND verified_at > 0))`)
    .run(status, ref, status).changes);
}

export const recordRevision = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');

function editListing(connection, record, form) {
  const title = text(form, 'title', 90);
  const category = text(form, 'category', 25);
  const condition = text(form, 'condition', 25);
  const format = text(form, 'format', 20);
  const province = text(form, 'province', 30);
  const description = text(form, 'description', 1600);
  const price = text(form, 'price', 14);
  const video = videoLink(text(form, 'video', 300));
  if (!title || !description || !Object.hasOwn(categories, category) || !Object.hasOwn(conditions, condition)
    || !Object.hasOwn(formats, format) || !provinces.includes(province)) throw new FormError('Completá los datos obligatorios del equipo.');
  if (price && !/^[1-9]\d{0,10}$/.test(price)) throw new FormError('Ingresá un precio entero mayor a cero o dejalo vacío.');
  if (video === null) throw new FormError('Ingresá un enlace válido de YouTube o Vimeo.');
  connection.prepare(`UPDATE machines SET title = ?, category = ?, brand = ?, model = ?, province = ?, format = ?,
    format_detail = ?, capacity = ?, condition = ?, price = ?, description = ?, video = ? WHERE ref = ?`)
    .run(title, category, text(form, 'brand', 60), text(form, 'model', 60), province, format,
      text(form, 'format_detail', 70), text(form, 'capacity', 60), condition, price ? Number(price) : null,
      description, video, record.ref);
}

function editSeller(connection, record, form) {
  const seller = text(form, 'seller', 80);
  const phone = text(form, 'phone', 30).replace(/[\s().-]/g, '');
  const email = record.verified_at ? record.email : text(form, 'email', 254);
  const address = text(form, 'address', 160);
  const locality = text(form, 'locality', 80);
  if (!seller) throw new FormError('Ingresá el nombre del vendedor.');
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new FormError('Ingresá un teléfono con código de país.');
  if (email && !/^[^\s@,<>]+@[^\s@,<>.]+(?:\.[^\s@,<>.]+)+$/.test(email)) throw new FormError('Ingresá un email válido.');
  connection.prepare('UPDATE machines SET seller = ?, contact = ? WHERE ref = ?')
    .run(seller, text(form, 'contact', 100), record.ref);
  connection.prepare(`INSERT INTO listing_contacts (machine_ref, email, phone, address, locality, verified_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(machine_ref) DO UPDATE SET email = excluded.email,
    phone = excluded.phone, address = excluded.address, locality = excluded.locality`)
    .run(record.ref, email, phone, address, locality, record.verified_at || 0);
}

function editInquiry(connection, record, form) {
  const name = text(form, 'name', 80);
  const contact = text(form, 'contact', 100);
  const message = text(form, 'message', 1200);
  if (!name || !contact || !message) throw new FormError('Completá el nombre, contacto y mensaje de la consulta.');
  connection.prepare('UPDATE inquiries SET name = ?, contact = ?, message = ? WHERE id = ?').run(name, contact, message, record.id);
}

export function applyPanelChange(kind, key, action, form) {
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try {
    const record = managedRecord(kind, key);
    if (!record || recordRevision(record) !== form.get('revision') || Boolean(record.deleted_at) !== (action === 'restore')) {
      throw new FormError('El registro cambió desde que lo abriste. Revisá los datos antes de volver a intentar.', 409);
    }
    if (action === 'delete') {
      connection.prepare('INSERT INTO panel_trash (kind, record_key, previous_status) VALUES (?, ?, ?)').run(kind, key, record.status ?? null);
      if (kind === 'aviso') connection.prepare("UPDATE machines SET status = 'paused' WHERE ref = ?").run(key);
    } else if (action === 'restore') {
      const { previous_status } = connection.prepare('DELETE FROM panel_trash WHERE kind = ? AND record_key = ? RETURNING previous_status').get(kind, key);
      if (kind === 'aviso') connection.prepare('UPDATE machines SET status = ? WHERE ref = ?').run(previous_status, key);
    } else if (action === 'edit') {
      if (kind === 'aviso') editListing(connection, record, form);
      else editInquiry(connection, record, form);
    } else if (action === 'seller' && kind === 'aviso') {
      editSeller(connection, record, form);
    } else if (kind !== 'aviso' || !setListingStatus(key, action)) {
      throw new FormError('Para publicar, el aviso debe tener un email verificado.', 409);
    }
    connection.exec('COMMIT');
  } catch (error) {
    if (connection.isTransaction) connection.exec('ROLLBACK');
    throw error;
  }
}

const columns = [
  'Referencia', 'Producto', 'Categoría', 'Marca', 'Modelo', 'Estado del equipo', 'Formato', 'Medida', 'Capacidad',
  'Descripción', 'Precio', 'Moneda', 'Estado del aviso', 'Fecha de alta (UTC)', 'Vendedor', 'Email',
  'Email verificado (UTC)', 'WhatsApp o teléfono', 'Dirección', 'Localidad', 'Provincia', 'Contacto anterior', 'Video', 'Fotos',
];

function csvCell(value) {
  let cell = String(value ?? '');
  if (/^[\s\uFEFF]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

export function listingCsv(listings = managedListings()) {
  const rows = listings.map(item => [
    item.ref, item.title, categories[item.category], item.brand, item.model, conditions[item.condition],
    formats[item.format], item.format_detail, item.capacity, item.description, item.price, item.currency,
    item.status, item.created_at, item.seller, item.email,
    item.verified_at ? new Date(item.verified_at * 1000).toISOString() : '', item.phone, item.address,
    item.locality, item.province, item.contact, item.video, JSON.parse(item.photos).join(' '),
  ]);
  return '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
