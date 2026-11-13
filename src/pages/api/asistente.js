import { askAssistant, assistantContext } from '../../lib/assistant.mjs';

const minute = 60_000;
const limits = new Map();
let nextSweep = 0;

function admit(address, now) {
  if (now >= nextSweep) {
    for (const [id, bucket] of limits) if (bucket.until <= now) limits.delete(id);
    nextSweep = now + minute;
  }
  const client = 'client:' + address;
  for (const [id, max] of [['all', 30], [client, 8]]) {
    const bucket = limits.get(id);
    if (bucket?.until > now && bucket.count >= max) return false;
  }
  for (const id of ['all', client]) {
    const bucket = limits.get(id);
    if (bucket?.until > now) bucket.count += 1;
    else limits.set(id, { count: 1, until: now + minute });
  }
  return true;
}

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});

export async function POST({ request, url, clientAddress }) {
  const fetchSite = request.headers.get('sec-fetch-site');
  const sameOrigin = fetchSite ? fetchSite === 'same-origin' : request.headers.get('origin') === url.origin;
  if (!sameOrigin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return json({ error: 'No se pudo iniciar la consulta.' }, 403);
  }
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return json({ error: 'El asistente todavía no está disponible.' }, 503);
  if (!admit(clientAddress, Date.now())) {
    return json({ error: 'Hay muchas consultas. Volvé a intentar en un minuto.' }, 429, { 'Retry-After': '60' });
  }

  let messages;
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) {
        void reader.cancel().catch(() => {});
        return json({ error: 'La consulta es demasiado larga.' }, 413);
      }
      chunks.push(value);
    }
    messages = JSON.parse(Buffer.concat(chunks).toString('utf8')).messages;
  } catch {
    return json({ error: 'No pudimos leer tu consulta.' }, 400);
  }
  if (!Array.isArray(messages) || !messages.length || messages.length > 7 ||
      messages.at(-1)?.role !== 'user' || messages.some((entry, index) =>
        entry?.role !== (index % 2 ? 'assistant' : 'user') ||
        typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > (index % 2 ? 2500 : 700))) {
    return json({ error: 'Revisá el mensaje y volvé a intentar.' }, 400);
  }
  messages = messages.map(({ role, content }) => ({ role, content: content.trim() }));
  try {
    const result = await askAssistant({
      key, model: process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b', messages,
      sources: assistantContext(messages), signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    return json(result);
  } catch {
    return json({ error: 'El asistente no pudo responder. Podés reintentar o usar el contacto de Aguamáquinas.' }, 502);
  }
}
