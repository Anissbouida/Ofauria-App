/**
 * Référentiels pilotés par le secteur (mig 698).
 *
 * Chaque cas se joue dans une transaction annulée : la base de test (boulangerie, partagée
 * avec les autres suites) n'est jamais modifiée. Le secteur est changé comme le fait
 * l'application (company_settings.sector_pack, company_sectors, company_specializations) :
 * ce sont les déclencheurs qui synchronisent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

describe.skipIf(!hasTestDb)('Référentiels sectoriels (mig 698)', () => {
  let scope: typeof import('../../services/referential-scope.js');

  beforeAll(async () => {
    await importRepositories();
    scope = await import('../../services/referential-scope.js');
  });
  afterAll(async () => { await closeTestPool(); });

  /** Exécute `fn` dans une transaction toujours annulée. */
  async function sandbox<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      return await fn((sql, params) => client.query(sql, params));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  const setSector = async (q: Q, primary: string, secondary: string[] = [], specs: string[] = []) => {
    await q(`DELETE FROM company_specializations`);
    await q(`DELETE FROM company_sectors WHERE NOT is_primary`);
    await q(`UPDATE company_settings SET sector_pack = $1 WHERE id = 1`, [primary]);
    if (secondary.length) await q(`INSERT INTO company_sectors (sector_code, is_primary) SELECT unnest($1::varchar[]), false ON CONFLICT DO NOTHING`, [secondary]);
    if (specs.length) await q(`INSERT INTO company_specializations (code) SELECT unnest($1::varchar[]) ON CONFLICT DO NOTHING`, [specs]);
  };
  const active = async (q: Q, table: string): Promise<string[]> =>
    (await q(`SELECT code FROM ref_entries WHERE table_id = $1 AND is_active AND code IS NOT NULL ORDER BY code`, [table])).rows.map(r => r.code);
  const activeKeys = async (q: Q): Promise<string[]> =>
    (await q(`SELECT table_id || ':' || code AS k FROM ref_entries WHERE is_active AND code IS NOT NULL ORDER BY 1`)).rows.map(r => r.k);

  it('catalogue cohérent : chaque rattachement désigne un profil ou une spécialité qui existe', async () => {
    const badSectors = await testPool().query(
      `SELECT DISTINCT s FROM (SELECT unnest(sectors) s FROM ref_entries UNION SELECT unnest(sectors) FROM ref_tables
                               UNION SELECT unnest(sectors) FROM expense_categories UNION SELECT unnest(sectors) FROM revenue_categories
                               UNION SELECT unnest(sectors) FROM recipe_categories) x
        WHERE NOT EXISTS (SELECT 1 FROM sector_packs sp WHERE sp.code = x.s)`);
    expect(badSectors.rows.map(r => r.s)).toEqual([]);
    const badSpecs = await testPool().query(
      `SELECT DISTINCT s FROM (SELECT unnest(specializations) s FROM ref_entries) x
        WHERE NOT EXISTS (SELECT 1 FROM sector_specializations ss WHERE ss.code = x.s)`);
    expect(badSpecs.rows.map(r => r.s)).toEqual([]);
    const badLabels = await testPool().query(
      `SELECT DISTINCT k FROM ref_tables, jsonb_object_keys(label_overrides) k
        WHERE NOT EXISTS (SELECT 1 FROM sector_packs sp WHERE sp.code = k)`);
    expect(badLabels.rows.map(r => r.k)).toEqual([]);
    // Une valeur livrée garde son libellé d'origine (base de la surcharge).
    const noOrigin = await testPool().query(`SELECT count(*)::int AS n FROM ref_entries WHERE origin = 'system' AND system_label IS NULL`);
    expect(noOrigin.rows[0].n).toBe(0);
  });

  it('chaque profil de l\'assistant a ses familles d\'articles et ses fonctions, sans valeur étrangère', async () => {
    const profiles = (await testPool().query(`SELECT code FROM sector_packs WHERE in_wizard ORDER BY sort_order`)).rows.map(r => r.code as string);
    expect(profiles.length).toBeGreaterThanOrEqual(13);
    for (const code of profiles) {
      await sandbox(async q => {
        await setSector(q, code);
        // Invariant de la synchronisation : une valeur « auto » active est applicable, ou utilisée.
        const stray = await q(
          `SELECT table_id || ':' || code AS k FROM ref_entries
            WHERE activation = 'auto' AND is_active
              AND NOT fn_ref_applicable(sectors, specializations, fn_active_sector_lineage(), fn_active_specializations())
              AND NOT (id = ANY(fn_ref_entries_in_use(ARRAY(SELECT id FROM ref_entries WHERE is_active))))`);
        expect(stray.rows.map(r => r.k), `valeurs étrangères actives pour ${code}`).toEqual([]);
        const missing = await q(
          `SELECT table_id || ':' || code AS k FROM ref_entries
            WHERE activation = 'auto' AND NOT is_active
              AND fn_ref_applicable(sectors, specializations, fn_active_sector_lineage(), fn_active_specializations())`);
        expect(missing.rows.map(r => r.k), `valeurs du secteur inactives pour ${code}`).toEqual([]);
        // Le profil apporte bien des valeurs à lui (pas seulement le tronc commun).
        const own = await q(
          `SELECT table_id, count(*)::int AS n FROM ref_entries
            WHERE is_active AND sectors && fn_active_sector_lineage() AND table_id IN ('ingredient_categories', 'employee_roles')
            GROUP BY table_id`);
        const by = Object.fromEntries(own.rows.map(r => [r.table_id, r.n]));
        expect(by.ingredient_categories ?? 0, `familles d'articles de ${code}`).toBeGreaterThan(0);
        // Le tronc « agroalimentaire » ne reçoit volontairement aucune fonction nouvelle : la
        // boulangerie en hérite et ses listes ne doivent pas changer (catalogue à compléter
        // par une valeur propre au profil quand il sera validé).
        if (code !== 'agroalimentaire') expect(by.employee_roles ?? 0, `fonctions de ${code}`).toBeGreaterThan(0);
      });
    }
  }, 180_000);

  it('BTP : matériaux, engins et métiers du chantier ; plus rien de la boulangerie dans le catalogue livré', async () => {
    await sandbox(async q => {
      await setSector(q, 'btp');
      const families = await active(q, 'ingredient_categories');
      expect(families).toEqual(expect.arrayContaining(['ciment_liants', 'aciers', 'granulats', 'beton_mortiers', 'autre']));
      expect(families).not.toContain('tissus');
      expect(await active(q, 'units')).toEqual(expect.arrayContaining(['m', 'm2', 'm3', 't', 'kg', 'forfait']));
      expect(await active(q, 'employee_roles')).toEqual(expect.arrayContaining(['conducteur_travaux', 'chef_chantier', 'macon', 'admin']));
      expect(await active(q, 'production_equipment_types')).toEqual(expect.arrayContaining(['engin_chantier', 'grue', 'betonniere']));
      // Valeurs boulangères : désactivées, sauf celles que des données de la base de test utilisent.
      const bakery = await q(
        `SELECT id, table_id || ':' || code AS k FROM ref_entries WHERE is_active AND activation = 'auto'
            AND sectors && ARRAY['boulangerie', 'agroalimentaire'] AND NOT sectors && ARRAY['btp']`);
      const used = (await q(`SELECT fn_ref_entries_in_use($1::uuid[]) AS ids`, [bakery.rows.map(r => r.id)])).rows[0].ids as string[];
      expect(bakery.rows.filter(r => !used.includes(r.id)).map(r => r.k)).toEqual([]);
      // Miroir des catégories de dépenses (écran « Catégories de dépenses ») : même liste.
      const mirror = await q(
        `SELECT code FROM expense_categories WHERE ref_table_id = 'ingredient_categories' AND is_active AND code IS NOT NULL
            AND parent_id = '20000000-0000-0000-0000-000000000004' ORDER BY code`);
      expect(mirror.rows.map(r => r.code)).toEqual(families);
      // Journal de la bascule.
      const log = (await q(`SELECT reason, sectors, activated, deactivated FROM ref_sector_sync_log ORDER BY id DESC LIMIT 1`)).rows[0];
      expect(log.reason).toBe('sector_change');
      expect(log.sectors).toEqual(['btp']);
      expect(log.activated).toBeGreaterThan(20);
    });
  });

  it('non-régression boulangerie : aller-retour BTP → boulangerie rend exactement les mêmes listes', async () => {
    await sandbox(async q => {
      const before = await activeKeys(q);
      const specs = (await q(`SELECT code FROM company_specializations`)).rows.map(r => r.code as string);
      const primary = (await q(`SELECT sector_pack FROM company_settings WHERE id = 1`)).rows[0].sector_pack as string;
      expect(primary).toBe('boulangerie');
      // Déjà aligné : une resynchronisation ne change rien.
      const idle = (await q(`SELECT fn_ref_sync_sectors('test') AS r`)).rows[0].r;
      expect([idle.activated, idle.deactivated, idle.native_changes]).toEqual([0, 0, 0]);
      await setSector(q, 'btp');
      expect(await activeKeys(q)).not.toEqual(before);
      await setSector(q, primary, [], specs);
      expect(await activeKeys(q)).toEqual(before);
    });
  });

  it('les choix de la société survivent au changement de secteur (désactivation, activation forcée, valeur personnalisée)', async () => {
    await sandbox(async q => {
      await q(`UPDATE ref_entries SET is_active = false, activation = 'forced_off' WHERE table_id = 'units' AND code = 'cl'`);
      await q(`UPDATE ref_entries SET is_active = true, activation = 'forced_on' WHERE table_id = 'ingredient_categories' AND code = 'tissus'`);
      await q(`INSERT INTO ref_entries (table_id, code, label, origin) VALUES ('ingredient_categories', 'maison_test', 'Famille maison', 'company')`);
      for (const code of ['btp', 'services', 'boulangerie']) {
        await setSector(q, code);
        expect(await active(q, 'units'), code).not.toContain('cl');
        const families = await active(q, 'ingredient_categories');
        expect(families, code).toContain('tissus');
        expect(families, code).toContain('maison_test');
      }
      // « Suivre le secteur » : la valeur forcée retombe sur la règle.
      await q(`UPDATE ref_entries SET activation = 'auto' WHERE table_id = 'ingredient_categories' AND code = 'tissus'`);
      await q(`SELECT fn_ref_sync_sectors('test')`);
      expect(await active(q, 'ingredient_categories')).not.toContain('tissus');
    });
  });

  it('une valeur utilisée par des données n\'est jamais désactivée', async () => {
    await sandbox(async q => {
      await setSector(q, 'btp');
      await q(`INSERT INTO ingredients (name, unit, unit_cost, category) VALUES ('Ciment CPJ 45 (test 698)', 'kg', 1, 'ciment_liants')`);
      await setSector(q, 'services');
      const families = await active(q, 'ingredient_categories');
      expect(families).toContain('ciment_liants');   // utilisée : conservée
      expect(families).not.toContain('granulats');    // non utilisée : retirée
      const log = (await q(`SELECT details FROM ref_sector_sync_log ORDER BY id DESC LIMIT 1`)).rows[0].details;
      expect(log.kept_in_use).toContain('ingredient_categories:ciment_liants');
      // Rien n'est supprimé : le libellé reste lisible pour l'historique.
      const gone = await q(`SELECT label FROM ref_entries WHERE table_id = 'ingredient_categories' AND code = 'granulats'`);
      expect(gone.rows[0].label).toBe('Granulats (sable, gravier)');
    });
  });

  it('plusieurs activités : union des référentiels des profils retenus', async () => {
    await sandbox(async q => {
      await setSector(q, 'btp', ['textile']);
      const families = await active(q, 'ingredient_categories');
      expect(families).toEqual(expect.arrayContaining(['ciment_liants', 'tissus', 'fils']));
      expect(await active(q, 'employee_roles')).toEqual(expect.arrayContaining(['chef_chantier', 'couturier']));
      await setSector(q, 'btp');
      expect(await active(q, 'ingredient_categories')).not.toContain('tissus');
    });
  });

  it('spécialité métier : ses valeurs apparaissent à l\'activation et disparaissent au retrait', async () => {
    await sandbox(async q => {
      await setSector(q, 'btp');
      expect(await active(q, 'ingredient_categories')).not.toContain('peintures_revetements');
      await q(`INSERT INTO company_specializations (code) VALUES ('second_oeuvre')`);
      expect(await active(q, 'ingredient_categories')).toEqual(expect.arrayContaining(['peintures_revetements', 'plomberie']));
      expect(await active(q, 'employee_roles')).toEqual(expect.arrayContaining(['electricien', 'peintre']));
      await q(`DELETE FROM company_specializations WHERE code = 'second_oeuvre'`);
      expect(await active(q, 'ingredient_categories')).not.toContain('peintures_revetements');
    });
  });

  it('une spécialité d\'un autre secteur, restée cochée, ne compte plus', async () => {
    await sandbox(async q => {
      // L'ancienne voie de changement de secteur ne retire pas les spécialités.
      await q(`DELETE FROM company_sectors WHERE NOT is_primary`);
      await q(`INSERT INTO company_specializations (code) VALUES ('traiteur_sale') ON CONFLICT DO NOTHING`);
      await q(`UPDATE company_settings SET sector_pack = 'btp' WHERE id = 1`);
      expect((await q(`SELECT fn_active_specializations() AS s`)).rows[0].s).toEqual([]);
      const log = (await q(`SELECT specializations FROM ref_sector_sync_log ORDER BY id DESC LIMIT 1`)).rows[0];
      expect(log.specializations).toEqual([]);
    });
  });

  it('héritage : un profil enfant reçoit les référentiels de son parent', async () => {
    await sandbox(async q => {
      await q(`INSERT INTO sector_packs (code, label, enabled_modules, is_custom, base_sector, inherits)
               VALUES ('btp_filiale_test', 'BTP filiale (test)', '{dashboard,settings,users}', true, 'btp', true)`);
      await setSector(q, 'btp_filiale_test');
      expect((await q(`SELECT fn_active_sector_lineage() AS l`)).rows[0].l).toEqual(['btp', 'btp_filiale_test']);
      expect(await active(q, 'ingredient_categories')).toEqual(expect.arrayContaining(['ciment_liants', 'aciers']));
      // Une valeur propre à l'enfant ne remonte pas au parent.
      await q(`INSERT INTO ref_entries (table_id, code, label, origin, system_label, sectors)
               VALUES ('ingredient_categories', 'prefabrique_test', 'Préfabriqué', 'system', 'Préfabriqué', '{btp_filiale_test}')`);
      await setSector(q, 'btp');
      expect(await active(q, 'ingredient_categories')).not.toContain('prefabrique_test');
    });
  });

  it('tables natives : catégories de revenus et de production boulangères masquées hors boulangerie', async () => {
    await sandbox(async q => {
      const tagged = (await q(`SELECT count(*)::int AS n FROM revenue_categories WHERE sectors && ARRAY['boulangerie']`)).rows[0].n;
      await setSector(q, 'services');
      const still = (await q(`SELECT count(*)::int AS n FROM revenue_categories WHERE sectors && ARRAY['boulangerie'] AND is_active`)).rows[0].n;
      if (tagged > 0) expect(still).toBe(0);
      const cats = await q(
        `SELECT rc.code FROM recipe_categories rc WHERE rc.is_active AND rc.sectors && ARRAY['boulangerie']
            AND NOT (rc.id = ANY(fn_ref_fk_used_ids('recipe_categories'::regclass, ARRAY(SELECT id FROM recipe_categories))))`);
      expect(cats.rows.map(r => r.code)).toEqual([]);
    });
  });

  it('aperçu (assistant) : annonce les changements sans rien écrire', async () => {
    const before = await activeKeys(q0);
    const preview = await scope.refScopePreview(['btp'], ['second_oeuvre']);
    expect(preview.lineage).toEqual(['btp']);
    const families = preview.tables.find(t => t.table_id === 'ingredient_categories');
    expect(families?.label).toBe('Familles de matériaux');
    expect(families?.activated).toEqual(expect.arrayContaining(['Ciments & liants', 'Peintures & revêtements']));
    // « Retirées » : seulement des valeurs boulangères qu'aucune donnée n'utilise.
    expect(families?.deactivated.length).toBeGreaterThan(0);
    expect(families?.deactivated).not.toContain('Ciments & liants');
    expect(preview.activated).toBeGreaterThan(20);
    expect(await activeKeys(q0)).toEqual(before);
    // Profil courant : aucun changement annoncé.
    const specs = (await testPool().query(`SELECT code FROM company_specializations`)).rows.map(r => r.code as string);
    const same = await scope.refScopePreview(['boulangerie'], specs);
    expect([same.activated, same.deactivated]).toEqual([0, 0]);
  });

  const q0: Q = (sql, params) => testPool().query(sql, params);
});
