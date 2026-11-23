/**
 * C-04 — bilan de santé enrichi : chaque contrôle de cohérence est provoqué par une donnée
 * fautive fabriquée ici, puis la donnée est corrigée et l'élément disparaît du compteur.
 * Les données créées portent un suffixe aléatoire et sont supprimées à la fin.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Bilan de santé — contrôles de cohérence (C-04)', () => {
  let health: typeof import('../../services/config-health.js');
  let sector: typeof import('../../repositories/sector.repository.js');
  let chRepo: typeof import('../../repositories/config-health.repository.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const p = () => testPool();
  const tag = Math.random().toString(36).slice(2, 10);
  const ids: Record<string, string> = {};

  /** Recommandation d'une clé (null si absente), sans tenir compte des propositions écartées. */
  const rec = async (key: string) => (await health.healthReport()).recommendations.find(r => r.key === key) ?? null;
  const hasItem = async (key: string, id: string) => !!(await rec(key))?.items?.some(i => i.id === id);

  beforeAll(async () => {
    repos = await importRepositories();
    health = await import('../../services/config-health.js');
    sector = await import('../../repositories/sector.repository.js');
    chRepo = await import('../../repositories/config-health.repository.js');
    await p().query(`UPDATE config_health_dismissals SET dismissed_until = now() WHERE check_key LIKE 'profile.%'`);
    const act = await sector.sectorRepository.activation();
    expect(act.modules.has('production')).toBe(true);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  afterAll(async () => {
    const q = (sql: string, v: unknown) => p().query(sql, [v]).catch(() => undefined);
    if (ids.qline) await q(`DELETE FROM quality_control_plan_lines WHERE id = $1`, ids.qline);
    if (ids.routing) await q(`DELETE FROM routings WHERE id = $1`, ids.routing);
    if (ids.wc) await q(`DELETE FROM work_centers WHERE id = $1`, ids.wc);
    if (ids.recipe) {
      await q(`DELETE FROM bom_versions WHERE recipe_id = $1`, ids.recipe);
      await q(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, ids.recipe);
      await q(`DELETE FROM recipes WHERE id = $1`, ids.recipe);
    }
    if (ids.ingredient) {
      await q(`DELETE FROM item_unit_conversions WHERE item_id = $1`, ids.ingredient);
      await q(`DELETE FROM ingredients WHERE id = $1`, ids.ingredient);
    }
    if (ids.orderType) await q(`DELETE FROM production_order_types WHERE id = $1`, ids.orderType);
    if (ids.workshop) await q(`DELETE FROM production_workshops WHERE code = $1`, ids.workshop);
    if (ids.user) {
      await q(`DELETE FROM user_action_permissions WHERE user_id = $1`, ids.user);
      await q(`DELETE FROM user_roles WHERE user_id = $1`, ids.user);
      await q(`DELETE FROM users WHERE id = $1`, ids.user);
    }
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('type d\'ordre sans série puis sans atelier', async () => {
    ids.orderType = (await p().query(
      `INSERT INTO production_order_types (code, label, sequence_doc_type, requires_bon_sortie, requires_weighing, consumption_mode, display_order)
       VALUES ($1, $2, $3, false, false, 'a_la_declaration', 999) RETURNING id`,
      [`TST_${tag}`.toUpperCase(), `Type test ${tag}`, `absente_${tag}`])).rows[0].id;

    const r = await rec('profile.order_type.no_sequence');
    expect(r).toMatchObject({ severity: 'blocking', tone: 'warning', action: { kind: 'link' } });
    expect(r!.count).toBeGreaterThanOrEqual(1);
    expect(r!.items!.find(i => i.id === ids.orderType)?.to).toBe('/production/settings');
    const before = r!.count!;
    await p().query(`UPDATE production_order_types SET sequence_doc_type = 'production_order' WHERE id = $1`, [ids.orderType]);
    expect(await hasItem('profile.order_type.no_sequence', ids.orderType)).toBe(false);
    expect((await rec('profile.order_type.no_sequence'))?.count ?? 0).toBe(before - 1);

    // Sans atelier par défaut : avertissement ; un atelier actif le corrige.
    expect((await rec('profile.order_type.no_workshop'))?.severity).toBe('warning');
    expect(await hasItem('profile.order_type.no_workshop', ids.orderType)).toBe(true);
    ids.workshop = `tst_${tag}`;
    await p().query(`INSERT INTO production_workshops (code, label, is_active) VALUES ($1, $2, true)`, [ids.workshop, `Atelier ${tag}`]);
    await p().query(`UPDATE production_order_types SET default_target_role = $2 WHERE id = $1`, [ids.orderType, ids.workshop]);
    expect(await hasItem('profile.order_type.no_workshop', ids.orderType)).toBe(false);
    // Atelier désactivé : le défaut redevient en cause.
    await p().query(`UPDATE production_workshops SET is_active = false WHERE code = $1`, [ids.workshop]);
    expect(await hasItem('profile.order_type.no_workshop', ids.orderType)).toBe(true);
    await p().query(`UPDATE production_workshops SET is_active = true WHERE code = $1`, [ids.workshop]);
  });

  it('étape exigée par un type d\'ordre alors que son module est masqué', async () => {
    await p().query(`UPDATE production_order_types SET requires_quality_check = true WHERE id = $1`, [ids.orderType]);
    const real = await sector.sectorRepository.activation();
    vi.spyOn(sector.sectorRepository, 'activation').mockResolvedValue({
      ...real, modules: new Set([...real.modules].filter(m => m !== 'controle' && m !== 'stock')) as typeof real.modules,
    });
    const r = await rec('profile.order_type.module_off');
    expect(r?.severity).toBe('blocking');
    expect(r!.items!.find(i => i.id === ids.orderType)?.label).toMatch(/contrôle/);
    // Contrôle masqué : le contrôle « qualité sans personne habilitée » ne s'affiche pas.
    expect(await rec('profile.quality.no_releaser')).toBeNull();

    vi.restoreAllMocks();
    expect(await hasItem('profile.order_type.module_off', ids.orderType)).toBe(false);
  });

  it('unité de fabrication non convertible, puis nomenclature sans version active', async () => {
    ids.ingredient = (await p().query(
      `INSERT INTO ingredients (name, unit, unit_cost) VALUES ($1, 'kg', 10) RETURNING id`, [`Matière ${tag}`])).rows[0].id;
    ids.recipe = (await p().query(`INSERT INTO recipes (name) VALUES ($1) RETURNING id`, [`0 Fiche ${tag}`])).rows[0].id; // « 0 » : en tête de la liste bornée (ITEM_LIMIT), quel que soit le volume de la base de test
    await p().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 3, 'unit')`, [ids.recipe, ids.ingredient]);

    const r = await rec('profile.unit.not_convertible');
    expect(r?.severity).toBe('blocking');
    expect(r!.items!.find(i => i.id === ids.ingredient)).toMatchObject({ to: `/stock/${ids.ingredient}` });
    // Poids par pièce saisi sur la fiche : la conversion pièce → kg existe (mig 555).
    await p().query(`UPDATE ingredients SET poids_piece_kg = 0.25 WHERE id = $1`, [ids.ingredient]);
    expect(await hasItem('profile.unit.not_convertible', ids.ingredient)).toBe(false);

    expect(await hasItem('profile.bom.no_active_version', ids.recipe)).toBe(true);
    const before = (await rec('profile.bom.no_active_version'))!.count!;
    await p().query(
      `INSERT INTO bom_versions (recipe_id, version_no, status, valid_from, snapshot) VALUES ($1, 1, 'active', current_date, fn_recipe_bom_snapshot($1))`,
      [ids.recipe]);
    expect(await hasItem('profile.bom.no_active_version', ids.recipe)).toBe(false);
    expect((await rec('profile.bom.no_active_version'))?.count ?? 0).toBe(before - 1);
  });

  it('gamme sans poste, poste sans calendrier', async () => {
    ids.routing = (await p().query(`INSERT INTO routings (name, is_active) VALUES ($1, true) RETURNING id`, [`Gamme ${tag}`])).rows[0].id;
    expect((await rec('profile.routing.no_work_center'))?.items?.find(i => i.id === ids.routing)?.label).toMatch(/aucune opération/);
    await p().query(`INSERT INTO routing_operations (routing_id, sequence, operation_name) VALUES ($1, 10, 'Op')`, [ids.routing]);
    expect((await rec('profile.routing.no_work_center'))?.items?.find(i => i.id === ids.routing)?.label).toMatch(/1 opération\(s\) sans poste/);

    ids.wc = (await p().query(`INSERT INTO work_centers (name) VALUES ($1) RETURNING id`, [`Poste ${tag}`])).rows[0].id;
    await p().query(`UPDATE routing_operations SET work_center_id = $2 WHERE routing_id = $1`, [ids.routing, ids.wc]);
    expect(await hasItem('profile.routing.no_work_center', ids.routing)).toBe(false);

    expect(await hasItem('profile.work_center.no_calendar', ids.wc)).toBe(true);
    await p().query(`INSERT INTO work_center_calendar (work_center_id, iso_weekday, start_time, end_time) VALUES ($1, 1, '08:00', '16:00')`, [ids.wc]);
    expect(await hasItem('profile.work_center.no_calendar', ids.wc)).toBe(false);
  });

  it('contrôle bloquant sans personne habilitée à libérer', async () => {
    ids.qline = (await p().query(
      `INSERT INTO quality_control_plan_lines (ingredient_id, stage, characteristic, is_blocking) VALUES ($1, 'reception', $2, true) RETURNING id`,
      [ids.ingredient, `Aspect ${tag}`])).rows[0].id;

    // Le décompte des habilités suit la règle de hasPermission : rôle, puis exception utilisateur.
    const key = chRepo.QUALITY_RELEASE_PERMISSION;
    const n0 = await chRepo.configHealthRepository.activeUsersWithPermission(key);
    ids.user = (await p().query(
      `INSERT INTO users (email, first_name, last_name, role, password_hash, is_active) VALUES ($1, 'T', 'T', 'cashier', 'x', true) RETURNING id`,
      [`ch-${tag}@test.local`])).rows[0].id;
    await p().query(`INSERT INTO user_action_permissions (user_id, permission_key, granted) VALUES ($1, $2, true)`, [ids.user, key]);
    expect(await chRepo.configHealthRepository.activeUsersWithPermission(key)).toBe(n0 + 1);
    await p().query(`UPDATE user_action_permissions SET granted = false WHERE user_id = $1 AND permission_key = $2`, [ids.user, key]);
    expect(await chRepo.configHealthRepository.activeUsersWithPermission(key)).toBe(n0);

    // Personne d'habilité : bloquant, avec la ligne du plan en cause.
    vi.spyOn(chRepo.configHealthRepository, 'activeUsersWithPermission').mockResolvedValue(0);
    const r = await rec('profile.quality.no_releaser');
    expect(r).toMatchObject({ severity: 'blocking', module: 'controle', action: { kind: 'link', to: '/users' } });
    expect(r!.items!.find(i => i.id === ids.qline)?.to).toBe('/controle?tab=qualite');
    vi.restoreAllMocks();
    // Base réelle : l'administrateur détient le droit, rien à signaler.
    if (n0 > 0) expect(await rec('profile.quality.no_releaser')).toBeNull();
  });

  it('chaque contrôle avec liste porte un compteur, au plus 200 éléments et des liens', async () => {
    const { recommendations } = await health.healthReport();
    for (const r of recommendations.filter(x => x.items)) {
      expect(r.count).toBeGreaterThanOrEqual(r.items!.length);
      expect(r.items!.length).toBeLessThanOrEqual(chRepo.ITEM_LIMIT);
      for (const i of r.items!) expect(i.to.startsWith('/')).toBe(true);
    }
  });
});
