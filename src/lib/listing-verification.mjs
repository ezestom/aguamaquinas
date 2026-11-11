import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { db, safeEqual } from './db.mjs';
import { sendMail } from './mail.mjs';

export const verificationCookie = 'aguamaquinas_verificar';
export const codeSeconds = 600;
export const verificationSeconds = 3600;
const maxAttempts = 5;
const hash = value => createHash('sha256').update(value).digest('hex');
const hashCode = (token, code) => createHmac('sha256', token).update(code).digest('hex');
const isToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

export class VerificationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function listingVerification(token) {
  if (!isToken(token)) return;
  return db().prepare(`SELECT email, verified_at FROM listing_verifications
    WHERE token_hash = ? AND expires_at > unixepoch()`).get(hash(token));
}

export async function issueListingCode(rawEmail, previousToken, send = sendMail) {
  const email = rawEmail.trim();
  if (email.length > 254 || !/^[^\s@,<>]+@[^\s@,<>.]+(?:\.[^\s@,<>.]+)+$/.test(email)) {
    throw new VerificationError('Ingresá un correo electrónico válido.');
  }
  const connection = db();
  connection.exec(`DELETE FROM listing_code_requests WHERE created_at <= unixepoch() - 3600;
    DELETE FROM listing_verifications WHERE expires_at <= unixepoch();`);
  const emailHash = hash(email.toLowerCase());
  const reservation = connection.prepare(`INSERT INTO listing_code_requests
    SELECT ?, unixepoch() WHERE (SELECT count(*) FROM listing_code_requests) < 30
    AND (SELECT count(*) FROM listing_code_requests WHERE email_hash = ?) < 3
    AND NOT EXISTS (SELECT 1 FROM listing_code_requests WHERE email_hash = ? AND created_at > unixepoch() - 60)`)
    .run(emailHash, emailHash, emailHash);
  if (!reservation.changes) throw new VerificationError('Por ahora no podemos reenviar el código. Probá más tarde.', 429);

  const token = randomBytes(32).toString('hex');
  const tokenHash = hash(token);
  const code = String(randomInt(1_000_000)).padStart(6, '0');
  connection.prepare(`INSERT INTO listing_verifications (token_hash, email, code_hash, expires_at)
    VALUES (?, ?, ?, unixepoch() + ?)`).run(tokenHash, email, hashCode(token, code), codeSeconds);
  try {
    await send({ to: email, subject: 'Tu código de Agua Máquinas',
      text: `Tu código para publicar es ${code}. Vence en 10 minutos.`, event: `otp/${tokenHash}` });
  } catch {
    connection.prepare('DELETE FROM listing_verifications WHERE token_hash = ?').run(tokenHash);
    throw new VerificationError('No pudimos enviar el código. Probá más tarde.', 503);
  }
  if (isToken(previousToken)) connection.prepare('DELETE FROM listing_verifications WHERE token_hash = ?').run(hash(previousToken));
  return token;
}

export function verifyListingCode(token, code) {
  if (!isToken(token) || !/^\d{6}$/.test(code)) throw new VerificationError('Ingresá el código de seis dígitos.');
  const connection = db();
  const tokenHash = hash(token);
  const challenge = connection.prepare(`UPDATE listing_verifications SET attempts = attempts + 1
    WHERE token_hash = ? AND expires_at > unixepoch() AND attempts < ? AND verified_at IS NULL
    RETURNING code_hash`).get(tokenHash, maxAttempts);
  if (!challenge || !safeEqual(hashCode(token, code), challenge.code_hash)) {
    throw new VerificationError('El código no es válido o venció. Revisalo o pedí uno nuevo.');
  }
  const result = connection.prepare(`UPDATE listing_verifications SET verified_at = unixepoch(), expires_at = unixepoch() + ?, code_hash = ''
    WHERE token_hash = ? AND expires_at > unixepoch() AND verified_at IS NULL`).run(verificationSeconds, tokenHash);
  if (!result.changes) throw new VerificationError('El código ya se usó o venció.');
}

export function consumeListingVerification(connection, token) {
  if (!isToken(token)) return;
  return connection.prepare(`DELETE FROM listing_verifications
    WHERE token_hash = ? AND expires_at > unixepoch() AND verified_at IS NOT NULL
    RETURNING email, verified_at`).get(hash(token));
}
