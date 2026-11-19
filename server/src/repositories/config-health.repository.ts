import { db } from '../config/database.js';

/**
 * Requêtes du bilan de santé de la configuration (C-04, contrôles enrichis).
 *
 * Chaque fonction rend le nombre total d'éléments en cause et au plus ITEM_LIMIT d'entre
 * eux (identifiant, libellé, lien vers la fiche) : l'écran affiche le compteur et la liste.
 * Rien n'est écrit. Analogie Oracle : des curseurs de contrôle d'un package de diagnostic.
 */
export const ITEM_LIMIT = 200;

export type HealthItem = { id: string; label: string; to: string };
export type HealthFinding = { total: number; items: HealthItem[] };

async function finding(sql: string, params: unknown[] = []): Promise<HealthFinding> {
  const { rows } = await db.query(`SELECT q.*, count(*) OVER () AS total FROM (${sql}) q LIMIT ${ITEM_LIMIT}`, params);
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    items: rows.map(r => ({ id: String(r.id), label: String(r.label), to: String(r.to) })),
  };
}

/** Clé de droit qui permet de clôturer une inspection et de libérer un lot (routes /quality). */
export const QUALITY_RELEASE_PERMISSION = 'controle.quality.inspections';

export const configHealthRepository = {
  /** Types d'ordre actifs dont la série de numérotation n'existe pas (la création d'ordre échoue). */
  orderTypesWithoutSequence(): Promise<HealthFinding> {
    return finding(
      `SELECT t.id, t.label || ' (série « ' || t.sequence_doc_type || ' » introuvable)' AS label, '/production/settings' AS "to"
         FROM production_order_types t
        WHERE t.is_active AND NOT EXISTS (SELECT 1 FROM document_sequences s WHERE s.doc_type = t.sequence_doc_type)
        ORDER BY t.display_order, t.label`);
  },

  /** Types d'ordre actifs sans atelier par défaut, ou dont l'atelier est inconnu ou inactif. */
  orderTypesWithoutWorkshop(): Promise<HealthFinding> {
    return finding(
      `SELECT t.id,
              t.label || CASE WHEN t.default_target_role IS NULL THEN ' (aucun atelier par défaut)'
                              ELSE ' (atelier « ' || t.default_target_role || ' » inconnu ou inactif)' END AS label,
              '/production/settings' AS "to"
         FROM production_order_types t
        WHERE t.is_active
          AND NOT EXISTS (SELECT 1 FROM production_workshops w WHERE w.code = t.default_target_role AND w.is_active)
        ORDER BY t.display_order, t.label`);
  },

  /** Types d'ordre actifs et les étapes qu'ils exigent (pour confronter aux modules actifs). */
  async activeOrderTypeRequirements(): Promise<{ id: string; label: string; needsStock: boolean; needsQuality: boolean; needsSubcontracting: boolean }[]> {
    const { rows } = await db.query(
      `SELECT id, label, (requires_bon_sortie OR requires_weighing) AS needs_stock, requires_quality_check AS needs_quality,
              is_subcontracting AS needs_subcontracting
         FROM production_order_types WHERE is_active ORDER BY display_order, label`);
    return rows.map(r => ({ id: r.id, label: r.label, needsStock: r.needs_stock, needsQuality: r.needs_quality, needsSubcontracting: r.needs_subcontracting }));
  },

  /**
   * Articles dont une ligne de nomenclature (unité de fabrication) ne se convertit pas vers
   * l'unité de stock : ni même dimension, ni conversion propre à l'article (densité, poids
   * par pièce, contenant, saisie) — vue v_impossible_unit_conversions_v2 (mig 556).
   */
  unconvertibleItemUnits(): Promise<HealthFinding> {
    return finding(
      `SELECT v.ingredient_id AS id,
              v.ingredient_name || ' : ' || string_agg(DISTINCT v.line_unit, ', ') || ' → ' || max(v.stock_unit)
                || ' (' || count(DISTINCT v.recipe_id) || ' fiche(s))' AS label,
              '/stock/' || v.ingredient_id AS "to"
         FROM v_impossible_unit_conversions_v2 v
        GROUP BY v.ingredient_id, v.ingredient_name
        ORDER BY v.ingredient_name`);
  },

  /** Nomenclatures (fiches non archivées) sans version active (mig 559) : les ordres n'en figent aucune. */
  recipesWithoutActiveVersion(): Promise<HealthFinding> {
    return finding(
      `SELECT r.id, r.name AS label, '/recipes/' || r.id || '/nomenclature' AS "to"
         FROM recipes r
        WHERE r.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM bom_versions b WHERE b.recipe_id = r.id AND b.status = 'active')
        ORDER BY r.name`);
  },

  /** Gammes actives sans opération, ou dont une opération n'a pas de poste de charge actif. */
  routingsWithoutWorkCenter(): Promise<HealthFinding> {
    return finding(
      `SELECT ro.id,
              ro.name || CASE WHEN NOT EXISTS (SELECT 1 FROM routing_operations o WHERE o.routing_id = ro.id)
                              THEN ' (aucune opération)'
                              ELSE ' (' || (SELECT count(*) FROM routing_operations o LEFT JOIN work_centers wc ON wc.id = o.work_center_id
                                             WHERE o.routing_id = ro.id AND (wc.id IS NULL OR NOT wc.is_active)) || ' opération(s) sans poste)' END AS label,
              CASE WHEN ro.recipe_id IS NOT NULL THEN '/recipes/' || ro.recipe_id || '/nomenclature' ELSE '/production/work-centers' END AS "to"
         FROM routings ro
        WHERE ro.is_active
          AND (NOT EXISTS (SELECT 1 FROM routing_operations o WHERE o.routing_id = ro.id)
               OR EXISTS (SELECT 1 FROM routing_operations o LEFT JOIN work_centers wc ON wc.id = o.work_center_id
                           WHERE o.routing_id = ro.id AND (wc.id IS NULL OR NOT wc.is_active)))
        ORDER BY ro.name`);
  },

  /** Postes de charge actifs sans aucun créneau de calendrier (mig 568). */
  workCentersWithoutCalendar(): Promise<HealthFinding> {
    return finding(
      `SELECT wc.id, wc.name AS label, '/production/work-centers' AS "to"
         FROM work_centers wc
        WHERE wc.is_active AND NOT EXISTS (SELECT 1 FROM work_center_calendar c WHERE c.work_center_id = wc.id)
        ORDER BY wc.name`);
  },

  /** Lignes actives et bloquantes du plan de contrôle (mig 573). */
  blockingQualityLines(): Promise<HealthFinding> {
    return finding(
      `SELECT l.id,
              l.characteristic || ' — ' || CASE l.stage WHEN 'reception' THEN 'réception' WHEN 'en_cours' THEN 'en cours' ELSE 'final' END
                || COALESCE(' — ' || COALESCE(p.name, i.name), '') AS label,
              '/controle?tab=qualite' AS "to"
         FROM quality_control_plan_lines l
         LEFT JOIN products p ON p.id = l.product_id
         LEFT JOIN ingredients i ON i.id = l.ingredient_id
        WHERE l.is_active AND l.is_blocking
        ORDER BY l.stage, l.characteristic`);
  },

  /**
   * Utilisateurs actifs qui détiennent une clé de droit — même règle que hasPermission
   * (services/permissions.ts) : l'exception utilisateur prime ; sinon un de ses rôles
   * (rôles propres, à défaut users.role, plus délégations en cours) détient la clé.
   */
  async activeUsersWithPermission(key: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM users u
        WHERE u.is_active
          AND COALESCE(
                (SELECT o.granted FROM user_action_permissions o WHERE o.user_id = u.id AND o.permission_key = $1),
                EXISTS (SELECT 1 FROM role_action_permissions p
                         WHERE p.permission_key = $1
                           AND p.role_code IN (
                             SELECT ur.role_code FROM user_roles ur WHERE ur.user_id = u.id
                             UNION ALL
                             SELECT u.role WHERE NOT EXISTS (SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = u.id)
                             UNION ALL
                             SELECT d.role_code FROM role_delegations d WHERE d.to_user_id = u.id AND now() BETWEEN d.starts_at AND d.ends_at)))`,
      [key]);
    return rows[0].n;
  },
};
