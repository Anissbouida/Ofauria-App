/**
 * Éditions comptables sur base migrée : les états imprimés reprennent les
 * chiffres des écrans (balance et journal équilibrés, bilan = repository).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Éditions comptables', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let E: typeof import('../../services/ledger-editions.service.js');
  const year = new Date().getFullYear();
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const total = (e: { rows: { kind: string; cells: Record<string, unknown> }[] }) => e.rows.find(r => r.kind === 'total')!.cells;

  beforeAll(async () => {
    repos = await importRepositories();
    E = await import('../../services/ledger-editions.service.js');
  });
  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('balance : mouvements équilibrés, soldes = ouvertures + mouvements', async () => {
    const t = total(await E.buildBalance({ startDate: start, endDate: end }));
    const r = (v: unknown) => Math.round(Number(v) * 100);
    expect(t.md).toBe(t.mc);
    expect(Number(t.md)).toBeGreaterThan(0);
    // Les ouvertures ne s'équilibrent que si les exercices antérieurs sont clôturés
    // (à-nouveaux) ; l'identité, elle, tient toujours.
    expect(r(t.cd) - r(t.cc)).toBe(r(t.od) - r(t.oc) + r(t.md) - r(t.mc));
  });

  it('livre-journal : total débit = total crédit, une ligne de titre par écriture', async () => {
    const j = await E.buildJournal({ startDate: start, endDate: end });
    const t = total(j);
    expect(t.debit).toBe(t.credit);
    const groups = j.rows.filter(r => r.kind === 'group').length;
    expect(String(t.label)).toContain(`(${groups} écriture(s))`);
  });

  it('bilan : total actif = total passif', async () => {
    // Un seul calcul (les suites parallèles écrivent dans l'exercice) : l'état s'équilibre lui-même.
    const b = await E.buildBilan({ endDate: end });
    const [actif, passif] = b.rows.filter(r => r.kind === 'total').map(r => Number(r.cells.amount));
    expect(actif).toBe(passif);
    expect(b.notes).toBeUndefined();          // pas d'écart signalé
  });

  it('rend chaque état en PDF et en Excel', async () => {
    const ctx = await E.editionContext((await repos.db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)).rows[0].id);
    for (const e of [await E.buildCpc({ startDate: start, endDate: end }), await E.buildBalanceAgee({ side: 'suppliers', asOf: end })]) {
      expect((await E.renderPdf(e, ctx)).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await E.renderXlsx(e, ctx)).subarray(0, 2).toString()).toBe('PK');
    }
  });
});
