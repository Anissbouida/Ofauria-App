/**
 * Phase 5.1 (mig 479) — base de prix explicite HT/TTC sur l'article.
 *
 * Le défaut d'une ligne professionnelle est un prix HT. On vérifie que :
 *   - la colonne price_includes_tax existe et vaut true par défaut (TTC) ;
 *   - un article TTC avec code TVA voit son HT dérivé (120 TTC @20% -> 100 HT) ;
 *   - un article déclaré HT garde son prix tel quel ;
 *   - un article TTC sans code TVA (cas Ofauria) : HT = TTC (zéro régression) ;
 *   - les helpers purs netPriceOf / grossPriceOf sont exacts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { deliveryNoteRepository } from '../../repositories/delivery-note.repository.js';
import { netPriceOf, grossPriceOf } from '../../utils/tva.js';

describe('Base de prix HT/TTC — helpers purs', () => {
  it('dérive le HT et le TTC selon la base déclarée', () => {
    expect(netPriceOf(120, true, 20)).toBe(100);   // TTC -> HT
    expect(netPriceOf(100, false, 20)).toBe(100);  // déjà HT
    expect(grossPriceOf(100, false, 20)).toBe(120); // HT -> TTC
    expect(grossPriceOf(120, true, 20)).toBe(120);  // déjà TTC
    expect(netPriceOf(120, true, 0)).toBe(120);     // taux 0 : HT = TTC
    expect(netPriceOf(120, true, null)).toBe(120);  // pas de taux : HT = TTC
  });
});

describe.skipIf(!hasTestDb)('Base de prix HT/TTC — lineDefaults', () => {
  const p = () => testPool();
  let proId: string;
  let ttcProd: string;   // prix TTC + code TVA 20 %
  let htProd: string;    // prix HT + code TVA 20 %
  let bareProd: string;  // prix TTC sans code TVA (cas Ofauria)

  beforeAll(async () => {
    proId = (await p().query(
      `INSERT INTO customers (customer_type, company_name) VALUES ('professionnel', $1) RETURNING id`,
      [`Pro base-prix ${RUN}`]
    )).rows[0].id;

    const mk = async (name: string, price: number, taxCode: string | null, includesTax: boolean) => (await p().query(
      `INSERT INTO products (name, slug, price, tax_code, price_includes_tax)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`${name} ${RUN}`, `${name.toLowerCase()}-${RUN}`, price, taxCode, includesTax]
    )).rows[0].id;

    ttcProd = await mk('BasePrixTTC', 120, 'N20', true);
    htProd = await mk('BasePrixHT', 100, 'N20', false);
    bareProd = await mk('BasePrixBrut', 120, null, true);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[ttcProd, htProd, bareProd]]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [proId]).catch(() => undefined);
    await closeTestPool();
  });

  it('colonne price_includes_tax : défaut TTC (true)', async () => {
    const d = (await p().query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 10) RETURNING price_includes_tax`,
      [`BasePrixDefaut ${RUN}`, `defaut-${RUN}`]
    )).rows[0];
    expect(d.price_includes_tax).toBe(true);
  });

  it('article TTC + code TVA : le HT par défaut est dérivé (120 TTC @20% -> 100 HT)', async () => {
    const out = await deliveryNoteRepository.lineDefaults(proId, [ttcProd]);
    expect(out[ttcProd].unitPrice).toBe(100);
    expect(out[ttcProd].tvaRate).toBe(20);
  });

  it('article déclaré HT : le prix par défaut reste tel quel', async () => {
    const out = await deliveryNoteRepository.lineDefaults(proId, [htProd]);
    expect(out[htProd].unitPrice).toBe(100);
    expect(out[htProd].tvaRate).toBe(20);
  });

  it('article TTC sans code TVA (Ofauria) : HT = TTC, zéro régression', async () => {
    const out = await deliveryNoteRepository.lineDefaults(proId, [bareProd]);
    expect(out[bareProd].unitPrice).toBe(120);
  });
});
