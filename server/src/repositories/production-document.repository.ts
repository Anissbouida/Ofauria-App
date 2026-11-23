import { db } from '../config/database.js';

/**
 * Registre des documents de production (plan d'exécution multi-industries, étape 6, mig 640).
 *
 * Règle : un document n'est que la TRACE d'un enregistrement. Le désactiver retire le
 * document (impression, génération) ; la pesée, la déclaration ou le transfert dont il est
 * la trace restent possibles. Obligatoire implique activé.
 */
export type ProductionDocument = {
  docKey: string; label: string; description: string | null; enabled: boolean; mandatory: boolean;
  generation: 'auto' | 'manuel'; stageCode: string | null; approvalDocType: string | null;
  sequenceDocType: string | null; templateDocType: string | null; recordLabel: string | null; sortOrder: number;
};

/** Registre absent (base antérieure à la mig 640) : seule erreur tolérée. */
const missingTable = (e: unknown) => (e as { code?: string })?.code === '42P01';

const map = (r: Record<string, any>): ProductionDocument => ({
  docKey: r.doc_key, label: r.label, description: r.description, enabled: r.enabled, mandatory: r.mandatory,
  generation: r.generation, stageCode: r.stage_code, approvalDocType: r.approval_doc_type,
  sequenceDocType: r.sequence_doc_type, templateDocType: r.template_doc_type, recordLabel: r.record_label, sortOrder: r.sort_order,
});

export const productionDocumentRepository = {
  async list(): Promise<ProductionDocument[]> {
    try {
      return (await db.query(`SELECT * FROM production_documents ORDER BY sort_order, doc_key`)).rows.map(map);
    } catch (e) { if (missingTable(e)) return []; throw e; }
  },

  /** Document actif ? Inconnu ou registre absent = actif (comportement historique). */
  async isEnabled(docKey: string): Promise<boolean> {
    try {
      const r = (await db.query(`SELECT enabled FROM production_documents WHERE doc_key = $1`, [docKey])).rows[0];
      return r ? r.enabled === true : true;
    } catch (e) { if (missingTable(e)) return true; throw e; }
  },

  async update(docKey: string, patch: { enabled?: boolean; mandatory?: boolean; generation?: 'auto' | 'manuel'; stageCode?: string | null }, userId?: string | null)
    : Promise<{ error: string } | ProductionDocument> {
    const cur = (await db.query(`SELECT * FROM production_documents WHERE doc_key = $1`, [docKey])).rows[0];
    if (!cur) return { error: 'Document inconnu' };
    let enabled = patch.enabled ?? cur.enabled;
    let mandatory = patch.mandatory ?? cur.mandatory;
    if (patch.mandatory === true) enabled = true;          // obligatoire => activé
    if (patch.enabled === false) mandatory = false;        // désactivé => plus obligatoire
    const generation = patch.generation ?? cur.generation;
    if (!['auto', 'manuel'].includes(generation)) return { error: 'Mode de génération inconnu' };
    const stage = patch.stageCode !== undefined ? (patch.stageCode || null) : cur.stage_code;
    const r = await db.query(
      `UPDATE production_documents SET enabled = $2, mandatory = $3, generation = $4, stage_code = $5, updated_by = $6, updated_at = now()
        WHERE doc_key = $1 RETURNING *`, [docKey, enabled, mandatory, generation, stage, userId ?? null]);
    return map(r.rows[0]);
  },
};
