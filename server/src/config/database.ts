import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * Cloisonnement par établissement (RLS, mig 436). Une requête HTTP d'un
 * utilisateur rattaché à un magasin s'exécute dans runWithStoreScope : chaque
 * connexion qu'elle emprunte porte app.store_scope, et Postgres filtre les
 * tables comptables (politiques p_store_scope). Hors périmètre : aucune
 * surcharge, le pool est utilisé tel quel. Le paramètre est remis à zéro avant
 * de rendre la connexion au pool, pour ne jamais fuiter vers une autre requête.
 */
const storeScope = new AsyncLocalStorage<{ storeId: string }>();
export function runWithStoreScope<T>(storeId: string, fn: () => T): T {
  return storeScope.run({ storeId }, fn);
}
export const currentStoreScope = () => storeScope.getStore()?.storeId ?? null;

async function scopedClient(storeId: string): Promise<pg.PoolClient> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.store_scope', $1, false)`, [storeId]);
  } catch (err) {
    client.release(true);
    throw err;
  }
  const release = client.release.bind(client);
  // Remise à zéro avant retour au pool ; en cas d'échec, la connexion est détruite.
  client.release = ((err?: Error | boolean) => {
    client.release = release;
    if (err) { release(err); return; }
    client.query(`RESET app.store_scope`).then(() => release(), () => release(true));
  }) as typeof client.release;
  return client;
}

export const db = {
  query: async (text: string, params?: unknown[]) => {
    const scope = storeScope.getStore();
    if (!scope) return pool.query(text, params);
    const client = await scopedClient(scope.storeId);
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  },
  getClient: () => {
    const scope = storeScope.getStore();
    return scope ? scopedClient(scope.storeId) : pool.connect();
  },
  pool,
};
