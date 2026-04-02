import pg from 'pg';
import { env } from './env.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
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
