import { db, withTransaction } from '../config/database.js';
import { ACTIONS, CONDITIONS, GUARDS, TECH_STATUSES, isAction, isCondition, isGuard } from '../services/process-catalog.js';

/**
 * Éditeur de parcours (plan d'exécution multi-industries, étape 5, pas 5d-5e).
 *
 * Un parcours se COMPOSE à partir du catalogue fermé (gardes, actions, conditions) ; il se
 * rattache aux états techniques existants. Une modification crée un BROUILLON ; la
 * publication archive la version publiée et la remplace. Les ordres déjà confirmés gardent
 * leur exécution figée (étape 4) ; le moteur ne lit que la version publiée.
 */
export type StageInput = {
  code: string; label: string; techStatus: string;
  guards?: string[]; actions?: string[];
  documentKey?: string | null; responsibleRole?: string | null; delayMinutes?: number | null;
  conditionKey?: string | null; parallelGroup?: string | null; requiredFields?: string[]; allowResume?: boolean;
};

const DOCUMENT_KEYS = ['ordre_fabrication', 'bon_sortie', 'fiche_suivi', 'rapport_production', 'bon_transfert', 'certificat_conformite', 'fiche_controle', 'etiquette_lot'];

function mapStage(r: Record<string, any>) {
  return {
    id: r.id, code: r.code, label: r.label, sequence: r.sequence, techStatus: r.tech_status,
    guards: r.guards ?? [], actions: r.actions ?? [], documentKey: r.document_key, responsibleRole: r.responsible_role,
    delayMinutes: r.delay_minutes, conditionKey: r.condition_key, parallelGroup: r.parallel_group,
    requiredFields: r.required_fields ?? [], allowResume: r.allow_resume,
  };
}

/** Contrôle d'un parcours ; renvoie la liste des erreurs (vide = valide). */
export function validateStages(stages: StageInput[]): string[] {
  const errs: string[] = [];
  if (!Array.isArray(stages) || stages.length < 2) return ['Un parcours compte au moins deux étapes.'];
  const codes = new Set<string>();
  let prevRank = -1; let prevGroup: string | null = null; const closedGroups = new Set<string>();
  stages.forEach((s, i) => {
    const n = `Étape ${i + 1}${s.label ? ` (${s.label})` : ''}`;
    if (!s.code || !/^[a-z][a-z0-9_]{1,39}$/.test(s.code)) errs.push(`${n} : code invalide (minuscules, chiffres, _).`);
    if (codes.has(s.code)) errs.push(`${n} : code « ${s.code} » en double.`);
    codes.add(s.code);
    if (!s.label?.trim()) errs.push(`${n} : libellé requis.`);
    const rank = (TECH_STATUSES as readonly string[]).indexOf(s.techStatus);
    if (rank < 0) errs.push(`${n} : état technique inconnu « ${s.techStatus} ».`);
    else if (rank < prevRank) errs.push(`${n} : l'état technique ne peut pas revenir en arrière.`);
    for (const g of s.guards ?? []) if (!isGuard(g)) errs.push(`${n} : garde inconnue « ${g} ».`);
    for (const a of s.actions ?? []) if (!isAction(a)) errs.push(`${n} : action inconnue « ${a} ».`);
    if (s.conditionKey && !isCondition(s.conditionKey)) errs.push(`${n} : condition inconnue « ${s.conditionKey} ».`);
    if (s.documentKey && !DOCUMENT_KEYS.includes(s.documentKey)) errs.push(`${n} : document inconnu « ${s.documentKey} ».`);
    if (s.delayMinutes != null && (!Number.isInteger(s.delayMinutes) || s.delayMinutes < 0)) errs.push(`${n} : délai invalide.`);
    // Groupe parallèle : étapes contiguës, même état technique.
    const g = s.parallelGroup?.trim() || null;
    if (g) {
      if (closedGroups.has(g)) errs.push(`${n} : les étapes du groupe parallèle « ${g} » doivent se suivre.`);
      if (g === prevGroup && stages[i - 1].techStatus !== s.techStatus) errs.push(`${n} : un groupe parallèle partage le même état technique.`);
    }
    if (prevGroup && prevGroup !== g) closedGroups.add(prevGroup);
    prevGroup = g; if (rank >= 0) prevRank = Math.max(prevRank, rank);
  });
  if (stages[0] && stages[0].techStatus !== 'draft') errs.push('La première étape doit être à l\'état « brouillon » (planification).');
  if (!stages.some(s => s.techStatus === 'in_progress')) errs.push('Le parcours doit comporter une étape « en cours » (fabrication).');
  if (!stages.some(s => s.techStatus === 'completed')) errs.push('Le parcours doit se terminer par une étape « terminé ».');
  return errs;
}

async function modelWithStages(id: number, runner = db) {
  const m = (await runner.query(`SELECT * FROM process_models WHERE id = $1`, [id])).rows[0];
  if (!m) return null;
  const st = (await runner.query(`SELECT * FROM process_stages WHERE model_id = $1 ORDER BY sequence`, [id])).rows;
  return {
    id: m.id, orderTypeCode: m.order_type_code, versionNo: m.version_no, status: m.status, label: m.label,
    createdAt: m.created_at, publishedAt: m.published_at, stages: st.map(mapStage),
  };
}

export const processModelRepository = {
  catalog() {
    return {
      guards: Object.values(GUARDS).map(g => ({ key: g.key, label: g.label, description: g.description })),
      actions: Object.values(ACTIONS),
      conditions: Object.values(CONDITIONS).map(c => ({ key: c.key, label: c.label })),
      techStatuses: [...TECH_STATUSES],
      documents: DOCUMENT_KEYS,
    };
  },

  /** Types d'ordre avec leur version publiée et leur brouillon éventuel. */
  async overview() {
    const rows = (await db.query(
      `SELECT t.code, t.label,
              (SELECT id FROM process_models m WHERE m.order_type_code = t.code AND m.status = 'publie') AS published_id,
              (SELECT id FROM process_models m WHERE m.order_type_code = t.code AND m.status = 'brouillon' ORDER BY version_no DESC LIMIT 1) AS draft_id,
              (SELECT count(*)::int FROM process_models m WHERE m.order_type_code = t.code) AS versions
         FROM production_order_types t WHERE t.is_active IS NOT FALSE ORDER BY t.display_order, t.label`)).rows;
    return Promise.all(rows.map(async r => ({
      orderTypeCode: r.code, orderTypeLabel: r.label, versions: r.versions,
      published: r.published_id ? await modelWithStages(r.published_id) : null,
      draft: r.draft_id ? await modelWithStages(r.draft_id) : null,
    })));
  },

  async history(orderTypeCode: string) {
    return (await db.query(
      `SELECT id, version_no, status, label, created_at, published_at FROM process_models WHERE order_type_code = $1 ORDER BY version_no DESC`,
      [orderTypeCode])).rows;
  },

  get: (id: number) => modelWithStages(id),

  /** Enregistre le brouillon du type d'ordre (le crée au besoin, remplace ses étapes). */
  async saveDraft(orderTypeCode: string, input: { label?: string; stages: StageInput[] }, userId?: string | null)
    : Promise<{ error: string; details?: string[] } | { model: NonNullable<Awaited<ReturnType<typeof modelWithStages>>> }> {
    const ot = (await db.query(`SELECT code FROM production_order_types WHERE code = $1`, [orderTypeCode])).rows[0];
    if (!ot) return { error: 'Type d\'ordre inconnu' };
    const errs = validateStages(input.stages);
    if (errs.length) return { error: 'Parcours invalide', details: errs };
    return withTransaction(async () => {
      const client = db;
      let draft = (await client.query(
        `SELECT id FROM process_models WHERE order_type_code = $1 AND status = 'brouillon' ORDER BY version_no DESC LIMIT 1 FOR UPDATE`, [orderTypeCode])).rows[0];
      if (!draft) {
        draft = (await client.query(
          `INSERT INTO process_models (order_type_code, version_no, status, label, created_by)
           VALUES ($1::varchar, (SELECT COALESCE(max(version_no), 0) + 1 FROM process_models WHERE order_type_code = $1::varchar), 'brouillon', $2, $3) RETURNING id`,
          [orderTypeCode, input.label?.trim() || 'Parcours', userId ?? null])).rows[0];
      } else if (input.label?.trim()) {
        await client.query(`UPDATE process_models SET label = $2 WHERE id = $1`, [draft.id, input.label.trim()]);
      }
      await client.query(`DELETE FROM process_stages WHERE model_id = $1`, [draft.id]);
      let seq = 0;
      for (const s of input.stages) {
        seq += 10;
        await client.query(
          `INSERT INTO process_stages (model_id, code, label, sequence, tech_status, guards, actions, document_key, responsible_role,
                                       delay_minutes, condition_key, parallel_group, required_fields, allow_resume)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [draft.id, s.code, s.label.trim(), seq, s.techStatus, s.guards ?? [], s.actions ?? [], s.documentKey || null,
            s.responsibleRole || null, s.delayMinutes ?? null, s.conditionKey || null, s.parallelGroup?.trim() || null,
            s.requiredFields ?? [], s.allowResume !== false]);
      }
      return { model: (await modelWithStages(draft.id, client))! };
    });
  },

  /** Publie un brouillon : la version publiée passe en archive. */
  async publish(modelId: number): Promise<{ error: string } | { model: NonNullable<Awaited<ReturnType<typeof modelWithStages>>> }> {
    return withTransaction(async () => {
      const client = db;
      const m = (await client.query(`SELECT * FROM process_models WHERE id = $1 FOR UPDATE`, [modelId])).rows[0];
      if (!m) return { error: 'Parcours introuvable' };
      if (m.status !== 'brouillon') return { error: 'Seul un brouillon se publie' };
      const st = (await client.query(`SELECT * FROM process_stages WHERE model_id = $1 ORDER BY sequence`, [modelId])).rows.map(mapStage);
      const errs = validateStages(st as StageInput[]);
      if (errs.length) return { error: `Parcours invalide : ${errs[0]}` };
      await client.query(`UPDATE process_models SET status = 'archive' WHERE order_type_code = $1 AND status = 'publie'`, [m.order_type_code]);
      await client.query(`UPDATE process_models SET status = 'publie', published_at = now() WHERE id = $1`, [modelId]);
      return { model: (await modelWithStages(modelId, client))! };
    });
  },

  async discardDraft(modelId: number): Promise<{ error: string } | { ok: true }> {
    const r = await db.query(`DELETE FROM process_models WHERE id = $1 AND status = 'brouillon'`, [modelId]);
    return r.rowCount ? { ok: true } : { error: 'Brouillon introuvable' };
  },

  /** Journal du mode ombre (désaccords moteur / code actuel). */
  async shadowLog(limit = 100) {
    return (await db.query(
      `SELECT l.*, pp.of_number FROM process_shadow_log l LEFT JOIN production_plans pp ON pp.id = l.plan_id
        ORDER BY l.created_at DESC LIMIT $1`, [limit])).rows;
  },
};
