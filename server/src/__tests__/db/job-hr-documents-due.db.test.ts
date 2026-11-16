/**
 * G1-12 — tâche planifiée « échéances du personnel ».
 * Seuils 30 et 7 jours : carte d'identité, visite médicale, fin de CDD et fin d'essai d'un
 * salarié actif sont signalées une fois par seuil ; un salarié inactif n'est pas suivi ;
 * une échéance reportée (document renouvelé) est signalée de nouveau.
 * Les dates sont posées avec une marge : la date de la base de test et celle de Casablanca
 * peuvent différer d'un jour.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Tâche planifiée : échéances du personnel (G1-12)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let scheduler: typeof import('../../services/scheduler.js');
  let fx: Fixtures;
  let previous: unknown;
  let activeId: string, inactiveId: string, contractId: string, documentId: string;
  const p = () => testPool();
  const setParam = (value: unknown) => p().query(
    `INSERT INTO module_parameters (key, value) VALUES ('hr.documents_due', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(value)]);
  const alerts = async () => (await p().query(
    `SELECT kind, threshold_days FROM hr_due_alerts WHERE ref_id = ANY($1) ORDER BY kind, threshold_days`,
    [[activeId, inactiveId, contractId, documentId]])).rows.map(r => `${r.kind}:${r.threshold_days}`);
  const notifications = async () => (await p().query(
    `SELECT title, message FROM notifications WHERE store_id = $1 AND type = 'hr_document_due' ORDER BY created_at`, [fx.storeId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    scheduler = await import('../../services/scheduler.js');
    fx = await createBaseFixtures();
    previous = (await p().query(`SELECT value FROM module_parameters WHERE key = 'hr.documents_due'`)).rows[0]?.value;
    await setParam({ days: [30, 7], email: false });
    const employee = async (name: string, active: boolean, cinInDays: number) => (await p().query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, monthly_salary, store_id, is_active, cin_expires_on)
       VALUES ($1, $2, 'baker', '2025-01-01', 4000, $3, $4, CURRENT_DATE + $5::int) RETURNING id`,
      [name, `G112 ${RUN}`, fx.storeId, active, cinInDays])).rows[0].id as string;
    activeId = await employee('Salima', true, 20);            // CIN sous 30 jours
    inactiveId = await employee('Ancien', false, 20);         // inactif : non suivi
    contractId = (await p().query(
      `INSERT INTO employee_contracts (employee_id, contract_type, start_date, end_date, trial_end_date)
       VALUES ($1, 'cdd', CURRENT_DATE - 60, CURRENT_DATE + 25, CURRENT_DATE + 4) RETURNING id`, [activeId])).rows[0].id;   // CDD sous 30, essai sous 7
    documentId = (await p().query(
      `INSERT INTO employee_documents (employee_id, doc_type, title, expires_on, file_name, mime_type, size_bytes, content)
       VALUES ($1, 'visite_medicale', 'Visite médicale', CURRENT_DATE + 90, 'visite.pdf', 'application/pdf', 4, '\\x25504446') RETURNING id`,
      [activeId])).rows[0].id;                                 // dans 90 jours : pas encore
  }, 60_000);

  afterAll(async () => {
    if (previous) await setParam(previous).catch(() => undefined);
    await p().query(`DELETE FROM hr_due_alerts WHERE ref_id = ANY($1)`, [[activeId, inactiveId, contractId, documentId]]).catch(() => undefined);
    await p().query(`DELETE FROM notifications WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
    await p().query(`DELETE FROM employee_documents WHERE employee_id = ANY($1)`, [[activeId, inactiveId]]).catch(() => undefined);
    await p().query(`DELETE FROM employee_contracts WHERE employee_id = ANY($1)`, [[activeId, inactiveId]]).catch(() => undefined);
    await p().query(`DELETE FROM employees WHERE id = ANY($1)`, [[activeId, inactiveId]]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('premier passage : CIN et fin de CDD sous 30 jours, fin d\'essai sous 30 et 7 jours ; une seule notification', async () => {
    const run = await scheduler.runJob('hr_documents_due', 'manual');
    expect(run.status).toBe('ok');
    expect(await alerts()).toEqual(['cdd_end:30', 'cin:30', 'trial_end:7', 'trial_end:30']);
    const n = await notifications();
    expect(n).toHaveLength(1);
    expect(n[0].title).toMatch(/3 échéances proches/);
    expect(n[0].message).toContain('Salima');
    expect(n[0].message).toContain('Fin de période d\'essai');
    expect(n[0].message).not.toContain('Ancien');             // salarié inactif
    expect(n[0].message).not.toContain('Visite médicale');    // dans 90 jours
  }, 120_000);

  it('second passage : rien de nouveau', async () => {
    expect(await scheduler.runJob('hr_documents_due', 'manual')).toMatchObject({ status: 'ok', items: 0 });
    expect(await notifications()).toHaveLength(1);
  }, 120_000);

  it('la visite médicale approche, puis est renouvelée : signalée à chaque nouvelle échéance', async () => {
    await p().query(`UPDATE employee_documents SET expires_on = CURRENT_DATE + 20 WHERE id = $1`, [documentId]);
    await scheduler.runJob('hr_documents_due', 'manual');
    expect((await alerts()).filter(a => a.startsWith('document'))).toEqual(['document:30']);
    expect((await notifications())[1].message).toContain('Visite médicale');
    // Renouvelée : nouvelle date, de nouveau sous 30 jours un an plus tard — ici on rapproche la date pour le vérifier.
    await p().query(`UPDATE employee_documents SET expires_on = CURRENT_DATE + 15 WHERE id = $1`, [documentId]);
    await scheduler.runJob('hr_documents_due', 'manual');
    expect(await notifications()).toHaveLength(3);
  }, 120_000);
});
