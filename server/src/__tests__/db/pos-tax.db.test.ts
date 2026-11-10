/**
 * Phase 5.2 (mig 480) — TVA au comptoir par article.
 *
 * Le prix de caisse est le prix payé (TTC) ; la TVA y est *incluse*. On vérifie :
 *   - la dérivation de la TVA incluse (formule du contrôleur) ;
 *   - taxCodeRepository.rateFor résout le taux courant d'un code (null si inconnu) ;
 *   - saleRepository.create fige tax_rate / tax_amount par ligne et au niveau vente,
 *     sans changer le total encaissé (TVA ventilée, pas ajoutée) ;
 *   - l'écriture comptable du ticket (fromSale) reste équilibrée, avec le HT en 7111
 *     et la TVA collectée isolée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { saleRepository } from '../../repositories/sale.repository.js';
import { taxCodeRepository } from '../../repositories/tax-code.repository.js';
import { fromSale, type SaleRow } from '../../services/journal-generator.service.js';
import { netFromGross, round2 } from '../../utils/tva.js';

describe('TVA au comptoir — dérivation incluse (formule du contrôleur)', () => {
  // vat = subtotal - subtotal/(1+taux/100), exactement comme sale.controller.ts.
  const vatOf = (ttc: number, rate: number) => round2(ttc - netFromGross(ttc, rate));
  it('isole la TVA contenue dans un prix TTC', () => {
    expect(vatOf(120, 20)).toBe(20);   // 120 TTC @20% -> 20 de TVA, 100 HT
    expect(vatOf(110, 10)).toBe(10);   // 110 TTC @10% -> 10 de TVA, 100 HT
  });
  it('TVA nulle sans taux (cas Ofauria) : total inchangé', () => {
    expect(vatOf(120, 0)).toBe(0);
  });
});

describe.skipIf(!hasTestDb)('TVA au comptoir — persistance et écriture', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let prodTtc: string;   // article TTC + code TVA 20 %
  let prodBare: string;  // article sans code TVA (cas Ofauria)
  const code = `T20-${RUN}`.slice(0, 20);

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag TVA ${RUN}`])).rows[0].id;
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, 'x', 'Test', 'Caisse', 'admin', $2) RETURNING id`,
      [`caisse-${RUN}@test.local`, storeId]
    )).rows[0].id;
    // Code TVA daté (mig 309/473), pays MA (défaut de rateFor).
    await p().query(
      `INSERT INTO tax_codes (country_code, code, label, rate, kind, recoverable, valid_from)
       VALUES ('MA', $1, 'Test 20', 20, 'standard', true, CURRENT_DATE - 1)`, [code]);
    const mk = async (name: string, taxCode: string | null) => (await p().query(
      `INSERT INTO products (name, slug, price, tax_code, price_includes_tax)
       VALUES ($1, $2, 120, $3, true) RETURNING id`,
      [`${name} ${RUN}`, `${name.toLowerCase()}-${RUN}`, taxCode]
    )).rows[0].id;
    prodTtc = await mk('PosTVA', code);
    prodBare = await mk('PosBrut', null);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[prodTtc, prodBare]]).catch(() => undefined);
    await p().query(`DELETE FROM tax_codes WHERE code = $1`, [code]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('rateFor résout le taux courant du code, null si inconnu', async () => {
    expect(await taxCodeRepository.rateFor(code)).toBe(20);
    expect(await taxCodeRepository.rateFor(`INEXISTANT-${RUN}`)).toBeNull();
    expect(await taxCodeRepository.rateFor(null)).toBeNull();
  });

  it('fige la TVA de ligne et au niveau vente, total TTC inchangé', async () => {
    const sale = await saleRepository.create({
      userId, storeId,
      subtotal: 120, taxAmount: 20, discountAmount: 0, total: 120,
      paymentMethod: 'cash', paymentStatus: 'paid', skipStockDeduction: true,
      items: [{ productId: prodTtc, quantity: 1, unitPrice: 120, subtotal: 120, taxRate: 20, taxAmount: 20 }],
    });
    expect(round2(Number(sale.total))).toBe(120);      // total encaissé inchangé
    expect(round2(Number(sale.tax_amount))).toBe(20);  // TVA ventilée
    const li = (await p().query(`SELECT tax_rate, tax_amount FROM sale_items WHERE sale_id = $1`, [sale.id])).rows[0];
    expect(Number(li.tax_rate)).toBe(20);
    expect(Number(li.tax_amount)).toBe(20);
  });

  it('article sans code TVA (Ofauria) : TVA 0 par défaut', async () => {
    const sale = await saleRepository.create({
      userId, storeId,
      subtotal: 120, taxAmount: 0, discountAmount: 0, total: 120,
      paymentMethod: 'cash', paymentStatus: 'paid', skipStockDeduction: true,
      items: [{ productId: prodBare, quantity: 1, unitPrice: 120, subtotal: 120 }],
    });
    const li = (await p().query(`SELECT tax_rate, tax_amount FROM sale_items WHERE sale_id = $1`, [sale.id])).rows[0];
    expect(Number(li.tax_rate)).toBe(0);
    expect(Number(li.tax_amount)).toBe(0);
  });

  it('écriture du ticket équilibrée : 7111 au HT, TVA collectée isolée', async () => {
    const sale = await saleRepository.create({
      userId, storeId,
      subtotal: 120, taxAmount: 20, discountAmount: 0, total: 120,
      paymentMethod: 'cash', paymentStatus: 'paid', skipStockDeduction: true,
      items: [{ productId: prodTtc, quantity: 1, unitPrice: 120, subtotal: 120, taxRate: 20, taxAmount: 20 }],
    });
    const row = (await p().query(`SELECT * FROM sales WHERE id = $1`, [sale.id])).rows[0] as SaleRow;
    const entry = await fromSale(p() as never, row);
    expect(entry).not.toBeNull();
    const lines = entry!.lines;
    const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
    expect(debit).toBe(credit);                                  // équilibre
    expect(debit).toBe(120);                                     // TTC
    const revenue = lines.find((l) => l.account_code === '7111');
    expect(revenue?.credit).toBe(100);                           // HT = 120 - 20
    const tva = lines.find((l) => /TVA/i.test(l.label));
    expect(round2(tva?.credit ?? 0)).toBe(20);                   // TVA collectée
  });
});
