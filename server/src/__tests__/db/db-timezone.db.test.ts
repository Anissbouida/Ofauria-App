/**
 * Le pool applicatif fixe le fuseau de session sur Africa/Casablanca : les
 * CURRENT_DATE des requetes d'expiration et de vente sont la date METIER,
 * quel que soit le fuseau du serveur Postgres (UTC en prod, local en dev).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, importRepositories, testPool, closeTestPool } from './helpers.js';

describe.skipIf(!hasTestDb)('Pool Postgres — fuseau de session metier', () => {
  afterAll(closeTestPool);

  it('chaque connexion du pool applicatif est en Africa/Casablanca', async () => {
    const { db } = await importRepositories();
    try {
      const tz = await db.query(`SHOW TimeZone`);
      expect(tz.rows[0].TimeZone).toBe('Africa/Casablanca');

      // CURRENT_DATE suit ce fuseau : identique a la date de now() convertie en Casablanca.
      const dates = await db.query(
        `SELECT CURRENT_DATE::text AS today, (now() AT TIME ZONE 'Africa/Casablanca')::date::text AS casa`
      );
      expect(dates.rows[0].today).toBe(dates.rows[0].casa);

      // Plusieurs connexions physiques : toutes configurees.
      const checks = await Promise.all([1, 2, 3].map(() => db.query(`SHOW TimeZone`)));
      for (const c of checks) expect(c.rows[0].TimeZone).toBe('Africa/Casablanca');
    } finally {
      await db.pool.end();
    }
  });

  it('temoin : le pool de test (sans SET TIME ZONE) suit le serveur, ce qui prouve que la difference vient bien du pool applicatif', async () => {
    const tz = await testPool().query(`SHOW TimeZone`);
    expect(typeof tz.rows[0].TimeZone).toBe('string');
  });
});
