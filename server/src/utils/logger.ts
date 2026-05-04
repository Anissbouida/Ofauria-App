import pino from 'pino';
import { env } from '../config/env.js';

const IS_PROD = env.NODE_ENV === 'production';

/**
 * OWASP A09-4 / CWE-532 : logger structure avec redaction automatique
 * des champs sensibles (credentials, tokens, PII courants).
 *
 * En dev : output formate via pino-pretty (lisible en console).
 * En prod : JSON structure, un event par ligne (stdout) consommable par
 * un stack de logs centralise (Loki, Elastic, etc.).
 */
export const logger = pino({
  level: IS_PROD ? 'info' : 'debug',
  base: { service: 'ofauria-server' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Redaction : remplace les valeurs matchantes par "[REDACTED]" avant serialisation.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.headers["x-timezone"]', // pas sensible mais bruyant
      'res.headers["set-cookie"]',
      '*.password',
      '*.pinCode',
      '*.pin_code',
      '*.passwordHash',
      '*.password_hash',
      '*.token',
      '*.jwt',
      '*.secret',
      '*.apiKey',
      '*.api_key',
      'body.password',
      'body.pinCode',
      'body.newPassword',
    ],
    censor: '[REDACTED]',
  },
  transport: IS_PROD
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service',
        },
      },
});
