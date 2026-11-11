/**
 * Phase 5.7 (mig 485) — socle fiscal : attestation d'exonération datée + droit de timbre.
 *
 * Phase bloquée par l'expert-comptable : le socle est ADDITIF et INERTE par défaut.
 * On vérifie :
 *   - une attestation d'exonération est active dans sa fenêtre de validité, pas en dehors ;
 *   - le droit de timbre est 0 tant qu'il est désactivé, et calculé (borné au minimum)
 *     une fois activé, sur règlement espèces seulement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { customerTaxExemptionRepository } from '../../repositories/customer-tax-exemption.repository.js';
import { stampDutyAmount } from '../../utils/tva.js';

describe('Droit de timbre — fonction pure (inerte par défaut)', () => {
  const on = { enabled: true, rate_pct: 0.25, min_dh: 1, cash_only: true };
  it('est nul tant qu\'il est désactivé', () => {
    expect(stampDutyAmount({ ...on, enabled: false }, 1000, 'cash')).toBe(0);
  });
  it('s\'applique au comptant, pas à la carte (cash_only)', () => {
    expect(stampDutyAmount(on, 1000, 'card')).toBe(0);
    expect(stampDutyAmount(on, 1000, 'cash')).toBe(2.5); // 0,25 % de 1000
  });
  it('est borné au minimum', () => {
    expect(stampDutyAmount(on, 100, 'cash')).toBe(1); // 0,25 → min 1
  });
  it('est nul pour un montant nul ou négatif', () => {
    expect(stampDutyAmount(on, 0, 'cash')).toBe(0);
  });
});

describe.skipIf(!hasTestDb)('Attestations d\'exonération de TVA', () => {
  const p = () => testPool();
  let customerId: string;

  beforeAll(async () => {
    customerId = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Exo', 'Client ${RUN}', 'professionnel') RETURNING id`)).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM customer_tax_exemptions WHERE customer_id = $1`, [customerId]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
    await closeTestPool();
  });

  it('est active dans sa fenêtre de validité, pas en dehors', async () => {
    await customerTaxExemptionRepository.create(customerId, {
      certificateNumber: `EXO-${RUN}`, reason: 'Export', validFrom: '2026-01-01', validTo: '2026-12-31',
    });
    expect(await customerTaxExemptionRepository.activeAt(p(), customerId, '2026-06-15')).not.toBeNull();
    expect(await customerTaxExemptionRepository.activeAt(p(), customerId, '2025-12-31')).toBeNull();
    expect(await customerTaxExemptionRepository.activeAt(p(), customerId, '2027-01-01')).toBeNull();
    const list = await customerTaxExemptionRepository.list(customerId);
    expect(list).toHaveLength(1);
  });

  it('une attestation sans fin reste active au-delà', async () => {
    const other = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Exo', 'Perm ${RUN}', 'professionnel') RETURNING id`)).rows[0].id;
    await customerTaxExemptionRepository.create(other, { certificateNumber: `PERM-${RUN}`, validFrom: '2026-01-01', validTo: null });
    expect(await customerTaxExemptionRepository.activeAt(p(), other, '2030-06-15')).not.toBeNull();
    await p().query(`DELETE FROM customer_tax_exemptions WHERE customer_id = $1`, [other]);
    await p().query(`DELETE FROM customers WHERE id = $1`, [other]);
  });
});
