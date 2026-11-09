import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { matches, videoLink } from '../src/lib/catalog.mjs';
import { db } from '../src/lib/db.mjs';
import { submitMachine } from '../src/lib/submissions.mjs';

const sandbox = await mkdtemp(join(tmpdir(), 'agua-test-'));
process.env.AGUA_DATA_DIR = sandbox;
const connection = db();
after(async () => { connection.close(); await rm(sandbox, { recursive: true, force: true }); });

test('buscar por capacidad, referencia y provincia', () => {
  assert.equal(connection.prepare('SELECT count(*) AS count FROM machines WHERE sample = 1').get().count, 12);
  const first = connection.prepare("SELECT * FROM machines WHERE ref = 'AM-1041'").get();
  assert.equal(matches(first, new URLSearchParams({ q: 'llenadora 20 litros', provincia: 'Córdoba' })), true);
  assert.equal(matches(first, new URLSearchParams({ q: 'am1041' })), true);
  assert.equal(matches(first, new URLSearchParams({ q: 'AM-1041', provincia: 'Santa Fe' })), false);
  assert.equal(matches(first, new URLSearchParams({ q: 'am-1041' })), true);
});

test('los videos son enlaces seguros y específicos', () => {
  assert.equal(videoLink('https://youtu.be/dQw4w9WgXcQ?t=30'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(videoLink('https://www.youtube.com/redirect?q=https://example.com'), null);
  assert.equal(videoLink('https://youtube.com.example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(videoLink('javascript:alert(1)'), null);
});

test('los avisos quedan pendientes y una imagen inválida limpia la carga parcial', async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toBuffer();
  const form = new FormData();
  for (const [key, value] of Object.entries({ title: 'Lavadora de prueba', category: 'lavadoras', province: 'Córdoba',
    format: 'bidones', condition: 'usado', seller: 'Persona de prueba', contact: 'demo@example.com', description: 'Equipo para probar el alta.', currency: 'ARS' })) {
    form.set(key, value);
  }
  form.append('photos', new File([png], 'valid.png', { type: 'image/png' }));
  form.append('photos', new File(['inválida'], 'invalid.png', { type: 'image/png' }));
  await assert.rejects(submitMachine(form), /No pudimos leer/);
  assert.deepEqual(await readdir(join(sandbox, 'fotos')), []);
  form.set('photos', new File([png], 'valid.png', { type: 'image/png' }));
  const ref = await submitMachine(form);
  const machine = connection.prepare('SELECT * FROM machines WHERE ref = ?').get(ref);
  assert.equal(machine.status, 'pending');
  assert.match(machine.photos, /\.webp/);
  assert.equal((await readdir(join(sandbox, 'fotos'))).length, 1);
});
