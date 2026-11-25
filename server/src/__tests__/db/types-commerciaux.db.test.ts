/**
 * Types de client et types de commande pilotés par le secteur (mig 701).
 *
 * Même méthode que referentiels-sectoriels.db.test.ts : chaque cas se joue dans une
 * transaction annulée, et le secteur est changé comme le fait l'application (ce sont les
 * déclencheurs qui synchronisent les référentiels). Un changement de secteur resynchronise
 * tous les référentiels : d'où le délai long de chaque cas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { REF_BEHAVIOR_FIELDS, cleanRefBehaviors, customerTypeBehaviors, orderTypeBehaviors } from '@ofauria/shared';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

describe('Comportements des types commerciaux (schéma partagé)', () => {
  it('un type de client inconnu garde la règle historique', () => {
    expect(customerTypeBehaviors(undefined, 'particulier').settlement).toBe('comptant');
    expect(customerTypeBehaviors(undefined, 'professionnel')).toMatchObject({ settlement: 'compte', legal_entity: true, requires_tax_id: true });
    expect(customerTypeBehaviors(undefined, 'association')).toMatchObject({ settlement: 'compte', requires_tax_id: false, vat_exempt: true });
    expect(customerTypeBehaviors({}, null).settlement).toBe('comptant');
  });
  it('les comportements enregistrés priment sur le code', () => {
    expect(customerTypeBehaviors({ settlement: 'compte', legal_entity: false }, 'particulier')).toMatchObject({ settlement: 'compte', legal_entity: false });
    expect(orderTypeBehaviors({ party: 'employee', auto_discount: 'staff' })).toMatchObject({ party: 'employee', auto_discount: 'staff', direction_only: false, settlement: 'any' });
    expect(orderTypeBehaviors(null)).toMatchObject({ party: 'customer', settlement: 'any' });
  });
  it('la saisie est contrôlée : valeur hors liste refusée, clé inconnue écartée', () => {
    expect(cleanRefBehaviors('order_types', { party: 'robot' })).toMatchObject({ ok: false });
    const ok = cleanRefBehaviors('customer_types', { settlement: 'compte', legal_entity: true, intrus: 1 });
    expect(ok).toEqual({ ok: true, metadata: { settlement: 'compte', legal_entity: true, requires_tax_id: false, vat_exempt: false, personal_fields: false } });
    expect(cleanRefBehaviors('units', { category: 'mass' })).toEqual({ ok: true, metadata: { category: 'mass' } });
  });
});

describe.skipIf(!hasTestDb)('Types de client et de commande par secteur (mig 701)', () => {
  let svc: typeof import('../../services/commercial-types.js');

  beforeAll(async () => {
    await importRepositories();
    svc = await import('../../services/commercial-types.js');
  });
  afterAll(async () => { await closeTestPool(); });

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
  const setSector = async (q: Q, primary: string) => {
    await q(`DELETE FROM company_specializations`);
    await q(`DELETE FROM company_sectors WHERE NOT is_primary`);
    await q(`UPDATE company_settings SET sector_pack = $1 WHERE id = 1`, [primary]);
    await q(`SELECT fn_ref_sync_sectors('test')`);
  };
  /** Retire des données les types d'un autre métier : une valeur utilisée n'est jamais désactivée. */
  const clearUsage = async (q: Q) => {
    await q(`UPDATE orders SET order_kind = NULL WHERE order_kind IS NOT NULL`);
    await q(`UPDATE customers SET customer_type = 'professionnel' WHERE customer_type IS DISTINCT FROM 'professionnel'`);
  };
  const active = async (q: Q, table: string): Promise<string[]> =>
    (await q(`SELECT code FROM ref_entries WHERE table_id = $1 AND is_active AND code IS NOT NULL ORDER BY display_order`, [table])).rows.map(r => r.code);

  it('le catalogue livré respecte le schéma des comportements', async () => {
    const { rows } = await testPool().query(
      `SELECT table_id, code, metadata FROM ref_entries WHERE table_id IN ('customer_types', 'order_types') AND origin = 'system'`);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      const c = cleanRefBehaviors(r.table_id, r.metadata);
      expect(c, `${r.table_id}:${r.code}`).toEqual({ ok: true, metadata: r.metadata });
      expect(Object.keys(r.metadata).sort(), `${r.table_id}:${r.code}`).toEqual(REF_BEHAVIOR_FIELDS[r.table_id].map(f => f.key).sort());
    }
  });

  it('boulangerie : les quatre types de commande et de client d\'origine, rien de plus', () => sandbox(async q => {
    await clearUsage(q);
    await setSector(q, 'boulangerie');
    expect(await active(q, 'order_types')).toEqual(['client', 'passager', 'professionnel', 'staff']);
    expect(await active(q, 'customer_types')).toEqual(['particulier', 'professionnel', 'association', 'revendeur']);
    expect(await svc.accountOrdersRestricted({ query: q })).toBe(true);
  }), 180_000);

  it('BTP : commandes de travaux et de marché, maîtres d\'ouvrage — ni passager ni personnel', () => sandbox(async q => {
    await clearUsage(q);
    await setSector(q, 'btp');
    expect(await active(q, 'order_types')).toEqual(['travaux', 'marche']);
    const customers = await active(q, 'customer_types');
    expect(customers).toEqual(expect.arrayContaining(['maitre_ouvrage', 'promoteur', 'organisme_public', 'professionnel', 'client_prive']));
    expect(customers).not.toContain('particulier');
    expect(customers).not.toContain('revendeur');
    // Aucune commande réservée à la direction : la règle de la vente au comptoir ne s'applique pas.
    expect(await svc.accountOrdersRestricted({ query: q })).toBe(false);
    expect((await svc.findOrderType('travaux', { query: q }))?.behaviors).toMatchObject({ party: 'customer', settlement: 'compte', direction_only: false });
  }), 180_000);

  it('chaque profil propose un type de commande et des clients qui lui correspondent', () => sandbox(async q => {
    const sectors = (await q(`SELECT code FROM sector_packs WHERE NOT is_custom ORDER BY code`)).rows.map(r => r.code as string);
    expect(sectors.length).toBeGreaterThanOrEqual(13);
    for (const s of sectors) {
      await setSector(q, s);
      const orders = (await q(`SELECT code, metadata FROM ref_entries WHERE table_id = 'order_types' AND is_active`)).rows;
      const customers = (await q(`SELECT code, metadata FROM ref_entries WHERE table_id = 'customer_types' AND is_active`)).rows;
      expect(orders.length, `types de commande — ${s}`).toBeGreaterThan(0);
      expect(customers.length, `types de client — ${s}`).toBeGreaterThan(0);
      const settlements = new Set(customers.map(c => customerTypeBehaviors(c.metadata, c.code).settlement));
      for (const o of orders) {
        const b = orderTypeBehaviors(o.metadata);
        if (b.party === 'customer' && b.settlement !== 'any') expect(settlements.has(b.settlement), `${s} : ${o.code} sans client « ${b.settlement} »`).toBe(true);
      }
    }
  }), 180_000);

  it('aller-retour boulangerie → BTP → boulangerie sans écart', () => sandbox(async q => {
    await clearUsage(q);
    await setSector(q, 'boulangerie');
    const before = [await active(q, 'order_types'), await active(q, 'customer_types')];
    await setSector(q, 'btp');
    await setSector(q, 'boulangerie');
    expect([await active(q, 'order_types'), await active(q, 'customer_types')]).toEqual(before);
  }), 180_000);

  it('fn_customer_on_account lit le comportement, avec la règle historique pour un code inconnu', async () => {
    const r = await testPool().query(
      `SELECT fn_customer_on_account('particulier') AS p, fn_customer_on_account('professionnel') AS pro, fn_customer_on_account('maitre_ouvrage') AS mo,
              fn_customer_on_account('client_prive') AS prive, fn_customer_on_account(NULL) AS nul, fn_customer_on_account('inconnu') AS inconnu,
              fn_customer_type_flag('association', 'vat_exempt') AS asso_exo, fn_customer_type_flag('organisme_public', 'requires_tax_id') AS pub_ice`);
    expect(r.rows[0]).toEqual({ p: false, pro: true, mo: true, prive: true, nul: false, inconnu: true, asso_exo: true, pub_ice: false });
  });

  it('une fiche client n\'accepte qu\'un type du référentiel ; un type utilisé reste proposé', () => sandbox(async q => {
    await setSector(q, 'boulangerie');
    await q(`SAVEPOINT s`);
    await expect(q(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('T', 'Inconnu', 'type_absent')`)).rejects.toThrow(/référentiel/);
    await q(`ROLLBACK TO SAVEPOINT s`);
    await q(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('T', 'Asso', 'Association test 701', 'association')`);
    await setSector(q, 'btp');
    const customers = await active(q, 'customer_types');
    expect(customers).toContain('association'); // portée par une fiche : jamais désactivée
    expect(customers).toContain('maitre_ouvrage');
  }), 180_000);

  it('Référentiel : un type créé par la société reçoit un code et des comportements contrôlés', async () => {
    const { refEntryRepository: referentielRepository } = await import('../../repositories/referentiel.repository.js');
    await testPool().query(`DELETE FROM ref_entries WHERE table_id = 'order_types' AND code = 'commande_en_regie_701'`);
    try {
      const row = await referentielRepository.create('order_types', { label: 'Commande en régie 701', metadata: { party: 'customer', settlement: 'compte', intrus: true } });
      expect(row.code).toBe('commande_en_regie_701');
      expect(row.metadata).toEqual({ party: 'customer', settlement: 'compte', auto_discount: 'none', direction_only: false });
      expect(row.is_active).toBe(true);
      await expect(referentielRepository.create('order_types', { label: 'Type invalide 701', metadata: { party: 'robot' } })).rejects.toThrow(/valeur inconnue/);
      await expect(referentielRepository.update('order_types', row.id, { metadata: { auto_discount: 'tout' } })).rejects.toThrow(/valeur inconnue/);
    } finally {
      await testPool().query(`DELETE FROM ref_entries WHERE table_id = 'order_types' AND code IN ('commande_en_regie_701', 'type_invalide_701')`);
    }
  });

  it('type par défaut d\'une fiche créée sans choix : celui du secteur', () => sandbox(async q => {
    await clearUsage(q);
    await setSector(q, 'boulangerie');
    expect(await svc.defaultCustomerType(false, { query: q })).toBe('particulier');
    expect(await svc.defaultCustomerType(true, { query: q })).toBe('professionnel');
    await setSector(q, 'btp');
    expect(await svc.defaultCustomerType(false, { query: q })).toBe('client_prive');
  }), 180_000);
});
