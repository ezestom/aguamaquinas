import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { seed } from './seed.mjs';

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
      message TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insert = connection.prepare(`INSERT INTO machines
    (ref, title, category, brand, model, province, format, format_detail, capacity, condition, price, currency, photos, description, status, sample)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1) ON CONFLICT(ref) DO NOTHING`);
  connection.exec('BEGIN IMMEDIATE');
  try {
    for (const row of seed) {
      const record = [...row];
      record[0] = `AM-${record[0]}`;
      record[12] = JSON.stringify([`/equipos/${record[12]}.webp`]);
      insert.run(...record);
    }
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    connection.close();
    throw error;
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

export function adminSession() {
  return createHmac('sha256', adminKey()).update('aguamaquinas:panel:v1').digest('hex');
}

export function getPhotos(machine) {
  return JSON.parse(machine.photos);
}
