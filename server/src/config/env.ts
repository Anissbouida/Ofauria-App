import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ─── JWT_SECRET ────────────────────────────────────────────────
// Doit etre defini dans tous les environnements, aleatoire, >= 32 caracteres.
// Generer avec : openssl rand -hex 32
const FORBIDDEN_SECRETS = new Set([
  '',
  'change-me-in-production',
  'dev-only-secret-not-for-production',
  'secret',
  'changeme',
]);

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || FORBIDDEN_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET doit etre defini (>= 32 caracteres aleatoires) dans tous les environnements. ' +
    'Generer avec: openssl rand -hex 32'
  );
}

// ─── JWT_EXPIRES_IN ────────────────────────────────────────────
// Whitelist pour eviter les tokens a duree quasi-infinie.
const ALLOWED_JWT_EXPIRES = new Set(['15m', '30m', '1h', '2h', '4h', '8h', '12h', '24h', '7d']);
const jwtExpires = process.env.JWT_EXPIRES_IN || '8h';
if (!ALLOWED_JWT_EXPIRES.has(jwtExpires)) {
  throw new Error(
    `JWT_EXPIRES_IN invalide (valeur=${jwtExpires}). ` +
    `Valeurs autorisees: ${[...ALLOWED_JWT_EXPIRES].join(', ')}`
  );
}

// ─── DATABASE_URL ──────────────────────────────────────────────
// Plus de fallback avec credentials hardcodes (OWASP A02 / CWE-798).
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL doit etre defini (variable d\'environnement manquante)');
}

export const env = {
  PORT: parseInt(process.env.SERVER_PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: jwtExpires,
};
