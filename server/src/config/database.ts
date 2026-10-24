import pg from 'pg';
import { env } from './env.js';

/**
 * Fuseau METIER de la base. Les DLC des lots (product_lots.expires_at) sont des
 * dates calculees en Africa/Casablanca cote application, et les requetes
 * d'expiration / de vente les comparent a CURRENT_DATE, qui suit le fuseau de
 * la SESSION Postgres. Sans cette ligne, un serveur en UTC (Cloud SQL) ou en
 * heure locale d'un poste de dev decale « jour meme » autour de minuit.
 * Pose a chaque connexion physique du pool : independant de la configuration
 * du serveur et de la base.
 */
export const DB_TIMEZONE = 'Africa/Casablanca';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

pool.on('connect', (client) => {
  client.query(`SET TIME ZONE '${DB_TIMEZONE}'`).catch((err) => {
    console.error('[db] impossible de fixer le fuseau de session', err);
  });
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const db = {
  query: (text: string, params?: unknown[]) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
