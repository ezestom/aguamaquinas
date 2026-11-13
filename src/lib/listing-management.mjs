import { createHash } from 'node:crypto';
import { db } from './db.mjs';
import { referenceEquipment } from './reference-equipment.mjs';
import { categories, conditions, formats, provinces, videoLink } from './catalog.mjs';
import { FormError, listingPrices, text } from './submissions.mjs';
import { confirmAvailability } from './availability.mjs';
import { defaultInquirySource, inquirySources, inquiryStages, inquiryTimeframes, moneyInput, validBuyerEmail, validBuyerWhatsApp } from './inquiry-options.mjs';

const listingQuery = `SELECT m.*, c.email, c.phone, c.address, c.locality, c.verified_at, d.price_max, d.confirmed_at, d.reminded_at, t.deleted_at
    FROM machines m LEFT JOIN listing_contacts c ON c.machine_ref = m.ref
    LEFT JOIN listing_details d ON d.machine_ref = m.ref
    LEFT JOIN panel_trash t ON t.kind = 'aviso' AND t.record_key = m.ref WHERE m.sample = 0`;
const inquiryQuery = `SELECT i.*, coalesce(nullif(i.machine_title_at_submission, ''), m.title) AS machine_title, m.sample, m.currency AS listing_currency, t.deleted_at,
    mt.deleted_at AS listing_deleted_at, coalesce(f.stage, 'new') AS stage, f.location, f.budget,
    f.timeframe, f.minutes, f.notes, f.commission_currency, f.sale_amount, f.commission_agreed,
    f.commission_paid, f.closed_on, f.paid_on, coalesce(f.manual, 0) AS manual
    FROM inquiries i LEFT JOIN machines m ON m.ref = i.machine_ref
    LEFT JOIN inquiry_followups f ON f.inquiry_id = i.id
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
  const connection = db();
  const standalone = !connection.isTransaction;
  if (standalone) connection.exec('BEGIN IMMEDIATE');
  try {
    const changed = Boolean(connection.prepare(`UPDATE machines SET status = ? WHERE ref = ? AND sample = 0
      AND NOT EXISTS (SELECT 1 FROM panel_trash WHERE kind = 'aviso' AND record_key = machines.ref)
      AND (? != 'published' OR EXISTS (SELECT 1 FROM listing_contacts WHERE machine_ref = machines.ref AND verified_at > 0))`)
      .run(status, ref, status).changes);
    if (changed && status === 'published') confirmAvailability(connection, ref);
    if (standalone) connection.exec('COMMIT');
    return changed;
  } catch (error) {
    if (standalone && connection.isTransaction) connection.exec('ROLLBACK');
    throw error;
  }
}

export const recordRevision = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');

function editListing(connection, record, form) {
  const title = text(form, 'title', 90);
  const category = text(form, 'category', 25);
  const condition = text(form, 'condition', 25);
  const format = text(form, 'format', 20);
  const province = text(form, 'province', 30);
  const description = text(form, 'description', 1600);
  const [price, upper] = listingPrices(form);
  const video = videoLink(text(form, 'video', 300));
  if (!title || !description || !Object.hasOwn(categories, category) || !Object.hasOwn(conditions, condition)
    || !Object.hasOwn(formats, format) || !provinces.includes(province)) throw new FormError('Completá los datos obligatorios del equipo.');
  if (video === null) throw new FormError('Ingresá un enlace válido de YouTube o Vimeo.');
  connection.prepare(`UPDATE machines SET title = ?, category = ?, brand = ?, model = ?, province = ?, format = ?,
    format_detail = ?, capacity = ?, condition = ?, price = ?, description = ?, video = ? WHERE ref = ?`)
    .run(title, category, text(form, 'brand', 60), text(form, 'model', 60), province, format,
      text(form, 'format_detail', 70), text(form, 'capacity', 60), condition, price,
      description, video, record.ref);
  connection.prepare(`INSERT INTO listing_details (machine_ref, price_max) VALUES (?, ?)
    ON CONFLICT(machine_ref) DO UPDATE SET price_max = excluded.price_max`).run(record.ref, upper);
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
  const email = text(form, 'buyer_email', 254);
  const whatsapp = text(form, 'buyer_whatsapp', 30);
  const message = text(form, 'message', 1200);
  const legacyContact = Boolean(record.contact && !record.buyer_email && !record.buyer_whatsapp);
  if (!name || (legacyContact && !contact) || ((!record.machine_ref || record.manual) && !message)) {
    throw new FormError('Completá los campos obligatorios de la consulta.');
  }
  if (!legacyContact && (!validBuyerEmail(email) || !validBuyerWhatsApp(whatsapp))) {
    throw new FormError('Ingresá un correo y un número de WhatsApp válidos.');
  }
  connection.prepare('UPDATE inquiries SET name = ?, contact = ?, message = ?, buyer_email = ?, buyer_whatsapp = ? WHERE id = ?')
    .run(name, legacyContact ? contact : '', message, legacyContact ? '' : email, legacyContact ? '' : whatsapp, record.id);
}

function moneyCents(form, field, label) {
  const value = text(form, field, 32);
  if (!value) return null;
  if (!/^\d{1,11}(?:[.,]\d{1,2})?$/.test(value)) throw new FormError(`Revisá «${label}». Ingresá un importe como 122 o 122,50.`);
  const [whole, decimal = ''] = value.split(/[.,]/);
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}

function agreedCommission(form, sale) {
  const value = text(form, 'commission_agreed', 32);
  if (!value.endsWith('%')) return moneyCents(form, 'commission_agreed', 'Comisión acordada');

  const percent = /^(\d{1,3})(?:[.,](\d{1,2}))?\s*%$/.exec(value);
  const rate = percent ? Number(percent[1]) * 100 + Number((percent[2] ?? '').padEnd(2, '0')) : NaN;
  if (!Number.isFinite(rate) || rate > 10000) throw new FormError('Ingresá un porcentaje entre 0% y 100%, por ejemplo 5%.');
  if (sale === null) throw new FormError('Ingresá el importe de venta para calcular la comisión.');
  return Number((BigInt(sale) * BigInt(rate) + 5000n) / 10000n);
}

function followupDate(form, field) {
  const value = text(form, field, 24);
  if (!value) return '';
  const date = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.valueOf()) || !date.toISOString().startsWith(value)) {
    throw new FormError('Revisá las fechas de cierre y de cobro.');
  }
  return value;
}

export function followupCurrency(record) {
  return record.commission_currency || record.listing_currency
    || referenceEquipment.find(item => item.ref === record.machine_ref)?.currency || '';
}

function saveFollowup(connection, record, form) {
  const stage = text(form, 'stage', 20);
  const origin = text(form, 'origin', 40);
  const minutes = form.has('minutes') ? text(form, 'minutes', 12) : String(record.minutes ?? '');
  const timeframe = text(form, 'timeframe', 12);
  const currency = text(form, 'commission_currency', 12) || followupCurrency(record);
  const sale = moneyCents(form, 'sale_amount', 'Importe de venta');
  const agreed = agreedCommission(form, sale);
  const paid = moneyCents(form, 'commission_paid', 'Comisión cobrada');
  const submittedClose = followupDate(form, 'closed_on');
  const closedOn = stage === 'closed' ? submittedClose || record.closed_on
    || new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short' }).format(new Date()) : '';
  const paidOn = followupDate(form, 'paid_on');
  if (!Object.hasOwn(inquiryStages, stage) || (origin !== record.origin && origin !== defaultInquirySource
    && !Object.values(inquirySources).includes(origin)) || (timeframe && !Object.hasOwn(inquiryTimeframes, timeframe))) {
    throw new FormError('Revisá el estado, el origen y el plazo de la consulta.');
  }
  if (minutes && !/^\d{1,5}$/.test(minutes)) throw new FormError('Ingresá el tiempo de gestión en minutos enteros.');
  if ((currency && !['USD', 'ARS'].includes(currency)) || ([sale, agreed, paid].some(value => value !== null) && !currency)) {
    throw new FormError('Elegí la moneda de los importes.');
  }
  if ((paid !== null && paid <= 0) || (paid !== null) !== Boolean(paidOn) || (paidOn && (!closedOn || paidOn < closedOn))) {
    throw new FormError('Para registrar un cobro, indicá el importe y una fecha igual o posterior al cierre.');
  }
  connection.prepare('UPDATE inquiries SET origin = ? WHERE id = ?').run(origin, record.id);
  connection.prepare(`INSERT INTO inquiry_followups
    (inquiry_id, location, budget, timeframe, stage, minutes, notes, commission_currency, sale_amount,
      commission_agreed, commission_paid, closed_on, paid_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(inquiry_id) DO UPDATE SET location = excluded.location, budget = excluded.budget,
      timeframe = excluded.timeframe, stage = excluded.stage, minutes = excluded.minutes, notes = excluded.notes,
      commission_currency = excluded.commission_currency, sale_amount = excluded.sale_amount,
      commission_agreed = excluded.commission_agreed, commission_paid = excluded.commission_paid,
      closed_on = excluded.closed_on, paid_on = excluded.paid_on`)
    .run(record.id, text(form, 'location', 100), text(form, 'budget', 80), timeframe, stage,
      minutes ? Number(minutes) : null, text(form, 'notes', 2000), currency, sale, agreed, paid, closedOn, paidOn);
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
    } else if (action === 'followup' && kind === 'consulta') {
      saveFollowup(connection, record, form);
    } else if (action === 'seller' && kind === 'aviso') {
      editSeller(connection, record, form);
    } else if (action === 'confirm' && kind === 'aviso') {
      if (record.status !== 'published') throw new FormError('Solo podés confirmar avisos publicados.', 409);
      confirmAvailability(connection, record.ref);
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
  'Precio máximo', 'Disponibilidad confirmada (UTC)',
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
    item.locality, item.province, item.contact, item.video, JSON.parse(item.photos).join(' '), item.price_max,
    item.confirmed_at ? new Date(item.confirmed_at * 1000).toISOString() : '',
  ]);
  return csvDocument(columns, rows);
}

function csvDocument(headers, rows) {
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function inquiryCsv(inquiries = managedInquiries()) {
  const headers = ['Consulta', 'Referencia', 'Equipo', 'Nombre', 'Contacto', 'Mensaje', 'Origen',
    'Localidad y provincia', 'Presupuesto', 'Plazo', 'Estado', 'Ingreso (UTC)', 'Cierre', 'Días hasta el cierre',
    'Minutos de gestión', 'Moneda', 'Importe de venta', 'Comisión acordada', 'Comisión cobrada', 'Fecha de cobro', 'Notas',
    'WhatsApp', 'Correo electrónico'];
  const formatAmount = value => moneyInput(value).replace('.', ',');
  const localDay = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const rows = inquiries.map(item => [
    item.id, item.machine_ref, item.machine_title, item.name, item.contact, item.message, item.origin,
    item.location, item.budget, inquiryTimeframes[item.timeframe], inquiryStages[item.stage], item.created_at,
    item.closed_on, item.closed_on ? Math.round((Date.parse(item.closed_on) -
      Date.parse(localDay.format(new Date(item.created_at.replace(' ', 'T') + 'Z')))) / 86_400_000) : '',
    item.minutes, item.commission_currency, formatAmount(item.sale_amount), formatAmount(item.commission_agreed),
    formatAmount(item.commission_paid), item.paid_on, item.notes, item.buyer_whatsapp, item.buyer_email,
  ]);
  return csvDocument(headers, rows);
}
