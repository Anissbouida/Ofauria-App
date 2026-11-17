import { db, withTransaction } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * Référentiel équipement unique (M5-05). La fiche physique est production_equipements ;
 * elle se rattache à un poste de travail et à une immobilisation, et la maintenance la
 * pointe. Le rapprochement par les noms est une PROPOSITION : chaque lien se valide à la main.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s: string) => new Set(norm(s).split(' ').filter(t => t.length > 2));
/** Indice de Jaccard sur les mots de plus de deux lettres. */
export function nameSimilarity(a: string, b: string): number {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return Math.round((inter / (A.size + B.size - inter)) * 100) / 100;
}

export const equipmentLinkRepository = {
  /** Équipements, leurs liens, et pour ceux sans immobilisation les immobilisations au nom proche. */
  async overview(storeId?: string | null) {
    const eq = (await db.query(
      `SELECT e.id, e.nom, e.type, e.work_center_id, wc.name AS work_center_name, e.fixed_asset_id, fa.label AS fixed_asset_label
         FROM production_equipements e
         LEFT JOIN work_centers wc ON wc.id = e.work_center_id
         LEFT JOIN fixed_assets fa ON fa.id = e.fixed_asset_id
        WHERE e.is_active AND ($1::uuid IS NULL OR e.store_id IS NULL OR e.store_id = $1)
        ORDER BY e.nom`, [storeId ?? null])).rows;
    const assets = (await db.query(
      `SELECT fa.id, fa.label FROM fixed_assets fa
        WHERE fa.status IS DISTINCT FROM 'disposed' AND NOT EXISTS (SELECT 1 FROM production_equipements e WHERE e.fixed_asset_id = fa.id)`)).rows as { id: string; label: string }[];
    return eq.map(e => ({
      ...e,
      asset_proposals: e.fixed_asset_id ? [] : assets
        .map(a => ({ id: a.id, label: a.label, score: nameSimilarity(e.nom, a.label) }))
        .filter(a => a.score >= 0.34).sort((x, y) => y.score - x.score).slice(0, 3),
    }));
  },

  async link(equipmentId: string, patch: { workCenterId?: string | null; fixedAssetId?: string | null }) {
    const sets: string[] = []; const vals: unknown[] = [equipmentId];
    if (patch.workCenterId !== undefined) { vals.push(patch.workCenterId); sets.push(`work_center_id = $${vals.length}`); }
    if (patch.fixedAssetId !== undefined) { vals.push(patch.fixedAssetId); sets.push(`fixed_asset_id = $${vals.length}`); }
    if (!sets.length) return null;
    return (await db.query(`UPDATE production_equipements SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals)).rows[0] ?? null;
  },

  /** Arrêt de poste → demande d'intervention corrective sur le premier équipement du poste. */
  async interventionFromDowntime(downtimeId: string, ctx: { userId: string; storeId: string | null }) {
    return withTransaction(async () => {
      const d = (await db.query(
        `SELECT d.id, d.reason, d.notes, d.intervention_id, wc.name AS wc_name, wc.store_id,
                (SELECT e.id FROM production_equipements e WHERE e.work_center_id = d.work_center_id AND e.is_active ORDER BY e.nom LIMIT 1) AS equipment_id
           FROM work_center_downtime d JOIN work_centers wc ON wc.id = d.work_center_id WHERE d.id = $1 FOR UPDATE OF d`, [downtimeId])).rows[0];
      if (!d) throw new Error('Arrêt introuvable');
      if (d.intervention_id) return { id: d.intervention_id as string, created: false };
      const eq = d.equipment_id ? (await db.query(`SELECT nom, fixed_asset_id FROM production_equipements WHERE id = $1`, [d.equipment_id])).rows[0] : null;
      const client = await db.getClient();
      let number: string;
      try { number = await nextDocumentNumber(client, 'maintenance'); } finally { client.release(); }
      const id = (await db.query(
        `INSERT INTO maintenance_interventions (number, store_id, kind, priority, title, fixed_asset_id, equipment_label, equipment_id,
                                                reported_problem, created_by, status, work_center_downtime_id)
         VALUES ($1, $2, 'corrective', 'high', $3, $4, $5, $6, $7, $8, 'requested', $9) RETURNING id`,
        [number, d.store_id ?? ctx.storeId, `Arrêt ${d.wc_name} : ${d.reason}`.slice(0, 200), eq?.fixed_asset_id ?? null,
         eq?.nom ?? d.wc_name, d.equipment_id ?? null, d.notes ?? d.reason, ctx.userId, d.id])).rows[0].id as string;
      await db.query(`UPDATE work_center_downtime SET intervention_id = $2 WHERE id = $1`, [d.id, id]);
      await db.query(
        `INSERT INTO maintenance_events (intervention_id, event_type, to_value, note, created_by) VALUES ($1, 'created', 'corrective', 'Ouverte depuis un arrêt de poste', $2)`,
        [id, ctx.userId]);
      return { id, created: true };
    });
  },

  /** Intervention terminée sur l'équipement d'un poste → arrêt du poste sur la durée de l'intervention
   *  (de started_at, sinon de la fin moins downtime_hours, à completed_at), s'il n'existe pas déjà. */
  async downtimeFromIntervention(interventionId: string, userId: string | null) {
    const i = (await db.query(
      `SELECT i.id, i.title, i.started_at, i.completed_at, i.downtime_hours, i.work_center_downtime_id, e.work_center_id
         FROM maintenance_interventions i JOIN production_equipements e ON e.id = i.equipment_id
        WHERE i.id = $1 AND i.status = 'done'`, [interventionId])).rows[0];
    if (!i?.work_center_id || i.work_center_downtime_id || !i.completed_at) return null;
    const from = i.started_at ?? (i.downtime_hours != null ? new Date(new Date(i.completed_at).getTime() - Number(i.downtime_hours) * 3600_000) : null);
    if (!from) return null;
    const d = (await db.query(
      `INSERT INTO work_center_downtime (work_center_id, from_time, to_time, reason, operator_id, notes, intervention_id)
       VALUES ($1, $2, $3, 'maintenance', $4, $5, $6) RETURNING id`,
      [i.work_center_id, from, i.completed_at, userId, `Intervention : ${i.title}`.slice(0, 500), i.id])).rows[0];
    await db.query(`UPDATE maintenance_interventions SET work_center_downtime_id = $2 WHERE id = $1`, [i.id, d.id]);
    return d.id as string;
  },
};
