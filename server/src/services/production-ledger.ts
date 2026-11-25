import { db } from '../config/database.js';
import { resolvePolicy } from './policies.js';
import { postManualEntry } from './ledger-post.js';
import { postOrQueue } from './ledger-posting.service.js';

/**
 * Écritures comptables de production en option (plan d'exécution multi-industries, étape 9).
 *
 * Inventaire intermittent (défaut, Ofauria) : la production ne passe aucune écriture.
 * Inventaire permanent (politique production.ledger_entries activée) : à la clôture d'un
 * ordre, une écriture d'OD (CGNC) :
 *   3151 Produits finis              au débit   / 7132 Variation des stocks de produits  au crédit — coût de revient
 *   6124 Variation des stocks de matières au débit / 3121 Matières premières          au crédit — matières et emballages consommés
 * Une seule écriture par ordre (repérée par source_detail) ; en cas d'échec, l'écriture va
 * dans la file de comptabilisation (ou bloque, en mode strict) comme les autres modules.
 */
export const PRODUCTION_ACCOUNTS = { finishedGoods: '3151', productionVariation: '7132', materialsVariation: '6124', materials: '3121' } as const;

type Client = Parameters<typeof postManualEntry>[0];

async function entryData(runner: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }, planId: string) {
  return (await runner.query(
    `SELECT pp.of_number, pp.store_id, COALESCE(pp.completed_at, now())::date::text AS d,
            pcr.cout_total::float8 AS total, (pcr.cout_matieres + pcr.cout_emballages)::float8 AS matieres
       FROM production_plans pp JOIN production_cout_reel pcr ON pcr.plan_id = pp.id WHERE pp.id = $1`, [planId])).rows[0];
}

/** Pose l'écriture dans la transaction de l'appelant (aussi utilisé par le rejeu de la file). */
export async function writeProductionEntry(client: Client, planId: string, userId: string) {
  const row = await entryData(client, planId);
  if (!row || !(row.total > 0)) return null;
  const detail = `production:${planId}`;
  // Audit 2026-11 C-14 : écriture rejouée par la file, ou deux clôtures simultanées — une
  // seule écriture par plan. Verrou sur le plan, puis vérification dans la même transaction.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [detail]);
  const already = await client.query(
    `SELECT 1 FROM journal_entries WHERE source_detail = $1 AND status <> 'reversed' LIMIT 1`, [detail]);
  if (already.rows.length > 0) return null;
  const label = `Production ${row.of_number ?? planId.slice(0, 8)}`;
  return postManualEntry(client, {
    journal: 'OD', date: row.d, label, detail, userId, storeId: row.store_id ?? null,
    lines: [
      { code: PRODUCTION_ACCOUNTS.finishedGoods, debit: row.total, credit: 0, label: `${label} — production stockée` },
      { code: PRODUCTION_ACCOUNTS.productionVariation, debit: 0, credit: row.total, label: `${label} — production stockée` },
      { code: PRODUCTION_ACCOUNTS.materialsVariation, debit: row.matieres, credit: 0, label: `${label} — matières consommées` },
      { code: PRODUCTION_ACCOUNTS.materials, debit: 0, credit: row.matieres, label: `${label} — matières consommées` },
    ],
  });
}

export async function postProductionEntry(planId: string, userId: string): Promise<{ posted: boolean; reason?: string }> {
  const pol = await resolvePolicy<{ enabled?: boolean }>('production.ledger_entries', {});
  if (pol.value?.enabled !== true) return { posted: false, reason: 'disabled' };
  const detail = `production:${planId}`;
  const done = (await db.query(`SELECT 1 FROM journal_entries WHERE source_detail = $1 AND status = 'posted' LIMIT 1`, [detail])).rows.length > 0;
  if (done) return { posted: false, reason: 'already' };
  const row = await entryData(db, planId);
  if (!row || !(row.total > 0)) return { posted: false, reason: 'no_cost' };
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const ok = await postOrQueue(client, { kind: 'production', id: planId, detail }, () => writeProductionEntry(client, planId, userId));
    await client.query('COMMIT');
    return { posted: ok, reason: ok ? undefined : 'queued' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
