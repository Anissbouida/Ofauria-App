/**
 * Facturation à l'avancement — situations de travaux (mig 713), sur une vraie base :
 * marché = devis accepté avec un lot et deux ouvrages ; situation 1, validation, situation 2
 * calculée sur le cumul précédent ; l'avancement ne recule pas ; conditions figées après
 * la première validation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Situations de travaux', () => {
  let fx: Fixtures;
  let quoteId = '';
  let itemA = '';
  let itemB = '';
  let repo: typeof import('../../repositories/progress-billing.repository.js').progressBillingRepository;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    repo = (await import('../../repositories/progress-billing.repository.js')).progressBillingRepository;
    const p = testPool();
    quoteId = (await p.query(
      `INSERT INTO quotes (number, store_id, prospect_name, title, status, quote_date, valid_until, with_tax, subtotal, total, created_by)
       VALUES ($1, $2, 'Maître d''ouvrage', 'Immeuble R+4', 'accepted', CURRENT_DATE, CURRENT_DATE + 30, true, 1000000, 1200000, $3) RETURNING id`,
      [`DV-${RUN}`, fx.storeId, fx.userId])).rows[0].id;
    await p.query(`INSERT INTO quote_items (quote_id, description, quantity, unit_price, subtotal, display_order, line_type)
                   VALUES ($1, 'Lot 1 — Gros œuvre', 0, 0, 0, 1, 'section')`, [quoteId]);
    itemA = (await p.query(`INSERT INTO quote_items (quote_id, description, quantity, unit_price, tva_rate, subtotal, display_order, line_type)
                   VALUES ($1, 'Fondations', 1, 600000, 20, 600000, 2, 'free') RETURNING id`, [quoteId])).rows[0].id;
    itemB = (await p.query(`INSERT INTO quote_items (quote_id, description, quantity, unit_price, tva_rate, subtotal, display_order, line_type)
                   VALUES ($1, 'Élévation', 1, 400000, 20, 400000, 3, 'free') RETURNING id`, [quoteId])).rows[0].id;
  });

  afterAll(async () => {
    const p = testPool();
    if (!quoteId) { await cleanupFixtures(fx); await closeTestPool(); return; }
    await p.query(`DELETE FROM progress_billings WHERE quote_id = $1`, [quoteId]);
    await p.query(`DELETE FROM quote_items WHERE quote_id = $1`, [quoteId]);
    await p.query(`DELETE FROM quotes WHERE id = $1`, [quoteId]);
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('prépare la première situation : ouvrages rangés sous leur lot, rien de facturé', async () => {
    await repo.setTerms(quoteId, { retentionPct: 10, advanceAmount: 100000, advanceRecoveryPct: 10 });
    const base = await repo.prepare(quoteId);
    expect(base.situationNo).toBe(1);
    expect(base.items.map(i => [i.lot, i.label, i.contractAmount])).toEqual([
      ['Lot 1 — Gros œuvre', 'Fondations', 600000], ['Lot 1 — Gros œuvre', 'Élévation', 400000]]);
  });

  it('situation 1 : 50 % des fondations, retenue et avance déduites, TVA sur le net', async () => {
    const s = await repo.saveDraft(quoteId, { periodEnd: '2026-10-31', lines: [{ quoteItemId: itemA, pctCumulative: 50 }] }, fx.userId);
    expect(Number(s.period_ht)).toBe(300000);
    expect(Number(s.retention_amount)).toBe(30000);
    expect(Number(s.advance_recovery_amount)).toBe(30000);
    expect(Number(s.net_ht)).toBe(240000);
    expect(Number(s.total_ttc)).toBe(288000);
    await repo.validate(s.id, fx.userId);
  });

  it('les conditions du marché sont figées après validation', async () => {
    await expect(repo.setTerms(quoteId, { retentionPct: 5, advanceAmount: 0, advanceRecoveryPct: 0 })).rejects.toThrow(/figées/);
  });

  it('situation 2 : la période est le cumul moins la situation 1, l’avance est bornée au reste', async () => {
    await expect(repo.saveDraft(quoteId, { periodEnd: '2026-11-30', lines: [{ quoteItemId: itemA, pctCumulative: 40 }] }, fx.userId))
      .rejects.toThrow(/reculer/);
    const s = await repo.saveDraft(quoteId, { periodEnd: '2026-11-30', lines: [
      { quoteItemId: itemA, pctCumulative: 100 }, { quoteItemId: itemB, pctCumulative: 100 }] }, fx.userId);
    expect(s.situation_no).toBe(2);
    expect(Number(s.previous_ht)).toBe(300000);
    expect(Number(s.period_ht)).toBe(700000);
    // 10 % de 700 000 = 70 000, mais il ne reste que 70 000 d'avance (100 000 − 30 000).
    expect(Number(s.advance_recovery_amount)).toBe(70000);
    expect(Number(s.retention_amount)).toBe(70000);
    expect(Number(s.net_ht)).toBe(560000);
    await repo.validate(s.id, fx.userId);
    const list = await repo.contracts();
    const mine = list.find((c: { id: string }) => c.id === quoteId);
    expect(mine.cumulative_ht).toBe(1000000);
    expect(mine.retention_held).toBe(100000);
  });

  it('une ligne de bon de commande affectée au chantier compte dans ses achats engagés (mig 716)', async () => {
    const p = testPool();
    const projectId = (await p.query(`INSERT INTO projects (number, name, store_id, created_by) VALUES ($1, 'Chantier R+4', $2, $3) RETURNING id`,
      [`PRJ-${RUN}`, fx.storeId, fx.userId])).rows[0].id;
    const supplierId = (await p.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Négoce matériaux ${RUN}`])).rows[0].id;
    const poId = (await p.query(`INSERT INTO purchase_orders (order_number, supplier_id, store_id, status) VALUES ($1, $2, $3, 'en_attente') RETURNING id`,
      [`BC-${RUN}`, supplierId, fx.storeId])).rows[0].id;
    // Ligne de service : désignation + catégorie de dépense obligatoires (po_item_kind_check).
    const cat = (await p.query(`SELECT id FROM expense_categories ORDER BY created_at LIMIT 1`)).rows[0].id;
    await p.query(`INSERT INTO purchase_order_items (purchase_order_id, line_type, description, category_id, quantity_ordered, quantity_delivered, unit_price, project_id)
                   VALUES ($1, 'service', 'Location grue', $3, 2, 1, 5000, $2), ($1, 'service', 'Hors chantier', $3, 1, 0, 999, NULL)`, [poId, projectId, cat]);
    const { projectRepository } = await import('../../repositories/project.repository.js');
    const prj = await projectRepository.findById(projectId);
    expect(Number(prj.committed_purchases)).toBe(10000);
    expect(Number(prj.received_purchases)).toBe(5000);
    await p.query(`DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, [poId]);
    await p.query(`DELETE FROM purchase_orders WHERE id = $1`, [poId]);
    await p.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
  });

  it('un devis non accepté ne se facture pas à l’avancement', async () => {
    await testPool().query(`UPDATE quotes SET status = 'sent' WHERE id = $1`, [quoteId]);
    await expect(repo.prepare(quoteId)).rejects.toThrow(/accepté/);
    await testPool().query(`UPDATE quotes SET status = 'accepted' WHERE id = $1`, [quoteId]);
  });
});
