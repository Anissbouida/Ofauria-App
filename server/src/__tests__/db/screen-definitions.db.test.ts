/**
 * Définitions d'écran (plan d'exécution multi-industries, étape 10, pas 10b et 10g ; mig 646).
 *
 *   - sans définition, l'écran garde l'ordre du code ;
 *   - réordonner deux sections de la fiche d'ordre sans code : brouillon (aperçu), puis publication ;
 *   - résolution profil → société → rôle, élément par élément ;
 *   - un élément verrouillé ne se masque pas ; un élément hors catalogue est refusé ;
 *   - un champ personnalisé se place dans une section du catalogue.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';
import { applyScreenDefinition } from '@ofauria/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 10 — définitions d\'écran', () => {
  let repo: any;
  const p = () => testPool();
  const SCREEN = 'production.plan';
  const lineage = ['agroalimentaire', 'boulangerie'];
  const synthese = ['subcontract', 'linked-order', 'consumption', 'custom-fields', 'history', 'quality'];

  beforeAll(async () => {
    repo = (await import('../../repositories/screen-definition.repository.js')).screenDefinitionRepository;
    await p().query(`DELETE FROM screen_definitions WHERE screen_key IN ('production.plan', 'production.plans')`);
  });
  afterAll(async () => {
    await p().query(`DELETE FROM screen_definitions WHERE screen_key IN ('production.plan', 'production.plans')`).catch(() => undefined);
    await closeTestPool();
  });

  it('sans définition, l\'ordre du code est gardé', async () => {
    const def = await repo.resolve(SCREEN, { lineage, role: 'manager' });
    expect(def).toEqual({});
    expect(applyScreenDefinition(SCREEN, 'sections', synthese, def)).toEqual(synthese);
  });

  it('réordonner deux sections sans code : aperçu du brouillon, puis publication', async () => {
    const r = await repo.saveDraft(SCREEN, { type: 'company', id: '' }, {
      sections: [{ key: 'history', visible: true, order: 10 }, { key: 'consumption', visible: true, order: 20 }],
    });
    expect(r.error).toBeUndefined();
    // Brouillon : invisible pour les utilisateurs, visible en aperçu.
    expect(await repo.resolve(SCREEN, { lineage, role: 'manager' })).toEqual({});
    const preview = await repo.resolve(SCREEN, { lineage, role: 'manager', preview: true });
    expect(applyScreenDefinition(SCREEN, 'sections', synthese, preview).slice(0, 2)).toEqual(['history', 'consumption']);
    expect((await repo.publish(SCREEN, { type: 'company', id: '' })).published).toBe(true);
    const live = await repo.resolve(SCREEN, { lineage, role: 'manager' });
    expect(applyScreenDefinition(SCREEN, 'sections', synthese, live)).toEqual(['history', 'consumption', 'subcontract', 'linked-order', 'custom-fields', 'quality']);
  });

  it('résolution profil → société → rôle, élément par élément', async () => {
    await repo.saveDraft(SCREEN, { type: 'profile', id: 'boulangerie' }, { sections: [{ key: 'quality', visible: false, order: 5 }] });
    await repo.publish(SCREEN, { type: 'profile', id: 'boulangerie' });
    await repo.saveDraft(SCREEN, { type: 'role', id: 'manager' }, { sections: [{ key: 'quality', visible: true, order: 99 }] });
    await repo.publish(SCREEN, { type: 'role', id: 'manager' });
    const forManager = applyScreenDefinition(SCREEN, 'sections', synthese, await repo.resolve(SCREEN, { lineage, role: 'manager' }));
    const forCashier = applyScreenDefinition(SCREEN, 'sections', synthese, await repo.resolve(SCREEN, { lineage, role: 'cashier' }));
    // Le rôle remet le contrôle (ordre 99 : après les sections ordonnées par la société, avant les autres).
    expect(forManager.slice(0, 3)).toEqual(['history', 'consumption', 'quality']);
    expect(forCashier).not.toContain('quality');                 // le profil le masque pour les autres
    expect(forCashier.slice(0, 2)).toEqual(['history', 'consumption']); // la société ordonne
  });

  it('verrouillé non masquable, élément hors catalogue refusé ; champ personnalisé placé dans une section', async () => {
    const locked = await repo.saveDraft(SCREEN, { type: 'company', id: '' }, { sections: [{ key: 'subcontract', visible: false, order: 1 }] });
    expect(locked.details.join(' ')).toMatch(/ne se masque pas/);
    const unknown = await repo.saveDraft('production.plans', { type: 'company', id: '' }, { columns: [{ key: 'sql_libre', visible: true, order: 1 }] });
    expect(unknown.details.join(' ')).toMatch(/inconnu/);
    expect(applyScreenDefinition('production.plans', 'columns', ['number', 'status', 'date'], { columns: [{ key: 'status', visible: false, order: 1 }] }))
      .toContain('status');
    const placed = await repo.saveDraft(SCREEN, { type: 'company', id: '' }, {
      sections: [{ key: 'history', visible: true, order: 10 }], custom_fields: [{ key: 'num_affaire', section: 'linked-order' }],
    });
    expect(placed.error).toBeUndefined();
    const bad = await repo.saveDraft(SCREEN, { type: 'company', id: '' }, { custom_fields: [{ key: 'x', section: 'nulle_part' }] });
    expect(bad.details.join(' ')).toMatch(/Section inconnue/);
  });
});
