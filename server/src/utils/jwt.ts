import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

interface TokenPayload {
  userId: string;
  role: string;
  storeId?: string;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}
