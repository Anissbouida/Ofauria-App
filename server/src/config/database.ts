import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

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
    logger.error({ err: err }, '[db] impossible de fixer le fuseau de session');
  });
});

pool.on('error', (err) => {
  logger.error({ err: err }, 'Unexpected error on idle client');
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

/**
 * Transaction ambiante (G0-14, plan d'action 2026-11).
 *
 * `withTransaction(fn)` ouvre UNE transaction et exécute `fn` dedans : tout
 * `db.query` et tout `db.getClient()` appelés pendant `fn` — y compris au fond
 * d'un autre dépôt de données — empruntent la même connexion. Un BEGIN / COMMIT /
 * ROLLBACK émis par ce code devient un point de sauvegarde. Si `fn` lève, tout
 * est annulé ; sinon tout est validé d'un coup. C'est l'équivalent d'un bloc
 * PL/SQL unique avec un seul COMMIT final.
 *
 * Imbriqué dans une transaction ambiante, `withTransaction` pose simplement un
 * point de sauvegarde. Hors transaction ambiante, `db` se comporte comme avant.
 */
type TxState = { client: pg.PoolClient; depth: number };
const txContext = new AsyncLocalStorage<TxState>();

/** Connexion « empruntée » à la transaction ambiante : release sans effet, BEGIN = point de sauvegarde. */
function borrowedClient(tx: TxState): pg.PoolClient {
  const names: string[] = [];
  const query = (text: unknown, params?: unknown[]) => {
    const t = typeof text === 'string' ? text.trim().replace(/;$/, '').toUpperCase() : '';
    if (t === 'BEGIN' || t.startsWith('BEGIN ') || t === 'START TRANSACTION') {
      const sp = `sp_${++tx.depth}`;
      names.push(sp);
      return tx.client.query(`SAVEPOINT ${sp}`);
    }
    if (t === 'COMMIT' || t === 'END') {
      const sp = names.pop();
      return sp ? tx.client.query(`RELEASE SAVEPOINT ${sp}`) : Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (t === 'ROLLBACK') {
      const sp = names.pop();
      return sp ? tx.client.query(`ROLLBACK TO SAVEPOINT ${sp}`) : Promise.resolve({ rows: [], rowCount: 0 });
    }
    return (tx.client.query as (...a: unknown[]) => unknown)(text, params);
  };
  return new Proxy(tx.client, {
    get(target, prop) {
      if (prop === 'query') return query;
      if (prop === 'release') return () => undefined;
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as pg.PoolClient;
}

export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const outer = txContext.getStore();
  if (outer) {
    const sp = `sp_${++outer.depth}`;
    await outer.client.query(`SAVEPOINT ${sp}`);
    try {
      const out = await fn();
      await outer.client.query(`RELEASE SAVEPOINT ${sp}`);
      return out;
    } catch (err) {
      await outer.client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => undefined);
      throw err;
    }
  }
  const scope = storeScope.getStore();
  const client = scope ? await scopedClient(scope.storeId) : await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await txContext.run({ client, depth: 0 }, fn);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Vrai si l'appel courant s'exécute dans une transaction ambiante. */
export const inTransaction = () => txContext.getStore() !== undefined;

/**
 * G3-03 — requêtes lentes : au-delà de SLOW_QUERY_MS (500 ms par défaut), une ligne de journal
 * structurée avec la durée et le début du SQL. Jamais les paramètres (données personnelles).
 */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 500);
async function timed<T>(text: string, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    const ms = performance.now() - t0;
    if (ms >= SLOW_QUERY_MS) {
      logger.warn({ slowQueryMs: Math.round(ms), sql: text.replace(/\s+/g, ' ').trim().slice(0, 300) }, 'requête SQL lente');
    }
  }
}

export const db = {
  query: async (text: string, params?: unknown[]) => timed(text, () => runQuery(text, params)),
  getClient: (): Promise<pg.PoolClient> => {
    const tx = txContext.getStore();
    if (tx) return Promise.resolve(borrowedClient(tx));
    const scope = storeScope.getStore();
    return scope ? scopedClient(scope.storeId) : pool.connect();
  },
  pool,
};

async function runQuery(text: string, params?: unknown[]) {
  const tx = txContext.getStore();
  if (tx) return tx.client.query(text, params);
  const scope = storeScope.getStore();
  if (!scope) return pool.query(text, params);
  const client = await scopedClient(scope.storeId);
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
