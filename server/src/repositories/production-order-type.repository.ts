import { db, withTransaction } from '../config/database.js';
import { productionImpactRepository } from './production-impact.repository.js';

/**
 * Types d'ordre de fabrication (M2-01, mig 546).
 * Un type dit quelles étapes du parcours s'appliquent : bon de sortie (et donc
 * consommation au bon), pesage, contrôle. Le type « PLAN_JOUR » reproduit le parcours
 * historique ; c'est le type par défaut de tout plan créé sans type.
 * Lu par production.repository (confirm / start) via `forPlan`.
 */
export type ConsumptionMode = 'au_bon_de_sortie' | 'a_la_declaration' | 'manuel';

export interface OrderType {
  id: string;
  code: string;
  label: string;
  description: string | null;
  requires_bon_sortie: boolean;
  requires_weighing: boolean;
  requires_quality_check: boolean;
  /** Sous-traité (mig 584) : envoi des composants, réception du produit fini, coût de façon. */
  is_subcontracting?: boolean;
  consumption_mode: ConsumptionMode;
  sequence_doc_type: string;
  default_target_role: string | null;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
  plan_count?: number;
}

export interface OrderTypeInput {
  code?: string;
  label?: string;
  description?: string | null;
  requiresBonSortie?: boolean;
  requiresWeighing?: boolean;
  requiresQualityCheck?: boolean;
  isSubcontracting?: boolean;
  consumptionMode?: ConsumptionMode;
  defaultTargetRole?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  displayOrder?: number;
}

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Cohérence des étapes : sans bon de sortie, ni pesage ni consommation au bon. */
function normalize(cur: Partial<OrderType>, input: OrderTypeInput) {
  // Sous-traité (mig 584) : ni bon de sortie ni pesage chez nous, matières déduites à la réception.
  const subcontracting = input.isSubcontracting ?? cur.is_subcontracting ?? false;
  if (subcontracting) return { requiresBon: false, weighing: false, mode: 'a_la_declaration' as ConsumptionMode, subcontracting };
  const requiresBon = input.requiresBonSortie ?? cur.requires_bon_sortie ?? true;
  let weighing = input.requiresWeighing ?? cur.requires_weighing ?? requiresBon;
  let mode: ConsumptionMode = input.consumptionMode ?? cur.consumption_mode ?? (requiresBon ? 'au_bon_de_sortie' : 'a_la_declaration');
  if (!requiresBon) {
    weighing = false;
    if (mode === 'au_bon_de_sortie') mode = 'a_la_declaration';
  }
  return { requiresBon, weighing, mode, subcontracting };
}

export const productionOrderTypeRepository = {
  async list(includeInactive = true): Promise<OrderType[]> {
    const r = await db.query(
      `SELECT t.*, (SELECT COUNT(*)::int FROM production_plans p WHERE p.order_type_id = t.id) AS plan_count
         FROM production_order_types t
        ${includeInactive ? '' : 'WHERE t.is_active'}
        ORDER BY t.display_order, t.label`);
    return r.rows;
  },

  async get(id: string): Promise<OrderType | null> {
    return (await db.query(`SELECT * FROM production_order_types WHERE id = $1`, [id])).rows[0] ?? null;
  },

  /** Type d'un plan (le type par défaut si le plan n'en a pas — cas impossible après mig 546). */
  async forPlan(planId: string, runner: Runner = db): Promise<OrderType> {
    const r = await runner.query(
      `SELECT t.* FROM production_order_types t
        WHERE t.id = COALESCE((SELECT order_type_id FROM production_plans WHERE id = $1),
                              (SELECT id FROM production_order_types WHERE is_default LIMIT 1))`, [planId]);
    if (!r.rows[0]) throw new Error('Type d\'ordre introuvable');
    return r.rows[0];
  },

  async create(input: OrderTypeInput, userId: string): Promise<OrderType> {
    const code = (input.code ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) throw new Error('Code invalide (lettres majuscules, chiffres, _ ; 2 à 30 caractères)');
    if (!input.label?.trim()) throw new Error('Libellé requis');
    const { requiresBon, weighing, mode, subcontracting } = normalize({}, input);
    return withTransaction(async () => {
      if (input.isDefault) await db.query(`UPDATE production_order_types SET is_default = false WHERE is_default`);
      const r = await db.query(
        `INSERT INTO production_order_types (code, label, description, requires_bon_sortie, requires_weighing, requires_quality_check,
                                             consumption_mode, default_target_role, is_default, is_active, display_order, updated_by, is_subcontracting)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [code, input.label!.trim(), input.description ?? null, requiresBon, weighing, input.requiresQualityCheck ?? false,
         mode, input.defaultTargetRole || null, input.isDefault ?? false, input.isActive ?? true, input.displayOrder ?? 100, userId, subcontracting]);
      return r.rows[0];
    });
  },

  async update(id: string, input: OrderTypeInput, userId: string): Promise<OrderType> {
    return withTransaction(async () => {
      const cur = (await db.query(`SELECT * FROM production_order_types WHERE id = $1 FOR UPDATE`, [id])).rows[0] as OrderType | undefined;
      if (!cur) throw new Error('Type d\'ordre introuvable');
      if (cur.is_default && input.isActive === false) throw new Error('Le type par défaut ne peut pas être désactivé : choisissez d\'abord un autre type par défaut');
      if (cur.is_default && input.isDefault === false) throw new Error('Un type doit rester par défaut : cochez « par défaut » sur un autre type');
      const { requiresBon, weighing, mode, subcontracting } = normalize(cur, input);
      // C-09 : les étapes d'un type ne changent pas sous des ordres déjà engagés (bon de sortie
      // généré, consommation choisie à la confirmation) ; un brouillon prendra le nouveau réglage.
      const stepsChanged = requiresBon !== cur.requires_bon_sortie || weighing !== cur.requires_weighing
        || mode !== cur.consumption_mode || subcontracting !== !!cur.is_subcontracting;
      if (stepsChanged) {
        const impact = await productionImpactRepository.forOrderType(id);
        if (impact.underway > 0) {
          throw new Error(`${impact.underway} ordre(s) de ce type sont en cours : terminez-les, ou créez un nouveau type avec ces étapes.`);
        }
      }
      if (input.isDefault) await db.query(`UPDATE production_order_types SET is_default = false WHERE is_default AND id <> $1`, [id]);
      const r = await db.query(
        `UPDATE production_order_types
            SET label = $2, description = $3, requires_bon_sortie = $4, requires_weighing = $5, requires_quality_check = $6,
                consumption_mode = $7, default_target_role = $8, is_default = $9, is_active = $10, display_order = $11,
                updated_by = $12, is_subcontracting = $13, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, input.label?.trim() || cur.label, input.description !== undefined ? input.description : cur.description,
         requiresBon, weighing, input.requiresQualityCheck ?? cur.requires_quality_check, mode,
         input.defaultTargetRole !== undefined ? (input.defaultTargetRole || null) : cur.default_target_role,
         input.isDefault ?? cur.is_default, input.isActive ?? cur.is_active, input.displayOrder ?? cur.display_order, userId, subcontracting]);
      return r.rows[0];
    });
  },
};
