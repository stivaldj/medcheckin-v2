import { createHash, randomBytes } from 'node:crypto';

/** Token aleatório URL-safe (32 bytes → 43 chars). Nunca vai ao banco em claro. */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex — o que fica no banco. */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
