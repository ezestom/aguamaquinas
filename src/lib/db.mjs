import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';

export const dataDir = () => resolve(process.env.AGUA_DATA_DIR || './data');
let database;

export function db() {
  if (database) return database;
  mkdirSync(dataDir(), { recursive: true });
  const connection = new DatabaseSync(resolve(dataDir(), 'aguamaquinas.sqlite'));
  connection.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY, ref TEXT UNIQUE, title TEXT NOT NULL, category TEXT NOT NULL,
      brand TEXT NOT NULL, model TEXT NOT NULL, province TEXT NOT NULL, format TEXT NOT NULL,
      format_detail TEXT NOT NULL, capacity TEXT NOT NULL, condition TEXT NOT NULL,
      price INTEGER, currency TEXT NOT NULL, photos TEXT NOT NULL, description TEXT NOT NULL,
      video TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', seller TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','paused','sold')),
      sample INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY, machine_ref TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
      message TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      buyer_email TEXT NOT NULL DEFAULT '', buyer_whatsapp TEXT NOT NULL DEFAULT '',
      machine_title_at_submission TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS inquiries_created_at ON inquiries(created_at);
    CREATE TABLE IF NOT EXISTS inquiry_followups (
      inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id),
      location TEXT NOT NULL DEFAULT '', budget TEXT NOT NULL DEFAULT '', timeframe TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'new', minutes INTEGER, notes TEXT NOT NULL DEFAULT '',
      commission_currency TEXT NOT NULL DEFAULT '', sale_amount INTEGER, commission_agreed INTEGER,
      commission_paid INTEGER, closed_on TEXT NOT NULL DEFAULT '', paid_on TEXT NOT NULL DEFAULT '',
      manual INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listing_upload_attempts (started_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS listing_verifications (
      token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, verified_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS listing_code_requests (email_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS listing_contacts (
      machine_ref TEXT PRIMARY KEY, email TEXT NOT NULL, phone TEXT NOT NULL,
      address TEXT NOT NULL, locality TEXT NOT NULL, verified_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listing_details (
      machine_ref TEXT PRIMARY KEY REFERENCES machines(ref),
      price_max INTEGER, confirmed_at INTEGER, reminder_attempted_at INTEGER, reminded_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS notification_outbox (event TEXT PRIMARY KEY, sent_at INTEGER);
    CREATE TABLE IF NOT EXISTS panel_trash (
      kind TEXT NOT NULL, record_key TEXT NOT NULL, previous_status TEXT,
      deleted_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (kind, record_key)
    );
    CREATE TABLE IF NOT EXISTS home_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL,
      label TEXT NOT NULL, href TEXT NOT NULL, position INTEGER NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0, 1)), image BLOB,
      sponsored INTEGER NOT NULL DEFAULT 0 CHECK(sponsored IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS home_featured (
      position INTEGER PRIMARY KEY, machine_ref TEXT NOT NULL UNIQUE,
      sponsored INTEGER NOT NULL CHECK(sponsored IN (0, 1))
    );
  `);
  const columns = [
    ['home_campaigns', 'sponsored', 'INTEGER NOT NULL DEFAULT 0 CHECK(sponsored IN (0, 1))'],
    ['inquiry_followups', 'manual', 'INTEGER NOT NULL DEFAULT 0'],
    ['inquiries', 'buyer_email', "TEXT NOT NULL DEFAULT ''"],
    ['inquiries', 'buyer_whatsapp', "TEXT NOT NULL DEFAULT ''"],
    ['inquiries', 'machine_title_at_submission', "TEXT NOT NULL DEFAULT ''"],
  ];
  const hasColumn = connection.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?');
  if (columns.some(([table, column]) => !hasColumn.get(table, column))) {
    connection.exec('BEGIN IMMEDIATE');
    try {
      for (const [table, column, definition] of columns) {
        if (!hasColumn.get(table, column)) connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
      connection.exec('COMMIT');
    } catch (error) {
      connection.exec('ROLLBACK');
      connection.close();
      throw error;
    }
  }
  database = connection;
  return database;
}

export function adminKey() {
  if (process.env.AGUA_ADMIN_KEY) return process.env.AGUA_ADMIN_KEY;
  mkdirSync(dataDir(), { recursive: true });
  const file = resolve(dataDir(), 'clave-panel.txt');
  try { writeFileSync(file, randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readFileSync(file, 'utf8').trim();
}

export function safeEqual(left, right) {
  const a = Buffer.from(left ?? '');
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const adminSessionCookie = 'aguamaquinas_panel';
export const adminSessionSeconds = 3600;

const sessionHash = token => createHmac('sha256', adminKey()).update(`aguamaquinas:panel:v2:${token}`).digest('hex');
const isSessionToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

export function createAdminSession() {
  const token = randomBytes(32).toString('hex');
  const connection = db();
  connection.exec('DELETE FROM admin_sessions WHERE expires_at <= unixepoch()');
  connection.prepare('INSERT INTO admin_sessions VALUES (?, unixepoch() + ?)').run(sessionHash(token), adminSessionSeconds);
  return token;
}

export function hasAdminSession(token) {
  return isSessionToken(token) && Boolean(db().prepare(
    'SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > unixepoch()',
  ).get(sessionHash(token)));
}

export function revokeAdminSession(token) {
  if (isSessionToken(token)) db().prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sessionHash(token));
}

export function getPhotos(machine) {
  return JSON.parse(machine.photos);
}
