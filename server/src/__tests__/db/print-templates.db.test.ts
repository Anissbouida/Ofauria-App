/**
 * M8-04 — gabarits d'impression du module (mig 582) : modèle général puis variante propre
 * à un type d'ordre ; la suppression de la variante rend le modèle général.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Gabarits d\'impression (M8-04)', () => {
  let repo: typeof import('../../repositories/print-template.repository.js')['printTemplateRepository'];
  const p = () => testPool();
  let typeId = '', userId = '';
  let saved: { title: string | null; layout: object; footer_note: string | null } | undefined;

  beforeAll(async () => {
    repo = (await import('../../repositories/print-template.repository.js')).printTemplateRepository;
    userId = (await p().query(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).rows[0].id;
    typeId = (await p().query(
      `INSERT INTO production_order_types (code, label, requires_bon_sortie, requires_weighing, consumption_mode)
       VALUES ($1, 'Test M8-04', false, false, 'a_la_declaration') RETURNING id`, [`M804_${RUN}`.slice(0, 30)])).rows[0].id;
    saved = (await p().query(`SELECT title, layout, footer_note FROM document_templates WHERE doc_type = 'production_fiche'`)).rows[0];
  });

  afterAll(async () => {
    if (saved) await p().query(`UPDATE document_templates SET title = $1, layout = $2, footer_note = $3 WHERE doc_type = 'production_fiche'`,
      [saved.title, JSON.stringify(saved.layout), saved.footer_note]).catch(() => undefined);
    await p().query(`DELETE FROM production_order_types WHERE id = $1`, [typeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('modèle général, variante, retour au général', async () => {
    await repo.updateBase('production_fiche', { title: 'Rapport de fabrication', signatures: ['Chef d\'atelier'] }, userId);
    let t = await repo.resolve('production_fiche', typeId);
    expect(t).toMatchObject({ title: 'Rapport de fabrication', signatures: ['Chef d\'atelier'], source: 'base' });

    await repo.upsertVariant('production_fiche', typeId, { columns: ['product', 'produced'], footer: 'Sous-traitance' }, userId);
    t = await repo.resolve('production_fiche', typeId);
    expect(t).toMatchObject({ title: 'Rapport de fabrication', columns: ['product', 'produced'], footer: 'Sous-traitance', source: 'variant' });
    // Les autres types d'ordre gardent le modèle général.
    expect((await repo.resolve('production_fiche', null)).columns).toHaveLength(8);
    expect((await repo.listForSettings()).variants.some(v => v.order_type_id === typeId)).toBe(true);

    expect(await repo.deleteVariant('production_fiche', typeId)).toBe(true);
    t = await repo.resolve('production_fiche', typeId);
    expect(t.source).toBe('base');
    expect(t.columns).toHaveLength(8);
  });
});
