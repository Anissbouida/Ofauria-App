import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

/**
 * Recette multisectorielle de bout en bout (PLAN_ACTION.md, §6) : chaque scénario passe
 * par le vrai parcours — brouillon, réponses, compilation, ACTIVATION — puis vérifie la
 * configuration obtenue. Tout se déroule dans une transaction annulée à la fin : la base
 * de test n'est pas modifiée.
 */
type Answers = Record<string, { reviewed?: boolean; data?: Record<string, unknown> }>;

describe.skipIf(!hasTestDb)('Recette multisectorielle de bout en bout', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  const ids: string[] = [];
  beforeAll(async () => { repos = await importRepositories(); fx = await createBaseFixtures(); });
  afterAll(async () => {
    await testPool().query('DELETE FROM config_change_sets WHERE session_id = ANY($1::uuid[])', [ids]);
    await testPool().query('DELETE FROM config_wizard_sessions WHERE id = ANY($1::uuid[])', [ids]);
    if (fx) await cleanupFixtures(fx); await repos?.db.pool.end(); await closeTestPool();
  });

  async function deps() {
    const { withTransaction, db } = await import('../../config/database.js');
    const sessions = await import('../../services/wizard/sessions.js');
    const changes = await import('../../services/wizard/change-set.js');
    const { wizardCatalog } = await import('../../services/wizard/catalog.js');
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    const { ACTIVATABLE_MODULES, CORE_MODULES } = await import('@ofauria/shared');
    return { withTransaction, db, sessions, changes, wizardCatalog, sectorRepository, ACTIVATABLE_MODULES, CORE_MODULES };
  }

  /** Modules d'un ou plusieurs profils, socle compris, en clés activables. */
  async function profileModules(codes: string[]) {
    const { wizardCatalog, ACTIVATABLE_MODULES, CORE_MODULES } = await deps();
    const catalog = await wizardCatalog(false);
    const mods = codes.flatMap(c => catalog.profiles.find(p => p.code === c)?.modules ?? []);
    return [...new Set([...mods, ...CORE_MODULES])].filter(m => (ACTIVATABLE_MODULES as string[]).includes(m));
  }

  /** Parcours complet en mode rapide, activation comprise, dans la transaction appelante. */
  async function runWizard(answers: Answers) {
    const { sessions, changes, sectorRepository } = await deps();
    const base: Answers = { company: { reviewed: true, data: { name: 'Société scénario' } }, specialties: { reviewed: true, data: { selected: [] } }, vocabulary: { reviewed: true }, finance: { reviewed: true }, roles: { reviewed: true }, data: { reviewed: true } };
    const draft = await sessions.createWizardSession('evolution', 'quick', fx.userId); ids.push(draft.id);
    const saved = await sessions.saveWizardSession(draft.id, { mode: 'quick', current_step: 'review', revision: draft.revision, answers: { ...base, ...answers, company: { reviewed: true, data: { ...base.company.data, ...answers.company?.data } } } as never }, fx.userId);
    const compiled = await changes.compileWizardSession(draft.id, saved.revision, fx.userId);
    expect(compiled.issues.filter((i: { severity: string }) => i.severity === 'blocking')).toEqual([]);
    expect(compiled.status).toBe('compiled');
    const applied = await changes.applyWizardChangeSet(draft.id, saved.revision, fx.userId);
    expect(applied.status).toBe('applied');
    sectorRepository.invalidate();
    return { applied, activation: await sectorRepository.activation() };
  }

  async function inRollback(fn: () => Promise<void>) {
    const { withTransaction, sectorRepository } = await deps();
    const rollback = new Error('rollback scénario');
    await expect(withTransaction(async () => { await fn(); throw rollback; })).rejects.toBe(rollback);
    sectorRepository.invalidate();
  }

  it('1 — Boulangerie artisanale, trois établissements : écart nul sur la configuration active et rôles adaptés', async () => {
    const { db, sectorRepository, wizardCatalog } = await deps();
    sectorRepository.invalidate();
    const before = await sectorRepository.activation();
    const storesBefore = Number((await db.query('SELECT count(*) AS n FROM stores')).rows[0].n);
    await inRollback(async () => {
      const { applied, activation } = await runWizard({
        sector: { reviewed: true, data: { primary: before.sector.code, secondary: before.sector.secondarySectors ?? [] } },
        modules: { reviewed: true, data: { selected: [...before.modules] } },
        company: { reviewed: true, data: { 'store:1:name': 'Boutique scénario A', 'store:1:kind': 'shop', 'store:2:name': 'Laboratoire scénario', 'store:2:kind': 'workshop' } },
      });
      expect([...activation.modules].sort()).toEqual([...before.modules].sort());
      const impact = (applied.simulation as { impact?: { modulesOn?: string[]; modulesOff?: string[] } }).impact;
      expect([...(impact?.modulesOn ?? []), ...(impact?.modulesOff ?? [])]).toEqual([]);
      expect(Number((await db.query('SELECT count(*) AS n FROM stores')).rows[0].n)).toBe(storesBefore + 2);
      const catalog = await wizardCatalog(false);
      expect(catalog.roleTemplates.filter(t => t.sector_code === 'boulangerie').map(t => t.code)).toEqual(expect.arrayContaining(['saleswoman']));
    });
  }, 120000);

  it('2 — Agroalimentaire industriel : traçabilité active et contrôle qualité avant transfert', async () => {
    const { productionFlow } = await import('../../services/operating-rules.js');
    await inRollback(async () => {
      const { activation } = await runWizard({
        sector: { reviewed: true, data: { primary: 'agroalimentaire', secondary: [] } },
        modules: { reviewed: true, data: { selected: await profileModules(['agroalimentaire']) } },
        rules: { reviewed: true, data: { 'production.flow:quality_before_transfer': true } },
      });
      expect(activation.sector.code).toBe('agroalimentaire');
      expect(activation.features.has('lots')).toBe(true);
      expect(activation.features.has('tracabilite')).toBe(true);
      expect((await productionFlow()).quality_before_transfer).toBe(true);
    });
  }, 120000);

  it('3 — Manufacture à la commande : numéros de série, nomenclatures, sans caisse, déclenchement à la commande', async () => {
    const { demandSource } = await import('../../services/operating-rules.js');
    await inRollback(async () => {
      const modules = (await profileModules(['fabrication'])).filter(m => m !== 'pos' && m !== 'reconciliation');
      const { activation } = await runWizard({
        sector: { reviewed: true, data: { primary: 'fabrication', secondary: [] } },
        modules: { reviewed: true, data: { selected: modules } },
        operations: { reviewed: true, data: { 'production.demand_source:mode': 'orders' } },
      });
      expect(activation.modules.has('pos' as never)).toBe(false);
      expect(activation.modules.has('recipes' as never)).toBe(true);
      expect(activation.features.has('series')).toBe(true);
      expect(await demandSource()).toBe('orders');
    });
  }, 120000);

  it('4 — Distribution : aucun module de fabrication', async () => {
    await inRollback(async () => {
      const { activation } = await runWizard({
        sector: { reviewed: true, data: { primary: 'negoce', secondary: [] } },
        modules: { reviewed: true, data: { selected: await profileModules(['negoce']) } },
      });
      expect(activation.sector.code).toBe('negoce');
      for (const m of ['production', 'recipes']) expect(activation.modules.has(m as never)).toBe(false);
      expect(activation.modules.has('purchasing' as never)).toBe(true);
    });
  }, 120000);

  it('5 — Services : profil sans stock ni fabrication ; données réglementaires protégées', async () => {
    const { sessions, changes, sectorRepository } = await deps();
    const modules = await profileModules(['services']);
    expect(modules).not.toContain('stock');
    expect(modules).not.toContain('production');
    expect(modules).toEqual(expect.arrayContaining(['projects', 'sales']));
    // Retirer le stock retire les capacités réglementaires (lots, DLC) : si la base les
    // utilise, l'activation est refusée sans rien écrire ; sinon le parcours aboutit.
    await inRollback(async () => {
      const draft = await sessions.createWizardSession('evolution', 'quick', fx.userId); ids.push(draft.id);
      const answers = { company: { reviewed: true, data: { name: 'Société scénario' } }, sector: { reviewed: true, data: { primary: 'services', secondary: [] } }, specialties: { reviewed: true, data: { selected: [] } }, modules: { reviewed: true, data: { selected: modules } }, vocabulary: { reviewed: true }, finance: { reviewed: true }, roles: { reviewed: true }, data: { reviewed: true } };
      const saved = await sessions.saveWizardSession(draft.id, { mode: 'quick', current_step: 'review', revision: draft.revision, answers: answers as never }, fx.userId);
      await changes.compileWizardSession(draft.id, saved.revision, fx.userId);
      sectorRepository.invalidate();
      const before = await sectorRepository.activation();
      const outcome = await changes.applyWizardChangeSet(draft.id, saved.revision, fx.userId).then(() => null, (e: Error & { statusCode?: number }) => e);
      sectorRepository.invalidate();
      const activation = await sectorRepository.activation();
      if (!outcome) { expect(activation.modules.has('stock' as never)).toBe(false); expect(activation.modules.has('projects' as never)).toBe(true); }
      else {
        expect(outcome.statusCode).toBe(409);
        expect(outcome.message).toMatch(/réglementaire/);
        expect([...activation.modules].sort()).toEqual([...before.modules].sort());
      }
    });
  }, 120000);

  it('6 — Multisecteur : union des modules et priorité du profil principal', async () => {
    await inRollback(async () => {
      const { activation } = await runWizard({
        sector: { reviewed: true, data: { primary: 'boulangerie', secondary: ['negoce'] } },
        modules: { reviewed: true, data: { selected: await profileModules(['boulangerie', 'negoce']) } },
      });
      expect(activation.sector.code).toBe('boulangerie');
      expect(activation.sector.secondarySectors).toEqual(['negoce']);
      for (const m of ['production', 'recipes', 'purchasing', 'crm']) expect(activation.modules.has(m as never)).toBe(true);
    });
  }, 120000);

  it('7 — Évolution : activation versionnée, restauration complète, données conservées', async () => {
    const { db, sectorRepository } = await deps();
    sectorRepository.invalidate();
    const before = await sectorRepository.activation();
    const products = Number((await db.query('SELECT count(*) AS n FROM products')).rows[0].n);
    const removable = [...before.modules].find(m => ['maintenance', 'projects', 'crm'].includes(m));
    expect(removable).toBeDefined();
    await inRollback(async () => {
      const { applied, activation } = await runWizard({
        sector: { reviewed: true, data: { primary: before.sector.code, secondary: before.sector.secondarySectors ?? [] } },
        modules: { reviewed: true, data: { selected: [...before.modules].filter(m => m !== removable) } },
      });
      expect(activation.modules.has(removable as never)).toBe(false);
      const restoreTo = (applied.simulation as { restoreVersionId?: number | null }).restoreVersionId;
      const versionId = restoreTo ?? (await db.query(`SELECT min(id) AS id FROM config_versions`)).rows[0].id;
      const restored = await sectorRepository.restoreVersion(Number(versionId), fx.userId);
      expect('error' in restored).toBe(false);
      sectorRepository.invalidate();
      expect((await sectorRepository.activation()).modules.has(removable as never)).toBe(true);
      expect(Number((await db.query('SELECT count(*) AS n FROM products')).rows[0].n)).toBe(products);
    });
  }, 120000);
});
