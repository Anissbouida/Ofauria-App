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

  it('balance : mouvements et soldes débit = crédit', async () => {
    const t = total(await E.buildBalance({ startDate: start, endDate: end }));
    expect(t.md).toBe(t.mc);
    expect(t.cd).toBe(t.cc);
    expect(Number(t.md)).toBeGreaterThan(0);
  });

  it('livre-journal : total débit = total crédit, une ligne de titre par écriture', async () => {
    const j = await E.buildJournal({ startDate: start, endDate: end });
    const t = total(j);
    expect(t.debit).toBe(t.credit);
    const groups = j.rows.filter(r => r.kind === 'group').length;
    expect(String(t.label)).toContain(`(${groups} écriture(s))`);
  });

  it('bilan : total actif = total passif, comme le repository', async () => {
    const b = await E.buildBilan({ endDate: end });
    const totals = b.rows.filter(r => r.kind === 'total').map(r => r.cells.amount);
    const { balanceSheetRepository } = await import('../../repositories/ledger.repository.js');
    const sheet = await balanceSheetRepository.balanceSheet({ endDate: end });
    expect(totals).toEqual([sheet.actif.total, sheet.passif.total]);
  });

  it('rend chaque état en PDF et en Excel', async () => {
    const ctx = await E.editionContext((await repos.db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)).rows[0].id);
    for (const e of [await E.buildCpc({ startDate: start, endDate: end }), await E.buildBalanceAgee({ side: 'suppliers', asOf: end })]) {
      expect((await E.renderPdf(e, ctx)).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await E.renderXlsx(e, ctx)).subarray(0, 2).toString()).toBe('PK');
    }
  });
});
