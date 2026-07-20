import { randomBytes, createHash } from 'node:crypto';

/** Raw token sent to the user via an emailed link. Never stored as-is. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Digest of a raw token, persisted in place of the token itself. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
