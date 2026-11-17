/**
 * G3-11 — droit d'accès (loi 09-08) : export des données d'un salarié et d'un fournisseur.
 *  - salarié : sa fiche, ses tables liées (contrat, document du dossier), son compte
 *    utilisateur SANS secret, ses connexions ;
 *  - le contenu binaire d'un document n'est pas exporté : seule sa taille l'est ;
 *  - fournisseur : sa fiche et ses pièces liées (bon de commande) ;
 *  - l'export est tracé (auth_events, personal_data_export) ; personne inconnue : null ;
 *  - le registre des traitements couvre clients, salariés, fournisseurs, comptes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Export des données personnelles (G3-11)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let pd: typeof import('../../services/personal-data.js');
  let fx: Fixtures;
  let employeeId: string, accountId: string, supplierId: string, orderId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    pd = await import('../../services/personal-data.js');
    fx = await createBaseFixtures();
    accountId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id, pin_code)
       VALUES ($1, 'empreinte-secrete', 'Salima', 'G311', 'baker', $2, '9999') RETURNING id`,
      [`salima-${RUN}@test.local`, fx.storeId])).rows[0].id;
    employeeId = (await p().query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, monthly_salary, store_id, user_id, cin, rib)
       VALUES ('Salima', $1, 'baker', '2025-01-01', 4200, $2, $3, 'AB123456', '011780000012345678901234') RETURNING id`,
      [`G311 ${RUN}`, fx.storeId, accountId])).rows[0].id;
    await p().query(`INSERT INTO employee_contracts (employee_id, contract_type, start_date) VALUES ($1, 'cdi', '2025-01-01')`, [employeeId]);
    await p().query(
      `INSERT INTO employee_documents (employee_id, doc_type, title, file_name, mime_type, size_bytes, content)
       VALUES ($1, 'cin', 'Copie CIN', 'cin.pdf', 'application/pdf', 4, '\\x25504446')`, [employeeId]);
    await p().query(`INSERT INTO auth_events (event_type, user_id, success, ip) VALUES ('login', $1, true, '10.0.0.1')`, [accountId]);
    supplierId = (await p().query(`INSERT INTO suppliers (name, contact_name, phone) VALUES ($1, 'Karim', '0600000000') RETURNING id`, [`Fournisseur G311 ${RUN}`])).rows[0].id;
    orderId = (await p().query(
      `INSERT INTO purchase_orders (order_number, supplier_id, status, order_date, store_id, created_by) VALUES ($1, $2, 'en_attente', CURRENT_DATE, $3, $4) RETURNING id`,
      [`BC-G311-${RUN}`, supplierId, fx.storeId, fx.userId])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM auth_events WHERE user_id = ANY($1) OR details->>'id' = ANY($2)`, [[accountId, fx.userId], [employeeId, supplierId]]).catch(() => undefined);
    await p().query(`DELETE FROM employee_documents WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM employee_contracts WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM employees WHERE id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [accountId]).catch(() => undefined);
    await p().query(`DELETE FROM purchase_orders WHERE id = $1`, [orderId]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('salarié : fiche, tables liées, compte sans secret, connexions ; pas de contenu binaire', async () => {
    const out = (await pd.exportPersonalData('employee', employeeId, { userId: fx.userId }))!;
    expect(out.kind).toBe('employee');
    expect(out.record).toMatchObject({ id: employeeId, cin: 'AB123456', rib: '011780000012345678901234' });
    const tables = Object.fromEntries(out.related.map(r => [r.table, r]));
    expect(tables.employee_contracts.count).toBe(1);
    const doc = tables.employee_documents.rows[0];
    expect(doc).toMatchObject({ title: 'Copie CIN', content_octets: 4 });
    expect(doc).not.toHaveProperty('content');
    expect(out.account).toMatchObject({ id: accountId, email: `salima-${RUN}@test.local` });
    expect(out.account).not.toHaveProperty('password_hash');
    expect(out.account).not.toHaveProperty('pin_code');
    expect(JSON.stringify(out)).not.toContain('empreinte-secrete');
    expect(out.connections!.some(c => c.ip === '10.0.0.1')).toBe(true);
  });

  it('fournisseur : fiche et pièces liées', async () => {
    const out = (await pd.exportPersonalData('supplier', supplierId, { userId: fx.userId }))!;
    expect(out.record).toMatchObject({ id: supplierId, contact_name: 'Karim' });
    expect(out.related.find(r => r.table === 'purchase_orders')).toMatchObject({ count: 1, truncated: false });
    expect(out.account).toBeUndefined();
  });

  it('chaque export est tracé ; personne inconnue : null', async () => {
    const traces = (await p().query(
      `SELECT details->>'kind' AS kind FROM auth_events WHERE event_type = 'personal_data_export' AND user_id = $1 ORDER BY created_at`, [fx.userId])).rows;
    expect(traces.map(t => t.kind)).toEqual(['employee', 'supplier']);
    expect(await pd.exportPersonalData('employee', '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('registre des traitements', () => {
    expect(pd.PROCESSING_REGISTER.map(r => r.key)).toEqual(['customers', 'employees', 'suppliers', 'users']);
    expect(pd.PROCESSING_REGISTER.find(r => r.key === 'employees')!.rights.erasure).toBe(false);
  });
});
