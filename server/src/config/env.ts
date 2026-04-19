import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'change-me-in-production') {
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET doit etre defini en production (variable d\'environnement manquante ou valeur par defaut)');
  }
  console.warn('⚠️  JWT_SECRET non defini ou valeur par defaut — acceptable en dev uniquement');
}

export const env = {
  PORT: parseInt(process.env.SERVER_PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://ofauria:ofauria_secret@localhost:5432/ofauria_db',
  JWT_SECRET: jwtSecret || 'dev-only-secret-not-for-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
};
