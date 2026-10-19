import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import {
  trialEndDate, renewedTrialEnd, cddRenewalWarnings, computeHrAlerts, type Category,
} from '../services/contract-rules.js';

/**
 * Contrats de travail, avenants et documents du salarie (lot 4, mig 322).
 * Le contrat ACTIF est la source de verite : chaque changement est repercute
 * sur la fiche employe (type, dates, salaire) pour le reste de l'application.
 */

type Row = Record<string, any>;
const iso = (d: unknown): string | null => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};
const dayBefore = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10);
};
const dayAfter = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
};
const httpError = (status: number, message: string) => Object.assign(new Error(message), { statusCode: status });

async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Repercute le contrat actif sur la fiche employe (debut = debut de la chaine). */
async function syncEmployee(client: PoolClient, c: Row, userId?: string) {
  const first = await client.query(
    `SELECT MIN(start_date) AS d FROM employee_contracts WHERE employee_id = $1 AND status <> 'ended'`, [c.employee_id]
  );
  await client.query(
    `UPDATE employees SET contract_type = $2, contract_start = $3, contract_end = $4,
            monthly_salary = COALESCE($5, monthly_salary), weekly_salary = COALESCE($6, weekly_salary),
            updated_by = COALESCE($7, updated_by)
      WHERE id = $1`,
    [c.employee_id, c.contract_type, iso(first.rows[0]?.d) ?? iso(c.start_date), iso(c.end_date),
     c.monthly_salary, c.weekly_salary, userId ?? null]
  );
}

async function lockActive(client: PoolClient, employeeId: string): Promise<Row> {
  const r = await client.query(`SELECT * FROM employee_contracts WHERE employee_id = $1 AND status = 'active' FOR UPDATE`, [employeeId]);
  if (!r.rows[0]) throw httpError(409, 'Aucun contrat actif pour cet employé : créez d\'abord son contrat.');
  return r.rows[0];
}

export interface ContractChanges {
  contractType?: string; category?: Category; jobTitle?: string | null; weeklyHours?: number;
  monthlySalary?: number | null; weeklySalary?: number | null; endDate?: string | null; notes?: string | null;
}

export const contractRepository = {
  async list(employeeId: string) {
    const r = await db.query(
      `SELECT c.*, u.first_name AS created_by_first_name, u.last_name AS created_by_last_name,
              (SELECT COUNT(*)::int FROM employee_documents d WHERE d.contract_id = c.id) AS documents
         FROM employee_contracts c LEFT JOIN users u ON u.id = c.created_by
        WHERE c.employee_id = $1 ORDER BY c.start_date DESC, c.created_at DESC`,
      [employeeId]
    );
    return r.rows;
  },

  /** Contrat initial (embauche ou reembauche). Periode d'essai legale par defaut. */
  async create(employeeId: string, data: ContractChanges & { startDate: string; trialEndDate?: string | null; withTrial?: boolean }, userId?: string) {
    return withTx(async client => {
      const active = await client.query(`SELECT 1 FROM employee_contracts WHERE employee_id = $1 AND status = 'active'`, [employeeId]);
      if (active.rowCount) throw httpError(409, 'Un contrat est déjà actif : faites un avenant ou clôturez-le.');
      const type = data.contractType ?? 'cdi';
      if (type === 'cdd' && !data.endDate) throw httpError(400, 'Un CDD exige une date de fin.');
      const category = data.category ?? 'employe';
      const trial = data.trialEndDate ?? (data.withTrial === false ? null : trialEndDate(data.startDate, category));
      const emp = (await client.query('SELECT monthly_salary, weekly_salary FROM employees WHERE id = $1', [employeeId])).rows[0];
      const r = await client.query(
        `INSERT INTO employee_contracts (employee_id, kind, contract_type, category, job_title, start_date, end_date,
           trial_end_date, weekly_hours, monthly_salary, weekly_salary, notes, created_by)
         VALUES ($1,'contrat',$2,$3,$4,$5,$6,$7,COALESCE($8,44),$9,$10,$11,$12) RETURNING *`,
        [employeeId, type, category, data.jobTitle ?? null, data.startDate, data.endDate ?? null, trial,
         data.weeklyHours ?? null, data.monthlySalary ?? emp?.monthly_salary ?? null, data.weeklySalary ?? emp?.weekly_salary ?? null,
         data.notes ?? null, userId ?? null]
      );
      await syncEmployee(client, r.rows[0], userId);
      return r.rows[0];
    });
  },

  /**
   * Avenant : nouvelles conditions a partir de `effectiveDate`. Le contrat en
   * cours est clos la veille (superseded) ; l'avenant reprend ce qui ne change pas.
   */
  async addAvenant(employeeId: string, effectiveDate: string, changes: ContractChanges, userId?: string) {
    return withTx(async client => {
      const cur = await lockActive(client, employeeId);
      if (effectiveDate <= iso(cur.start_date)!) throw httpError(400, 'L\'avenant doit prendre effet après le début du contrat en cours.');
      const type = changes.contractType ?? cur.contract_type;
      const endDate = changes.endDate !== undefined ? changes.endDate : (type === 'cdi' ? null : iso(cur.end_date));
      if (type === 'cdd' && !endDate) throw httpError(400, 'Un CDD exige une date de fin.');
      if (endDate && endDate < effectiveDate) throw httpError(400, 'La date de fin précède la prise d\'effet.');
      await client.query(
        `UPDATE employee_contracts SET status = 'superseded', end_date = $2 WHERE id = $1`, [cur.id, dayBefore(effectiveDate)]
      );
      const trial = cur.trial_end_date && iso(cur.trial_end_date)! >= effectiveDate ? iso(cur.trial_end_date) : null;
      const r = await client.query(
        `INSERT INTO employee_contracts (employee_id, kind, parent_id, contract_type, category, job_title, start_date, end_date,
           trial_end_date, trial_renewed, weekly_hours, monthly_salary, weekly_salary, notes, created_by)
         VALUES ($1,'avenant',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [employeeId, cur.id, type, changes.category ?? cur.category,
         changes.jobTitle !== undefined ? changes.jobTitle : cur.job_title, effectiveDate, endDate, trial, cur.trial_renewed,
         changes.weeklyHours ?? cur.weekly_hours,
         changes.monthlySalary !== undefined ? changes.monthlySalary : cur.monthly_salary,
         changes.weeklySalary !== undefined ? changes.weeklySalary : cur.weekly_salary,
         changes.notes ?? null, userId ?? null]
      );
      await syncEmployee(client, r.rows[0], userId);
      return r.rows[0];
    });
  },

  /** Renouvellement d'un contrat a terme (CDD, stage…) jusqu'a `newEnd`. */
  async renew(employeeId: string, newEnd: string, notes: string | null, userId?: string) {
    return withTx(async client => {
      const cur = await lockActive(client, employeeId);
      if (cur.contract_type === 'cdi' || !cur.end_date) throw httpError(400, 'Seul un contrat à terme se renouvelle (un CDI n\'a pas de fin).');
      const curEnd = iso(cur.end_date)!;
      if (newEnd <= curEnd) throw httpError(400, 'La nouvelle fin doit être postérieure à la fin actuelle.');
      // Chaine du contrat (contrat initial + renouvellements) pour les controles legaux.
      const chain = (await client.query(
        `WITH RECURSIVE ch AS (
           SELECT id, parent_id, kind, start_date, end_date FROM employee_contracts WHERE id = $1
           UNION ALL SELECT c.id, c.parent_id, c.kind, c.start_date, c.end_date FROM employee_contracts c JOIN ch ON c.id = ch.parent_id)
         SELECT kind, start_date, end_date FROM ch`, [cur.id]
      )).rows.map((x: Row) => ({ kind: x.kind, startDate: iso(x.start_date)!, endDate: iso(x.end_date) }));
      const warnings = cur.contract_type === 'cdd' ? cddRenewalWarnings(chain, newEnd) : [];
      await client.query(`UPDATE employee_contracts SET status = 'superseded' WHERE id = $1`, [cur.id]);
      const r = await client.query(
        `INSERT INTO employee_contracts (employee_id, kind, parent_id, contract_type, category, job_title, start_date, end_date,
           weekly_hours, monthly_salary, weekly_salary, notes, created_by)
         VALUES ($1,'renouvellement',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [employeeId, cur.id, cur.contract_type, cur.category, cur.job_title, dayAfter(curEnd), newEnd,
         cur.weekly_hours, cur.monthly_salary, cur.weekly_salary, notes, userId ?? null]
      );
      await syncEmployee(client, r.rows[0], userId);
      return { contract: r.rows[0], warnings };
    });
  },

  /** Renouvelle la periode d'essai (une seule fois, meme duree). */
  async renewTrial(employeeId: string) {
    return withTx(async client => {
      const cur = await lockActive(client, employeeId);
      if (!cur.trial_end_date) throw httpError(400, 'Ce contrat n\'a pas de période d\'essai.');
      // Duree de reference : depuis le debut du contrat initial de la chaine.
      const end = renewedTrialEnd(iso(cur.trial_end_date)!, iso(cur.start_date)!, cur.category, cur.trial_renewed);
      const r = await client.query(
        `UPDATE employee_contracts SET trial_end_date = $2, trial_renewed = true WHERE id = $1 RETURNING *`, [cur.id, end]
      );
      return r.rows[0];
    });
  },

  /** Cloture du contrat actif (fin de CDD, rupture). Le solde de tout compte suit au lot 6. */
  async end(employeeId: string, endDate: string, reason: string, userId?: string) {
    return withTx(async client => {
      const cur = await lockActive(client, employeeId);
      if (endDate < iso(cur.start_date)!) throw httpError(400, 'La date de fin précède le début du contrat.');
      const r = await client.query(
        `UPDATE employee_contracts SET status = 'ended', end_date = $2, end_reason = $3 WHERE id = $1 RETURNING *`,
        [cur.id, endDate, reason]
      );
      await client.query(`UPDATE employees SET contract_end = $2, updated_by = COALESCE($3, updated_by) WHERE id = $1`, [employeeId, endDate, userId ?? null]);
      return r.rows[0];
    });
  },

  /** Correction directe depuis la fiche employe (type, fin, salaire) : sur le contrat actif. */
  async correctActive(employeeId: string, fields: { contractType?: string; endDate?: string | null; monthlySalary?: number | null; weeklySalary?: number | null }) {
    const sets: string[] = [];
    const values: unknown[] = [employeeId];
    if (fields.contractType !== undefined) { values.push(fields.contractType); sets.push(`contract_type = $${values.length}`); }
    if (fields.endDate !== undefined) { values.push(fields.endDate || null); sets.push(`end_date = $${values.length}`); }
    if (fields.monthlySalary !== undefined) { values.push(fields.monthlySalary); sets.push(`monthly_salary = $${values.length}`); }
    if (fields.weeklySalary !== undefined) { values.push(fields.weeklySalary); sets.push(`weekly_salary = $${values.length}`); }
    if (!sets.length) return;
    await db.query(`UPDATE employee_contracts SET ${sets.join(', ')} WHERE employee_id = $1 AND status = 'active'`, values);
  },
};

// ─── Documents ──────────────────────────────────────────────────────────
export const ALLOWED_DOC_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export const employeeDocumentRepository = {
  async list(employeeId: string) {
    const r = await db.query(
      `SELECT d.id, d.employee_id, d.contract_id, d.doc_type, d.title, d.expires_on::text AS expires_on, d.file_name,
              d.mime_type, d.size_bytes, d.created_at, u.first_name AS uploaded_by_first_name
         FROM employee_documents d LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.employee_id = $1 ORDER BY d.created_at DESC`,
      [employeeId]
    );
    return r.rows;
  },
  async create(data: { employeeId: string; contractId?: string | null; docType: string; title: string; expiresOn?: string | null;
    fileName: string; mimeType: string; content: Buffer }, userId?: string) {
    if (!ALLOWED_DOC_MIME.includes(data.mimeType)) throw httpError(400, 'Format non accepté : PDF, PNG, JPG ou WebP.');
    const r = await db.query(
      `INSERT INTO employee_documents (employee_id, contract_id, doc_type, title, expires_on, file_name, mime_type, size_bytes, content, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, employee_id, contract_id, doc_type, title, expires_on::text AS expires_on, file_name, mime_type, size_bytes, created_at`,
      [data.employeeId, data.contractId ?? null, data.docType, data.title, data.expiresOn || null,
       data.fileName.slice(0, 200), data.mimeType, data.content.length, data.content, userId ?? null]
    );
    return r.rows[0];
  },
  async findWithContent(id: string) {
    return (await db.query('SELECT * FROM employee_documents WHERE id = $1', [id])).rows[0] ?? null;
  },
  async remove(id: string) {
    await db.query('DELETE FROM employee_documents WHERE id = $1', [id]);
  },
};

// ─── Alertes ────────────────────────────────────────────────────────────
export async function hrAlerts(storeId: string | undefined, horizonDays = 30) {
  const scope = storeId ? 'AND (e.store_id = $1 OR e.store_id IS NULL)' : '';
  const params = storeId ? [storeId] : [];
  const [emps, contracts, docs] = await Promise.all([
    db.query(`SELECT e.id, e.first_name, e.last_name, e.is_declared, e.cnss_number, e.cin, e.cin_expires_on::text AS cin_expires_on
                FROM employees e WHERE e.is_active = true ${scope}`, params),
    db.query(`SELECT c.employee_id, c.contract_type, c.end_date::text AS end_date, c.trial_end_date::text AS trial_end_date, c.status
                FROM employee_contracts c JOIN employees e ON e.id = c.employee_id
               WHERE c.status = 'active' AND e.is_active = true ${scope}`, params),
    db.query(`SELECT d.employee_id, d.doc_type, d.title, d.expires_on::text AS expires_on
                FROM employee_documents d JOIN employees e ON e.id = d.employee_id
               WHERE e.is_active = true ${scope}`, params),
  ]);
  const today = iso(new Date())!;
  return computeHrAlerts({
    today, horizonDays,
    employees: emps.rows.map((e: Row) => ({
      id: e.id, name: `${e.first_name} ${e.last_name}`, isDeclared: e.is_declared !== false,
      cnssNumber: e.cnss_number, cin: e.cin, cinExpiresOn: e.cin_expires_on,
    })),
    contracts: contracts.rows.map((c: Row) => ({ employeeId: c.employee_id, contractType: c.contract_type, endDate: c.end_date, trialEndDate: c.trial_end_date, status: c.status })),
    documents: docs.rows.map((d: Row) => ({ employeeId: d.employee_id, docType: d.doc_type, title: d.title, expiresOn: d.expires_on })),
  });
}
