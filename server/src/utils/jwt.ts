import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';

interface TokenPayload {
  userId: string;
  role: string;
  storeId?: string;
  // OWASP A07-5 : version incrementee quand les privileges changent,
  // force les tokens existants a etre refuses apres un changement de role.
  tokenVersion: number;
}

// Payload decode incluant les claims standards JWT (iat, exp, jti).
export interface VerifiedPayload extends TokenPayload {
  jti: string;
  iat: number;
  exp: number;
}

export function generateToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    jwtid: randomUUID(),
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): VerifiedPayload {
  return jwt.verify(token, env.JWT_SECRET) as VerifiedPayload;
}
