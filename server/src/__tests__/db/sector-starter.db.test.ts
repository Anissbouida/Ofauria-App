/**
 * Phase 9.3 — données de départ par secteur, chargeables, hors migrations.
 *
 * Le secteur générique charge des catégories transverses ; la boulangerie ne charge rien
 * (son référentiel existe déjà). Une société neuve ne reçoit donc pas de données de
 * fabrication (recettes) par simple création.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';
import { loadSectorStarter, sectorStarterPreview } from '../../services/sector-starter.service.js';

describe.skipIf(!hasTestDb)('Données de départ par secteur', () => {
  const p = () => testPool();
  afterAll(async () => {
    const q = (sql: string) => p().query(sql).catch(() => undefined);
    await q(`DELETE FROM recipe_format_components WHERE format_id IN (SELECT f.id FROM recipe_formats f JOIN recipes r ON r.id = f.recipe_id JOIN products pr ON pr.id = r.product_id WHERE pr.slug = 'starter-demo-etagere')`);
    await q(`DELETE FROM recipe_formats WHERE recipe_id IN (SELECT r.id FROM recipes r JOIN products pr ON pr.id = r.product_id WHERE pr.slug = 'starter-demo-etagere')`);
    await q(`DELETE FROM recipes WHERE product_id IN (SELECT id FROM products WHERE slug = 'starter-demo-etagere')`);
    await q(`DELETE FROM products WHERE slug = 'starter-demo-etagere'`);
    await q(`DELETE FROM ingredients WHERE name LIKE '%(démo)'`);
    await q(`DELETE FROM ref_entries WHERE (table_id = 'production_step_types' AND code IN ('preparation', 'usinage', 'assemblage', 'controle', 'conditionnement'))
               OR (table_id = 'production_equipment_types' AND code IN ('machine', 'poste_manuel', 'outillage'))`);
    await q(`DELETE FROM production_workshops WHERE code = 'atelier_principal'`);
    await q(`DELETE FROM categories WHERE slug LIKE 'starter-%'`);
    await closeTestPool();
  });

  it('boulangerie ne charge aucune donnée de départ', async () => {
    expect((await sectorStarterPreview('boulangerie')).categories).toHaveLength(0);
    const r = await loadSectorStarter('boulangerie');
    expect(r.categories).toBe(0);
  });

  it('générique charge des catégories transverses, idempotent', async () => {
    const r1 = await loadSectorStarter('generique');
    expect(r1.categories).toBeGreaterThanOrEqual(1);
    const r2 = await loadSectorStarter('generique'); // rejeu
    expect(r2.categories).toBe(0);
    const rows = (await p().query(`SELECT name FROM categories WHERE slug LIKE 'starter-%'`)).rows;
    expect(rows.map((x: { name: string }) => x.name)).toContain('Marchandises');
  });

  it('fabrication charge le procédé et une nomenclature de démonstration, sans toucher aux ateliers existants', async () => {
    expect((await sectorStarterPreview('fabrication')).items.length).toBeGreaterThanOrEqual(5);
    const hadWorkshops = Number((await p().query(`SELECT count(*) FROM production_workshops WHERE is_active`)).rows[0].count);

    const r1 = await loadSectorStarter('fabrication');
    expect(r1).toMatchObject({ units: 0, stepTypes: 5, equipmentTypes: 3, demo: 1 });
    // La base de test a déjà les 4 ateliers repris de la boulangerie : aucun n'est ajouté.
    expect(r1.workshops).toBe(hadWorkshops > 0 ? 0 : 1);

    const demo = (await p().query(
      `SELECT pr.item_kind, r.total_cost::float AS cost, count(fc.id)::int AS lines
         FROM products pr JOIN recipes r ON r.product_id = pr.id
         JOIN recipe_formats f ON f.recipe_id = r.id AND f.is_default
         JOIN recipe_format_components fc ON fc.format_id = f.id AND fc.source_ingredient_id IS NOT NULL
        WHERE pr.slug = 'starter-demo-etagere' GROUP BY pr.item_kind, r.total_cost`)).rows[0];
    expect(demo).toEqual({ item_kind: 'manufactured', cost: 6.5 * 14 + 4 * 22 + 24 * 0.3 + 0.4 * 90, lines: 4 });

    const r2 = await loadSectorStarter('fabrication'); // rejeu : rien de neuf
    expect(r2).toEqual({ categories: 0, units: 0, stepTypes: 0, equipmentTypes: 0, workshops: 0, demo: 0, orderTypes: 0, policies: 0, printTemplates: 0 });
  });

  it('une société sans atelier reçoit l\'atelier principal, par défaut et rattaché aux produits finis', async () => {
    const saved = (await p().query(`SELECT code, is_active, is_default FROM production_workshops`)).rows;
    try {
      await p().query(`UPDATE production_workshops SET is_active = false, is_default = false`);
      const r = await loadSectorStarter('fabrication');
      expect(r.workshops).toBe(1);
      const w = (await p().query(
        `SELECT w.is_default, c.slug FROM production_workshops w
           JOIN production_workshop_categories wc ON wc.workshop_code = w.code JOIN categories c ON c.id = wc.category_id
          WHERE w.code = 'atelier_principal'`)).rows;
      expect(w).toEqual([{ is_default: true, slug: 'starter-produits-finis' }]);
    } finally {
      await p().query(`DELETE FROM production_workshops WHERE code = 'atelier_principal'`);
      for (const s of saved) {
        await p().query(`UPDATE production_workshops SET is_active = $2, is_default = $3 WHERE code = $1`, [s.code, s.is_active, s.is_default]);
      }
    }
  });
});
