/**
 * Phase 4.6 (mig 478) — loi 09-08. Consentement, export, et surtout
 * anonymisation : on scrub les données personnelles mais on GARDE la ligne et
 * son id (les factures/créances qui la référencent ne cassent pas), on supprime
 * les adresses, et l'action est tracée dans la piste d'audit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { customerRepository } from '../../repositories/customer.repository.js';
import { customerAddressRepository } from '../../repositories/customer-address.repository.js';

describe.skipIf(!hasTestDb)('Protection des données client (09-08)', () => {
  const p = () => testPool();
  let custId: string;

  beforeAll(async () => {
    custId = (await p().query(
      `INSERT INTO customers (customer_type, company_name, email, phone, ice, address, city)
       VALUES ('professionnel', $1, 'jean@x.ma', '0600000000', '123456789012345', '1 rue X', 'Casa') RETURNING id`,
      [`Confidentiel ${RUN}`]
    )).rows[0].id;
    await customerAddressRepository.create(custId, { addressLine: '1 rue X', city: 'Casa', isDefaultDelivery: true });
  });

  afterAll(async () => {
    await p().query(`DELETE FROM customer_audit WHERE customer_id = $1`, [custId]).catch(() => undefined);
    await p().query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [custId]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [custId]).catch(() => undefined);
    await closeTestPool();
  });

  it('enregistre le consentement marketing et le date', async () => {
    await customerRepository.setConsent(custId, true, null);
    const row = await customerRepository.findById(custId);
    expect(row.marketing_consent).toBe(true);
    expect(row.consent_at).not.toBeNull();
  });

  it('exporte les données personnelles du client', async () => {
    const data = await customerRepository.exportData(custId);
    expect(data).not.toBeNull();
    expect(data!.customer.id).toBe(custId);
    expect(Array.isArray(data!.addresses)).toBe(true);
  });

  it('anonymise sans effacer la ligne, scrub le PII, et trace l\'action', async () => {
    const ok = await customerRepository.anonymize(custId, null);
    expect(ok).not.toBeNull();

    const row = await customerRepository.findById(custId);
    expect(row).not.toBeNull();                 // la ligne existe toujours (compta préservée)
    expect(row.id).toBe(custId);
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.ice).toBeNull();
    expect(row.company_name).toBeNull();
    expect(row.anonymized_at).not.toBeNull();
    expect(row.is_active).toBe(false);

    const addrCount = (await p().query(`SELECT COUNT(*)::int AS n FROM customer_addresses WHERE customer_id = $1`, [custId])).rows[0].n;
    expect(addrCount).toBe(0);                  // adresses personnelles supprimées

    const hist = await customerRepository.history(custId);
    expect(hist.some(h => h.action === 'anonymize')).toBe(true);

    // Idempotence : un second appel ne refait rien (déjà anonymisé).
    expect(await customerRepository.anonymize(custId, null)).toBeNull();
  });
});
